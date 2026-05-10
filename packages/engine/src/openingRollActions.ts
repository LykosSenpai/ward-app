import type { MatchState } from "@ward/shared";
import { addEvent, cloneState, getPlayer } from "./engineRuntime.js";
import { rollD6 } from "./dice.js";

function ensureOpeningRollState(state: MatchState) {
  if (state.setup.openingRoll) {
    return state.setup.openingRoll;
  }

  const firstDraws = state.setup.firstTurnDrawsByPlayer ?? {};
  const noOpeningCardsDrawn =
    state.players.every(player => player.hand.length === 0) &&
    state.players.every(player => !firstDraws[player.id]);
  const appearsToBeFreshOpening =
    state.status !== "COMPLETE" &&
    noOpeningCardsDrawn &&
    state.turn.turnNumber === 1 &&
    state.turn.phase === "DRAW";

  if (appearsToBeFreshOpening) {
    return {
      status: "AWAITING_ROLL" as const,
      round: 1,
      rolls: Object.fromEntries(state.players.map(player => [player.id, undefined]))
    };
  }

  return {
    status: "COMPLETE" as const,
    round: 1,
    rolls: {},
    winnerPlayerId: state.turn.activePlayerId
  };
}

export function hasCompletedOpeningRoll(state: MatchState): boolean {
  return ensureOpeningRollState(state).status === "COMPLETE";
}

export function rollOpeningTurnOrder(state: MatchState, playerId: string): MatchState {
  const openingRoll = ensureOpeningRollState(state);

  if (openingRoll.status === "COMPLETE") {
    throw new Error("Opening roll is already complete.");
  }

  if (state.players.some(player => player.hand.length > 0)) {
    throw new Error("Opening roll must be completed before drawing.");
  }

  if (state.pendingPrompt || state.pendingBattle || state.pendingChain || state.pendingEffectTargetPrompt) {
    throw new Error("Resolve the pending game action before rolling for first turn.");
  }

  if (state.manualEffectQueue.some(effect => !effect.completed)) {
    throw new Error("Complete all pending Magic effects before rolling for first turn.");
  }

  const nextState = cloneState(state);
  const nextOpeningRoll = nextState.setup.openingRoll ?? {
    status: "AWAITING_ROLL" as const,
    round: 1,
    rolls: {}
  };
  nextState.setup.openingRoll = nextOpeningRoll;

  const player = getPlayer(nextState, playerId);

  if (nextOpeningRoll.rolls[player.id] !== undefined) {
    throw new Error(`${player.displayName} has already rolled this opening roll round.`);
  }

  const [roll] = rollD6(1);
  nextOpeningRoll.rolls[player.id] = roll;

  addEvent(nextState, "OPENING_TURN_ROLL", player.id, {
    round: nextOpeningRoll.round,
    roll,
    dice: [roll]
  });

  const playersWithoutRoll = nextState.players.filter(candidate => nextOpeningRoll.rolls[candidate.id] === undefined);
  if (playersWithoutRoll.length > 0) {
    return nextState;
  }

  const [firstPlayer, secondPlayer] = nextState.players;
  const firstRoll = nextOpeningRoll.rolls[firstPlayer.id];
  const secondRoll = nextOpeningRoll.rolls[secondPlayer.id];

  if (firstRoll === undefined || secondRoll === undefined) {
    return nextState;
  }

  nextOpeningRoll.lastRolls = {
    [firstPlayer.id]: firstRoll,
    [secondPlayer.id]: secondRoll
  };

  if (firstRoll === secondRoll) {
    addEvent(nextState, "OPENING_TURN_ROLL_TIED", undefined, {
      round: nextOpeningRoll.round,
      rolls: nextOpeningRoll.lastRolls,
      message: "Opening rolls matched. Roll again."
    });

    nextOpeningRoll.round += 1;
    nextOpeningRoll.rolls = {
      [firstPlayer.id]: undefined,
      [secondPlayer.id]: undefined
    };
    return nextState;
  }

  const winner = firstRoll < secondRoll ? firstPlayer : secondPlayer;
  const loser = winner.id === firstPlayer.id ? secondPlayer : firstPlayer;

  nextOpeningRoll.status = "COMPLETE";
  nextOpeningRoll.winnerPlayerId = winner.id;
  nextOpeningRoll.rolls = {
    [firstPlayer.id]: firstRoll,
    [secondPlayer.id]: secondRoll
  };

  nextState.turn.activePlayerId = winner.id;
  nextState.turn.currentTurnOrder = [winner.id, loser.id];
  nextState.turn.currentTurnIndex = 0;
  nextState.turn.turnStartCountsByPlayer = {
    [winner.id]: 1,
    [loser.id]: 0
  };

  addEvent(nextState, "OPENING_TURN_ROLL_COMPLETED", winner.id, {
    round: nextOpeningRoll.round,
    rolls: nextOpeningRoll.lastRolls,
    winnerPlayerId: winner.id,
    message: `${winner.displayName} wins the low-roll opening roll and goes first.`
  });

  return nextState;
}
