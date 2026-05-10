import type { CardInstance, MatchState } from "@ward/shared";
import { addEvent, cloneState, getPlayer } from "./engineRuntime.js";
import {
  ensureNoHandDiscardRequired,
  ensureNoOpenChain,
  ensureNoPendingManualEffects
} from "./actionGuards.js";
import { shuffleCards } from "./actionCards.js";
import { hasCompletedOpeningRoll } from "./openingRollActions.js";

export function shuffleDeckForPlayer(
  state: MatchState,
  playerId: string
): MatchState {
  if (!hasCompletedOpeningRoll(state)) {
    throw new Error("Complete the opening low-roll before shuffling.");
  }

  if (state.pendingPrompt) {
    throw new Error("Resolve the pending prompt before shuffling.");
  }

  ensureNoHandDiscardRequired(state);
  ensureNoOpenChain(state);
  ensureNoPendingManualEffects(state);

  const nextState = cloneState(state);
  const player = getPlayer(nextState, playerId);

  player.deck = shuffleCards(player.deck);

  addEvent(nextState, "DECK_SHUFFLED", playerId);

  return nextState;
}

export function shuffleAllDecks(state: MatchState): MatchState {
  if (!hasCompletedOpeningRoll(state)) {
    throw new Error("Complete the opening low-roll before shuffling.");
  }

  if (state.pendingPrompt) {
    throw new Error("Resolve the pending prompt before shuffling.");
  }

  ensureNoHandDiscardRequired(state);
  ensureNoOpenChain(state);
  ensureNoPendingManualEffects(state);

  const anyPlayerHasDrawn = state.players.some(player => player.hand.length > 0);

  if (anyPlayerHasDrawn) {
    throw new Error("Cannot shuffle all decks after players have drawn cards.");
  }

  let nextState = cloneState(state);

  for (const player of nextState.players) {
    nextState = shuffleDeckForPlayer(nextState, player.id);
  }

  nextState.setup.decksShuffled = true;

  addEvent(nextState, "ALL_DECKS_SHUFFLED");

  return nextState;
}

export function drawCards(
  state: MatchState,
  playerId: string,
  count: number
): MatchState {
  const nextState = cloneState(state);
  const player = getPlayer(nextState, playerId);

  const drawnCards: CardInstance[] = [];

  for (let index = 0; index < count; index++) {
    const card = player.deck.shift();

    if (!card) {
      break;
    }

    card.zone = "HAND";
    drawnCards.push(card);
    player.hand.push(card);
  }

  addEvent(nextState, "CARDS_DRAWN", playerId, {
    countRequested: count,
    countDrawn: drawnCards.length
  });

  return nextState;
}

export function drawForActivePlayer(state: MatchState): MatchState {
  if (state.pendingPrompt) {
    throw new Error("Resolve the pending prompt before drawing.");
  }


  if (!state.setup.decksShuffled) {
    throw new Error("Shuffle both decks before drawing.");
  }

  if (!hasCompletedOpeningRoll(state)) {
    throw new Error("Complete the opening low-roll before drawing.");
  }

  const activePlayer = getPlayer(state, state.turn.activePlayerId);

  if (activePlayer.turnFlags.drawnThisTurn) {
    throw new Error("This player has already drawn during this turn.");
  }

  const isFirstTurnDraw =
    !state.setup.firstTurnDrawsByPlayer[activePlayer.id];

  const drawCount = isFirstTurnDraw ? 5 : 1;

  const nextState = drawCards(state, activePlayer.id, drawCount);
  const nextActivePlayer = getPlayer(nextState, activePlayer.id);

  nextActivePlayer.turnFlags.drawnThisTurn = true;

  if (isFirstTurnDraw) {
  nextState.setup.firstTurnDrawsByPlayer[activePlayer.id] = true;

  addEvent(nextState, "FIRST_TURN_DRAW_COMPLETED", activePlayer.id, {
    cardsDrawn: drawCount
  });
}

const updatedActivePlayer = getPlayer(nextState, activePlayer.id);

if (updatedActivePlayer.hand.length > 8) {
  nextState.setup.handDiscardRequiredForPlayerId = updatedActivePlayer.id;

  addEvent(nextState, "HAND_SIZE_DISCARD_REQUIRED", updatedActivePlayer.id, {
    handSize: updatedActivePlayer.hand.length,
    requiredHandSize: 8,
    cardsToDiscard: updatedActivePlayer.hand.length - 8
  });
}

return nextState;
}

/**
 * Plays a creature card from the player's hand as the primary creature on their field.
 * This can be a normal summon during the Summoning/Magic Phase or a forced replacement if required.
 * The function validates conditions such as active player, phase, available slots, and summon limits.
 * It handles sacrifices by moving specified cards from hand to cemetery and updates the game state accordingly.
 * Events are added for sacrifices and the primary creature play.
 * 
 * @param state - The current match state.
 * @param playerId - The ID of the player performing the action.
 * @param cardInstanceId - The instance ID of the creature card to play from hand.
 * @param sacrificeCardInstanceIds - Optional array of instance IDs of cards to sacrifice from hand (defaults to empty array).
 * @returns The updated match state after playing the creature.
 * @throws Error if there is a pending prompt, if it's not the player's turn, if the phase is incorrect (for non-forced summons),
 *         if the primary slot is occupied, if the normal summon limit is reached (for non-forced summons),
 *         if the card is not in hand, if it's not a creature, or if sacrifices are invalid.
 */
