import { listDefaultCardLibrary } from "../dataStore.js";
import { getDbPool } from "../db/pool.js";
import type { CardOwnershipMap } from "./ownershipStore.js";

export type AutoNeedQuantityPolicy = "ONE_PER_CARD" | "DECK_LIMIT";

export type AutoNeedRule = {
  id: string;
  userId: string;
  generation: string;
  includeVariants: boolean;
  quantityPolicy: AutoNeedQuantityPolicy;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MarketplaceNeedMap = Record<string, number>;

type RuleRow = {
  id: string; user_id: string; generation: string; include_variants: boolean; quantity_policy: AutoNeedQuantityPolicy; enabled: boolean; created_at: string; updated_at: string;
};

type NeedRow = { ownership_key: string; needed_count: number };

function toRule(row: RuleRow): AutoNeedRule {
  return { id: row.id, userId: row.user_id, generation: row.generation, includeVariants: row.include_variants, quantityPolicy: row.quantity_policy, enabled: row.enabled, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function createOrReplaceAutoNeedRule(args: Omit<AutoNeedRule, "id" | "createdAt" | "updatedAt">): Promise<AutoNeedRule> {
  const result = await getDbPool().query<RuleRow>(`insert into marketplace_auto_need_rules (user_id, generation, include_variants, quantity_policy, enabled, updated_at)
values ($1,$2,$3,$4,$5, now())
on conflict (user_id, generation, include_variants, quantity_policy)
do update set enabled = excluded.enabled, updated_at = now()
returning *`, [args.userId, args.generation, args.includeVariants, args.quantityPolicy, args.enabled]);
  return toRule(result.rows[0]);
}

export async function disableAutoNeedRule(args: { userId: string; ruleId: string; remove?: boolean }): Promise<void> {
  if (args.remove) {
    await getDbPool().query(`delete from marketplace_auto_need_rules where id = $1 and user_id = $2`, [args.ruleId, args.userId]);
  } else {
    await getDbPool().query(`update marketplace_auto_need_rules set enabled = false, updated_at = now() where id = $1 and user_id = $2`, [args.ruleId, args.userId]);
  }
}

export async function recomputeMarketplaceNeedsForUser(userId: string, ownershipMap: CardOwnershipMap): Promise<MarketplaceNeedMap> {
  const rulesResult = await getDbPool().query<RuleRow>(`select * from marketplace_auto_need_rules where user_id = $1 and enabled = true`, [userId]);
  const cards = listDefaultCardLibrary();
  const aggregate: MarketplaceNeedMap = {};
  for (const rule of rulesResult.rows) {
    for (const card of cards) {
      if (String(card.generation ?? "") !== rule.generation) continue;
      const needed = rule.quantity_policy === "DECK_LIMIT" ? Math.max(1, card.deckLimit ?? 1) : 1;
      const key = card.id;
      const owned = ownershipMap[key] ?? 0;
      const missing = Math.max(0, needed - owned);
      if (missing > 0) aggregate[key] = Math.max(aggregate[key] ?? 0, missing);
    }
  }
  await getDbPool().query(`delete from marketplace_needs where user_id = $1`, [userId]);
  const entries = Object.entries(aggregate);
  for (const [ownershipKey, neededCount] of entries) {
    await getDbPool().query(`insert into marketplace_needs (user_id, ownership_key, needed_count, updated_at) values ($1,$2,$3, now())`, [userId, ownershipKey, neededCount]);
  }
  return aggregate;
}

export async function loadMarketplaceNeeds(userId: string): Promise<MarketplaceNeedMap> {
  const result = await getDbPool().query<NeedRow>(`select ownership_key, needed_count from marketplace_needs where user_id = $1`, [userId]);
  return result.rows.reduce<MarketplaceNeedMap>((acc, row) => {
    acc[row.ownership_key] = row.needed_count;
    return acc;
  }, {});
}
