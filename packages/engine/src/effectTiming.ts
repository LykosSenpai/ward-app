import type { ActiveCreatureStatus, ActiveRecurringCreatureEffect, MatchState, WardEngineEffect } from "@ward/shared";

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function durationData(effect: WardEngineEffect): Record<string, unknown> {
  const duration = effect.duration ?? effect.params?.duration ?? {};
  return typeof duration === "object" && duration !== null
    ? duration as Record<string, unknown>
    : {};
}

function effectDurationText(effect: WardEngineEffect): string {
  const duration = durationData(effect);
  return [
    duration.text,
    duration.type,
    duration.expires,
    effect.value,
    effect.params?.valueText,
    effect.actionText
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function getEffectDurationAmount(effect: WardEngineEffect, fallback = 1): number {
  const duration = durationData(effect);
  const amount = Number(duration.amount ?? fallback);
  return Number.isFinite(amount) && amount > 0 ? Math.trunc(amount) : fallback;
}

export function effectUsesSourceTurnCycle(effect: WardEngineEffect): boolean {
  const duration = durationData(effect);
  const type = normalize(duration.type);
  const expires = normalize(duration.expires);
  const text = effectDurationText(effect);

  return type === "TURN_CYCLES" ||
    expires === "BEGINNING_OF_START_PLAYER_TURN" ||
    text.includes("turn cycle");
}

export function effectDurationIsUntilSourceLeaves(effect: WardEngineEffect): boolean {
  const duration = durationData(effect);
  const type = normalize(duration.type);
  const text = effectDurationText(effect);
  const hasFiniteDuration = Number.isFinite(Number(
    duration.amount ??
    effect.params?.durationAmount ??
    effect.params?.startingTicks
  ));

  return type === "UNTIL_SOURCE_LEAVES_FIELD" ||
    text.includes("until_source_leaves_field") ||
    text.includes("until source leaves") ||
    text.includes("until this card leaves") ||
    ((duration.sourceLinked === true || effect.params?.sourceLinked === true || effect.params?.expiresWhenSourceLeaves === true) && !hasFiniteDuration);
}

export function getTurnCycleExpiration(args: {
  state: MatchState;
  sourcePlayerId: string;
  targetPlayerId: string;
  effect: WardEngineEffect;
  fallbackDuration?: number;
}): { expiresOnPlayerId: string; expiresAtPlayerTurnStartCount: number } {
  const expiresOnPlayerId = effectUsesSourceTurnCycle(args.effect)
    ? args.sourcePlayerId
    : args.targetPlayerId;
  const currentTurnStartCount = args.state.turn.turnStartCountsByPlayer[expiresOnPlayerId] ?? 0;

  return {
    expiresOnPlayerId,
    expiresAtPlayerTurnStartCount: currentTurnStartCount + getEffectDurationAmount(args.effect, args.fallbackDuration ?? 1)
  };
}

export type NormalizedRecurringTickTiming = "BEGINNING_OF_COMBAT_PHASE" | "END_OF_COMBAT_PHASE" | "BEGINNING_OF_TURN";

export function getNextRecurringEffectTickSchedule(
  state: MatchState,
  sourcePlayerId: string,
  tickTiming: NormalizedRecurringTickTiming = "END_OF_COMBAT_PHASE"
): { nextTickPlayerId: string; nextTickTurnStartCount: number } {
  const sourcePlayerTurnStartCount = state.turn.turnStartCountsByPlayer[sourcePlayerId] ?? 0;
  const sourcePlayerIsActive = state.turn.activePlayerId === sourcePlayerId;

  if (tickTiming === "BEGINNING_OF_COMBAT_PHASE") {
    // Damage DOT ticks before the source player can battle. If the DOT was
    // applied before that player's Combat Phase, it may tick this turn. If it
    // was applied during or after Combat, the next eligible window is that
    // source player's following Combat Phase, even if they skip declaring a battle.
    const sourcePlayerCombatHasNotStarted = sourcePlayerIsActive &&
      (state.turn.phase === "DRAW" || state.turn.phase === "SUMMON_MAGIC");

    return {
      nextTickPlayerId: sourcePlayerId,
      nextTickTurnStartCount: sourcePlayerCombatHasNotStarted
        ? sourcePlayerTurnStartCount
        : sourcePlayerTurnStartCount + 1
    };
  }

  if (tickTiming === "END_OF_COMBAT_PHASE") {
    // DOT/HOT use the source player's Combat Phase end window. If applied
    // before or during that Combat Phase, the first tick is due at that same
    // Combat Phase end. If applied after Combat, the first tick is due during
    // that source player's following Combat Phase end.
    const sourcePlayerCombatHasNotEnded = sourcePlayerIsActive &&
      (state.turn.phase === "DRAW" || state.turn.phase === "SUMMON_MAGIC" || state.turn.phase === "COMBAT");

    return {
      nextTickPlayerId: sourcePlayerId,
      nextTickTurnStartCount: sourcePlayerCombatHasNotEnded
        ? sourcePlayerTurnStartCount
        : sourcePlayerTurnStartCount + 1
    };
  }

  return {
    nextTickPlayerId: sourcePlayerId,
    nextTickTurnStartCount: sourcePlayerTurnStartCount + 1
  };
}

export function getFollowingRecurringEffectTickSchedule(
  state: MatchState,
  sourcePlayerId: string
): { nextTickPlayerId: string; nextTickTurnStartCount: number } {
  return {
    nextTickPlayerId: sourcePlayerId,
    nextTickTurnStartCount: (state.turn.turnStartCountsByPlayer[sourcePlayerId] ?? 0) + 1
  };
}

export function normalizeRecurringTickTiming(tickTiming: string | undefined): NormalizedRecurringTickTiming {
  if (tickTiming === "BEGINNING_OF_TURN") {
    return "BEGINNING_OF_TURN";
  }

  if (tickTiming === "BEGINNING_OF_COMBAT_PHASE") {
    return "BEGINNING_OF_COMBAT_PHASE";
  }

  return "END_OF_COMBAT_PHASE";
}

export function shouldRecurringEffectTickNow(
  state: MatchState,
  recurring: ActiveRecurringCreatureEffect
): boolean {
  const timing = normalizeRecurringTickTiming(recurring.tickTiming);

  if (recurring.remainingTicks <= 0) {
    return false;
  }

  const tickPlayerId = recurring.nextTickPlayerId ?? recurring.sourcePlayerId;
  const currentTickPlayerTurnStartCount = state.turn.turnStartCountsByPlayer[tickPlayerId] ?? 0;
  const requiredTickTurnStartCount = recurring.nextTickTurnStartCount ?? currentTickPlayerTurnStartCount;
  const alreadyTickedThisTurn = recurring.lastTickTurnNumber === state.turn.turnNumber &&
    recurring.lastTickTurnCycle === state.turn.turnCycleNumber;

  if (timing === "BEGINNING_OF_TURN") {
    return state.turn.phase === "DRAW" &&
      state.turn.activePlayerId === tickPlayerId &&
      currentTickPlayerTurnStartCount >= requiredTickTurnStartCount &&
      !alreadyTickedThisTurn;
  }

  return state.turn.phase === "COMBAT" &&
    state.turn.activePlayerId === tickPlayerId &&
    currentTickPlayerTurnStartCount >= requiredTickTurnStartCount &&
    !alreadyTickedThisTurn;
}

export function shouldStatusExpireNow(
  state: MatchState,
  status: ActiveCreatureStatus,
  playerId: string
): boolean {
  if (status.durationType !== "TARGET_PLAYER_TURN_STARTS") {
    return false;
  }

  if (status.expiresOnPlayerId !== playerId) {
    return false;
  }

  const currentTurnStartCount = state.turn.turnStartCountsByPlayer[playerId] ?? 0;
  return (status.expiresAtPlayerTurnStartCount ?? Number.POSITIVE_INFINITY) <= currentTurnStartCount;
}
