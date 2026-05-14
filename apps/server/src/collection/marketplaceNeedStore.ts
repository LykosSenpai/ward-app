import { validateDataFileId } from "../dataStore.js";
import { getDbPool } from "../db/pool.js";
import { getCardArtOwnershipKey } from "./ownershipStore.js";

export type MarketplaceNeedItem = { cardId: string; artKey: string; neededCount: number; source: "MANUAL" | "RULE"; ruleId?: string };
export type MarketplaceAutoNeedRule = {
  id: string;
  enabled: boolean;
  desiredQuantityPerCard: number;
  selectedGenerations: string[];
  selectedArtKeys: string[];
  createdAt: string;
  updatedAt: string;
};

function normalizeCount(value: number): number { return Math.max(0, Math.min(999, Math.floor(Number.isFinite(value) ? value : 0))); }

export async function listMarketplaceAutoNeedRules(userId: string): Promise<MarketplaceAutoNeedRule[]> {
  const result = await getDbPool().query<{ id:string; enabled:boolean; desired_quantity_per_card:number; selected_generations:string[]; selected_art_keys:string[]; created_at:Date; updated_at:Date }>(
    `select id, enabled, desired_quantity_per_card, selected_generations, selected_art_keys, created_at, updated_at from user_marketplace_auto_need_rules where user_id=$1 order by updated_at desc`,
    [userId]
  );
  return result.rows.map(r => ({ id:r.id, enabled:r.enabled, desiredQuantityPerCard: normalizeCount(r.desired_quantity_per_card), selectedGenerations:r.selected_generations ?? [], selectedArtKeys:r.selected_art_keys ?? [], createdAt:r.created_at.toISOString(), updatedAt:r.updated_at.toISOString() }));
}

export async function createMarketplaceAutoNeedRule(userId: string, rule: Omit<MarketplaceAutoNeedRule, "id"|"createdAt"|"updatedAt">): Promise<MarketplaceAutoNeedRule[]> {
  const desired = Math.max(1, normalizeCount(rule.desiredQuantityPerCard));
  await getDbPool().query(
    `insert into user_marketplace_auto_need_rules (user_id, enabled, desired_quantity_per_card, selected_generations, selected_art_keys) values ($1,$2,$3,$4,$5)`,
    [userId, !!rule.enabled, desired, rule.selectedGenerations, rule.selectedArtKeys]
  );
  return listMarketplaceAutoNeedRules(userId);
}

export async function addMissingNeedsOnce(args: { userId: string; ownershipCounts: Record<string, number>; cards: Array<{ id: string; generation?: string }>; desiredQuantityPerCard: number; selectedGenerations: string[]; selectedArtKeys: string[]; }): Promise<void> {
  const desired = Math.max(1, normalizeCount(args.desiredQuantityPerCard));
  const generationSet = new Set(args.selectedGenerations);
  const artKeys = args.selectedArtKeys.length ? args.selectedArtKeys : ["default"];
  for (const card of args.cards) {
    if (generationSet.size && !generationSet.has(String(card.generation ?? ""))) continue;
    for (const artKey of artKeys) {
      validateDataFileId(card.id);
      validateDataFileId(artKey);
      const owned = normalizeCount(args.ownershipCounts[getCardArtOwnershipKey(card.id, artKey)] ?? 0);
      const need = desired - owned;
      if (need <= 0) continue;
      await getDbPool().query(
        `insert into user_marketplace_needs (user_id, card_id, art_key, needed_count, source_rule_id, source_kind, updated_at)
         values ($1,$2,$3,$4,null,'MANUAL', now())
         on conflict (user_id, card_id, art_key, source_kind, source_rule_id)
         do update set needed_count=excluded.needed_count, updated_at=now()`,
        [args.userId, card.id, artKey, need]
      );
    }
  }
}


export async function listMarketplaceNeedsWithDerived(args: { userId: string; ownershipCounts: Record<string, number>; cards: Array<{ id: string; generation?: string }>; }): Promise<MarketplaceNeedItem[]> {
  const manual = await getDbPool().query<{ card_id:string; art_key:string; needed_count:number; source_rule_id:string; source_kind:string }>(`select card_id, art_key, needed_count, source_rule_id, source_kind from user_marketplace_needs where user_id=$1 and needed_count>0`, [args.userId]);
  const rules = await listMarketplaceAutoNeedRules(args.userId);
  const derived: MarketplaceNeedItem[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const gset = new Set(rule.selectedGenerations);
    const artKeys = rule.selectedArtKeys.length ? rule.selectedArtKeys : ["default"];
    for (const card of args.cards) {
      if (gset.size && !gset.has(String(card.generation ?? ""))) continue;
      for (const artKey of artKeys) {
        const owned = normalizeCount(args.ownershipCounts[getCardArtOwnershipKey(card.id, artKey)] ?? 0);
        const need = Math.max(0, rule.desiredQuantityPerCard - owned);
        if (need > 0) derived.push({ cardId: card.id, artKey, neededCount: need, source: "RULE", ruleId: rule.id });
      }
    }
  }
  return [
    ...manual.rows.map(row => ({ cardId: row.card_id, artKey: row.art_key, neededCount: normalizeCount(row.needed_count), source: "MANUAL" as const })),
    ...derived
  ];
}
