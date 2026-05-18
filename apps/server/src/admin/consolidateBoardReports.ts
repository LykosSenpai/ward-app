import "../env/loadEnvFile.js";

import { randomUUID } from "node:crypto";

import { closeDbPool, getDbPool } from "../db/pool.js";

type SupportTicketSeverity = "LOW" | "NORMAL" | "HIGH" | "BLOCKING";
type SupportTicketStatus = "OPEN" | "TRIAGED" | "RESOLVED" | "DISMISSED";

type SupportTicketRow = {
  id: string;
  reporter_user_id: string | null;
  match_id: string;
  subject: string;
  description: string;
  severity: SupportTicketSeverity;
  status: SupportTicketStatus;
  match_snapshot: Record<string, unknown> | null;
  match_snapshot_key: string | null;
  client_context: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const SEVERITY_RANK: Record<SupportTicketSeverity, number> = {
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
  BLOCKING: 3
};

const STATUS_PRIORITY: SupportTicketStatus[] = ["OPEN", "TRIAGED", "RESOLVED", "DISMISSED"];
const applyChanges = process.argv.includes("--apply");

function serializeTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function hasSnapshot(value: Record<string, unknown> | null | undefined): value is Record<string, unknown> {
  return Boolean(value && Object.keys(value).length > 0);
}

function pickHighestSeverity(rows: SupportTicketRow[]): SupportTicketSeverity {
  return rows.reduce(
    (highest, row) => SEVERITY_RANK[row.severity] > SEVERITY_RANK[highest] ? row.severity : highest,
    rows[0].severity
  );
}

function pickAggregateStatus(rows: SupportTicketRow[]): SupportTicketStatus {
  return STATUS_PRIORITY.find(status => rows.some(row => row.status === status)) ?? "OPEN";
}

function buildDescription(matchId: string, rows: SupportTicketRow[]): string {
  const issues = rows.map((row, index) => {
    const context = row.client_context ?? {};
    const turnNumber = context.turnNumber ?? "unknown";
    const phase = context.phase ?? "unknown";
    const activePlayerId = context.activePlayerId ?? "unknown";

    return [
      `${index + 1}. [${row.severity}] ${row.subject}`,
      `Source ticket: ${row.id}`,
      `Turn: ${turnNumber} | Phase: ${phase} | Active player: ${activePlayerId}`,
      row.description
    ].join("\n");
  });

  return `Consolidated board report batch for match ${matchId}.\n\n${issues.join("\n\n")}`;
}

function buildClientContext(rows: SupportTicketRow[]): Record<string, unknown> {
  return {
    reportBatch: true,
    reportCount: rows.length,
    consolidatedAt: new Date().toISOString(),
    consolidatedFromTicketIds: rows.map(row => row.id),
    sourceTicketStatuses: Object.fromEntries(rows.map(row => [row.id, row.status])),
    reports: rows.map((row, index) => {
      const context = row.client_context ?? {};
      return {
        index: index + 1,
        sourceTicketId: row.id,
        reporterUserId: row.reporter_user_id,
        matchId: row.match_id,
        subject: row.subject,
        description: row.description,
        severity: row.severity,
        status: row.status,
        turnNumber: context.turnNumber ?? null,
        phase: context.phase ?? null,
        activePlayerId: context.activePlayerId ?? null,
        createdAt: serializeTimestamp(row.created_at),
        updatedAt: serializeTimestamp(row.updated_at),
        clientContext: context
      };
    })
  };
}

async function loadBestSnapshot(rows: SupportTicketRow[]): Promise<Record<string, unknown> | undefined> {
  for (const row of [...rows].reverse()) {
    if (hasSnapshot(row.match_snapshot)) {
      return row.match_snapshot;
    }

    if (!row.match_snapshot_key) continue;

    const result = await getDbPool().query<{ match_snapshot: Record<string, unknown> }>(
      `select match_snapshot
         from support_ticket_match_snapshots
        where match_id = $1 and snapshot_key = $2
        limit 1`,
      [row.match_id, row.match_snapshot_key]
    );

    if (hasSnapshot(result.rows[0]?.match_snapshot)) {
      return result.rows[0].match_snapshot;
    }
  }

  return undefined;
}

async function listLegacyBoardReportGroups(): Promise<SupportTicketRow[][]> {
  const result = await getDbPool().query<SupportTicketRow>(`
    select id,
           reporter_user_id,
           match_id,
           subject,
           description,
           severity,
           status,
           match_snapshot,
           match_snapshot_key,
           client_context,
           created_at,
           updated_at
      from support_tickets
     where category = 'BOARD_REPORT'
       and coalesce(client_context->>'reportBatch', 'false') <> 'true'
     order by match_id asc, created_at asc
  `);

  const groups = new Map<string, SupportTicketRow[]>();
  for (const row of result.rows) {
    groups.set(row.match_id, [...(groups.get(row.match_id) ?? []), row]);
  }

  return [...groups.values()].filter(rows => rows.length > 1);
}

async function consolidateGroup(rows: SupportTicketRow[]): Promise<{ aggregateId: string; removedTickets: number; removedSnapshots: number }> {
  const matchId = rows[0].match_id;
  const aggregateId = randomUUID();
  const snapshot = await loadBestSnapshot(rows);
  const snapshotKey = snapshot ? `consolidated-${Date.now()}-${randomUUID()}` : null;
  const sourceIds = rows.map(row => row.id);

  if (snapshot && snapshotKey) {
    await getDbPool().query(
      `insert into support_ticket_match_snapshots (match_id, snapshot_key, match_snapshot)
       values ($1, $2, $3)
       on conflict (match_id, snapshot_key) do nothing`,
      [matchId, snapshotKey, snapshot]
    );
  }

  await getDbPool().query(
    `insert into support_tickets (
       id,
       reporter_user_id,
       match_id,
       subject,
       description,
       category,
       severity,
       status,
       match_snapshot,
       match_snapshot_key,
       client_context
     )
     values ($1,$2,$3,$4,$5,'BOARD_REPORT',$6,$7,$8,$9,$10)`,
    [
      aggregateId,
      rows.find(row => row.reporter_user_id)?.reporter_user_id ?? null,
      matchId,
      `Consolidated board reports (${rows.length}): ${matchId}`,
      buildDescription(matchId, rows),
      pickHighestSeverity(rows),
      pickAggregateStatus(rows),
      {},
      snapshotKey,
      buildClientContext(rows)
    ]
  );

  const deleteResult = await getDbPool().query(
    `delete from support_tickets where id = any($1::uuid[])`,
    [sourceIds]
  );
  const orphanSnapshotResult = await getDbPool().query(
    `delete from support_ticket_match_snapshots snapshot
      where not exists (
        select 1
          from support_tickets ticket
         where ticket.match_id = snapshot.match_id
           and ticket.match_snapshot_key = snapshot.snapshot_key
      )`
  );

  return {
    aggregateId,
    removedTickets: deleteResult.rowCount ?? 0,
    removedSnapshots: orphanSnapshotResult.rowCount ?? 0
  };
}

async function run(): Promise<void> {
  const groups = await listLegacyBoardReportGroups();

  if (groups.length === 0) {
    console.log("[support] No legacy board report groups need consolidation.");
    return;
  }

  const ticketCount = groups.reduce((total, rows) => total + rows.length, 0);
  console.log(`[support] Found ${ticketCount} legacy board report tickets across ${groups.length} match group(s).`);
  for (const rows of groups) {
    console.log(`[support] ${rows[0].match_id}: ${rows.length} ticket(s) -> 1 aggregate ticket`);
  }

  if (!applyChanges) {
    console.log("[support] Dry run only. Re-run with --apply to consolidate.");
    return;
  }

  await getDbPool().query("begin");
  try {
    let removedTickets = 0;
    let removedSnapshots = 0;
    for (const rows of groups) {
      const result = await consolidateGroup(rows);
      removedTickets += result.removedTickets;
      removedSnapshots += result.removedSnapshots;
      console.log(`[support] ${rows[0].match_id}: created ${result.aggregateId}, removed ${result.removedTickets} source ticket(s).`);
    }
    await getDbPool().query("commit");
    console.log(`[support] Consolidation complete. Removed ${removedTickets} source ticket(s) and ${removedSnapshots} unreferenced snapshot(s).`);
  } catch (error) {
    await getDbPool().query("rollback");
    throw error;
  }
}

run()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeDbPool();
  });
