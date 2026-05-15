export type MarketplaceMatchType = "THEY_HAVE_WHAT_I_NEED" | "I_HAVE_WHAT_THEY_NEED" | "MUTUAL_TRADE_MATCH";

export type ScoreInput = {
  type: MarketplaceMatchType;
  matchedQuantity: number;
  reciprocalQuantity: number;
  sourceUpdatedAt?: string;
  targetUpdatedAt?: string;
};

function recencyBonus(updatedAt?: string): number {
  if (!updatedAt) return 0;
  const ts = Date.parse(updatedAt);
  if (!Number.isFinite(ts)) return 0;
  const hours = (Date.now() - ts) / (1000 * 60 * 60);
  if (hours <= 24) return 5;
  if (hours <= 24 * 7) return 2;
  return -5;
}

export function scoreMarketplaceMatch(input: ScoreInput): { score: number; explanation: string } {
  const baseByType =
    input.type === "MUTUAL_TRADE_MATCH" ? 75
      : input.type === "THEY_HAVE_WHAT_I_NEED" ? 50
        : 40;

  const quantityBonus = Math.min(25, Math.max(0, input.matchedQuantity) * 5);
  const reciprocalBonus = Math.min(20, Math.max(0, input.reciprocalQuantity) * 4);
  const activityBonus = recencyBonus(input.sourceUpdatedAt) + recencyBonus(input.targetUpdatedAt);
  const score = baseByType + quantityBonus + reciprocalBonus + activityBonus;

  const explanation =
    input.type === "MUTUAL_TRADE_MATCH"
      ? `Mutual match: ${input.matchedQuantity} card(s) they can offer and ${input.reciprocalQuantity} card(s) you can offer.`
      : input.type === "THEY_HAVE_WHAT_I_NEED"
        ? `They have ${input.matchedQuantity} matching card(s) from your needs.`
        : `You have ${input.matchedQuantity} card(s) that match their needs.`;

  return { score, explanation };
}

export function buildMatchId(groupPostId: string, otherPostId: string, type: MarketplaceMatchType): string {
  return `${groupPostId}:${otherPostId}:${type}`;
}
