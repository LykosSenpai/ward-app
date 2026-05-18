import type { MatchState, PlayerState } from "@ward/shared";

function playerNeedsPrimaryReplacement(player: PlayerState): boolean {
  return !player.hasLost && !player.field.primaryCreature;
}

export function markPrimaryReplacementRequired(
  state: MatchState,
  playerId: string
): string | undefined {
  const currentPlayerId = state.setup.primaryReplacementRequiredForPlayerId;
  const currentPlayer = currentPlayerId
    ? state.players.find(player => player.id === currentPlayerId)
    : undefined;

  if (currentPlayer && playerNeedsPrimaryReplacement(currentPlayer)) {
    return currentPlayer.id;
  }

  const player = state.players.find(candidate => candidate.id === playerId);
  if (player && playerNeedsPrimaryReplacement(player)) {
    state.setup.primaryReplacementRequiredForPlayerId = player.id;
    return player.id;
  }

  return advancePrimaryReplacementRequirement(state);
}

export function advancePrimaryReplacementRequirement(
  state: MatchState,
  completedPlayerId?: string
): string | undefined {
  const nextPlayer = state.players.find(player =>
    player.id !== completedPlayerId &&
    playerNeedsPrimaryReplacement(player)
  ) ?? state.players.find(player => playerNeedsPrimaryReplacement(player));

  state.setup.primaryReplacementRequiredForPlayerId = nextPlayer?.id;
  return nextPlayer?.id;
}

export function repairPrimaryReplacementRequirementIfNeeded(
  state: MatchState
): string | undefined {
  const currentPlayerId = state.setup.primaryReplacementRequiredForPlayerId;
  const currentPlayer = currentPlayerId
    ? state.players.find(player => player.id === currentPlayerId)
    : undefined;

  if (currentPlayer && playerNeedsPrimaryReplacement(currentPlayer)) {
    return currentPlayer.id;
  }

  return advancePrimaryReplacementRequirement(state, currentPlayerId);
}
