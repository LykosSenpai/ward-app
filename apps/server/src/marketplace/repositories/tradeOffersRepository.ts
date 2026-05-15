import { randomUUID } from "node:crypto";

import { getDbPool } from "../../db/pool.js";

export type MarketplaceTradeOfferRecord = {
  id: string;
  createdByUserId: string;
  recipientUserId: string;
  status: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "COUNTERED" | "CANCELED" | "COMPLETED_MANUALLY";
  message?: string;
  createdAt: string;
  updatedAt: string;
};

function mapRow(row: any): MarketplaceTradeOfferRecord {
  return {
    id: row.id,
    createdByUserId: row.created_by_user_id,
    recipientUserId: row.recipient_user_id,
    status: row.status,
    message: row.message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listMarketplaceTradeOffersForUser(userId: string, args?: { page?: number; limit?: number }): Promise<MarketplaceTradeOfferRecord[]> {
  const page = Math.max(1, args?.page ?? 1);
  const limit = Math.max(1, Math.min(args?.limit ?? 20, 100));
  const offset = (page - 1) * limit;
  const result = await getDbPool().query(
    `select id, created_by_user_id, recipient_user_id, status, message, created_at, updated_at
       from marketplace_trade_offers
      where created_by_user_id = $1 or recipient_user_id = $1
      order by updated_at desc
      limit $2 offset $3`,
    [userId, limit, offset]
  );
  return result.rows.map(mapRow);
}

export async function createMarketplaceTradeOffer(args: {
  createdByUserId: string;
  recipientUserId: string;
  status: MarketplaceTradeOfferRecord["status"];
  message?: string;
}): Promise<MarketplaceTradeOfferRecord> {
  const id = randomUUID();
  const result = await getDbPool().query(
    `insert into marketplace_trade_offers (id, created_by_user_id, recipient_user_id, status, message)
     values ($1,$2,$3,$4,$5)
     returning id, created_by_user_id, recipient_user_id, status, message, created_at, updated_at`,
    [id, args.createdByUserId, args.recipientUserId, args.status, args.message ?? null]
  );
  return mapRow(result.rows[0]);
}

export async function getMarketplaceTradeOfferForUser(args: { userId: string; id: string }): Promise<MarketplaceTradeOfferRecord | undefined> {
  const result = await getDbPool().query(
    `select id, created_by_user_id, recipient_user_id, status, message, created_at, updated_at
       from marketplace_trade_offers
      where id = $1 and (created_by_user_id = $2 or recipient_user_id = $2)`,
    [args.id, args.userId]
  );
  return result.rows[0] ? mapRow(result.rows[0]) : undefined;
}

export async function updateMarketplaceTradeOfferStatus(args: {
  userId: string;
  id: string;
  status: MarketplaceTradeOfferRecord["status"];
  message?: string;
}): Promise<MarketplaceTradeOfferRecord | undefined> {
  const existing = await getMarketplaceTradeOfferForUser({ userId: args.userId, id: args.id });
  if (!existing) return undefined;

  const nextMessage = args.message?.trim() ? args.message.trim() : existing.message;
  const result = await getDbPool().query(
    `update marketplace_trade_offers
        set status = $3,
            message = $4,
            updated_at = now()
      where id = $1 and (created_by_user_id = $2 or recipient_user_id = $2)
      returning id, created_by_user_id, recipient_user_id, status, message, created_at, updated_at`,
    [args.id, args.userId, args.status, nextMessage ?? null]
  );

  return result.rows[0] ? mapRow(result.rows[0]) : undefined;
}
