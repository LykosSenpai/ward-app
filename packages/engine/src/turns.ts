import { removeExpiredStatModifiersForPlayerTurnStart } from "./effectiveStats.js";
import {
  processBeginningOfCombatRuntimeEffects,
  processBeginningOfTurnRuntimeEffects,
  processEndOfCombatRuntimeEffects,
  refreshRecurringRuntimeEffectsAtEndOfTurn,
  refreshRegeneratingHealsAtEndOfTurn
} from "./creatureRuntimeEffects.js";
import { v4 as uuidv4 } from "uuid";
import type { MatchState, PlayerState, TurnPhase } from "@ward/shared";
import { playerHasSummonableCreatureInHand } from "./summonRules.js";
import { removeExpiredSilenceFromTheGraveEffects } from "./silenceFromTheGrave.js";

const PHASE_ORDER: TurnPhase[] = [
  "DRAW",
  "SUMMON_MAGIC",
  "COMBAT",
  "SECOND_MAGIC",
  "END"
];

function cloneState(state: MatchState): MatchState {
  return JSON.parse(JSON.stringify(state)) as MatchState;
}


function addEvent(
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
  });
}

function getPlayer(state: MatchState, playerId: string): PlayerState {
  const player = state.players.find(p => p.id === playerId);

  if (!player) {
    throw new Error(`Player not found: ${playerId}`);
  }

  return player;
}

function resetPerTurnFlags(player: PlayerState): void {
  player.turnFlags.drawnThisTurn = false;
  player.turnFlags.playedCreatureThisTurn = false;
  player.turnFlags.normalSummonUsed = false;
  player.turnFlags.killedOwnCreatureThisTurn = false;
  player.turnFlags.hasBattledThisCombat = false;
  player.turnFlags.battleUsedCreatureInstanceIds = [];
}

export function getNextPhase(currentPhase: TurnPhase): TurnPhase | null {
  const index = PHASE_ORDER.indexOf(currentPhase);

  if (index === -1) {
    throw new Error(`Invalid turn phase: ${currentPhase}`);
  }

  return PHASE_ORDER[index + 1] ?? null;
}

export function processCombatPhaseEndInPlace(
  state: MatchState,
  reason = "COMBAT_PHASE_ENDED"
): void {
  if (state.turn.phase !== "COMBAT") {
    return;
  }

  processEndOfCombatRuntimeEffects(state, addEvent);

  addEvent(state, "COMBAT_PHASE_END_EFFECTS_PROCESSED", state.turn.activePlayerId, {
    reason,
    activePlayerId: state.turn.activePlayerId,
    turnNumber: state.turn.turnNumber,
    turnCycleNumber: state.turn.turnCycleNumber
  });
}

export function advancePhase(state: MatchState): MatchState {
  if (state.pendingBattle && state.pendingBattle.status !== "COMPLETE") {
    throw new Error("Finish the pending battle before advancing the turn.");
  }

  if (state.pendingPrompt) {
    throw new Error("Resolve the pending prompt before advancing the turn.");
  }

  if (state.manualEffectQueue.some(effect => !effect.completed)) {
    throw new Error("Complete all pending Magic effects before advancing the turn.");
  }

  if (state.pendingChain) {
    throw new Error("Resolve the pending Magic Chain before advancing the turn.");
    }

  if (state.setup.handDiscardRequiredForPlayerId) {
    const discardPlayer = getPlayer(
      state,
      state.setup.handDiscardRequiredForPlayerId
    );

    throw new Error(
      `${discardPlayer.displayName} must discard down to 8 cards before the turn can continue.`
    );
  }

  if (state.setup.primaryReplacementRequiredForPlayerId) {
    const replacementPlayer = getPlayer(
      state,
      state.setup.primaryReplacementRequiredForPlayerId
    );

    if (playerHasSummonableCreatureInHand(state, replacementPlayer)) {
      throw new Error(
        `${replacementPlayer.displayName} must replace their primary creature before the game can continue.`
      );
    }

    throw new Error(
      `${replacementPlayer.displayName} has no summonable creature in hand. They must request a no-creature hand reveal/redraw.`
    );
  }

  const activePlayer = getPlayer(state, state.turn.activePlayerId);

  if (state.turn.phase === "DRAW" && !activePlayer.turnFlags.drawnThisTurn) {
    throw new Error("You must draw for turn before leaving the Draw Phase.");
  }

  if (
    state.turn.phase === "SUMMON_MAGIC" &&
    !activePlayer.turnFlags.hasTakenFirstTurn &&
    !activePlayer.field.primaryCreature
  ) {
    if (playerHasSummonableCreatureInHand(state, activePlayer)) {
      throw new Error(
        "You must play a primary creature during your first turn before leaving the Summoning/Magic Phase."
      );
    }

    throw new Error(
      "You have no summonable creature in hand. Request a no-creature hand reveal/redraw and have your opponent approve it."
    );
  }

  const nextPhase = getNextPhase(state.turn.phase);

  if (nextPhase) {
    const nextState = cloneState(state);
    let phaseToEnter = nextPhase;
    nextState.setup.summonResponseWindow = undefined;

    if (state.turn.phase === "SUMMON_MAGIC" && nextPhase === "COMBAT" && !state.turn.firstTurnCycleComplete) {
      phaseToEnter = "SECOND_MAGIC";

      addEvent(nextState, "FIRST_TURN_CYCLE_BATTLE_PHASE_SKIPPED", activePlayer.id, {
        activePlayerId: activePlayer.id,
        turnNumber: state.turn.turnNumber,
        turnCycleNumber: state.turn.turnCycleNumber,
        reason: "No Battle Phase during the first turn cycle."
      });
    }

    if (state.turn.phase === "COMBAT" && phaseToEnter === "SECOND_MAGIC") {
      processCombatPhaseEndInPlace(nextState, "ADVANCE_PHASE_TO_SECOND_MAGIC");
    }

    nextState.turn = {
      ...nextState.turn,
      phase: phaseToEnter
    };

    if (state.turn.phase === "SUMMON_MAGIC" && phaseToEnter === "COMBAT") {
      processBeginningOfCombatRuntimeEffects(nextState, addEvent);
    }

    return nextState;
  }

  return advanceTurn(state);
}

export function endTurn(state: MatchState): MatchState {
  const activePlayerId = state.turn.activePlayerId;
  let nextState = state;

  for (let index = 0; index < PHASE_ORDER.length + 1; index += 1) {
    if (nextState.turn.activePlayerId !== activePlayerId) {
      return nextState;
    }

    nextState = advancePhase(nextState);
  }

  return nextState;
}

export function advanceTurn(state: MatchState): MatchState {
  const nextState = cloneState(state);

  const currentPlayer = getPlayer(nextState, nextState.turn.activePlayerId);

  currentPlayer.turnFlags.hasTakenFirstTurn = true;
  refreshRecurringRuntimeEffectsAtEndOfTurn(nextState, currentPlayer.id, addEvent);
  refreshRegeneratingHealsAtEndOfTurn(nextState, currentPlayer.id, addEvent);

  const nextIndex =
    (nextState.turn.currentTurnIndex + 1) %
    nextState.turn.currentTurnOrder.length;

  const nextPlayerId = nextState.turn.currentTurnOrder[nextIndex];
  const nextPlayer = getPlayer(nextState, nextPlayerId);

  resetPerTurnFlags(nextPlayer);

  const completedCycle = nextIndex === 0;

  nextState.turn = {
  ...nextState.turn,
  activePlayerId: nextPlayerId,
  currentTurnIndex: nextIndex,
  phase: "DRAW",
  turnNumber: nextState.turn.turnNumber + 1,
  turnCycleNumber: completedCycle
    ? nextState.turn.turnCycleNumber + 1
    : nextState.turn.turnCycleNumber,
  firstTurnCycleComplete: completedCycle
    ? true
    : nextState.turn.firstTurnCycleComplete,
  turnStartCountsByPlayer: {
    ...nextState.turn.turnStartCountsByPlayer,
    [nextPlayerId]:
      (nextState.turn.turnStartCountsByPlayer[nextPlayerId] ?? 0) + 1
  }
};

removeExpiredSilenceFromTheGraveEffects(nextState, nextPlayerId, addEvent);
removeExpiredStatModifiersForPlayerTurnStart(nextState, nextPlayerId);
processBeginningOfTurnRuntimeEffects(nextState, addEvent);

return nextState;
}
