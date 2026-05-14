import { v4 as uuidv4 } from "uuid";
import type { CardInstance, MatchState, PlayerState, RevealedCardInfo } from "@ward/shared";
import { calculateCemeteryCreatureHp } from "./cemetery.js";
import { playerHasSummonableCreatureInHand } from "./summonRules.js";
import { addEvent, cloneState, getCardDefinition, getOpponentPlayer, getPlayer } from "./engineRuntime.js";
import {
  ensureNoHandDiscardRequired,
  ensureNoOpenChain,
  ensureNoPendingManualEffects
} from "./actionGuards.js";
import { shuffleCards } from "./actionCards.js";

function getHandAnimationSlotId(playerId: string, handIndex: number): string {
  const normalizedPlayerId = playerId === "player_2" ? "player_2" : "player_1";
  return `${normalizedPlayerId}-hand-${Math.min(Math.max(1, handIndex + 1), 10)}`;
}

function hasAnyCreatureCardInHandOrDeck(state: MatchState, player: PlayerState): boolean {
  return [...player.hand, ...player.deck].some(card => state.cardCatalog[card.cardId]?.cardType === "CREATURE");
}

function completeCreatureOutLossInPlace(state: MatchState, losingPlayerId: string): void {
  const losingPlayer = getPlayer(state, losingPlayerId);
  const winner = getOpponentPlayer(state, losingPlayerId);

  losingPlayer.hasLost = true;
  losingPlayer.lossReason = `${losingPlayer.displayName} has no playable creatures in hand or deck.`;

  state.status = "COMPLETE";
  state.winnerPlayerId = winner.id;
  state.losingPlayerId = losingPlayer.id;
  state.completionReason = losingPlayer.lossReason;
  state.completedAt = new Date().toISOString();
  state.pendingPrompt = undefined;
  state.setup.primaryReplacementRequiredForPlayerId = undefined;

  addEvent(state, "MATCH_COMPLETED", winner.id, {
    winnerPlayerId: winner.id,
    winnerName: winner.displayName,
    losingPlayerId: losingPlayer.id,
    loserName: losingPlayer.displayName,
    completionReason: losingPlayer.lossReason
  });
}

function returnHandToDeckAndShuffle(player: PlayerState): number {
  const cardsToReturn = [...player.hand];
  player.hand = [];

  for (const card of cardsToReturn) {
    card.zone = "DECK";
    player.deck.push(card);
  }

  player.deck = shuffleCards(player.deck);
  return cardsToReturn.length;
}

function drawCardsInPlace(player: PlayerState, count: number): CardInstance[] {
  const drawn: CardInstance[] = [];
  const safeCount = Math.max(0, Math.trunc(count));

  for (let index = 0; index < safeCount; index++) {
    const card = player.deck.shift();
    if (!card) break;

    card.zone = "HAND";
    player.hand.push(card);
    drawn.push(card);
  }

  return drawn;
}

function redrawUntilSummonableCreatureInPlace(
  state: MatchState,
  player: PlayerState,
  redrawCount: number,
  eventPlayerId: string,
  reason: string
): { success: boolean; attempts: number; finalHandSize: number } {
  const safeRedrawCount = Math.max(1, Math.trunc(redrawCount));
  const maxAttempts = Math.max(100, (player.deck.length + player.hand.length + safeRedrawCount) * 20);
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts += 1;
    returnHandToDeckAndShuffle(player);
    drawCardsInPlace(player, safeRedrawCount);

    addEvent(state, "NO_CREATURE_REDRAW_ATTEMPT_RESOLVED", eventPlayerId, {
      requestingPlayerId: player.id,
      redrawCount: safeRedrawCount,
      attempt: attempts,
      handSize: player.hand.length,
      deckSize: player.deck.length,
      reason
    });

    if (playerHasSummonableCreatureInHand(state, player)) {
      player.deck = shuffleCards(player.deck);
      addEvent(state, "NO_CREATURE_REDRAW_COMPLETED", eventPlayerId, {
        requestingPlayerId: player.id,
        redrawCount: safeRedrawCount,
        attempts,
        finalHandSize: player.hand.length,
        deckShuffledAfterSuccess: true,
        reason
      });

      return { success: true, attempts, finalHandSize: player.hand.length };
    }

    if (!hasAnyCreatureCardInHandOrDeck(state, player)) {
      completeCreatureOutLossInPlace(state, player.id);
      addEvent(state, "NO_CREATURE_REDRAW_FAILED_CREATURE_OUT", eventPlayerId, {
        requestingPlayerId: player.id,
        redrawCount: safeRedrawCount,
        attempts,
        reason: "No creature cards remain in hand or deck."
      });

      return { success: false, attempts, finalHandSize: player.hand.length };
    }
  }

  addEvent(state, "NO_CREATURE_REDRAW_ATTEMPT_LIMIT_REACHED", eventPlayerId, {
    requestingPlayerId: player.id,
    redrawCount: safeRedrawCount,
    attempts,
    reason: "A summonable hand was not produced within the automatic redraw safety limit."
  });

  return { success: false, attempts, finalHandSize: player.hand.length };
}

function drawOneAtATimeForEmptyHandReplacementInPlace(
  state: MatchState,
  player: PlayerState
): { success: boolean; drawnCount: number } {
  let drawnCount = 0;

  while (player.deck.length > 0) {
    const drawn = drawCardsInPlace(player, 1);
    if (drawn.length === 0) break;
    drawnCount += drawn.length;

    addEvent(state, "EMPTY_HAND_REPLACEMENT_CARD_DRAWN", player.id, {
      requestingPlayerId: player.id,
      drawnCount,
      handSize: player.hand.length,
      deckSize: player.deck.length
    });

    if (playerHasSummonableCreatureInHand(state, player)) {
      player.deck = shuffleCards(player.deck);
      addEvent(state, "EMPTY_HAND_REPLACEMENT_DRAW_COMPLETED", player.id, {
        requestingPlayerId: player.id,
        drawnCount,
        handSize: player.hand.length,
        deckShuffledAfterSuccess: true
      });
      return { success: true, drawnCount };
    }
  }

  completeCreatureOutLossInPlace(state, player.id);
  addEvent(state, "EMPTY_HAND_REPLACEMENT_DRAW_FAILED_CREATURE_OUT", player.id, {
    requestingPlayerId: player.id,
    drawnCount,
    reason: "No playable creature could be drawn from the deck."
  });

  return { success: false, drawnCount };
}

export function discardCardFromHand(
  state: MatchState,
  playerId: string,
  cardInstanceId: string
): MatchState {
  if (state.pendingPrompt) {
    throw new Error("Resolve the pending prompt before discarding.");
  }


  if (state.setup.handDiscardRequiredForPlayerId !== playerId) {
    throw new Error("This player is not currently required to discard.");
  }

  const nextState = cloneState(state);
  const player = getPlayer(nextState, playerId);

  const handIndex = player.hand.findIndex(card => card.instanceId === cardInstanceId);

  if (handIndex === -1) {
    throw new Error("Selected card is not in this player's hand.");
  }

  const card = player.hand[handIndex];
  const definition = getCardDefinition(nextState, card);

  player.hand.splice(handIndex, 1);

  card.zone = "CEMETERY";

  if (definition.cardType === "CREATURE") {
    card.currentHp = 0;
  }

  player.cemetery.push(card);
  player.cemeteryCreatureHpTotal = calculateCemeteryCreatureHp(player);

  addEvent(nextState, "CARD_DISCARDED_FOR_HAND_SIZE", playerId, {
    cardInstanceId,
    cardName: definition.name,
    cardType: definition.cardType,
    sourceSlotId: getHandAnimationSlotId(playerId, handIndex),
    targetSlotId: `${playerId === "player_2" ? "player_2" : "player_1"}-cemetery`,
    handSizeAfterDiscard: player.hand.length,
    cemeteryCreatureHpTotal: player.cemeteryCreatureHpTotal,
    boardEvents: [
      {
        type: "CARD_DISCARDED",
        playerId,
        actionType: "DISCARD_CARD",
        reason: "HAND_SIZE_DISCARD",
        cardInstanceId,
        fromZoneRef: { playerId, zone: "HAND" },
        toZoneRef: { playerId, zone: "CEMETERY" }
      }
    ]
  });

  if (player.hand.length <= 8) {
    nextState.setup.handDiscardRequiredForPlayerId = undefined;

    addEvent(nextState, "HAND_SIZE_DISCARD_COMPLETED", playerId, {
      finalHandSize: player.hand.length
    });
  }

  return nextState;
}

export function requestNoCreatureRedrawReveal(
  state: MatchState,
  playerId: string
): MatchState {
  if (state.pendingPrompt) {
    throw new Error("There is already a pending prompt.");
  }

  ensureNoHandDiscardRequired(state);
  ensureNoOpenChain(state);
  ensureNoPendingManualEffects(state);

  const isForcedPrimaryReplacement =
    state.setup.primaryReplacementRequiredForPlayerId === playerId;

  if (!isForcedPrimaryReplacement) {
    if (state.turn.activePlayerId !== playerId) {
      throw new Error("Only the active player can request a no-creature redraw.");
    }

    if (state.turn.phase !== "SUMMON_MAGIC") {
      throw new Error("No-creature redraw can only be requested during the Summoning/Magic Phase.");
    }
  }

  const nextState = cloneState(state);
  const player = getPlayer(nextState, playerId);
  const opponent = getOpponentPlayer(nextState, playerId);

  if (player.field.primaryCreature) {
    throw new Error("You already have a primary creature.");
  }

  if (isForcedPrimaryReplacement && player.field.limitedSummons.length > 0) {
    throw new Error(
      "A Limited Summon is available and must be promoted to primary before using no-creature reveal/redraw."
    );
  }

  if (playerHasSummonableCreatureInHand(nextState, player)) {
    throw new Error("You cannot request a redraw because your hand contains a summonable creature.");
  }

  if (player.hand.length === 0) {
    const result = drawOneAtATimeForEmptyHandReplacementInPlace(nextState, player);

    addEvent(nextState, "EMPTY_HAND_REPLACEMENT_DRAW_REQUESTED", player.id, {
      requestingPlayerId: player.id,
      success: result.success,
      drawnCount: result.drawnCount,
      wasForcedReplacement: isForcedPrimaryReplacement
    });

    return nextState;
  }

  const revealedCards: RevealedCardInfo[] = player.hand.map(card => {
    const definition = getCardDefinition(nextState, card);

    return {
      cardInstanceId: card.instanceId,
      cardId: card.cardId,
      name: definition.name,
      cardType: definition.cardType
    };
  });

  nextState.pendingPrompt = {
    id: uuidv4(),
    type: "NO_CREATURE_REDRAW_REVEAL",
    requestingPlayerId: player.id,
    approvingPlayerId: opponent.id,
    revealedCards,
    redrawCount: player.hand.length
  };

  addEvent(nextState, "NO_CREATURE_REDRAW_REVEAL_REQUESTED", player.id, {
    approvingPlayerId: opponent.id,
    redrawCount: player.hand.length,
    revealedCards,
    wasForcedReplacement: isForcedPrimaryReplacement,
    boardEvents: [
      {
        type: "HAND_REVEALED",
        playerId: opponent.id,
        actionType: "REVEAL_HAND",
        reason: "NO_CREATURE_REDRAW_REVEAL",
        fromZoneRef: { playerId: player.id, zone: "HAND" },
        toZoneRef: { playerId: opponent.id, zone: "PROMPT" },
        metadata: {
          viewerPlayerId: opponent.id,
          revealedPlayerId: player.id
        }
      },
      ...revealedCards.map(card => ({
        type: "CARD_REVEALED",
        cardInstanceId: card.cardInstanceId,
        playerId: opponent.id,
        actionType: "REVEAL_HAND",
        reason: "NO_CREATURE_REDRAW_REVEAL",
        fromZoneRef: { playerId: player.id, zone: "HAND" },
        toZoneRef: { playerId: opponent.id, zone: "PROMPT" }
      }))
    ]
  });

  return nextState;
}

export function approveNoCreatureRedrawReveal(
  state: MatchState,
  approvingPlayerId: string
): MatchState {
  if (!state.pendingPrompt) {
    throw new Error("There is no pending prompt to approve.");
  }

  if (state.pendingPrompt.type !== "NO_CREATURE_REDRAW_REVEAL") {
    throw new Error("Unsupported pending prompt type.");
  }

  if (state.pendingPrompt.approvingPlayerId !== approvingPlayerId) {
    throw new Error("Only the opposing player can approve this reveal.");
  }

  let nextState = cloneState(state);
  const prompt = nextState.pendingPrompt;

  if (!prompt || prompt.type !== "NO_CREATURE_REDRAW_REVEAL") {
    throw new Error("Pending prompt was not found after cloning state.");
  }

  const requestingPlayer = getPlayer(nextState, prompt.requestingPlayerId);

  nextState.pendingPrompt = undefined;

  addEvent(nextState, "NO_CREATURE_REDRAW_REVEAL_APPROVED", approvingPlayerId, {
    requestingPlayerId: requestingPlayer.id,
    redrawCount: prompt.redrawCount
  });

  const redrawResult = redrawUntilSummonableCreatureInPlace(
    nextState,
    requestingPlayer,
    prompt.redrawCount,
    approvingPlayerId,
    "NO_CREATURE_REVEAL_APPROVED"
  );

  requestingPlayer.turnFlags.drawnThisTurn = true;

  addEvent(nextState, "NO_CREATURE_REDRAW_REVEAL_RESOLVED", approvingPlayerId, {
    requestingPlayerId: requestingPlayer.id,
    redrawCount: prompt.redrawCount,
    attempts: redrawResult.attempts,
    success: redrawResult.success,
    finalHandSize: redrawResult.finalHandSize
  });

  return nextState;
}
