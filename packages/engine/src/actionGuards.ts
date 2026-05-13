import type { MatchState } from "@ward/shared";
import { getPendingManualEffects, getPlayer } from "./engineRuntime.js";

export function getPlayerActionLockReason(state: MatchState, playerId: string): string | null {
  const player = getPlayer(state, playerId);
  if (Number(player.skipNextTurnCount ?? 0) > 0) {
    const skipLock = player.playerLocks?.find(lock => lock.kind === "SKIP_TURN");
    return skipLock?.reason ?? skipLock?.label ?? `${player.displayName} must skip their next turn.`;
  }

  const lock = player.playerLocks?.find(item => item.kind === "ACTION_LOCK");
  return lock?.reason ?? lock?.label ?? null;
}

export function ensureActivePlayerCanAct(state: MatchState): void {
  const reason = getPlayerActionLockReason(state, state.turn.activePlayerId);
  if (reason) {
    throw new Error(reason);
  }
}

export function ensureNoHandDiscardRequired(state: MatchState): void {
  ensureActivePlayerCanAct(state);

  if (state.setup.handDiscardRequiredForPlayerId) {
    const player = getPlayer(state, state.setup.handDiscardRequiredForPlayerId);

    throw new Error(
      `${player.displayName} must discard down to 8 cards before any other action can continue.`
    );
  }
}


export function ensureNoOpenChain(state: MatchState): void {
  if (state.pendingChain) {
    throw new Error("Resolve the pending Magic Chain before continuing.");
  }
}


export function ensureNoPendingManualEffects(state: MatchState): void {
  const pendingEffects = getPendingManualEffects(state);

  if (pendingEffects.length > 0) {
    throw new Error("Resolve or complete all pending Magic effects before continuing.");
  }
}


export function ensureNoPendingBattle(state: MatchState): void {
  if (state.pendingBattle && state.pendingBattle.status !== "COMPLETE") {
    throw new Error("Finish the pending battle before continuing.");
  }
}
