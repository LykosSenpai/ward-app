import type { CardInstance } from "@ward/shared";
import type { AppMatchState } from "../clientTypes";
import type { BoardPlayerId } from "./boardPreview3dTypes";

export type BoardHandRevealMode = BoardPlayerId | "all" | null;

export function resolveBoardHandRevealMode(params: {
  adminView: boolean;
  presentation: "lab" | "game";
  locallyRevealedHands: Partial<Record<BoardPlayerId, boolean>>;
  revealedHandPlayerIds: string[];
}): BoardHandRevealMode {
  const { adminView, presentation, locallyRevealedHands, revealedHandPlayerIds } = params;
  if (adminView && presentation === "lab") return "all";

  const revealedOwners = new Set<BoardPlayerId>();
  if (locallyRevealedHands.player_1 || revealedHandPlayerIds.includes("player_1")) revealedOwners.add("player_1");
  if (locallyRevealedHands.player_2 || revealedHandPlayerIds.includes("player_2")) revealedOwners.add("player_2");
  if (revealedOwners.size === 0) return null;
  return revealedOwners.size > 1 ? "all" : [...revealedOwners][0]!;
}

export function getFocusedPlayer(match: AppMatchState, focusedPlayerId: BoardPlayerId) {
  return match.players.find((player) => player.id === focusedPlayerId) ?? null;
}

export function getOpponentPlayer(match: AppMatchState, focusedPlayerId: BoardPlayerId) {
  return match.players.find((player) => player.id !== focusedPlayerId) ?? null;
}

export function getFocusedHandCards(match: AppMatchState, focusedPlayerId: BoardPlayerId): CardInstance[] {
  return getFocusedPlayer(match, focusedPlayerId)?.hand ?? [];
}

export function buildCardInstanceMap(match: AppMatchState): Map<string, CardInstance> {
  const cards = match.players.flatMap(player => [
    ...player.hand,
    ...player.deck,
    ...player.cemetery,
    ...player.field.limitedSummons,
    ...player.field.magicSlots.filter(Boolean),
    ...(player.field.primaryCreature ? [player.field.primaryCreature] : [])
  ]);
  return new Map(cards.map(card => [card.instanceId, card]));
}
