import { getDbPool } from "../../db/pool.js";

export type MarketplaceMatchStatus = "NEW" | "VIEWED" | "SAVED" | "DISMISSED";

export async function getMarketplaceMatchStatusesForUser(userId: string): Promise<Map<string, MarketplaceMatchStatus>> {
  const result = await getDbPool().query<{ id: string; status: MarketplaceMatchStatus }>(
    `select id, status from marketplace_match_statuses where user_id = $1`,
    [userId]
  );
  const out = new Map<string, MarketplaceMatchStatus>();
  for (const row of result.rows) out.set(row.id, row.status);
  return out;
}

export async function setMarketplaceMatchStatus(args: { userId: string; id: string; status: MarketplaceMatchStatus }): Promise<void> {
  await getDbPool().query(
    `insert into marketplace_match_statuses (id, user_id, status, updated_at)
     values ($1,$2,$3, now())
     on conflict (id) do update
       set status = excluded.status,
           updated_at = now()`,
    [args.id, args.userId, args.status]
  );
}
