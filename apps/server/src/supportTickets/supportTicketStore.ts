import { randomUUID } from "node:crypto";

import type { MatchState } from "@ward/shared";

import { getDbPool } from "../db/pool.js";

export type SupportTicketSeverity = "LOW" | "NORMAL" | "HIGH" | "BLOCKING";
export type SupportTicketStatus = "OPEN" | "TRIAGED" | "RESOLVED" | "DISMISSED";

export type SupportTicketRecord = {
  id: string;
  reporterUserId?: string;
  matchId: string;
  subject: string;
  description: string;
  category: "BOARD_REPORT";
  severity: SupportTicketSeverity;
  status: SupportTicketStatus;
  createdAt: string;
  updatedAt: string;
};

type SupportTicketRow = {
  id: string;
  reporter_user_id: string | null;
  match_id: string;
  subject: string;
  description: string;
  category: "BOARD_REPORT";
  severity: SupportTicketSeverity;
  status: SupportTicketStatus;
  created_at: Date | string;
  updated_at: Date | string;
};

function serializeTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function serializeSupportTicket(row: SupportTicketRow): SupportTicketRecord {
  return {
    id: row.id,
    reporterUserId: row.reporter_user_id ?? undefined,
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

export async function createSupportTicket(args: {
  reporterUserId: string;
  matchId: string;
  subject: string;
  description: string;
  severity: SupportTicketSeverity;
  matchSnapshot: MatchState;
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
     values ($1,$2,$3,$4,$5,'BOARD_REPORT',$6,$7,$8)
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
      args.severity,
      args.matchSnapshot,
      args.clientContext
    ]
  );

  return serializeSupportTicket(result.rows[0]);
}
