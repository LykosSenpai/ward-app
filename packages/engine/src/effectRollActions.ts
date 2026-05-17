import { v4 as uuidv4 } from "uuid";
import type {
  ActiveCreatureStatus,
  CardDefinition,
  CardInstance,
  EffectTargetOption,
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
import { removeActiveEffectInstance, syncStatusActiveEffectInstance } from "./activeEffectInstances.js";
import { applyDamageToCreatureTarget } from "./cardMovement.js";

type AddEventFn = (state: MatchState, type: string, playerId?: string, payload?: unknown) => void;

type FieldCreatureLocation = {
  player: PlayerState;
  card: CardInstance;
  definition: Extract<CardDefinition, { cardType: "CREATURE" }>;
  targetKind: "PRIMARY_CREATURE" | "LIMITED_SUMMON";
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
      return { player, card: primary, definition, targetKind: "PRIMARY_CREATURE" };
    }

    for (const limited of player.field.limitedSummons) {
      if (limited.instanceId !== creatureInstanceId) continue;
      const definition = state.cardCatalog[limited.cardId];
      if (definition?.cardType !== "CREATURE") return undefined;
      return { player, card: limited, definition, targetKind: "LIMITED_SUMMON" };
    }
  }

  return undefined;
}

function collectFieldCreatureLocations(state: MatchState): FieldCreatureLocation[] {
  const locations: FieldCreatureLocation[] = [];

  for (const player of state.players) {
    const primary = player.field.primaryCreature;
    if (primary) {
      const definition = state.cardCatalog[primary.cardId];
      if (definition?.cardType === "CREATURE") {
        locations.push({ player, card: primary, definition, targetKind: "PRIMARY_CREATURE" });
      }
    }

    for (const limited of player.field.limitedSummons) {
      const definition = state.cardCatalog[limited.cardId];
      if (definition?.cardType === "CREATURE") {
        locations.push({ player, card: limited, definition, targetKind: "LIMITED_SUMMON" });
      }
    }
  }

  return locations;
}

function targetOptionFromFieldCreature(location: FieldCreatureLocation): EffectTargetOption {
  return {
    id: `${location.player.id}:${location.targetKind}:${location.card.instanceId}`,
    label: `${location.player.displayName}: ${location.definition.name}`,
    targetKind: location.targetKind,
    playerId: location.player.id,
    cardInstanceId: location.card.instanceId,
    cardId: location.card.cardId,
    cardName: location.definition.name,
    zone: location.targetKind
  };
}

function findCardInstanceById(state: MatchState, cardInstanceId?: string): CardInstance | undefined {
  if (!cardInstanceId) return undefined;

  for (const player of state.players) {
    const fieldCards = [
      player.field.primaryCreature,
      ...player.field.limitedSummons,
      ...player.field.magicSlots
    ].filter((card): card is CardInstance => Boolean(card));
    const allCards = [
      ...fieldCards,
      ...player.hand,
      ...player.deck,
      ...player.cemetery,
      ...player.removedFromGame
    ];
    const found = allCards.find(card => card.instanceId === cardInstanceId);
    if (found) return found;
  }

  return state.chainZone.find(card => card.instanceId === cardInstanceId);
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

function statusTickFailureDamageAmount(effect: WardEngineEffect): number | undefined {
  const params = (effect.params ?? {}) as Record<string, unknown>;
  const onFailure = (params.onFailure ?? {}) as Record<string, unknown>;
  const explicit = Number(
    onFailure.damageAmount ??
    onFailure.amount ??
    params.onFailureDamageAmount ??
    params.damageAmount ??
    params.amount
  );
  if (Number.isFinite(explicit) && explicit > 0) return Math.trunc(explicit);

  const text = effectText(effect).toLowerCase();
  const failureMatch = text.match(/(?:otherwise|else|fail(?:s|ed|ure)?|unsuccessful)[^.?!;:]*?(\d+)\s*(?:damage|dmg|hp)/i);
  if (failureMatch) {
    const value = Number(failureMatch[1]);
    if (Number.isFinite(value) && value > 0) return Math.trunc(value);
  }

  const damageMatch = text.match(/(?:receive|receives|take|takes|deal|deals|inflict|inflicts)\s+(\d+)\s*(?:damage|dmg|hp)/i);
  if (damageMatch) {
    const value = Number(damageMatch[1]);
    if (Number.isFinite(value) && value > 0) return Math.trunc(value);
  }

  return undefined;
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
      reason: "Source creature effects are currently suppressed (Limited Summon, Silence From The Grave, or another negation effect)."
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

function findStatusTickEffect(
  sourceDefinition: CardDefinition,
  status: ActiveCreatureStatus
): WardEngineEffect | undefined {
  const statusName = normalize(status.status);
  const label = status.label.toLowerCase();

  return getCardEngineEffects(sourceDefinition).find(effect => {
    const actionType = normalize(effect.actionType);
    const trigger = normalize(effect.trigger);
    const reusableFunction = normalize(effect.reusableFunction);
    const text = effectText(effect).toLowerCase();

    if (actionType !== "RESOLVE_STATUS_TICK") return false;

    return trigger.includes(statusName) ||
      reusableFunction.includes(statusName) ||
      text.includes(statusName.toLowerCase()) ||
      (label && text.includes(label));
  });
}

function findDefinitionForStatusSource(
  state: MatchState,
  status: ActiveCreatureStatus
): { card?: CardInstance; definition?: CardDefinition } {
  const card = findCardInstanceById(state, status.sourceCardInstanceId);
  const definition = card ? state.cardCatalog[card.cardId] : undefined;
  if (definition) return { card, definition };

  const sourceName = status.sourceCardName.trim().toLowerCase();
  const byName = Object.values(state.cardCatalog).find(candidate => candidate.name.trim().toLowerCase() === sourceName);
  return { card, definition: byName };
}

export function createPendingStatusTickEffectRollSession(
  state: MatchState,
  activePlayerId: string,
  addEvent?: AddEventFn
): PendingEffectRollSession | undefined {
  if (state.pendingEffectRoll) return undefined;

  for (const target of collectFieldCreatureLocations(state)) {
    if (target.player.id !== activePlayerId) continue;

    for (const status of target.card.activeStatuses ?? []) {
      if (status.sourcePlayerId === activePlayerId) continue;

      const source = findDefinitionForStatusSource(state, status);
      if (!source.definition) continue;

      const effect = findStatusTickEffect(source.definition, status);
      if (!effect) continue;

      const now = new Date().toISOString();
      const successRanges = parseSuccessRanges(effect);
      const damageAmount = statusTickFailureDamageAmount(effect) ?? 10;
      const session: PendingEffectRollSession = {
        id: uuidv4(),
        status: "AWAITING_ROLL",
        createdAt: now,
        updatedAt: now,
        sourcePlayerId: status.sourcePlayerId,
        sourceCardInstanceId: status.sourceCardInstanceId,
        sourceCardId: source.card?.cardId ?? source.definition.id,
        sourceCardName: source.definition.name,
        rollPlayerId: activePlayerId,
        effectId: effect.id,
        trigger: effect.trigger ?? "OPPONENT_TURN_WHILE_STATUS_ACTIVE",
        actionType: effect.actionType,
        actionText: effect.actionText ?? effect.value ?? effect.params?.valueText,
        targetPlayerId: target.player.id,
        targetCardInstanceId: target.card.instanceId,
        targetCardName: target.definition.name,
        diceKind: "EFFECT_ROLL",
        diceCount: parseDiceCount(effect),
        successRanges,
        onSuccessActionType: "REMOVE_STATUS",
        onSuccessStatus: status.status,
        onSuccessLabel: status.label,
        targetStatusId: status.id,
        onFailureActionType: "DAMAGE",
        onFailureDamageAmount: damageAmount,
        duration: effect.duration,
        message: `${target.definition.name} is ${status.label}. ${target.player.displayName} rolls ${parseDiceCount(effect)}D6; success on ${rangeLabel(successRanges)} frees it, otherwise it receives ${damageAmount} damage.`
      };

      state.pendingEffectRoll = session;
      addEvent?.(state, "STATUS_TICK_EFFECT_ROLL_CREATED", activePlayerId, {
        effectRollSessionId: session.id,
        sourceCardInstanceId: session.sourceCardInstanceId,
        sourceCardName: session.sourceCardName,
        effectId: session.effectId,
        actionType: session.actionType,
        targetPlayerId: target.player.id,
        targetCreatureInstanceId: target.card.instanceId,
        targetCreatureName: target.definition.name,
        statusId: status.id,
        status: status.status,
        label: status.label,
        diceCount: session.diceCount,
        successRanges: session.successRanges,
        onFailureDamageAmount: damageAmount,
        message: session.message
      });

      return session;
    }
  }

  return undefined;
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
    playerId: session.rollPlayerId ?? session.sourcePlayerId,
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
    rollPlayerId: session.rollPlayerId ?? session.sourcePlayerId,
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

  if (normalize(session.onSuccessActionType) === "REMOVE_STATUS") {
    const target = session.targetCardInstanceId
      ? findFieldCreatureByInstanceId(state, session.targetCardInstanceId)
      : undefined;

    if (!target) {
      session.status = "APPLIED";
      session.updatedAt = new Date().toISOString();
      session.message = "Effect roll resolved, but the target creature is no longer on the field.";

      addEvent?.(state, "STATUS_TICK_EFFECT_ROLL_TARGET_MISSING", session.rollPlayerId ?? session.sourcePlayerId, {
        effectRollSessionId: session.id,
        sourceCardInstanceId: session.sourceCardInstanceId,
        targetCardInstanceId: session.targetCardInstanceId,
        statusId: session.targetStatusId
      });

      state.pendingEffectRoll = undefined;
      return session;
    }

    if (session.success) {
      const removedStatuses = (target.card.activeStatuses ?? []).filter(status =>
        status.id === session.targetStatusId ||
        (session.onSuccessStatus && normalize(status.status) === normalize(session.onSuccessStatus))
      );
      target.card.activeStatuses = (target.card.activeStatuses ?? []).filter(status => !removedStatuses.includes(status));
      for (const status of removedStatuses) {
        removeActiveEffectInstance(target.card, status.id);
      }

      session.status = "APPLIED";
      session.updatedAt = new Date().toISOString();
      session.message = `${target.definition.name} was freed from ${session.onSuccessLabel ?? session.onSuccessStatus ?? "the status"}.`;

      addEvent?.(state, "STATUS_TICK_EFFECT_ROLL_FREED", session.rollPlayerId ?? session.sourcePlayerId, {
        effectRollSessionId: session.id,
        sourceCardInstanceId: session.sourceCardInstanceId,
        sourceCardName: session.sourceCardName,
        effectId: session.effectId,
        targetPlayerId: target.player.id,
        targetCreatureInstanceId: target.card.instanceId,
        targetCreatureName: target.definition.name,
        statusId: session.targetStatusId,
        status: session.onSuccessStatus,
        label: session.onSuccessLabel,
        rollTotal: session.rollTotal,
        boardEvents: [
          {
            type: "STATUS_REMOVED",
            playerId: target.player.id,
            cardInstanceId: target.card.instanceId,
            targetCardInstanceId: target.card.instanceId,
            sourceCardInstanceId: session.sourceCardInstanceId,
            sourceCardId: session.sourceCardId,
            sourceEffectId: session.effectId,
            actionType: session.actionType,
            status: session.onSuccessStatus,
            statusLabel: session.onSuccessLabel,
            reason: "EFFECT_ROLL_SUCCESS"
          }
        ]
      });
    } else {
      const damageAmount = session.onFailureDamageAmount ?? 10;
      const result = applyDamageToCreatureTarget(state, targetOptionFromFieldCreature(target), damageAmount);

      session.status = "APPLIED";
      session.updatedAt = new Date().toISOString();
      session.message = `${target.definition.name} failed to escape and received ${result.damageAmount} damage.`;

      addEvent?.(state, "STATUS_TICK_EFFECT_ROLL_DAMAGE_APPLIED", session.rollPlayerId ?? session.sourcePlayerId, {
        effectRollSessionId: session.id,
        sourceCardInstanceId: session.sourceCardInstanceId,
        sourceCardName: session.sourceCardName,
        effectId: session.effectId,
        targetPlayerId: result.playerId,
        targetCreatureInstanceId: target.card.instanceId,
        targetCreatureName: result.creatureName,
        statusId: session.targetStatusId,
        status: session.onSuccessStatus,
        label: session.onSuccessLabel,
        rollTotal: session.rollTotal,
        damageAmount: result.damageAmount,
        remainingHp: result.remainingHp,
        killed: result.killed,
        boardEvents: [
          {
            type: "CREATURE_DAMAGED",
            playerId: result.playerId,
            sourceCardInstanceId: session.sourceCardInstanceId,
            sourceCardId: session.sourceCardId,
            sourceEffectId: session.effectId,
            actionType: session.actionType,
            targetCardInstanceId: target.card.instanceId,
            damageAmount: result.damageAmount,
            remainingHp: result.remainingHp,
            killed: result.killed,
            reason: "EFFECT_ROLL_FAILURE"
          }
        ]
      });
    }

    state.pendingEffectRoll = undefined;
    return session;
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

  if (isPendingEffectRollPhaseBlocking(session)) {
    throw new Error("Triggered effect rolls must be resolved and cannot be skipped.");
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

const OPTIONAL_ACTIVATED_ROLL_TRIGGERS = new Set([
  "ACTIVATED",
  "DURING_YOUR_TURN",
  "DURING_YOUR_TURN_ACTIVATED",
  "ONCE_PER_TURN_ACTIVATED",
  "REQUEST_BASED"
]);

function tokenLooksCombatOrTriggered(value: string): boolean {
  return value.includes("BATTLE") ||
    value.includes("COMBAT") ||
    value.includes("HIT") ||
    value.includes("DAMAGE") ||
    value.includes("STATUS_TICK");
}

export function isPendingEffectRollPhaseBlocking(session?: PendingEffectRollSession): boolean {
  if (!session) return false;

  if (session.linkedBattleSessionId || session.linkedStrikeId) {
    return true;
  }

  const trigger = normalize(session.trigger);
  const actionType = normalize(session.actionType);
  const onSuccessActionType = normalize(session.onSuccessActionType);

  if (
    session.targetStatusId ||
    actionType === "RESOLVE_STATUS_TICK" ||
    onSuccessActionType === "REMOVE_STATUS" ||
    session.onFailureActionType
  ) {
    return true;
  }

  if (OPTIONAL_ACTIVATED_ROLL_TRIGGERS.has(trigger)) {
    return false;
  }

  if (tokenLooksCombatOrTriggered(trigger) || tokenLooksCombatOrTriggered(actionType)) {
    return true;
  }

  // Unknown effect-roll sessions stay conservative and block until resolved.
  return true;
}

export function clearNonBlockingPendingEffectRollForPhaseAdvanceInPlace(
  state: MatchState,
  addEvent?: AddEventFn
): boolean {
  const session = state.pendingEffectRoll;
  if (!session || isPendingEffectRollPhaseBlocking(session)) return false;

  state.pendingEffectRoll = undefined;

  addEvent?.(state, "OPTIONAL_EFFECT_ROLL_SKIPPED_FOR_PHASE_ADVANCE", session.sourcePlayerId, {
    effectRollSessionId: session.id,
    sourceCardInstanceId: session.sourceCardInstanceId,
    sourceCardId: session.sourceCardId,
    sourceCardName: session.sourceCardName,
    effectId: session.effectId,
    trigger: session.trigger,
    actionType: session.actionType,
    status: session.status,
    rollTotal: session.rollTotal,
    success: session.success,
    reason: "Optional activated effect rolls do not block phase advance."
  });

  return true;
}
