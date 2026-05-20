import type { CardInstance, MatchState, PlayerState } from "@ward/shared";

export const MAX_INFINITE_MAGIC_ON_FIELD = 5;

export function isInfiniteMagicCard(state: MatchState, card: CardInstance): boolean {
  const definition = state.cardCatalog[card.cardId];
  return definition?.cardType === "MAGIC" && definition.magicType === "INFINITE";
}

export function countInfiniteMagicOnField(
  state: MatchState,
  player: PlayerState,
  excludeCardInstanceId?: string
): number {
  return player.field.magicSlots.filter(card =>
    card.instanceId !== excludeCardInstanceId &&
    isInfiniteMagicCard(state, card)
  ).length;
}

export function assertCanAddMagicToField(
  state: MatchState,
  player: PlayerState,
  card: CardInstance,
  options: {
    excludeCardInstanceId?: string;
    message?: string;
  } = {}
): void {
  if (!isInfiniteMagicCard(state, card)) return;

  if (countInfiniteMagicOnField(state, player, options.excludeCardInstanceId) >= MAX_INFINITE_MAGIC_ON_FIELD) {
    throw new Error(options.message ?? `${player.displayName} already has ${MAX_INFINITE_MAGIC_ON_FIELD} Infinite Magic cards.`);
  }
}
