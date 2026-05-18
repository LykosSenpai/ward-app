import "../env/loadEnvFile.js";

import { createHash } from "node:crypto";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import type { PoolClient } from "pg";

import { closeDbPool, getDbPool } from "../db/pool.js";

type ArchiveKind = "MONTHLY" | "YEARLY";
type SupportTicketStatus = "OPEN" | "TRIAGED" | "RESOLVED" | "DISMISSED";

type Period = {
  start: string;
  end: string;
  label: string;
};

type SupportTicketArchiveTicket = {
  id: string;
  reporterUserId: string | null;
  matchId: string;
  subject: string;
  description: string;
  category: string;
  severity: string;
  status: SupportTicketStatus;
  matchSnapshot: Record<string, unknown> | null;
  matchSnapshotKey: string | null;
  clientContext: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

type SupportTicketArchiveSnapshot = {
  matchId: string;
  snapshotKey: string;
  matchSnapshot: Record<string, unknown>;
  createdAt: string;
};

type MonthlyArchivePayload = {
  schemaVersion: 1;
  archiveKind: "MONTHLY";
  archivedAt: string;
  periodStart: string;
  periodEnd: string;
  tickets: SupportTicketArchiveTicket[];
  snapshots: SupportTicketArchiveSnapshot[];
};

type YearlyArchivePayload = {
  schemaVersion: 1;
  archiveKind: "YEARLY";
  archivedAt: string;
  periodStart: string;
  periodEnd: string;
  sourceArchiveIds: string[];
  sourcePeriods: Array<{ periodStart: string; periodEnd: string }>;
  tickets: SupportTicketArchiveTicket[];
  snapshots: SupportTicketArchiveSnapshot[];
};

type TicketRow = {
  id: string;
  reporter_user_id: string | null;
  match_id: string;
  subject: string;
  description: string;
  category: string;
  severity: string;
  status: SupportTicketStatus;
  match_snapshot: Record<string, unknown> | null;
  match_snapshot_key: string | null;
  client_context: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type SnapshotRow = {
  match_id: string;
  snapshot_key: string;
  match_snapshot: Record<string, unknown>;
  created_at: Date | string;
};

type ArchiveRow = {
  id: string;
  period_start: Date | string;
  period_end: Date | string;
  payload: Buffer;
};

type ArchiveItemRow = {
  ticket_id: string;
  match_id: string;
  ticket_category: string;
  ticket_status: string;
  ticket_created_at: Date | string;
};

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const yearly = args.includes("--yearly");
const includeCurrent = args.includes("--include-current");

function readArg(name: string): string | undefined {
  const prefix = `${name}=`;
  return args.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}

function serializeTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function serializeDateOnly(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildMonthPeriod(month: string): Period {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("--month must use YYYY-MM format.");
  }

  const start = new Date(`${month}-01T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    throw new Error("--month must be a valid YYYY-MM value.");
  }

  return {
    start: formatDate(start),
    end: formatDate(addMonths(start, 1)),
    label: month
  };
}

function buildYearPeriod(year: number): Period {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error("--year must be a four-digit year.");
  }

  return {
    start: `${year}-01-01`,
    end: `${year + 1}-01-01`,
    label: String(year)
  };
}

function serializeTicket(row: TicketRow): SupportTicketArchiveTicket {
  return {
    id: row.id,
    reporterUserId: row.reporter_user_id,
    matchId: row.match_id,
    subject: row.subject,
    description: row.description,
    category: row.category,
    severity: row.severity,
    status: row.status,
    matchSnapshot: row.match_snapshot,
    matchSnapshotKey: row.match_snapshot_key,
    clientContext: row.client_context,
    createdAt: serializeTimestamp(row.created_at),
    updatedAt: serializeTimestamp(row.updated_at)
  };
}

function serializeSnapshot(row: SnapshotRow): SupportTicketArchiveSnapshot {
  return {
    matchId: row.match_id,
    snapshotKey: row.snapshot_key,
    matchSnapshot: row.match_snapshot,
    createdAt: serializeTimestamp(row.created_at)
  };
}

function compressPayload(payload: MonthlyArchivePayload | YearlyArchivePayload): { compressed: Buffer; sha256: string } {
  const json = Buffer.from(JSON.stringify(payload), "utf-8");
  const compressed = brotliCompressSync(json);
  return {
    compressed,
    sha256: createHash("sha256").update(compressed).digest("hex")
  };
}

function decompressMonthlyArchive(row: ArchiveRow): MonthlyArchivePayload {
  return JSON.parse(brotliDecompressSync(row.payload).toString("utf-8")) as MonthlyArchivePayload;
}

async function listMonthlyPeriods(): Promise<Period[]> {
  const month = readArg("--month");
  if (month) return [buildMonthPeriod(month)];

  const whereCurrent = includeCurrent ? "" : "and created_at < date_trunc('month', now())";
  const result = await getDbPool().query<{ period_start: Date | string; period_end: Date | string }>(
    `select date_trunc('month', created_at)::date as period_start,
            (date_trunc('month', created_at) + interval '1 month')::date as period_end
       from support_tickets
      where status in ('RESOLVED', 'DISMISSED')
        ${whereCurrent}
      group by 1, 2
      order by 1 asc`
  );

  return result.rows.map(row => ({
    start: serializeDateOnly(row.period_start),
    end: serializeDateOnly(row.period_end),
    label: serializeDateOnly(row.period_start).slice(0, 7)
  }));
}

async function loadMonthlyPayload(client: PoolClient, period: Period): Promise<MonthlyArchivePayload> {
  const ticketResult = await client.query<TicketRow>(
    `select id,
            reporter_user_id,
            match_id,
            subject,
            description,
            category,
            severity,
            status,
            match_snapshot,
            match_snapshot_key,
            client_context,
            created_at,
            updated_at
       from support_tickets
      where status in ('RESOLVED', 'DISMISSED')
        and created_at >= $1::date
        and created_at < $2::date
      order by created_at asc, id asc`,
    [period.start, period.end]
  );

  const ticketIds = ticketResult.rows.map(row => row.id);
  let snapshots: SupportTicketArchiveSnapshot[] = [];
  if (ticketIds.length > 0) {
    const snapshotResult = await client.query<SnapshotRow>(
      `select distinct snapshot.match_id,
                       snapshot.snapshot_key,
                       snapshot.match_snapshot,
                       snapshot.created_at
         from support_ticket_match_snapshots snapshot
         join support_tickets ticket
           on ticket.match_id = snapshot.match_id
          and ticket.match_snapshot_key = snapshot.snapshot_key
        where ticket.id = any($1::uuid[])
        order by snapshot.created_at asc`,
      [ticketIds]
    );
    snapshots = snapshotResult.rows.map(serializeSnapshot);
  }

  return {
    schemaVersion: 1,
    archiveKind: "MONTHLY",
    archivedAt: new Date().toISOString(),
    periodStart: period.start,
    periodEnd: period.end,
    tickets: ticketResult.rows.map(serializeTicket),
    snapshots
  };
}

async function insertArchive(
  client: PoolClient,
  archiveKind: ArchiveKind,
  period: Period,
  payload: MonthlyArchivePayload | YearlyArchivePayload
): Promise<string> {
  const { compressed, sha256 } = compressPayload(payload);
  const ticketCount = payload.tickets.length;
  const snapshotCount = payload.snapshots.length;
  const archiveResult = await client.query<{ id: string }>(
    `insert into support_ticket_archives (
       archive_kind,
       period_start,
       period_end,
       ticket_count,
       snapshot_count,
       compression,
       payload_sha256,
       payload
     )
     values ($1,$2::date,$3::date,$4,$5,'brotli-json',$6,$7)
     returning id`,
    [archiveKind, period.start, period.end, ticketCount, snapshotCount, sha256, compressed]
  );

  return archiveResult.rows[0].id;
}

async function insertArchiveItems(
  client: PoolClient,
  archiveId: string,
  tickets: SupportTicketArchiveTicket[]
): Promise<void> {
  for (const ticket of tickets) {
    await client.query(
      `insert into support_ticket_archive_items (
         archive_id,
         ticket_id,
         match_id,
         ticket_category,
         ticket_status,
         ticket_created_at
       )
       values ($1,$2,$3,$4,$5,$6)`,
      [archiveId, ticket.id, ticket.matchId, ticket.category, ticket.status, new Date(ticket.createdAt)]
    );
  }
}

async function deleteArchivedHotRows(
  client: PoolClient,
  ticketIds: string[],
  snapshots: SupportTicketArchiveSnapshot[]
): Promise<{ deletedTickets: number; deletedSnapshots: number }> {
  const deletedTickets = await client.query(
    `delete from support_tickets where id = any($1::uuid[])`,
    [ticketIds]
  );

  let deletedSnapshots = 0;
  if (snapshots.length > 0) {
    const matchIds = snapshots.map(snapshot => snapshot.matchId);
    const snapshotKeys = snapshots.map(snapshot => snapshot.snapshotKey);
    const snapshotResult = await client.query(
      `delete from support_ticket_match_snapshots snapshot
        where (snapshot.match_id, snapshot.snapshot_key) in (
          select ref.match_id, ref.snapshot_key
            from unnest($1::text[], $2::text[]) as ref(match_id, snapshot_key)
        )
        and not exists (
          select 1
            from support_tickets ticket
           where ticket.match_id = snapshot.match_id
             and ticket.match_snapshot_key = snapshot.snapshot_key
        )`,
      [matchIds, snapshotKeys]
    );
    deletedSnapshots = snapshotResult.rowCount ?? 0;
  }

  return {
    deletedTickets: deletedTickets.rowCount ?? 0,
    deletedSnapshots
  };
}

async function archiveMonthlyPeriods(periods: Period[]): Promise<void> {
  if (periods.length === 0) {
    console.log("[support-archive] No resolved or dismissed monthly periods are ready to archive.");
    return;
  }

  const client = await getDbPool().connect();
  try {
    await client.query("begin");

    for (const period of periods) {
      const payload = await loadMonthlyPayload(client, period);
      console.log(`[support-archive] ${period.label}: ${payload.tickets.length} ticket(s), ${payload.snapshots.length} snapshot(s).`);

      if (payload.tickets.length === 0) continue;
      if (!apply) continue;

      const archiveId = await insertArchive(client, "MONTHLY", period, payload);
      await insertArchiveItems(client, archiveId, payload.tickets);
      const deleted = await deleteArchivedHotRows(client, payload.tickets.map(ticket => ticket.id), payload.snapshots);
      console.log(`[support-archive] ${period.label}: archived ${archiveId}, deleted ${deleted.deletedTickets} ticket(s) and ${deleted.deletedSnapshots} snapshot(s).`);
    }

    if (apply) {
      await client.query("commit");
      console.log("[support-archive] Monthly archive complete.");
    } else {
      await client.query("rollback");
      console.log("[support-archive] Dry run only. Re-run with --apply to archive and remove hot rows.");
    }
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function archiveYear(period: Period): Promise<void> {
  const client = await getDbPool().connect();
  try {
    await client.query("begin");

    const archiveResult = await client.query<ArchiveRow>(
      `select id, period_start, period_end, payload
         from support_ticket_archives
        where archive_kind = 'MONTHLY'
          and period_start >= $1::date
          and period_end <= $2::date
        order by period_start asc`,
      [period.start, period.end]
    );

    if (archiveResult.rows.length === 0) {
      console.log(`[support-archive] No monthly archives found for ${period.label}.`);
      await client.query("rollback");
      return;
    }

    const sourcePayloads = archiveResult.rows.map(decompressMonthlyArchive);
    const sourceArchiveIds = archiveResult.rows.map(row => row.id);
    const itemsResult = await client.query<ArchiveItemRow>(
      `select ticket_id, match_id, ticket_category, ticket_status, ticket_created_at
         from support_ticket_archive_items
        where archive_id = any($1::uuid[])
        order by ticket_created_at asc, ticket_id asc`,
      [sourceArchiveIds]
    );
    const payload: YearlyArchivePayload = {
      schemaVersion: 1,
      archiveKind: "YEARLY",
      archivedAt: new Date().toISOString(),
      periodStart: period.start,
      periodEnd: period.end,
      sourceArchiveIds,
      sourcePeriods: archiveResult.rows.map(row => ({
        periodStart: serializeDateOnly(row.period_start),
        periodEnd: serializeDateOnly(row.period_end)
      })),
      tickets: sourcePayloads.flatMap(source => source.tickets),
      snapshots: sourcePayloads.flatMap(source => source.snapshots)
    };

    console.log(`[support-archive] ${period.label}: ${archiveResult.rows.length} monthly archive(s), ${payload.tickets.length} ticket(s), ${payload.snapshots.length} snapshot(s).`);
    if (!apply) {
      await client.query("rollback");
      console.log("[support-archive] Dry run only. Re-run with --apply --yearly to merge yearly archives.");
      return;
    }

    const yearlyArchiveId = await insertArchive(client, "YEARLY", period, payload);
    for (const item of itemsResult.rows) {
      await client.query(
        `insert into support_ticket_archive_items (
           archive_id,
           ticket_id,
           match_id,
           ticket_category,
           ticket_status,
           ticket_created_at
         )
         values ($1,$2,$3,$4,$5,$6)`,
        [
          yearlyArchiveId,
          item.ticket_id,
          item.match_id,
          item.ticket_category,
          item.ticket_status,
          item.ticket_created_at
        ]
      );
    }
    const deleteResult = await client.query(
      `delete from support_ticket_archives where id = any($1::uuid[])`,
      [sourceArchiveIds]
    );

    await client.query("commit");
    console.log(`[support-archive] Yearly archive ${yearlyArchiveId} created. Removed ${deleteResult.rowCount ?? 0} monthly archive row(s).`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function run(): Promise<void> {
  if (yearly) {
    const currentYear = new Date().getUTCFullYear();
    const year = Number(readArg("--year") ?? currentYear - 1);
    await archiveYear(buildYearPeriod(year));
    return;
  }

  await archiveMonthlyPeriods(await listMonthlyPeriods());
}

run()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeDbPool();
  });
