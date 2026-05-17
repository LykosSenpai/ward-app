import type { MatchState } from "@ward/shared";
import { calculateCemeteryCreatureHp } from "./cemetery.js";
import { addEvent, cloneState, getOpponentPlayer, getPlayer } from "./engineRuntime.js";

function completeMatch(
  state: MatchState,
  winnerPlayerId: string,
  losingPlayerId: string,
  completionReason: string
): MatchState {
  if (state.status === "COMPLETE") {
    throw new Error("This match is already complete.");
  }

  const nextState = cloneState(state);

  const winner = getPlayer(nextState, winnerPlayerId);
  const loser = getPlayer(nextState, losingPlayerId);

  loser.hasLost = true;
  loser.lossReason = completionReason;

  nextState.status = "COMPLETE";
  nextState.winnerPlayerId = winner.id;
  nextState.losingPlayerId = loser.id;
  nextState.completionReason = completionReason;
  nextState.completedAt = new Date().toISOString();

  addEvent(nextState, "MATCH_COMPLETED", winner.id, {
    winnerPlayerId: winner.id,
    winnerName: winner.displayName,
    losingPlayerId: loser.id,
    loserName: loser.displayName,
    completionReason
  });

  return nextState;
}

export function concedeMatch(
  state: MatchState,
  concedingPlayerId: string
): MatchState {
  const concedingPlayer = getPlayer(state, concedingPlayerId);
  const winner = getOpponentPlayer(state, concedingPlayerId);

  return completeMatch(
    state,
    winner.id,
    concedingPlayer.id,
    `${concedingPlayer.displayName} conceded.`
  );
}

export function callCemeteryHpLoss(
  state: MatchState,
  losingPlayerId: string,
  callingPlayerId: string
): MatchState {
  const losingPlayer = getPlayer(state, losingPlayerId);
  const callingPlayer = getPlayer(state, callingPlayerId);
  const losingCemeteryHp = calculateCemeteryCreatureHp(losingPlayer);

  if (callingPlayer.id === losingPlayer.id) {
    throw new Error("A player cannot call cemetery HP loss against themselves.");
  }

  if (losingCemeteryHp < state.settings.cemeteryHpLimit) {
    throw new Error(
      `${losingPlayer.displayName} has ${losingCemeteryHp} cemetery HP. The loss threshold is ${state.settings.cemeteryHpLimit}.`
    );
  }

  return completeMatch(
    state,
    callingPlayer.id,
    losingPlayer.id,
    `${callingPlayer.displayName} called cemetery HP loss against ${losingPlayer.displayName}.`
  );
}

export function completeCemeteryHpLossIfNeeded(state: MatchState): MatchState {
  if ((state.status ?? "ACTIVE") === "COMPLETE") {
    return state;
  }

  const playersAtLimit = state.players
    .map(player => ({
      player,
      cemeteryHp: calculateCemeteryCreatureHp(player)
    }))
    .filter(item => item.cemeteryHp >= state.settings.cemeteryHpLimit);

  if (playersAtLimit.length !== 1) {
    return state;
  }

  const losingPlayer = playersAtLimit[0]!.player;
  const winner = getOpponentPlayer(state, losingPlayer.id);

  return completeMatch(
    state,
    winner.id,
    losingPlayer.id,
    `${losingPlayer.displayName} reached ${playersAtLimit[0]!.cemeteryHp} cemetery HP.`
  );
}
