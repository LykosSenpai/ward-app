import { v4 as uuidv4 } from "uuid";
import type { CardDefinition, CardInstance, GameEvent, MatchState, PlayerState } from "@ward/shared";

export function cloneState(state: MatchState): MatchState {
  return JSON.parse(JSON.stringify(state)) as MatchState;
}

export type AddEventFn = (
  state: MatchState,
  type: string,
  playerId?: string,
  payload?: unknown
) => void;

export function addEvent(
  state: MatchState,
  type: string,
  playerId?: string,
  payload?: unknown
): void {
  state.eventLog.push({
    id: uuidv4(),
    sequenceNumber: state.eventLog.length + 1,
    timestamp: new Date().toISOString(),
    type,
    playerId,
    payload
  } satisfies GameEvent);
}

export function getPlayer(state: MatchState, playerId: string): PlayerState {
  const player = state.players.find(candidate => candidate.id === playerId);

  if (!player) {
    throw new Error(`Player not found: ${playerId}`);
  }

  return player;
}

export function getOpponentPlayer(state: MatchState, playerId: string): PlayerState {
  const opponent = state.players.find(candidate => candidate.id !== playerId);

  if (!opponent) {
    throw new Error(`Opponent not found for player: ${playerId}`);
  }

  return opponent;
}

export function getCardDefinition(
  state: MatchState,
  card: CardInstance
): CardDefinition {
  const definition = state.cardCatalog[card.cardId];

  if (!definition) {
    throw new Error(`Card definition not found: ${card.cardId}`);
  }

  return definition;
}

export function getCardName(state: MatchState, card: CardInstance): string {
  return state.cardCatalog[card.cardId]?.name ?? card.cardId;
}

export function getPendingManualEffects(state: MatchState) {
  return state.manualEffectQueue.filter(effect => !effect.completed);
}
