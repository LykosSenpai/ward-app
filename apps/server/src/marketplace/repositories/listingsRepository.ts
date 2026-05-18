import { randomUUID } from "node:crypto";

import { getDbPool } from "../../db/pool.js";

export type MarketplaceListingRecord = {
  id: string;
  userId: string;
  gameId: string;
  cardId: string;
  quantity: number;
  listingType: "TRADE_ONLY" | "SELL_ONLY" | "TRADE_OR_SELL";
  status: "OPEN" | "PENDING" | "CLOSED";
  preferredReturn?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
};

function mapRow(row: any): MarketplaceListingRecord {
  return {
    id: row.id,
    userId: row.user_id,
    gameId: row.game_id,
    cardId: row.card_id,
    quantity: row.quantity,
    listingType: row.listing_type,
    status: row.status,
    preferredReturn: row.preferred_return ?? undefined,
    description: row.description ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listMarketplaceListings(args?: { page?: number; limit?: number; q?: string; listingType?: string }): Promise<{ items: MarketplaceListingRecord[]; total: number }> {
  const page = Math.max(1, args?.page ?? 1);
  const limit = Math.max(1, Math.min(args?.limit ?? 20, 100));
  const offset = (page - 1) * limit;
  const q = String(args?.q ?? "").trim().toLowerCase();
  const listingType = String(args?.listingType ?? "").trim();
  const filters: string[] = [];
  const values: unknown[] = [];

  if (q) {
    values.push(`%${q}%`);
    filters.push(`lower(card_id) like $${values.length}`);
  }

  if (listingType) {
    values.push(listingType);
    filters.push(`listing_type = $${values.length}`);
  }

  const whereClause = filters.length > 0 ? ` where ${filters.join(" and ")}` : "";
  const countResult = await getDbPool().query(
    `select count(*)::int as total
       from marketplace_posts${whereClause}`,
    values
  );
  const total = Number(countResult.rows[0]?.total ?? 0);

  values.push(limit, offset);
  const result = await getDbPool().query(
    `select id,user_id,game_id,card_id,quantity,listing_type,status,preferred_return,description,created_at,updated_at
       from marketplace_posts${whereClause}
      order by updated_at desc
      limit $${values.length - 1} offset $${values.length}`,
    values
  );
  return { items: result.rows.map(mapRow), total };
}

export async function getMarketplaceListingById(id: string): Promise<MarketplaceListingRecord | undefined> {
  const result = await getDbPool().query(`select id,user_id,game_id,card_id,quantity,listing_type,status,preferred_return,description,created_at,updated_at from marketplace_posts where id=$1`, [id]);
  return result.rows[0] ? mapRow(result.rows[0]) : undefined;
}

export async function createMarketplaceListing(args: Omit<MarketplaceListingRecord, "id"|"createdAt"|"updatedAt">): Promise<MarketplaceListingRecord> {
  const id = randomUUID();
  const result = await getDbPool().query(`insert into marketplace_posts (id,user_id,game_id,card_id,quantity,listing_type,status,preferred_return,description) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id,user_id,game_id,card_id,quantity,listing_type,status,preferred_return,description,created_at,updated_at`, [id,args.userId,args.gameId,args.cardId,args.quantity,args.listingType,args.status,args.preferredReturn??null,args.description??null]);
  return mapRow(result.rows[0]);
}

export async function updateMarketplaceListing(args: { userId: string; id: string; cardId: string; quantity: number; listingType: MarketplaceListingRecord["listingType"]; status: MarketplaceListingRecord["status"]; preferredReturn?: string; description?: string; }): Promise<MarketplaceListingRecord | undefined> {
  const result = await getDbPool().query(`update marketplace_posts set card_id=$3, quantity=$4, listing_type=$5, status=$6, preferred_return=$7, description=$8, updated_at=now() where user_id=$1 and id=$2 returning id,user_id,game_id,card_id,quantity,listing_type,status,preferred_return,description,created_at,updated_at`, [args.userId,args.id,args.cardId,args.quantity,args.listingType,args.status,args.preferredReturn??null,args.description??null]);
  return result.rows[0] ? mapRow(result.rows[0]) : undefined;
}

export async function deleteMarketplaceListing(args:{userId:string;id:string}): Promise<boolean> {
  const result = await getDbPool().query(`delete from marketplace_posts where user_id=$1 and id=$2`, [args.userId,args.id]);
  return (result.rowCount ?? 0) > 0;
}
