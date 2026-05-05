import { v4 as uuidv4 } from "uuid";
import type {
  ActiveCreatureStatus,
  CardDefinition,
  CardInstance,
  EffectRollSuccessRange,
  ManualBattleStrike,
  MatchState,
  PendingBattleSession,
  PendingEffectRollSession,
  PlayerState,
  WardEffectDuration,
  WardEngineEffect
} from "@ward/shared";
import { rollD6WithDev } from "./devRolls.js";
import { sumDice } from "./dice.js";
import { getCardEngineEffects } from "./effectResolver.js";
import { areCreatureEffectsSuppressed } from "./creatureEffectSuppression.js";
import { getTurnCycleExpiration } from "./effectTiming.js";
import { syncStatusActiveEffectInstance } from "./activeEffectInstances.js";

type AddEventFn = (state: MatchState, type: string, playerId?: string, payload?: unknown) => void;

type FieldCreatureLocation = {
  player: PlayerState;
  card: CardInstance;
  definition: Extract<CardDefinition, { cardType: "CREATURE" }>;
};

type RollParams = {
  kind?: unknown;
  diceCount?: unknown;
  successRanges?: unknown;
  successValues?: unknown;
};

type OnSuccessParams = {
  actionType?: unknown;
  status?: unknown;
  label?: unknown;
  flags?: unknown;
  duration?: WardEffectDuration;
};

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function effectText(effect: WardEngineEffect): string {
  return [
    effect.trigger,
    effect.actionType,
    effect.effectGroup,
    effect.actionText,
    effect.target,
    effect.value,
    effect.params?.target,
    effect.params?.valueText,
    effect.reusableFunction,
    effect.notes
  ]
    .filter(Boolean)
    .join(" ");
}

function findFieldCreatureByInstanceId(
  state: MatchState,
  creatureInstanceId: string
): FieldCreatureLocation | undefined {
  for (const player of state.players) {
    const primary = player.field.primaryCreature;
    if (primary?.instanceId === creatureInstanceId) {
      const definition = state.cardCatalog[primary.cardId];
      if (definition?.cardType !== "CREATURE") return undefined;
      return { player, card: primary, definition };
    }

    for (const limited of player.field.limitedSummons) {
      if (limited.instanceId !== creatureInstanceId) continue;
      const definition = state.cardCatalog[limited.cardId];
      if (definition?.cardType !== "CREATURE") return undefined;
      return { player, card: limited, definition };
    }
  }

  return undefined;
}

function isRollForEffect(effect: WardEngineEffect): boolean {
  const actionType = normalize(effect.actionType);
  const reusableFunction = normalize(effect.reusableFunction);
  const params = effect.params as Record<string, unknown> | undefined;

  return actionType === "ROLL_FOR_EFFECT" ||
    reusableFunction === "ROLLFOREFFECT" ||
    Boolean(params?.roll);
}

function effectTriggersOnHit(effect: WardEngineEffect): boolean {
  const trigger = normalize(effect.trigger);
  return trigger === "ON_HIT" || trigger === "WHEN_THIS_CREATURE_HITS" || trigger === "WHEN_CREATURE_HITS";
}

function toPositiveInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.trunc(number);
}

function parseDiceCount(effect: WardEngineEffect): number {
  const roll = (effect.params?.roll ?? {}) as RollParams;
  const fromParams = toPositiveInteger(roll.diceCount, 0);
  if (fromParams > 0) return Math.min(20, fromParams);

  const match = effectText(effect).match(/roll\s+(\d+)\s*(?:d6|die|dice)?/i);
  if (match) {
    return Math.min(20, toPositiveInteger(match[1], 1));
  }

  return 1;
}

function normalizeSuccessRanges(raw: unknown): EffectRollSuccessRange[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map(item => {
      if (typeof item === "number") {
        return { min: item, max: item };
      }

      if (!item || typeof item !== "object") {
        return undefined;
      }

      const data = item as { min?: unknown; max?: unknown; value?: unknown };
      const value = Number(data.value);
      const min = Number(data.min ?? data.value);
      const max = Number(data.max ?? data.value ?? data.min);

      if (Number.isInteger(value) && !Number.isInteger(min) && !Number.isInteger(max)) {
        return { min: value, max: value };
      }

      if (!Number.isInteger(min) || !Number.isInteger(max)) {
        return undefined;
      }

      return { min: Math.min(min, max), max: Math.max(min, max) };
    })
    .filter((item): item is EffectRollSuccessRange => !!item)
    .map(item => ({
      min: Math.max(1, Math.min(6, item.min)),
      max: Math.max(1, Math.min(6, item.max))
    }));
}

function parseSuccessRanges(effect: WardEngineEffect): EffectRollSuccessRange[] {
  const roll = (effect.params?.roll ?? {}) as RollParams;

  const explicitRanges = normalizeSuccessRanges(roll.successRanges);
  if (explicitRanges.length > 0) return explicitRanges;

  const explicitValues = normalizeSuccessRanges(roll.successValues);
  if (explicitValues.length > 0) return explicitValues;

  const condition = effect.condition as { successValues?: unknown } | undefined;
  const conditionValues = normalizeSuccessRanges(condition?.successValues);
  if (conditionValues.length > 0) return conditionValues;

  const text = effectText(effect);
  const rangeMatch = text.match(/(?:result|roll|on)\s*(?:is|of)?\s*(\d+)\s*[-–—]\s*(\d+)/i);
  if (rangeMatch) {
    const min = Number(rangeMatch[1]);
    const max = Number(rangeMatch[2]);
    if (Number.isInteger(min) && Number.isInteger(max)) {
      return [{ min: Math.min(min, max), max: Math.max(min, max) }];
    }
  }

  return [{ min: 4, max: 6 }];
}

function getOnSuccess(effect: WardEngineEffect): OnSuccessParams {
  const params = (effect.params ?? {}) as Record<string, unknown>;
  const onSuccess = (params.onSuccess ?? {}) as OnSuccessParams;
  const fullText = effectText(effect).toLowerCase();
  const duration = onSuccess.duration ?? effect.duration ?? effect.params?.duration;

  if (normalize(onSuccess.actionType) || normalize(onSuccess.status)) {
    return { ...onSuccess, duration };
  }

  if (fullText.includes("frozen") || fullText.includes("freeze")) {
    return {
      actionType: "APPLY_STATUS",
      status: "FROZEN",
      label: "Frozen",
      flags: {
        canInflictAtkDamage: false,
        canBeSacrificed: false
      },
      duration
    };
  }

  if (fullText.includes("stun") || fullText.includes("cannot inflict atk damage") || fullText.includes("cannot inflict attack damage")) {
    return {
      actionType: "APPLY_STATUS",
      status: "STUNNED",
      label: "Stunned",
      flags: {
        canInflictAtkDamage: false
      },
      duration
    };
  }

  if (fullText.includes("cannot be damaged") || fullText.includes("cannot receive damage") || fullText.includes("immune to damage") || fullText.includes("unaffected by damage")) {
    return {
      actionType: "APPLY_STATUS",
      status: "DAMAGE_IMMUNE",
      label: "Damage Immune",
      flags: {
        canReceiveDamage: false
      },
      duration
    };
  }

  return {
    actionType: "MANUAL_REVIEW",
    status: "STATUS",
    label: effect.actionText ?? effect.value ?? "Effect Roll Success",
    flags: {},
    duration
  };
}

function statusFlagsFromUnknown(rawFlags: unknown): ActiveCreatureStatus["flags"] {
  if (!rawFlags || typeof rawFlags !== "object") return {};

  const flags = rawFlags as Record<string, unknown>;
  const result: ActiveCreatureStatus["flags"] = {};

  if (typeof flags.canInflictAtkDamage === "boolean") {
    result.canInflictAtkDamage = flags.canInflictAtkDamage;
  }

  if (typeof flags.canBeSacrificed === "boolean") {
    result.canBeSacrificed = flags.canBeSacrificed;
  }

  if (typeof flags.canInitiateBattle === "boolean") {
    result.canInitiateBattle = flags.canInitiateBattle;
  }

  if (typeof flags.canReceiveDamage === "boolean") {
    result.canReceiveDamage = flags.canReceiveDamage;
  }

  if (typeof flags.canChangeControl === "boolean") {
    result.canChangeControl = flags.canChangeControl;
  }

  if (typeof flags.canBeRemovedFromField === "boolean") {
    result.canBeRemovedFromField = flags.canBeRemovedFromField;
  }

  return result;
}

function rangeLabel(ranges: EffectRollSuccessRange[]): string {
  return ranges.map(range => range.min === range.max ? String(range.min) : `${range.min}-${range.max}`).join(", ");
}

function rollSucceeded(total: number, ranges: EffectRollSuccessRange[]): boolean {
  return ranges.some(range => total >= range.min && total <= range.max);
}

export function createPendingEffectRollSession(args: {
  state: MatchState;
  source: FieldCreatureLocation;
  target: FieldCreatureLocation;
  effect: WardEngineEffect;
  battleSession: PendingBattleSession;
  strike: ManualBattleStrike;
}): PendingEffectRollSession {
  const now = new Date().toISOString();
  const successRanges = parseSuccessRanges(args.effect);
  const onSuccess = getOnSuccess(args.effect);
  const diceCount = parseDiceCount(args.effect);

  return {
    id: uuidv4(),
    status: "AWAITING_ROLL",
    createdAt: now,
    updatedAt: now,
    sourcePlayerId: args.source.player.id,
    sourceCardInstanceId: args.source.card.instanceId,
    sourceCardId: args.source.card.cardId,
    sourceCardName: args.source.definition.name,
    effectId: args.effect.id,
    trigger: args.effect.trigger ?? "ON_HIT",
    actionType: args.effect.actionType,
    actionText: args.effect.actionText ?? args.effect.value ?? args.effect.params?.valueText,
    linkedBattleSessionId: args.battleSession.id,
    linkedStrikeId: args.strike.id,
    targetPlayerId: args.target.player.id,
    targetCardInstanceId: args.target.card.instanceId,
    targetCardName: args.target.definition.name,
    diceKind: "EFFECT_ROLL",
    diceCount,
    successRanges,
    onSuccessActionType: typeof onSuccess.actionType === "string" ? onSuccess.actionType : undefined,
    onSuccessStatus: typeof onSuccess.status === "string" ? onSuccess.status : undefined,
    onSuccessLabel: typeof onSuccess.label === "string" ? onSuccess.label : undefined,
    onSuccessFlags: statusFlagsFromUnknown(onSuccess.flags),
    duration: onSuccess.duration,
    message: `${args.source.definition.name} hit ${args.target.definition.name}. Roll ${diceCount}D6 for ${args.source.definition.name}'s effect. Success on ${rangeLabel(successRanges)}.`
  };
}

export function detectPendingEffectRollForStrike(args: {
  state: MatchState;
  battleSession: PendingBattleSession;
  strike: ManualBattleStrike;
  addEvent?: AddEventFn;
}): PendingEffectRollSession | undefined {
  const { state, battleSession, strike, addEvent } = args;

  if (!strike.hit || strike.criticalMiss || strike.defenderKilled) {
    return undefined;
  }

  const source = findFieldCreatureByInstanceId(state, strike.attacker.creatureInstanceId);
  const target = findFieldCreatureByInstanceId(state, strike.defender.creatureInstanceId);

  if (!source || !target) {
    return undefined;
  }

  if (areCreatureEffectsSuppressed(state, source.card)) {
    addEvent?.(state, "EFFECT_ROLL_SKIPPED_SOURCE_EFFECTS_SUPPRESSED", source.player.id, {
      battleSessionId: battleSession.id,
      strikeId: strike.id,
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: source.definition.name,
      reason: "Limited Summons lose creature effects."
    });
    return undefined;
  }

  const effects = getCardEngineEffects(source.definition);
  const effect = effects.find(candidate => effectTriggersOnHit(candidate) && isRollForEffect(candidate));

  if (!effect) {
    return undefined;
  }

  const session = createPendingEffectRollSession({
    state,
    source,
    target,
    effect,
    battleSession,
    strike
  });

  addEvent?.(state, "EFFECT_ROLL_CREATED", source.player.id, {
    effectRollSessionId: session.id,
    battleSessionId: battleSession.id,
    strikeId: strike.id,
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: source.definition.name,
    effectId: effect.id,
    actionType: effect.actionType,
    targetPlayerId: target.player.id,
    targetCreatureInstanceId: target.card.instanceId,
    targetCreatureName: target.definition.name,
    diceCount: session.diceCount,
    successRanges: session.successRanges,
    message: session.message
  });

  return session;
}

export function rollPendingEffectRollInPlace(
  state: MatchState,
  effectRollSessionId: string,
  addEvent?: AddEventFn
): PendingEffectRollSession {
  const session = state.pendingEffectRoll;

  if (!session || session.id !== effectRollSessionId) {
    throw new Error("Pending effect roll session not found.");
  }

  if (session.status !== "AWAITING_ROLL") {
    throw new Error("This effect roll has already been rolled.");
  }

  const dice = rollD6WithDev(state, {
    kind: "EFFECT_ROLL",
    count: session.diceCount,
    playerId: session.sourcePlayerId,
    label: `${session.sourceCardName} effect roll`,
    addEvent,
    context: {
      effectRollSessionId: session.id,
      battleSessionId: session.linkedBattleSessionId,
      strikeId: session.linkedStrikeId,
      sourceCardInstanceId: session.sourceCardInstanceId,
      targetCardInstanceId: session.targetCardInstanceId
    }
  });
  const total = sumDice(dice);
  const success = rollSucceeded(total, session.successRanges);

  session.rolledDice = dice;
  session.rollTotal = total;
  session.success = success;
  session.status = "ROLLED";
  session.updatedAt = new Date().toISOString();
  session.message = success
    ? `${session.sourceCardName} rolled ${total}. Effect roll succeeded.`
    : `${session.sourceCardName} rolled ${total}. Effect roll failed.`;

  addEvent?.(state, "EFFECT_ROLL_ROLLED", session.sourcePlayerId, {
    effectRollSessionId: session.id,
    battleSessionId: session.linkedBattleSessionId,
    strikeId: session.linkedStrikeId,
    sourceCardInstanceId: session.sourceCardInstanceId,
    sourceCardName: session.sourceCardName,
    effectId: session.effectId,
    targetPlayerId: session.targetPlayerId,
    targetCreatureInstanceId: session.targetCardInstanceId,
    targetCreatureName: session.targetCardName,
    dice,
    total,
    successRanges: session.successRanges,
    success
  });

  return session;
}

export function applyPendingEffectRollStatusInPlace(
  state: MatchState,
  effectRollSessionId: string,
  addEvent?: AddEventFn
): PendingEffectRollSession {
  const session = state.pendingEffectRoll;

  if (!session || session.id !== effectRollSessionId) {
    throw new Error("Pending effect roll session not found.");
  }

  if (session.status !== "ROLLED") {
    throw new Error("Roll the effect dice before applying the effect.");
  }

  if (!session.success) {
    session.status = "APPLIED";
    session.updatedAt = new Date().toISOString();
    session.message = "Effect roll failed. No effect was applied.";

    addEvent?.(state, "EFFECT_ROLL_FAILED_NO_APPLY", session.sourcePlayerId, {
      effectRollSessionId: session.id,
      battleSessionId: session.linkedBattleSessionId,
      strikeId: session.linkedStrikeId,
      sourceCardName: session.sourceCardName,
      targetCreatureName: session.targetCardName,
      rollTotal: session.rollTotal
    });

    state.pendingEffectRoll = undefined;
    return session;
  }

  const target = session.targetCardInstanceId
    ? findFieldCreatureByInstanceId(state, session.targetCardInstanceId)
    : undefined;
  const source = findFieldCreatureByInstanceId(state, session.sourceCardInstanceId);

  if (!target || !source) {
    session.status = "APPLIED";
    session.updatedAt = new Date().toISOString();
    session.message = "Effect roll succeeded, but source or target is no longer on the field.";

    addEvent?.(state, "EFFECT_ROLL_APPLY_SKIPPED_TARGET_MISSING", session.sourcePlayerId, {
      effectRollSessionId: session.id,
      sourceCardInstanceId: session.sourceCardInstanceId,
      targetCardInstanceId: session.targetCardInstanceId
    });

    state.pendingEffectRoll = undefined;
    return session;
  }

  if (normalize(session.onSuccessActionType) === "APPLY_STATUS" || session.onSuccessStatus) {
    const fallbackDuration: WardEffectDuration = {
      text: "1 turn cycle",
      type: "TURN_CYCLES",
      amount: 1,
      unit: "TURN_CYCLE",
      starts: "EFFECT_ACTIVATION",
      expires: "BEGINNING_OF_START_PLAYER_TURN"
    };
    const duration = session.duration ?? fallbackDuration;
    const expiration = getTurnCycleExpiration({
      state,
      sourcePlayerId: source.player.id,
      targetPlayerId: target.player.id,
      effect: {
        id: session.effectId,
        trigger: session.trigger,
        actionType: session.actionType,
        duration
      } as WardEngineEffect,
      fallbackDuration: Number(duration.amount ?? 1) || 1
    });

    target.card.activeStatuses ??= [];
    const status: ActiveCreatureStatus = {
      id: uuidv4(),
      sourceEffectId: session.effectId,
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: source.definition.name,
      sourcePlayerId: source.player.id,
      status: session.onSuccessStatus ?? "STATUS",
      label: session.onSuccessLabel ?? session.onSuccessStatus ?? "Effect Roll Status",
      flags: session.onSuccessFlags ?? {},
      durationType: "TARGET_PLAYER_TURN_STARTS",
      appliedTurnNumber: state.turn.turnNumber,
      appliedTurnCycle: state.turn.turnCycleNumber,
      expiresOnPlayerId: expiration.expiresOnPlayerId,
      expiresAtPlayerTurnStartCount: expiration.expiresAtPlayerTurnStartCount
    };

    target.card.activeStatuses.push(status);
    syncStatusActiveEffectInstance(target.card, status);

    addEvent?.(state, "EFFECT_ROLL_APPLIED", session.sourcePlayerId, {
      effectRollSessionId: session.id,
      battleSessionId: session.linkedBattleSessionId,
      strikeId: session.linkedStrikeId,
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: source.definition.name,
      effectId: session.effectId,
      targetPlayerId: target.player.id,
      targetCreatureInstanceId: target.card.instanceId,
      targetCreatureName: target.definition.name,
      status: status.status,
      label: status.label,
      flags: status.flags,
      duration,
      rollTotal: session.rollTotal
    });
  } else {
    addEvent?.(state, "EFFECT_ROLL_APPLY_NEEDS_MANUAL_REVIEW", session.sourcePlayerId, {
      effectRollSessionId: session.id,
      battleSessionId: session.linkedBattleSessionId,
      strikeId: session.linkedStrikeId,
      sourceCardName: session.sourceCardName,
      targetCreatureName: session.targetCardName,
      onSuccessActionType: session.onSuccessActionType
    });
  }

  session.status = "APPLIED";
  session.updatedAt = new Date().toISOString();
  session.message = "Effect roll applied.";
  state.pendingEffectRoll = undefined;
  return session;
}

export function skipPendingEffectRollInPlace(
  state: MatchState,
  effectRollSessionId: string,
  addEvent?: AddEventFn
): PendingEffectRollSession {
  const session = state.pendingEffectRoll;

  if (!session || session.id !== effectRollSessionId) {
    throw new Error("Pending effect roll session not found.");
  }

  session.status = "SKIPPED";
  session.updatedAt = new Date().toISOString();
  session.message = "Effect roll skipped.";

  addEvent?.(state, "EFFECT_ROLL_SKIPPED", session.sourcePlayerId, {
    effectRollSessionId: session.id,
    battleSessionId: session.linkedBattleSessionId,
    strikeId: session.linkedStrikeId,
    sourceCardInstanceId: session.sourceCardInstanceId,
    sourceCardName: session.sourceCardName,
    effectId: session.effectId,
    targetPlayerId: session.targetPlayerId,
    targetCreatureInstanceId: session.targetCardInstanceId,
    targetCreatureName: session.targetCardName
  });

  state.pendingEffectRoll = undefined;
  return session;
}
