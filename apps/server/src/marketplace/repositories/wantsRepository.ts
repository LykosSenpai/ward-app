import { randomUUID } from "node:crypto";

import { getDbPool } from "../../db/pool.js";

export type MarketplaceWantRecord = {
  id: string;
  userId: string;
  gameId: string;
  cardId: string;
  desiredQuantity: number;
  priority: "LOW" | "MEDIUM" | "HIGH" | "TOP";
  notes?: string;
  updatedAt: string;
};

export async function listMarketplaceWantsByUser(userId: string, args?: { page?: number; limit?: number }): Promise<MarketplaceWantRecord[]> {
  const page = Math.max(1, args?.page ?? 1);
  const limit = Math.max(1, Math.min(args?.limit ?? 20, 100));
  const offset = (page - 1) * limit;
  const result = await getDbPool().query<{
    id: string;
    user_id: string;
    game_id: string;
    card_id: string;
    desired_quantity: number;
    priority: "LOW" | "MEDIUM" | "HIGH" | "TOP";
    notes: string | null;
    updated_at: string;
  }>(
    `select id, user_id, game_id, card_id, desired_quantity, priority, notes, updated_at
       from marketplace_wants
      where user_id = $1
      order by updated_at desc
      limit $2 offset $3`,
    [userId, limit, offset]
  );

  return result.rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    gameId: row.game_id,
    cardId: row.card_id,
    desiredQuantity: row.desired_quantity,
    priority: row.priority,
    notes: row.notes ?? undefined,
    updatedAt: row.updated_at
  }));
}

export async function createMarketplaceWant(args: {
  userId: string;
  gameId: string;
  cardId: string;
  desiredQuantity: number;
  priority: "LOW" | "MEDIUM" | "HIGH" | "TOP";
  notes?: string;
}): Promise<MarketplaceWantRecord> {
  const id = randomUUID();
  const result = await getDbPool().query<{
    id: string;
    user_id: string;
    game_id: string;
    card_id: string;
    desired_quantity: number;
    priority: "LOW" | "MEDIUM" | "HIGH" | "TOP";
    notes: string | null;
    updated_at: string;
  }>(
    `insert into marketplace_wants (id, user_id, game_id, card_id, desired_quantity, priority, notes)
     values ($1,$2,$3,$4,$5,$6,$7)
     returning id, user_id, game_id, card_id, desired_quantity, priority, notes, updated_at`,
    [id, args.userId, args.gameId, args.cardId, args.desiredQuantity, args.priority, args.notes ?? null]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    gameId: row.game_id,
    cardId: row.card_id,
    desiredQuantity: row.desired_quantity,
    priority: row.priority,
    notes: row.notes ?? undefined,
    updatedAt: row.updated_at
  };
}

export async function updateMarketplaceWant(args: {
  userId: string;
  id: string;
  cardId: string;
  desiredQuantity: number;
  priority: "LOW" | "MEDIUM" | "HIGH" | "TOP";
  notes?: string;
}): Promise<MarketplaceWantRecord | undefined> {
  const result = await getDbPool().query<{
    id: string;
    user_id: string;
    game_id: string;
    card_id: string;
    desired_quantity: number;
    priority: "LOW" | "MEDIUM" | "HIGH" | "TOP";
    notes: string | null;
    updated_at: string;
  }>(
    `update marketplace_wants
        set card_id = $3,
            desired_quantity = $4,
            priority = $5,
            notes = $6,
            updated_at = now()
      where user_id = $1 and id = $2
      returning id, user_id, game_id, card_id, desired_quantity, priority, notes, updated_at`,
    [args.userId, args.id, args.cardId, args.desiredQuantity, args.priority, args.notes ?? null]
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    id: row.id,
    userId: row.user_id,
    gameId: row.game_id,
    cardId: row.card_id,
    desiredQuantity: row.desired_quantity,
    priority: row.priority,
    notes: row.notes ?? undefined,
    updatedAt: row.updated_at
  };
}

export async function deleteMarketplaceWant(args: { userId: string; id: string }): Promise<boolean> {
  const result = await getDbPool().query(
    `delete from marketplace_wants where user_id = $1 and id = $2`,
    [args.userId, args.id]
  );
  return (result.rowCount ?? 0) > 0;
}
