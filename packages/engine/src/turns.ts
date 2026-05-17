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
import {
  processTurnEndTriggeredEffects,
  processTurnStartTriggeredEffects
} from "./turnTriggeredEffects.js";
import {
  clearNonBlockingPendingEffectRollForPhaseAdvanceInPlace,
  createPendingStatusTickEffectRollSession,
  isPendingEffectRollPhaseBlocking
} from "./effectRollActions.js";

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

function turnBoardEventPayload(
  state: MatchState,
  type: "TURN_STARTED" | "TURN_PHASE_CHANGED",
  playerId: string,
  phase: TurnPhase,
  reason?: string
): Record<string, unknown> {
  return {
    playerId,
    phase,
    turnNumber: state.turn.turnNumber,
    turnCycleNumber: state.turn.turnCycleNumber,
    ...(reason ? { reason } : {}),
    boardEvents: [
      {
        type,
        playerId,
        phase,
        turnNumber: state.turn.turnNumber,
        turnCycleNumber: state.turn.turnCycleNumber,
        ...(reason ? { reason } : {})
      }
    ]
  };
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
  player.turnFlags.retaliationSavedCreatureInstanceIds = [];
}

function getSkipTurnReason(player: PlayerState): string | null {
  if (Number(player.skipNextTurnCount ?? 0) > 0) {
    const skipLock = player.playerLocks?.find(lock => lock.kind === "SKIP_TURN");
    return skipLock?.reason ?? skipLock?.label ?? "A player-level effect skips this turn.";
  }

  const actionLock = player.playerLocks?.find(lock => lock.kind === "ACTION_LOCK");
  return actionLock?.reason ?? actionLock?.label ?? null;
}

function consumeSkipTurnLock(state: MatchState, player: PlayerState, reason: string): void {
  const previousSkipCount = Number(player.skipNextTurnCount ?? 0);
  player.skipNextTurnCount = Math.max(0, previousSkipCount - 1);

  const skipLocks = player.playerLocks?.filter(lock => lock.kind === "SKIP_TURN") ?? [];
  const boardEvents = [
    {
      type: "TURN_SKIPPED",
      playerId: player.id,
      reason,
      turnNumber: state.turn.turnNumber,
      turnCycleNumber: state.turn.turnCycleNumber,
      phase: state.turn.phase
    },
    ...skipLocks.flatMap(lock => {
      const remainingTurns = Math.max(0, Number(lock.remainingTurns ?? previousSkipCount) - 1);
      if (remainingTurns > 0) {
        lock.remainingTurns = remainingTurns;
        return [];
      }
      return [{
        type: "PLAYER_LOCK_REMOVED",
        playerId: player.id,
        reason: "SKIP_TURN_CONSUMED",
        status: "SKIP_TURN",
        statusLabel: lock.label,
        lockId: lock.id
      }];
    })
  ];

  player.playerLocks = (player.playerLocks ?? []).filter(lock =>
    lock.kind !== "SKIP_TURN" || Number(lock.remainingTurns ?? 0) > 0
  );

  addEvent(state, "TURN_SKIPPED", player.id, {
    playerId: player.id,
    playerName: player.displayName,
    reason,
    previousSkipCount,
    skipNextTurnCount: player.skipNextTurnCount,
    turnNumber: state.turn.turnNumber,
    turnCycleNumber: state.turn.turnCycleNumber,
    boardEvents
  });
}

function enterNextPlayerTurn(
  state: MatchState,
  nextPlayerId: string,
  nextIndex: number,
  completedCycle: boolean,
  reason: string
): void {
  const nextPlayer = getPlayer(state, nextPlayerId);
  resetPerTurnFlags(nextPlayer);

  state.turn = {
    ...state.turn,
    activePlayerId: nextPlayerId,
    currentTurnIndex: nextIndex,
    phase: "DRAW",
    turnNumber: state.turn.turnNumber + 1,
    turnCycleNumber: completedCycle
      ? state.turn.turnCycleNumber + 1
      : state.turn.turnCycleNumber,
    firstTurnCycleComplete: completedCycle
      ? true
      : state.turn.firstTurnCycleComplete,
    turnStartCountsByPlayer: {
      ...state.turn.turnStartCountsByPlayer,
      [nextPlayerId]:
        (state.turn.turnStartCountsByPlayer[nextPlayerId] ?? 0) + 1
    }
  };

  addEvent(
    state,
    "TURN_STARTED",
    nextPlayerId,
    turnBoardEventPayload(state, "TURN_STARTED", nextPlayerId, "DRAW", reason)
  );

  addEvent(
    state,
    "TURN_PHASE_CHANGED",
    nextPlayerId,
    turnBoardEventPayload(state, "TURN_PHASE_CHANGED", nextPlayerId, "DRAW", reason)
  );
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

  if (state.pendingEffectRoll && isPendingEffectRollPhaseBlocking(state.pendingEffectRoll)) {
    throw new Error("Resolve the pending effect roll before advancing the turn.");
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
  const nextStateBase = cloneState(state);
  clearNonBlockingPendingEffectRollForPhaseAdvanceInPlace(nextStateBase, addEvent);

  if (nextPhase) {
    const nextState = nextStateBase;
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

    addEvent(
      nextState,
      "TURN_PHASE_CHANGED",
      activePlayer.id,
      turnBoardEventPayload(nextState, "TURN_PHASE_CHANGED", activePlayer.id, phaseToEnter, "ADVANCE_PHASE")
    );

    if (state.turn.phase === "SUMMON_MAGIC" && phaseToEnter === "COMBAT") {
      processBeginningOfCombatRuntimeEffects(nextState, addEvent);
    }

    return nextState;
  }

  return advanceTurn(nextStateBase);
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

  processTurnEndTriggeredEffects(nextState, currentPlayer.id, addEvent);

  currentPlayer.turnFlags.hasTakenFirstTurn = true;
  refreshRecurringRuntimeEffectsAtEndOfTurn(nextState, currentPlayer.id, addEvent);
  refreshRegeneratingHealsAtEndOfTurn(nextState, currentPlayer.id, addEvent);

  const playerCount = nextState.turn.currentTurnOrder.length;
  const startingTurnIndex = nextState.turn.currentTurnIndex;
  for (let offset = 1; offset <= playerCount; offset += 1) {
    const nextIndex =
      (startingTurnIndex + offset) %
      playerCount;
    const nextPlayerId = nextState.turn.currentTurnOrder[nextIndex];
    const completedCycle = nextIndex === 0;

    enterNextPlayerTurn(nextState, nextPlayerId, nextIndex, completedCycle, "ADVANCE_TURN");

    const nextPlayer = getPlayer(nextState, nextPlayerId);
    const skipReason = getSkipTurnReason(nextPlayer);
    if (!skipReason) {
      removeExpiredSilenceFromTheGraveEffects(nextState, nextPlayerId, addEvent);
      removeExpiredStatModifiersForPlayerTurnStart(nextState, nextPlayerId, addEvent);
      processBeginningOfTurnRuntimeEffects(nextState, addEvent);
      createPendingStatusTickEffectRollSession(nextState, nextPlayerId, addEvent);
      processTurnStartTriggeredEffects(nextState, nextPlayerId, addEvent);
      return nextState;
    }

    consumeSkipTurnLock(nextState, nextPlayer, skipReason);
  }

  const activePlayer = getPlayer(nextState, nextState.turn.activePlayerId);
  addEvent(nextState, "TURN_SKIP_LOOP_STOPPED", activePlayer.id, {
    playerId: activePlayer.id,
    reason: "All players are currently locked or skipped; leaving control on the last skipped player."
  });
  return nextState;
}
