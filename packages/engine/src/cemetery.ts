import type { PlayerState } from "@ward/shared";

export function calculateCemeteryCreatureHp(player: PlayerState): number {
  return player.cemetery.reduce((total, card) => {
    return total + (card.baseHp ?? 0);
  }, 0);
}

export function isAtOrOverCemeteryLimit(
  player: PlayerState,
  cemeteryHpLimit: number
): boolean {
  return calculateCemeteryCreatureHp(player) >= cemeteryHpLimit;
}