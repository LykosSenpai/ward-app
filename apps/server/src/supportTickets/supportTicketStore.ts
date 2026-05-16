import { randomUUID } from "node:crypto";

import type { MatchState } from "@ward/shared";

import { getDbPool } from "../db/pool.js";

export type SupportTicketSeverity = "LOW" | "NORMAL" | "HIGH" | "BLOCKING";
export type SupportTicketStatus = "OPEN" | "TRIAGED" | "RESOLVED" | "DISMISSED";
export type SupportTicketCategory = "BOARD_REPORT" | "SITE_REPORT";
export type SupportTicketSnapshot = MatchState | Record<string, unknown>;

export type SupportTicketRecord = {
  id: string;
  reporterUserId?: string;
  reporterUsername?: string;
  reporterDisplayName?: string;
  matchId: string;
  subject: string;
  description: string;
  category: SupportTicketCategory;
  severity: SupportTicketSeverity;
  status: SupportTicketStatus;
  createdAt: string;
  updatedAt: string;
};

export type SupportTicketDetailRecord = SupportTicketRecord & {
  matchSnapshot: SupportTicketSnapshot;
  clientContext: Record<string, unknown>;
};

type SupportTicketRow = {
  id: string;
  reporter_user_id: string | null;
  reporter_username?: string | null;
  reporter_display_name?: string | null;
  match_id: string;
  subject: string;
  description: string;
  category: SupportTicketCategory;
  severity: SupportTicketSeverity;
  status: SupportTicketStatus;
  created_at: Date | string;
  updated_at: Date | string;
  match_snapshot?: SupportTicketSnapshot;
  client_context?: Record<string, unknown>;
};

function serializeTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function serializeSupportTicket(row: SupportTicketRow): SupportTicketRecord {
  return {
    id: row.id,
    reporterUserId: row.reporter_user_id ?? undefined,
    reporterUsername: row.reporter_username ?? undefined,
    reporterDisplayName: row.reporter_display_name ?? undefined,
    matchId: row.match_id,
    subject: row.subject,
    description: row.description,
    category: row.category,
    severity: row.severity,
    status: row.status,
    createdAt: serializeTimestamp(row.created_at),
    updatedAt: serializeTimestamp(row.updated_at)
  };
}

function serializeSupportTicketDetail(row: SupportTicketRow): SupportTicketDetailRecord {
  return {
    ...serializeSupportTicket(row),
    matchSnapshot: row.match_snapshot ?? {},
    clientContext: row.client_context ?? {}
  };
}

export async function createSupportTicket(args: {
  reporterUserId: string;
  matchId: string;
  category?: SupportTicketCategory;
  subject: string;
  description: string;
  severity: SupportTicketSeverity;
  matchSnapshot: SupportTicketSnapshot;
  clientContext: Record<string, unknown>;
}): Promise<SupportTicketRecord> {
  const id = randomUUID();
  const result = await getDbPool().query<SupportTicketRow>(
    `insert into support_tickets (
       id,
       reporter_user_id,
       match_id,
       subject,
       description,
       category,
       severity,
       match_snapshot,
       client_context
     )
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     returning id,
               reporter_user_id,
               match_id,
               subject,
               description,
               category,
               severity,
               status,
               created_at,
               updated_at`,
    [
      id,
      args.reporterUserId,
      args.matchId,
      args.subject,
      args.description,
      args.category ?? "BOARD_REPORT",
      args.severity,
      args.matchSnapshot,
      args.clientContext
    ]
  );

  return serializeSupportTicket(result.rows[0]);
}

export async function listSupportTickets(args?: {
  status?: SupportTicketStatus;
  page?: number;
  limit?: number;
}): Promise<SupportTicketRecord[]> {
  const page = Math.max(1, args?.page ?? 1);
  const limit = Math.max(1, Math.min(args?.limit ?? 50, 100));
  const offset = (page - 1) * limit;
  const params: unknown[] = [];
  let whereClause = "";

  if (args?.status) {
    params.push(args.status);
    whereClause = `where t.status = $${params.length}`;
  }

  params.push(limit, offset);
  const result = await getDbPool().query<SupportTicketRow>(
    `select t.id,
            t.reporter_user_id,
            u.username as reporter_username,
            u.display_name as reporter_display_name,
            t.match_id,
            t.subject,
            t.description,
            t.category,
            t.severity,
            t.status,
            t.created_at,
            t.updated_at
       from support_tickets t
       left join users u on u.id = t.reporter_user_id
       ${whereClause}
      order by t.created_at desc
      limit $${params.length - 1} offset $${params.length}`,
    params
  );

  return result.rows.map(serializeSupportTicket);
}

export async function getSupportTicket(ticketId: string): Promise<SupportTicketDetailRecord | undefined> {
  const result = await getDbPool().query<SupportTicketRow>(
    `select t.id,
            t.reporter_user_id,
            u.username as reporter_username,
            u.display_name as reporter_display_name,
            t.match_id,
            t.subject,
            t.description,
            t.category,
            t.severity,
            t.status,
            t.match_snapshot,
            t.client_context,
            t.created_at,
            t.updated_at
       from support_tickets t
       left join users u on u.id = t.reporter_user_id
      where t.id = $1`,
    [ticketId]
  );

  return result.rows[0] ? serializeSupportTicketDetail(result.rows[0]) : undefined;
}

export async function updateSupportTicketStatus(
  ticketId: string,
  status: SupportTicketStatus
): Promise<SupportTicketDetailRecord | undefined> {
  const result = await getDbPool().query<SupportTicketRow>(
    `update support_tickets
        set status = $2,
            updated_at = now()
      where id = $1
      returning id,
                reporter_user_id,
                match_id,
                subject,
                description,
                category,
                severity,
                status,
                match_snapshot,
                client_context,
                created_at,
                updated_at`,
    [ticketId, status]
  );

  if (!result.rows[0]) return undefined;
  return getSupportTicket(result.rows[0].id);
}
