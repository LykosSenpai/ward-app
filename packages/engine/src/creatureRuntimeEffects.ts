import { v4 as uuidv4 } from "uuid";
import type {
  ActiveCreatureStatus,
  ActiveEffectInstance,
  ActiveRecurringCreatureEffect,
  BoardEventType,
  CannotInflictAttackDamageBattlePolicy,
  BattleParticipantSnapshot,
  CardDefinition,
  CardInstance,
  EffectTargetOption,
  ManualBattleStrike,
  MatchState,
  PendingBattleSession,
  PlayerState,
  WardEngineEffect
} from "@ward/shared";
import { rollD6WithDev } from "./devRolls.js";
import { getCardDefinition, type AddEventFn } from "./engineRuntime.js";
import { getCardEngineEffects } from "./effectResolver.js";
import { areCreatureEffectsSuppressed } from "./creatureEffectSuppression.js";
import {
  applyDamageToCreatureTarget,
  applyStatModifierToCreatureTarget,
  healCreatureTarget,
  moveMagicSlotCardToCemetery
} from "./cardMovement.js";
import {
  getFollowingRecurringEffectTickSchedule,
  getNextRecurringEffectTickSchedule,
  getTurnCycleExpiration,
  normalizeRecurringTickTiming,
  shouldRecurringEffectTickNow
} from "./effectTiming.js";
import { syncRecurringActiveEffectInstance, syncStatusActiveEffectInstance } from "./activeEffectInstances.js";
import { getRuntimeBlockActionType, getRuntimeBlockStatChanges, getRuntimeBlockText } from "./effectBlockRuntime.js";

const BATTLE_TRIGGER_ALIASES: Record<string, string[]> = {
  ON_HIT: ["ON_HIT", "WHEN_OPPONENT_LANDS_HIT", "ON_OPPONENT_LANDS_HIT"],
  ON_HIT_FIRST: ["ON_HIT_FIRST"],
  ON_MISS: ["ON_MISS"],
  BEFORE_HIT_ROLL: [
    "BEFORE_HIT_ROLL",
    "DURING_HIT_ROLL",
    "PRIOR_TO_EACH_BATTLE",
    "PRIOR_TO_EACH_BATTLE_WITH_THIS_CREATURE"
  ],
  BEFORE_DAMAGE_ROLL: ["BEFORE_DAMAGE_ROLL"],
  DURING_DAMAGE_CALC: ["DURING_DAMAGE_CALC", "DURING_DAMAGE_CALC_OR_STATIC", "DAMAGE_CALC_ON_THIS_CARD"],
  AFTER_DAMAGE_APPLIED: ["AFTER_DAMAGE_APPLIED", "ON_EQUIPPED_CREATURE_DAMAGED", "ON_EQUIPPED_CREATURE_DAMAGED_IN_BATTLE"],
  WHEN_CREATURE_KILLED_IN_BATTLE: ["WHEN_CREATURE_KILLED_IN_BATTLE", "WHEN_THIS_CREATURE_KILLED", "IF_KILLED_IN_BATTLE", "IF_EQUIPPED_CREATURE_KILLED"],
  END_OF_COMBAT_PHASE: ["END_OF_COMBAT_PHASE", "AT_END_OF_BATTLE"]
};

type FieldCreatureLocation = {
  player: PlayerState;
  card: CardInstance;
  definition: Extract<CardDefinition, { cardType: "CREATURE" }>;
  targetKind: "PRIMARY_CREATURE" | "LIMITED_SUMMON";
};

type ActiveEffectSource = {
  player: PlayerState;
  card: CardInstance;
  definition: CardDefinition;
  zone: "PRIMARY_CREATURE" | "LIMITED_SUMMON" | "MAGIC_SLOT" | "CEMETERY";
};

type BoardEventPayload = {
  type: BoardEventType;
  cardInstanceId?: string;
  playerId?: string;
  sourceCardInstanceId?: string;
  sourceCardId?: string;
  sourceEffectId?: string;
  actionType?: string;
  reason?: string;
  targetCardInstanceId?: string;
  amount?: number;
  phase?: MatchState["turn"]["phase"];
  turnNumber?: number;
  turnCycleNumber?: number;
  ticksRemainingAfterThis?: number;
  damageType?: string;
  healType?: string;
  status?: string;
  statusLabel?: string;
  effectType?: string;
  stat?: string;
  delta?: number;
  modifierId?: string;
  rollKind?: string;
  diceLimitMode?: string;
  diceLimitValue?: number;
};

function runtimeBoardEventBase(
  source: ActiveEffectSource,
  effect: WardEngineEffect,
  reason?: string
): Omit<BoardEventPayload, "type"> {
  return {
    playerId: source.player.id,
    sourceCardInstanceId: source.card.instanceId,
    sourceCardId: source.card.cardId,
    sourceEffectId: effect.id,
    actionType: effect.actionType,
    reason
  };
}

function timingBoardEventFields(state: MatchState): {
  phase: MatchState["turn"]["phase"];
  turnNumber: number;
  turnCycleNumber: number;
} {
  return {
    phase: state.turn.phase,
    turnNumber: state.turn.turnNumber,
    turnCycleNumber: state.turn.turnCycleNumber
  };
}

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function unknownToSearchText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(unknownToSearchText).filter(Boolean).join(" ");

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map(unknownToSearchText)
      .filter(Boolean)
      .join(" ");
  }

  return "";
}

function textForEffect(effect: WardEngineEffect): string {
  return getRuntimeBlockText(effect).toLowerCase();
}

function firstPositiveNumber(effect: WardEngineEffect): number | undefined {
  const match = textForEffect(effect).match(/(\d+)/);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function durationAmount(effect: WardEngineEffect, fallback = 1): number {
  const amount = Number(effect.duration?.amount ?? effect.params?.duration?.amount ?? fallback);
  return Number.isFinite(amount) && amount > 0 ? Math.trunc(amount) : fallback;
}

function effectDurationData(effect: WardEngineEffect): Record<string, unknown> {
  const duration = effect.duration ?? effect.params?.duration ?? {};
  return typeof duration === "object" && duration !== null
    ? duration as Record<string, unknown>
    : {};
}

function shouldExpireBySourceTurnCycle(effect: WardEngineEffect): boolean {
  const duration = effectDurationData(effect);
  const type = normalize(duration.type);
  const expires = normalize(duration.expires);
  const text = String(duration.text ?? effect.value ?? effect.params?.valueText ?? "").toLowerCase();

  return type === "TURN_CYCLES" ||
    expires === "BEGINNING_OF_START_PLAYER_TURN" ||
    text.includes("turn cycle");
}

function expirationForRuntimeEffect(
  state: MatchState,
  source: ActiveEffectSource,
  target: FieldCreatureLocation,
  effect: WardEngineEffect,
  fallbackDuration = 1
): { expiresOnPlayerId: string; expiresAtPlayerTurnStartCount: number } {
  return getTurnCycleExpiration({
    state,
    sourcePlayerId: source.player.id,
    targetPlayerId: target.player.id,
    effect,
    fallbackDuration
  });
}

function findFieldCreatureByInstanceId(
  state: MatchState,
  creatureInstanceId: string
): FieldCreatureLocation | undefined {
  for (const player of state.players) {
    const primary = player.field.primaryCreature;
    if (primary?.instanceId === creatureInstanceId) {
      const definition = getCardDefinition(state, primary);
      if (definition.cardType !== "CREATURE") return undefined;
      return { player, card: primary, definition, targetKind: "PRIMARY_CREATURE" };
    }

    for (const limited of player.field.limitedSummons) {
      if (limited.instanceId !== creatureInstanceId) continue;
      const definition = getCardDefinition(state, limited);
      if (definition.cardType !== "CREATURE") return undefined;
      return { player, card: limited, definition, targetKind: "LIMITED_SUMMON" };
    }
  }

  return undefined;
}

function targetOptionFromCreatureLocation(location: FieldCreatureLocation): EffectTargetOption {
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

function collectActiveEffectSources(state: MatchState): ActiveEffectSource[] {
  const sources: ActiveEffectSource[] = [];

  for (const player of state.players) {
    const add = (card: CardInstance | undefined, zone: ActiveEffectSource["zone"]) => {
      if (!card) return;
      const definition = state.cardCatalog[card.cardId];
      if (!definition) return;
      if (definition.cardType === "CREATURE" && areCreatureEffectsSuppressed(state, card)) return;
      sources.push({ player, card, definition, zone });
    };

    add(player.field.primaryCreature, "PRIMARY_CREATURE");
    for (const limited of player.field.limitedSummons) add(limited, "LIMITED_SUMMON");
    for (const magic of player.field.magicSlots) add(magic, "MAGIC_SLOT");
  }

  return sources;
}

function collectKilledBattleEffectSources(state: MatchState, strike: ManualBattleStrike): ActiveEffectSource[] {
  const killedIds = new Set<string>();
  if (strike.defenderKilled) killedIds.add(strike.defender.creatureInstanceId);
  if (strike.attackerKilledByCriticalMiss) killedIds.add(strike.attacker.creatureInstanceId);
  if (killedIds.size === 0) return [];

  const sources: ActiveEffectSource[] = [];
  for (const player of state.players) {
    for (const card of player.cemetery) {
      if (!killedIds.has(card.instanceId)) continue;
      const definition = state.cardCatalog[card.cardId];
      if (!definition) continue;
      if (definition.cardType === "CREATURE" && areCreatureEffectsSuppressed(state, card)) continue;
      sources.push({ player, card, definition, zone: "CEMETERY" });
    }
  }

  return sources;
}

function sourceControlsStrikeAttacker(source: ActiveEffectSource, strike: ManualBattleStrike): boolean {
  return source.card.instanceId === strike.attacker.creatureInstanceId ||
    source.card.attachedToInstanceId === strike.attacker.creatureInstanceId;
}

function sourceControlsStrikeDefender(source: ActiveEffectSource, strike: ManualBattleStrike): boolean {
  return source.card.instanceId === strike.defender.creatureInstanceId ||
    source.card.attachedToInstanceId === strike.defender.creatureInstanceId;
}

function isOpponentLightningDamageBoostEffect(effect: WardEngineEffect): boolean {
  const trigger = normalize(effect.trigger);
  const actionType = normalize(getRuntimeBlockActionType(effect));
  const text = textForEffect(effect);

  return actionType === "APPLY_ATTACK_DAMAGE_MULTIPLIER" &&
    (
      trigger.includes("OPPONENT_PLAYS_LIGHTNING") ||
      text.includes("opponent played a lightning") ||
      text.includes("opponent plays a lightning")
    );
}

function opponentPlayedLightningThisTurn(state: MatchState, source: ActiveEffectSource): boolean {
  return state.eventLog.some(event => {
    if (event.type !== "LIGHTNING_RESPONSE_ADDED") return false;
    if (event.playerId === source.player.id) return false;

    const payload = event.payload as { turnNumber?: unknown; turnCycleNumber?: unknown } | undefined;
    const eventTurnNumber = Number(payload?.turnNumber);
    if (Number.isFinite(eventTurnNumber)) {
      return eventTurnNumber === state.turn.turnNumber;
    }

    return false;
  });
}

function equippedCreatureWasDamagedByStrike(source: ActiveEffectSource, strike: ManualBattleStrike): boolean {
  const attachedToInstanceId = source.card.attachedToInstanceId;
  if (!attachedToInstanceId) return false;

  if (strike.damageTarget === "DEFENDER" && strike.defender.creatureInstanceId === attachedToInstanceId) {
    return Number(strike.damageDealt ?? 0) > 0;
  }

  if (strike.damageTarget === "ATTACKER" && strike.attacker.creatureInstanceId === attachedToInstanceId) {
    return Number(strike.selfDamageDealt ?? 0) > 0;
  }

  return false;
}

function sourceWasKilledByStrike(source: ActiveEffectSource, strike: ManualBattleStrike): boolean {
  if (source.card.instanceId === strike.defender.creatureInstanceId) {
    return Boolean(strike.defenderKilled);
  }

  if (source.card.instanceId === strike.attacker.creatureInstanceId) {
    return Boolean(strike.attackerKilledByCriticalMiss);
  }

  return false;
}

function sourceCanResolveForTiming(source: ActiveEffectSource, effect: WardEngineEffect, timing: string, strike: ManualBattleStrike): boolean {
  const trigger = normalize(effect.trigger);
  const actionType = normalize(getRuntimeBlockActionType(effect));
  const aliases = BATTLE_TRIGGER_ALIASES[timing] ?? [timing];

  const staticBattleAction = timing === "DURING_DAMAGE_CALC" && [
    "APPLY_DAMAGE_MULTIPLIER_AURA",
    "APPLY_DAMAGE_REDUCTION",
    "APPLY_CONDITIONAL_DAMAGE_REDUCTION",
    "DEAL_PERCENTAGE_DAMAGE"
  ].includes(actionType);

  const opponentLightningDamageBoost = timing === "DURING_DAMAGE_CALC" &&
    isOpponentLightningDamageBoostEffect(effect);

  const afterDamageAction = timing === "AFTER_DAMAGE_APPLIED" && [
    "HEAL_BY_DAMAGE_DEALT",
    "HEAL_BY_SENT_CREATURE_HP"
  ].includes(actionType);

  if (!aliases.includes(trigger) && !aliases.includes(actionType) && !staticBattleAction && !opponentLightningDamageBoost && !afterDamageAction) {
    return false;
  }

  if (staticBattleAction) {
    if (actionType.includes("REDUCTION")) {
      return sourceControlsStrikeDefender(source, strike) || source.player.id === strike.defender.playerId;
    }
    if (actionType.includes("MULTIPLIER_AURA")) {
      return true;
    }
    return sourceControlsStrikeAttacker(source, strike) || sourceControlsStrikeDefender(source, strike);
  }

  if (opponentLightningDamageBoost) {
    return sourceControlsStrikeAttacker(source, strike);
  }

  if (timing === "AFTER_DAMAGE_APPLIED" && actionType === "HEAL_BY_DAMAGE_DEALT") {
    return sourceControlsStrikeAttacker(source, strike);
  }

  if (timing === "ON_HIT" || timing === "ON_HIT_FIRST" || timing === "BEFORE_DAMAGE_ROLL" || timing === "DURING_DAMAGE_CALC") {
    return sourceControlsStrikeAttacker(source, strike);
  }

  if (trigger.includes("OPPONENT") || actionType.includes("NEGATE") || actionType.includes("PREVENT")) {
    return sourceControlsStrikeDefender(source, strike) || source.player.id === strike.defender.playerId;
  }

  return sourceControlsStrikeAttacker(source, strike) || sourceControlsStrikeDefender(source, strike);
}

function getRollCondition(effect: WardEngineEffect): { dieSize: number; successValues: number[]; text?: string } | undefined {
  const candidates = [effect.condition, effect.params?.condition];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const data = candidate as { dieSize?: unknown; successValues?: unknown; text?: unknown };
    const dieSize = Number(data.dieSize ?? 6);
    const successValues = Array.isArray(data.successValues)
      ? data.successValues.map(value => Number(value)).filter(value => Number.isInteger(value))
      : [];

    if (Number.isInteger(dieSize) && dieSize > 0 && successValues.length > 0) {
      return {
        dieSize,
        successValues,
        text: typeof data.text === "string" ? data.text : undefined
      };
    }
  }

  return undefined;
}

function conditionPasses(
  state: MatchState,
  source: ActiveEffectSource,
  effect: WardEngineEffect,
  timing: string,
  strike: ManualBattleStrike,
  addEvent?: AddEventFn
): boolean {
  const condition = getRollCondition(effect);
  const trigger = normalize(effect.trigger);

  if (timing === "WHEN_CREATURE_KILLED_IN_BATTLE" || trigger.includes("KILLED_IN_BATTLE")) {
    if (!sourceWasKilledByStrike(source, strike)) return false;
  }

  if (!condition) {
    const text = textForEffect(effect);
    if (text.includes("hits first") && strike.role !== "FIRST_STRIKE") return false;
    if (text.includes("hit lands") && !strike.hit) return false;
    if (text.includes("equipped creature is damaged") || text.includes("equipped creature damaged")) {
      const passed = equippedCreatureWasDamagedByStrike(source, strike);
      if (!passed) {
        addEvent?.(state, "BATTLE_EFFECT_CONDITION_NOT_MET", source.player.id, {
          sourceCardInstanceId: source.card.instanceId,
          sourceCardName: source.definition.name,
          effectId: effect.id,
          actionType: effect.actionType,
          timing,
          strikeId: strike.id,
          reason: "The equipped creature was not damaged by this battle strike."
        });
      }
      return passed;
    }
    if (isOpponentLightningDamageBoostEffect(effect)) {
      const passed = opponentPlayedLightningThisTurn(state, source);
      if (!passed) {
        addEvent?.(state, "BATTLE_EFFECT_CONDITION_NOT_MET", source.player.id, {
          sourceCardInstanceId: source.card.instanceId,
          sourceCardName: source.definition.name,
          effectId: effect.id,
          actionType: effect.actionType,
          timing,
          strikeId: strike.id,
          reason: "Opponent has not played a Lightning card this turn."
        });
      }
      return passed;
    }
    return true;
  }

  if (condition.dieSize !== 6) {
    addEvent?.(state, "BATTLE_EFFECT_CONDITION_UNSUPPORTED", source.player.id, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: source.definition.name,
      effectId: effect.id,
      actionType: effect.actionType,
      reason: "Only D6 roll conditions are automated right now.",
      dieSize: condition.dieSize
    });
    return false;
  }

  const roll = rollD6WithDev(state, {
    kind: "EFFECT_ROLL",
    count: 1,
    playerId: source.player.id,
    label: `${source.definition.name} ${effect.id} condition roll`,
    addEvent,
    context: { timing, effectId: effect.id, actionType: effect.actionType, strikeId: strike.id }
  })[0];
  const success = condition.successValues.includes(roll);

  addEvent?.(state, success ? "BATTLE_EFFECT_CONDITION_ROLL_SUCCEEDED" : "BATTLE_EFFECT_CONDITION_ROLL_FAILED", source.player.id, {
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: source.definition.name,
    effectId: effect.id,
    actionType: effect.actionType,
    timing,
    strikeId: strike.id,
    conditionText: condition.text,
    roll,
    successValues: condition.successValues,
    success
  });

  return success;
}

function namedCardToSendToCemetery(effect: WardEngineEffect): string | undefined {
  const candidates = [
    effect.target,
    effect.params?.target,
    effect.actionText,
    effect.value,
    effect.params?.valueText,
    effect.condition && typeof effect.condition === "object"
      ? (effect.condition as { text?: unknown }).text
      : undefined,
    getRuntimeBlockText(effect)
  ].filter(Boolean).join(" ");

  const quoted = candidates.match(/"([^"]+)"/);
  if (quoted?.[1]) return quoted[1].trim().toLowerCase();

  const sendTarget = candidates.match(/\bsend\s+([A-Za-z][A-Za-z0-9 '\-]*?)\s+to\s+(?:the\s+)?cemetery\b/i);
  if (sendTarget?.[1]) return sendTarget[1].trim().toLowerCase();

  const fieldCondition = candidates.match(/\b([A-Za-z][A-Za-z0-9 '\-]*?)\s+is\s+on\s+(?:the\s+)?field\b/i);
  if (fieldCondition?.[1]) return fieldCondition[1].trim().toLowerCase();

  const cardTarget = candidates.match(/\b([A-Za-z][A-Za-z0-9 '\-]*?)\s+card\b/i);
  if (cardTarget?.[1]) return cardTarget[1].trim().toLowerCase();

  return undefined;
}

function sendNamedFieldMagicToCemetery(
  state: MatchState,
  source: ActiveEffectSource,
  effect: WardEngineEffect,
  addEvent?: AddEventFn
): void {
  const wantedName = namedCardToSendToCemetery(effect);
  if (!wantedName) {
    addEvent?.(state, "BATTLE_NAMED_CARD_TO_CEMETERY_SKIPPED", source.player.id, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: source.definition.name,
      effectId: effect.id,
      actionType: effect.actionType,
      reason: "No named card could be inferred."
    });
    return;
  }

  for (const player of state.players) {
    const magic = player.field.magicSlots.find(card => {
      const definition = state.cardCatalog[card.cardId];
      return definition?.name.trim().toLowerCase() === wantedName;
    });
    if (!magic) continue;

    const result = moveMagicSlotCardToCemetery(
      state,
      player.id,
      magic.instanceId,
      addEvent,
      "NAMED_CARD_SENT_TO_CEMETERY_BY_BATTLE_EFFECT"
    );
    addEvent?.(state, "BATTLE_NAMED_CARD_SENT_TO_CEMETERY", source.player.id, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: source.definition.name,
      effectId: effect.id,
      actionType: effect.actionType,
      namedCardName: result.destroyedCardName,
      namedCardInstanceId: result.magicCard.instanceId,
      fieldOwnerPlayerId: result.fieldOwnerPlayerId,
      ownerPlayerId: result.cardOwnerPlayerId
    });
    return;
  }

  addEvent?.(state, "BATTLE_NAMED_CARD_TO_CEMETERY_SKIPPED", source.player.id, {
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: source.definition.name,
    effectId: effect.id,
    actionType: effect.actionType,
    namedCardName: wantedName,
    reason: "Named card was not in a field Magic slot."
  });
}

function statusFromEffect(effect: WardEngineEffect): { status: string; label: string; flags: ActiveCreatureStatus["flags"] } {
  const text = textForEffect(effect);
  const flags: ActiveCreatureStatus["flags"] = {};
  let status = "STATUS";

  if (text.includes("frozen") || text.includes("freeze")) {
    status = "FROZEN";
    flags.canInflictAtkDamage = false;
    flags.canBeSacrificed = false;
  }

  if (text.includes("wrapped")) {
    status = status === "STATUS" ? "WRAPPED" : status;
  }

  if (text.includes("stun") || text.includes("cannot inflict atk damage") || text.includes("cannot inflict attack damage")) {
    status = status === "STATUS" ? "STUNNED" : status;
    flags.canInflictAtkDamage = false;
  }

  if (text.includes("sleep") || text.includes("cannot initiate battle") || text.includes("cannot battle")) {
    status = status === "STATUS" ? "ASLEEP" : status;
    flags.canInitiateBattle = false;
  }

  if (text.includes("cannot be damaged") || text.includes("cannot receive damage") || text.includes("immune to damage") || text.includes("unaffected by damage")) {
    status = status === "STATUS" ? "DAMAGE_IMMUNE" : status;
    flags.canReceiveDamage = false;
  }

  if (text.includes("cannot change control") || text.includes("cannot be controlled") || text.includes("cannot switch control")) {
    status = status === "STATUS" ? "CONTROL_LOCKED" : status;
    flags.canChangeControl = false;
  }

  if (text.includes("cannot be removed from the field") || text.includes("cannot be removed") || text.includes("cannot leave the field")) {
    status = status === "STATUS" ? "FIELD_LOCKED" : status;
    flags.canBeRemovedFromField = false;
  }

  return {
    status,
    label: effect.value ?? effect.actionText ?? effect.params?.valueText ?? status,
    flags
  };
}

function addStatusToCreature(
  state: MatchState,
  source: ActiveEffectSource,
  target: FieldCreatureLocation,
  effect: WardEngineEffect,
  addEvent?: AddEventFn
): void {
  const status = statusFromEffect(effect);
  const expiration = expirationForRuntimeEffect(state, source, target, effect, 1);
  target.card.activeStatuses ??= [];

  const activeStatus: ActiveCreatureStatus = {
    id: uuidv4(),
    sourceEffectId: effect.id,
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: source.definition.name,
    sourcePlayerId: source.player.id,
    status: status.status,
    label: status.label,
    flags: status.flags,
    durationType: "TARGET_PLAYER_TURN_STARTS",
    appliedTurnNumber: state.turn.turnNumber,
    appliedTurnCycle: state.turn.turnCycleNumber,
    expiresOnPlayerId: expiration.expiresOnPlayerId,
    expiresAtPlayerTurnStartCount: expiration.expiresAtPlayerTurnStartCount
  };

  target.card.activeStatuses.push(activeStatus);
  syncStatusActiveEffectInstance(target.card, activeStatus);

  addEvent?.(state, "BATTLE_EFFECT_STATUS_APPLIED", source.player.id, {
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: source.definition.name,
    effectId: effect.id,
    actionType: effect.actionType,
    targetPlayerId: target.player.id,
    targetCreatureInstanceId: target.card.instanceId,
    targetCreatureName: target.definition.name,
    status: status.status,
    label: status.label,
    flags: status.flags,
    duration: effect.duration ?? effect.params?.duration,
    boardEvents: [
      {
        type: "STATUS_APPLIED",
        ...runtimeBoardEventBase(source, effect, "STATUS_APPLIED"),
        cardInstanceId: target.card.instanceId,
        targetCardInstanceId: target.card.instanceId,
        status: status.status,
        statusLabel: status.label
      } satisfies BoardEventPayload
    ]
  });
}

function getRecurringTickTimingForEffect(
  effect: WardEngineEffect
): ActiveRecurringCreatureEffect["tickTiming"] {
  const explicitTiming = effect.params?.tickTiming ?? effect.duration?.tickTiming;

  if (typeof explicitTiming === "string" && explicitTiming.trim()) {
    return normalizeRecurringTickTiming(explicitTiming);
  }

  // Default WARD DOT/HOT behavior remains Combat Phase end unless a card
  // explicitly says otherwise. Troll Regeneration explicitly says start of turn.
  return "END_OF_COMBAT_PHASE";
}

function positiveIntegerFromUnknown(value: unknown, fallback: number): number {
  const amount = Number(value ?? fallback);
  return Number.isFinite(amount) && amount > 0 ? Math.trunc(amount) : fallback;
}

function addRecurringEffectToCreature(
  state: MatchState,
  source: ActiveEffectSource,
  target: FieldCreatureLocation,
  effect: WardEngineEffect,
  addEvent?: AddEventFn
): void {
  const amount = firstPositiveNumber(effect);
  if (!amount) {
    addEvent?.(state, "BATTLE_RECURRING_EFFECT_UNSUPPORTED", source.player.id, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: source.definition.name,
      effectId: effect.id,
      actionType: effect.actionType,
      reason: "No numeric amount was found."
    });
    return;
  }

  const effectType: ActiveRecurringCreatureEffect["effectType"] = normalize(effect.actionType).includes("HEAL")
    ? "HEAL_OVER_TIME"
    : "DAMAGE_OVER_TIME";
  const stackRule = String(effect.params?.stackRule ?? effect.duration?.stackRule ?? "DO_NOT_STACK");
  target.card.activeRecurringEffects ??= [];

  if (stackRule === "DO_NOT_STACK" && target.card.activeRecurringEffects.some(item => item.effectType === effectType)) {
    addEvent?.(state, "BATTLE_RECURRING_EFFECT_NOT_STACKED", source.player.id, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: source.definition.name,
      effectId: effect.id,
      actionType: effect.actionType,
      targetCreatureInstanceId: target.card.instanceId,
      targetCreatureName: target.definition.name,
      effectType
    });
    return;
  }

  const totalTicks = positiveIntegerFromUnknown(effect.params?.startingTicks ?? effect.duration?.amount, durationAmount(effect, 1));
  const tickTiming = getRecurringTickTimingForEffect(effect);
  const expiration = expirationForRuntimeEffect(state, source, target, effect, totalTicks);
  const nextTick = getNextRecurringEffectTickSchedule(state, source.player.id, tickTiming);

  const activeRecurring: ActiveRecurringCreatureEffect = {
    id: uuidv4(),
    sourceEffectId: effect.id,
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: source.definition.name,
    sourcePlayerId: source.player.id,
    effectType,
    amount,
    label: effect.value ?? effect.actionText ?? effect.params?.valueText ?? `${amount}`,
    tickTiming,
    stackRule,
    remainingTicks: totalTicks,
    nextTickPlayerId: nextTick.nextTickPlayerId,
    nextTickTurnStartCount: nextTick.nextTickTurnStartCount,
    durationType: "TARGET_PLAYER_TURN_STARTS",
    appliedTurnNumber: state.turn.turnNumber,
    appliedTurnCycle: state.turn.turnCycleNumber,
    appliedSequenceNumber: state.eventLog.length + 1,
    refreshAtEndOfSourceOwnerTurn: Boolean(effect.params?.refreshAtEndOfSourceOwnerTurn),
    refreshAmount: Number.isFinite(Number(effect.params?.refreshAmount)) ? Math.max(1, Math.trunc(Number(effect.params?.refreshAmount))) : undefined,
    maxRefreshCounter: Number.isFinite(Number(effect.params?.maxRefreshCounter)) ? Math.max(1, Math.trunc(Number(effect.params?.maxRefreshCounter))) : undefined,
    expiresWhenSourceLeaves: effect.params?.expiresWhenSourceLeaves === undefined
      ? Boolean(effect.params?.sourceLinked)
      : Boolean(effect.params?.expiresWhenSourceLeaves),
    healImmediatelyOnApply: Boolean(effect.params?.healImmediatelyOnApply),
    expiresOnPlayerId: expiration.expiresOnPlayerId,
    expiresAtPlayerTurnStartCount: expiration.expiresAtPlayerTurnStartCount
  };

  target.card.activeRecurringEffects.push(activeRecurring);
  syncRecurringActiveEffectInstance(target.card, activeRecurring);

  if (activeRecurring.healImmediatelyOnApply && activeRecurring.effectType === "HEAL_OVER_TIME") {
    const result = healCreatureTarget(state, targetOptionFromCreatureLocation(target), activeRecurring.amount);
    addEvent?.(state, "BATTLE_RECURRING_HEAL_INITIAL_TICK_RESOLVED", source.player.id, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: source.definition.name,
      effectId: effect.id,
      actionType: effect.actionType,
      targetPlayerId: result.playerId,
      targetCreatureInstanceId: result.creature.instanceId,
      targetCreatureName: result.creatureName,
      healAmount: result.healAmount,
      requestedHealAmount: activeRecurring.amount,
      remainingHp: result.remainingHp,
      counterConsumed: false,
      boardEvents: [
        {
          type: "CARD_HEALED",
          ...runtimeBoardEventBase(source, effect, "RECURRING_HEAL_INITIAL_TICK"),
          cardInstanceId: result.creature.instanceId,
          targetCardInstanceId: result.creature.instanceId,
          amount: result.healAmount,
          healType: "HEAL_OVER_TIME"
        } satisfies BoardEventPayload
      ]
    });
  }

  addEvent?.(state, "BATTLE_RECURRING_EFFECT_APPLIED", source.player.id, {
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: source.definition.name,
    effectId: effect.id,
    actionType: effect.actionType,
    targetPlayerId: target.player.id,
    targetCreatureInstanceId: target.card.instanceId,
    targetCreatureName: target.definition.name,
    effectType,
    amount,
    totalTicks,
    tickTiming,
    nextTickPlayerId: activeRecurring.nextTickPlayerId,
    nextTickTurnStartCount: activeRecurring.nextTickTurnStartCount,
    remainingTicks: activeRecurring.remainingTicks,
    boardEvents: [
      {
        type: "STATUS_APPLIED",
        ...runtimeBoardEventBase(source, effect, "RECURRING_EFFECT_APPLIED"),
        cardInstanceId: target.card.instanceId,
        targetCardInstanceId: target.card.instanceId,
        amount,
        status: effectType,
        statusLabel: activeRecurring.label,
        effectType
      } satisfies BoardEventPayload
    ]
  });
}

function normalizeStatKey(rawStat: string): "armorLevel" | "speed" | "attackDice" | "modifier" | undefined {
  const stat = rawStat.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (["AL", "ARMOR", "ARMOR_LEVEL"].includes(stat)) return "armorLevel";
  if (["SPD", "SPEED"].includes(stat)) return "speed";
  if (["ATK_DICE", "ATTACK_DICE", "ATK_DICE_ROLLS", "ATTACK_DICE_ROLLS"].includes(stat)) return "attackDice";
  if (["MOD", "MODIFIER"].includes(stat)) return "modifier";
  return undefined;
}

function statDelta(operation: string, value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  const normalized = operation.trim().toUpperCase();
  if (normalized === "ADD") return value;
  if (normalized === "SUBTRACT") return -value;
  return undefined;
}

function applyTemporaryStatModifiers(
  state: MatchState,
  source: ActiveEffectSource,
  target: FieldCreatureLocation,
  effect: WardEngineEffect,
  addEvent?: AddEventFn
): void {
  const statChanges = getRuntimeBlockStatChanges(effect);
  const amount = durationAmount(effect, 1);

  for (const change of statChanges) {
    const stat = normalizeStatKey(change.stat);
    const delta = statDelta(change.operation, Number(change.value));
    if (!stat || delta === undefined || delta === 0) continue;

    const result = applyStatModifierToCreatureTarget(state, targetOptionFromCreatureLocation(target), {
      sourceEffectId: effect.id,
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: source.definition.name,
      stat,
      delta,
      durationType: "TARGET_PLAYER_TURN_STARTS",
      durationTargetPlayerTurnStarts: amount
    });

    addEvent?.(state, "BATTLE_EFFECT_STAT_MODIFIER_APPLIED", source.player.id, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: source.definition.name,
      effectId: effect.id,
      actionType: effect.actionType,
      targetPlayerId: result.playerId,
      targetCreatureInstanceId: result.creature.instanceId,
      targetCreatureName: result.creatureName,
      stat,
      delta,
      duration: effect.duration ?? effect.params?.duration,
      boardEvents: [
        {
          type: "STAT_MODIFIER_APPLIED",
          ...runtimeBoardEventBase(source, effect, "STAT_MODIFIER_APPLIED"),
          cardInstanceId: result.creature.instanceId,
          targetCardInstanceId: result.creature.instanceId,
          stat,
          delta,
          modifierId: result.modifierId
        } satisfies BoardEventPayload
      ]
    });
  }
}

function explicitTargetText(effect: WardEngineEffect): string {
  return [effect.target, effect.params?.target]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function attachedCreatureTarget(
  state: MatchState,
  source: ActiveEffectSource
): FieldCreatureLocation | undefined {
  return source.card.attachedToInstanceId
    ? findFieldCreatureByInstanceId(state, source.card.attachedToInstanceId)
    : undefined;
}

function strikeAttackerLocation(
  state: MatchState,
  strike: ManualBattleStrike
): FieldCreatureLocation | undefined {
  return findFieldCreatureByInstanceId(state, strike.attacker.creatureInstanceId);
}

function strikeDefenderLocation(
  state: MatchState,
  strike: ManualBattleStrike
): FieldCreatureLocation | undefined {
  return findFieldCreatureByInstanceId(state, strike.defender.creatureInstanceId);
}

function opposingStrikeParticipantForSource(
  state: MatchState,
  source: ActiveEffectSource,
  strike: ManualBattleStrike
): FieldCreatureLocation | undefined {
  if (source.card.instanceId === strike.attacker.creatureInstanceId ||
      source.card.attachedToInstanceId === strike.attacker.creatureInstanceId) {
    return strikeDefenderLocation(state, strike);
  }

  if (source.card.instanceId === strike.defender.creatureInstanceId ||
      source.card.attachedToInstanceId === strike.defender.creatureInstanceId) {
    return strikeAttackerLocation(state, strike);
  }

  return strikeDefenderLocation(state, strike);
}

function targetForBattleEffect(
  state: MatchState,
  source: ActiveEffectSource,
  effect: WardEngineEffect,
  strike: ManualBattleStrike
): FieldCreatureLocation | undefined {
  const targetText = explicitTargetText(effect);
  const fullText = textForEffect(effect);
  const actionType = normalize(getRuntimeBlockActionType(effect));

  const attacker = strikeAttackerLocation(state, strike);
  const defender = strikeDefenderLocation(state, strike);

  if (actionType === "SEND_NAMED_CARD_TO_CEMETERY") {
    return attacker ?? defender;
  }

  const parsedTargetMeansBattleOpponent =
    targetText.includes("target creature") ||
    targetText.includes("targeted creature") ||
    targetText.includes("attack target") ||
    targetText.includes("attacked creature") ||
    targetText.includes("defending creature") ||
    targetText.includes("defender") ||
    targetText.includes("missed creature");

  // Prefer the parsed target fields over the full card text. Conditions often say
  // "when this creature hits", but the effect target is the opposing battle creature.
  // Blue Dragon is the key case: source text says "this creature hits", while the
  // target is the creature that was hit.
  if (parsedTargetMeansBattleOpponent) {
    return opposingStrikeParticipantForSource(state, source, strike);
  }

  if (targetText.includes("equipped creature")) {
    return attachedCreatureTarget(state, source) ?? attacker;
  }

  if (targetText.includes("attacking creature") || targetText.includes("attacker")) {
    return attacker;
  }

  if (targetText.includes("this creature") || targetText.includes("this card")) {
    return findFieldCreatureByInstanceId(state, source.card.instanceId) ?? attachedCreatureTarget(state, source);
  }

  if (targetText.includes("your creature") || targetText.includes("your primary")) {
    const ownPrimary = state.players.find(player => player.id === source.player.id)?.field.primaryCreature;
    return ownPrimary ? findFieldCreatureByInstanceId(state, ownPrimary.instanceId) : undefined;
  }

  if (targetText.includes("opponent") && targetText.includes("primary")) {
    const opponent = state.players.find(player => player.id !== source.player.id);
    const opponentPrimary = opponent?.field.primaryCreature;
    return opponentPrimary ? findFieldCreatureByInstanceId(state, opponentPrimary.instanceId) : undefined;
  }

  if (fullText.includes("equipped creature")) {
    return attachedCreatureTarget(state, source) ?? attacker;
  }

  if (fullText.includes("attacking creature") || fullText.includes("attacker")) {
    return attacker;
  }

  if (fullText.includes("your creature") || fullText.includes("your primary")) {
    const ownPrimary = state.players.find(player => player.id === source.player.id)?.field.primaryCreature;
    return ownPrimary ? findFieldCreatureByInstanceId(state, ownPrimary.instanceId) : undefined;
  }

  if (fullText.includes("opponent") && fullText.includes("primary")) {
    const opponent = state.players.find(player => player.id !== source.player.id);
    const opponentPrimary = opponent?.field.primaryCreature;
    return opponentPrimary ? findFieldCreatureByInstanceId(state, opponentPrimary.instanceId) : undefined;
  }

  if (fullText.includes("this creature") || fullText.includes("this card")) {
    return findFieldCreatureByInstanceId(state, source.card.instanceId) ?? attachedCreatureTarget(state, source);
  }

  return defender;
}


function parseEffectMultiplier(effect: WardEngineEffect): number | undefined {
  const text = [
    effect.value,
    effect.params?.valueText,
    effect.actionText,
    effect.notes
  ].filter(Boolean).join(" ").toLowerCase();

  const explicit = text.match(/(?:x|×)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:x|×)/i);
  if (explicit) {
    const value = Number(explicit[1] ?? explicit[2]);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }

  if (text.includes("double")) return 2;
  if (text.includes("triple")) return 3;
  if (text.includes("quadruple")) return 4;

  return undefined;
}

type BattleDamageMultiplierConditionResult = {
  applies: boolean;
  conditionName?: string;
  reason?: string;
  evidence?: Record<string, unknown>;
};

function hasAttackDamageDieSixCondition(effect: WardEngineEffect): boolean {
  const text = textForEffect(effect);

  return [
    /(?:one|1|any|at least\s+1)[^.;]*\batk\s+dice\s+rolls?[^.;]*\b6\b/,
    /\batk\s+dice\s+rolls?[^.;]*(?:is|are|contains?|has|rolls?)?[^.;]*\b6\b/,
    /\battack\s+damage\s+(?:die|dice|rolls?)[^.;]*\b6\b/,
    /\bdamage\s+(?:die|dice|rolls?)[^.;]*\b6\b[^.;]*(?:double|2x|x2|×2)/
  ].some(pattern => pattern.test(text));
}

function evaluateBattleDamageMultiplierCondition(
  effect: WardEngineEffect,
  strike: ManualBattleStrike
): BattleDamageMultiplierConditionResult {
  if (!hasAttackDamageDieSixCondition(effect)) {
    return { applies: true };
  }

  const dice = strike.damageRollDice ?? [];
  const hasSix = dice.some(die => Number(die) === 6);

  return {
    applies: hasSix,
    conditionName: "ATK_DAMAGE_DIE_RESULT_6",
    reason: hasSix
      ? undefined
      : dice.length
        ? "No attack damage die result was 6."
        : "Attack damage dice were not available when the condition was evaluated.",
    evidence: {
      damageRollDice: dice
    }
  };
}

function applyBattleDamageMultiplier(
  state: MatchState,
  source: ActiveEffectSource,
  effect: WardEngineEffect,
  target: FieldCreatureLocation,
  strike: ManualBattleStrike | undefined,
  addEvent?: AddEventFn
): void {
  if (!strike) {
    addEvent?.(state, "BATTLE_DAMAGE_MULTIPLIER_SKIPPED", source.player.id, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: source.definition.name,
      effectId: effect.id,
      actionType: effect.actionType,
      reason: "No active strike was available."
    });
    return;
  }

  const multiplier = parseEffectMultiplier(effect);
  if (multiplier === undefined) {
    addEvent?.(state, "BATTLE_DAMAGE_MULTIPLIER_SKIPPED", source.player.id, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: source.definition.name,
      effectId: effect.id,
      actionType: effect.actionType,
      reason: "No numeric multiplier could be inferred."
    });
    return;
  }

  const text = textForEffect(effect);
  const modifierNote = String(strike.modifiers.note ?? "").toLowerCase();
  const sourceAlreadyAppliedByBattleAdapter =
    modifierNote.includes(source.definition.name.toLowerCase()) &&
    Number(strike.modifiers.damageMultiplier ?? 1) >= multiplier;

  if (sourceAlreadyAppliedByBattleAdapter) {
    addEvent?.(state, "BATTLE_DAMAGE_MULTIPLIER_ALREADY_APPLIED", source.player.id, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: source.definition.name,
      effectId: effect.id,
      actionType: effect.actionType,
      strikeId: strike.id,
      multiplier,
      stackedDamageMultiplier: strike.modifiers.damageMultiplier,
      note: "Battle modifier adapter already applied this multiplier before the runtime timing trigger."
    });
    return;
  }

  const targetType = target.definition.creatureType.toLowerCase();
  const targetName = target.definition.name.toLowerCase();
  const targetArtworkTags = ((target.definition as { artworkTags?: unknown }).artworkTags ?? []) as unknown[];
  const targetHasWings = targetArtworkTags.some(tag => String(tag).trim().toLowerCase() === "wings") ||
    targetName.includes("dragon") ||
    targetName.includes("griffin");
  const targetPredicates: boolean[] = [];
  if (text.includes("dragon-type") || text.includes("dragon target") || text.includes("name contains dragon")) {
    targetPredicates.push(targetType.includes("dragon") || targetName.includes("dragon"));
  }
  if (text.includes("wings") || text.includes("winged")) {
    targetPredicates.push(targetHasWings);
  }
  if (text.includes("bug-type") || text.includes("bug type")) {
    targetPredicates.push(targetType.includes("bug"));
  }
  if (text.includes("demon-type") || text.includes("demon type") || text.includes("name contains \"demon\"")) {
    targetPredicates.push(targetType.includes("demon") || targetName.includes("demon"));
  }
  if (text.includes("undead-type") || text.includes("undead type")) {
    targetPredicates.push(targetType.includes("undead"));
  }
  if (text.includes("humanoid-type") || text.includes("humanoid type")) {
    targetPredicates.push(targetType.includes("humanoid"));
  }
  if (text.includes("mechanical-type") || text.includes("mechanical type")) {
    targetPredicates.push(targetType.includes("mechanical"));
  }
  const typePredicateFailed = targetPredicates.length > 0 && !targetPredicates.some(Boolean);

  if (typePredicateFailed) {
    addEvent?.(state, "BATTLE_DAMAGE_MULTIPLIER_CONDITION_NOT_MET", source.player.id, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: source.definition.name,
      effectId: effect.id,
      actionType: effect.actionType,
      strikeId: strike.id,
      targetCreatureInstanceId: target.card.instanceId,
      targetCreatureName: target.definition.name,
      targetCreatureType: target.definition.creatureType,
      reason: "Target creature did not match this multiplier aura condition."
    });
    return;
  }

  const condition = evaluateBattleDamageMultiplierCondition(effect, strike);
  if (!condition.applies) {
    addEvent?.(state, "BATTLE_DAMAGE_MULTIPLIER_CONDITION_NOT_MET", source.player.id, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: source.definition.name,
      effectId: effect.id,
      actionType: effect.actionType,
      strikeId: strike.id,
      attackerCreatureInstanceId: strike.attacker.creatureInstanceId,
      attackerCreatureName: strike.attacker.creatureName,
      defenderCreatureInstanceId: strike.defender.creatureInstanceId,
      defenderCreatureName: strike.defender.creatureName,
      conditionName: condition.conditionName,
      reason: condition.reason,
      evidence: condition.evidence
    });
    return;
  }

  strike.modifiers.damageMultiplier = Number(strike.modifiers.damageMultiplier ?? 1) * multiplier;
  strike.modifiers.note = [strike.modifiers.note, `${source.definition.name} ${effect.id}: x${multiplier}`]
    .filter(Boolean)
    .join("; ")
    .slice(0, 500);

  addEvent?.(state, "BATTLE_DAMAGE_MULTIPLIER_APPLIED", source.player.id, {
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: source.definition.name,
    effectId: effect.id,
    actionType: effect.actionType,
    strikeId: strike.id,
    attackerCreatureInstanceId: strike.attacker.creatureInstanceId,
    attackerCreatureName: strike.attacker.creatureName,
    defenderCreatureInstanceId: strike.defender.creatureInstanceId,
    defenderCreatureName: strike.defender.creatureName,
    multiplier,
    conditionName: condition.conditionName,
    conditionEvidence: condition.evidence,
    stackedDamageMultiplier: strike.modifiers.damageMultiplier,
    boardEvents: [
      {
        type: "STAT_MODIFIER_APPLIED",
        ...runtimeBoardEventBase(source, effect, "ATTACK_DAMAGE_MULTIPLIER"),
        cardInstanceId: target.card.instanceId,
        targetCardInstanceId: target.card.instanceId,
        stat: "attackDamageMultiplier",
        delta: multiplier
      } satisfies BoardEventPayload
    ]
  });
}

function applyBattleDamagePrevention(
  state: MatchState,
  source: ActiveEffectSource,
  effect: WardEngineEffect,
  strike: ManualBattleStrike | undefined,
  addEvent?: AddEventFn
): void {
  if (!strike) return;

  strike.modifiers.preventAttackDamage = true;
  strike.modifiers.note = [strike.modifiers.note, `${source.definition.name} ${effect.id}: attack damage prevented`]
    .filter(Boolean)
    .join("; ")
    .slice(0, 500);

  addEvent?.(state, "BATTLE_ATTACK_DAMAGE_PREVENTION_APPLIED", source.player.id, {
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: source.definition.name,
    effectId: effect.id,
    actionType: effect.actionType,
    strikeId: strike.id,
    attackerCreatureInstanceId: strike.attacker.creatureInstanceId,
    attackerCreatureName: strike.attacker.creatureName
  });
}

function applyPreBattleRollDefense(
  state: MatchState,
  source: ActiveEffectSource,
  effect: WardEngineEffect,
  strike: ManualBattleStrike | undefined,
  addEvent?: AddEventFn
): void {
  if (!strike) return;

  const sourceIsDefender = source.card.instanceId === strike.defender.creatureInstanceId ||
    source.card.attachedToInstanceId === strike.defender.creatureInstanceId;

  if (!sourceIsDefender) {
    addEvent?.(state, "BATTLE_PRE_ROLL_DEFENSE_SKIPPED", source.player.id, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: source.definition.name,
      effectId: effect.id,
      actionType: effect.actionType,
      strikeId: strike.id,
      reason: "This pre-battle defense only applies while the source is receiving attack damage."
    });
    return;
  }

  const rollPlayerId = strike.attacker.playerId;
  const roll = rollD6WithDev(state, {
    kind: "EFFECT_ROLL",
    count: 1,
    playerId: rollPlayerId,
    label: `${source.definition.name} ${effect.id} pre-battle defense roll`,
    addEvent,
    context: {
      timing: "BEFORE_HIT_ROLL",
      effectId: effect.id,
      actionType: effect.actionType,
      strikeId: strike.id,
      sourceCardInstanceId: source.card.instanceId
    }
  })[0];

  const preventsDamage = roll <= 2;

  addEvent?.(state, preventsDamage ? "BATTLE_PRE_ROLL_DEFENSE_SUCCEEDED" : "BATTLE_PRE_ROLL_DEFENSE_FAILED", source.player.id, {
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: source.definition.name,
    effectId: effect.id,
    actionType: effect.actionType,
    strikeId: strike.id,
    roll,
    successValues: [1, 2],
    preventsDamage
  });

  if (preventsDamage) {
    applyBattleDamagePrevention(state, source, effect, strike, addEvent);
  }
}


function applyPercentageDamage(
  state: MatchState,
  source: ActiveEffectSource,
  target: FieldCreatureLocation,
  effect: WardEngineEffect,
  addEvent?: AddEventFn
): void {
  const currentHp = target.card.currentHp ?? target.card.baseHp ?? target.definition.hp;
  const text = textForEffect(effect);
  const fraction = text.includes("1/2") || text.includes("half") ? 0.5 : undefined;
  if (!fraction) {
    addEvent?.(state, "BATTLE_PERCENTAGE_DAMAGE_SKIPPED", source.player.id, {
      sourceCardName: source.definition.name,
      effectId: effect.id,
      actionType: effect.actionType,
      reason: "Only half remaining HP percentage damage is automated right now."
    });
    return;
  }

  const amount = Math.ceil(currentHp * fraction);
  const result = applyDamageToCreatureTarget(state, targetOptionFromCreatureLocation(target), amount);
  addEvent?.(state, "BATTLE_PERCENTAGE_DAMAGE_RESOLVED", source.player.id, {
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: source.definition.name,
    effectId: effect.id,
    actionType: effect.actionType,
    targetCreatureInstanceId: result.creature.instanceId,
    targetCreatureName: result.creatureName,
    currentHpBefore: currentHp,
    damageAmount: result.damageAmount,
    remainingHp: result.remainingHp,
    killed: result.killed,
    note: "Half values are rounded up.",
    boardEvents: [
      {
        type: "CARD_DAMAGED",
        ...runtimeBoardEventBase(source, effect, "PERCENTAGE_DAMAGE"),
        cardInstanceId: result.creature.instanceId,
        targetCardInstanceId: result.creature.instanceId,
        amount: result.damageAmount,
        damageType: "PERCENTAGE_DAMAGE"
      } satisfies BoardEventPayload
    ]
  });
}

function applyHealByDamageDealt(
  state: MatchState,
  source: ActiveEffectSource,
  target: FieldCreatureLocation,
  effect: WardEngineEffect,
  strike: ManualBattleStrike | undefined,
  addEvent?: AddEventFn
): void {
  if (!strike || !strike.damageDealt || strike.damageDealt <= 0) return;
  const amount = Math.ceil(strike.damageDealt / 2);
  const result = healCreatureTarget(state, targetOptionFromCreatureLocation(target), amount);
  addEvent?.(state, "BATTLE_HEAL_BY_DAMAGE_DEALT_RESOLVED", source.player.id, {
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: source.definition.name,
    effectId: effect.id,
    actionType: effect.actionType,
    strikeId: strike.id,
    damageDealt: strike.damageDealt,
    healAmount: result.healAmount,
    targetCreatureInstanceId: result.creature.instanceId,
    targetCreatureName: result.creatureName,
    remainingHp: result.remainingHp,
    maxHp: result.maxHp,
    note: "Uses actual damage inflicted; half values are rounded up.",
    boardEvents: [
      {
        type: "CARD_HEALED",
        ...runtimeBoardEventBase(source, effect, "HEAL_BY_DAMAGE_DEALT"),
        cardInstanceId: result.creature.instanceId,
        targetCardInstanceId: result.creature.instanceId,
        amount: result.healAmount,
        healType: "HEAL_BY_DAMAGE_DEALT"
      } satisfies BoardEventPayload
    ]
  });
}

function applyImmediateDamageOrHeal(
  state: MatchState,
  source: ActiveEffectSource,
  target: FieldCreatureLocation,
  effect: WardEngineEffect,
  addEvent?: AddEventFn
): void {
  const amount = firstPositiveNumber(effect);
  if (!amount) return;

  const action = normalize(effect.actionType);
  const option = targetOptionFromCreatureLocation(target);

  if (action.includes("HEAL")) {
    const result = healCreatureTarget(state, option, amount);
    addEvent?.(state, "BATTLE_EFFECT_HEAL_RESOLVED", source.player.id, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: source.definition.name,
      effectId: effect.id,
      actionType: effect.actionType,
      targetCreatureInstanceId: result.creature.instanceId,
      targetCreatureName: result.creatureName,
      healAmount: result.healAmount,
      remainingHp: result.remainingHp,
      maxHp: result.maxHp,
      boardEvents: [
        {
          type: "CARD_HEALED",
          ...runtimeBoardEventBase(source, effect, "EFFECT_HEAL"),
          cardInstanceId: result.creature.instanceId,
          targetCardInstanceId: result.creature.instanceId,
          amount: result.healAmount,
          healType: effect.actionType
        } satisfies BoardEventPayload
      ]
    });
    return;
  }

  const result = applyDamageToCreatureTarget(state, option, amount);
  addEvent?.(state, "BATTLE_EFFECT_DAMAGE_RESOLVED", source.player.id, {
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: source.definition.name,
    effectId: effect.id,
    actionType: effect.actionType,
    targetCreatureInstanceId: result.creature.instanceId,
    targetCreatureName: result.creatureName,
    damageAmount: result.damageAmount,
    remainingHp: result.remainingHp,
    killed: result.killed,
    boardEvents: [
      {
        type: "CARD_DAMAGED",
        ...runtimeBoardEventBase(source, effect, "EFFECT_DAMAGE"),
        cardInstanceId: result.creature.instanceId,
        targetCardInstanceId: result.creature.instanceId,
        amount: result.damageAmount,
        damageType: effect.actionType
      } satisfies BoardEventPayload
    ]
  });
}

function applyForcedDamageDice(
  state: MatchState,
  source: ActiveEffectSource,
  target: FieldCreatureLocation,
  effect: WardEngineEffect,
  addEvent?: AddEventFn
): void {
  const diceCount = firstPositiveNumber(effect) ?? 1;
  const dice = rollD6WithDev(state, {
    kind: "EFFECT_ROLL",
    count: diceCount,
    playerId: target.player.id,
    label: `${source.definition.name} forced damage dice`,
    addEvent,
    context: {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: source.definition.name,
      effectId: effect.id,
      actionType: effect.actionType,
      targetCreatureInstanceId: target.card.instanceId,
      targetCreatureName: target.definition.name
    }
  });
  const damageAmount = dice.reduce((total, die) => total + die, 0);
  const result = applyDamageToCreatureTarget(state, targetOptionFromCreatureLocation(target), damageAmount);

  addEvent?.(state, "BATTLE_FORCED_DAMAGE_DICE_RESOLVED", source.player.id, {
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: source.definition.name,
    effectId: effect.id,
    actionType: effect.actionType,
    targetPlayerId: target.player.id,
    targetCreatureInstanceId: result.creature.instanceId,
    targetCreatureName: result.creatureName,
    dice,
    damageAmount: result.damageAmount,
    remainingHp: result.remainingHp,
    killed: result.killed,
    note: "Forced effect damage dice use dice total only; attack modifiers and critical rules do not apply.",
    boardEvents: [
      {
        type: "CARD_DAMAGED",
        ...runtimeBoardEventBase(source, effect, "FORCED_DAMAGE_DICE"),
        cardInstanceId: result.creature.instanceId,
        targetCardInstanceId: result.creature.instanceId,
        amount: result.damageAmount,
        damageType: "ROLL_DAMAGE_DICE"
      } satisfies BoardEventPayload
    ]
  });
}

function resolveEffectAction(
  state: MatchState,
  source: ActiveEffectSource,
  effect: WardEngineEffect,
  target: FieldCreatureLocation,
  strike?: ManualBattleStrike,
  addEvent?: AddEventFn
): void {
  const actionType = normalize(getRuntimeBlockActionType(effect));

  if (actionType === "ROLL_FOR_EFFECT") {
    addEvent?.(state, "BATTLE_EFFECT_ROLL_DETECTED", source.player.id, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: source.definition.name,
      effectId: effect.id,
      actionType: effect.actionType,
      strikeId: strike?.id,
      note: "Effect roll will open after the hit succeeds and before attack damage is rolled."
    });
    return;
  }

  if (actionType === "APPLY_ATTACK_DAMAGE_MULTIPLIER" || actionType === "APPLY_DAMAGE_MULTIPLIER" || actionType === "APPLY_DAMAGE_MULTIPLIER_AURA") {
    applyBattleDamageMultiplier(state, source, effect, target, strike, addEvent);
    return;
  }

  if (actionType === "APPLY_PRE_BATTLE_ROLL_DEFENSE") {
    applyPreBattleRollDefense(state, source, effect, strike, addEvent);
    return;
  }

  if (
    actionType === "PREVENT_ATTACK_DAMAGE" ||
    actionType === "NEGATE_ATTACK" ||
    actionType === "NEGATE_ATTACK_DAMAGE" ||
    actionType === "PREVENT_DAMAGE" ||
    actionType === "NEGATE_ATTACK_AND_HEAL" ||
    actionType === "NEGATE_ATTACK_AND_REFLECT_DAMAGE"
  ) {
    applyBattleDamagePrevention(state, source, effect, strike, addEvent);
    return;
  }

  if (actionType === "APPLY_STATUS" || actionType === "APPLY_STATUS_WITH_ESCAPE_ROLL") {
    addStatusToCreature(state, source, target, effect, addEvent);
    return;
  }

  if (actionType.includes("DAMAGE_OVER_TIME") || actionType.includes("HEALING_OVER_TIME") || actionType.includes("HEAL_OVER_TIME")) {
    addRecurringEffectToCreature(state, source, target, effect, addEvent);
    return;
  }

  if (actionType === "DEAL_PERCENTAGE_DAMAGE" || actionType === "APPLY_CONDITIONAL_DAMAGE_REDUCTION" || actionType === "APPLY_DAMAGE_REDUCTION") {
    if (actionType === "DEAL_PERCENTAGE_DAMAGE") {
      applyPercentageDamage(state, source, target, effect, addEvent);
    } else if (strike) {
      strike.modifiers.damageMultiplier = Number(strike.modifiers.damageMultiplier ?? 1) * 0.5;
      strike.modifiers.note = [strike.modifiers.note, `${source.definition.name} ${effect.id}: incoming damage x1/2`].filter(Boolean).join("; ").slice(0, 500);
      addEvent?.(state, "BATTLE_DAMAGE_REDUCTION_APPLIED", source.player.id, {
        sourceCardInstanceId: source.card.instanceId,
        sourceCardName: source.definition.name,
        effectId: effect.id,
        actionType: effect.actionType,
        strikeId: strike.id,
        multiplier: 0.5,
        note: "Half damage uses the existing damage multiplier pipeline."
      });
    }
    return;
  }

  if (actionType === "HEAL_BY_DAMAGE_DEALT") {
    applyHealByDamageDealt(state, source, target, effect, strike, addEvent);
    return;
  }

  if (actionType === "ROLL_DAMAGE_DICE") {
    applyForcedDamageDice(state, source, target, effect, addEvent);
    return;
  }

  if (actionType === "DAMAGE" || actionType === "DEAL_INSTANT_DAMAGE" || actionType === "DAMAGE_CREATURE" || actionType === "HEAL" || actionType === "HEAL_CREATURE") {
    applyImmediateDamageOrHeal(state, source, target, effect, addEvent);
    return;
  }

  if (actionType === "SEND_NAMED_CARD_TO_CEMETERY") {
    sendNamedFieldMagicToCemetery(state, source, effect, addEvent);
    return;
  }

  if (actionType === "APPLY_STAT_MODIFIER" || actionType === "APPLY_DICE_MODIFIER" || actionType === "APPLY_CONDITIONAL_DICE_MODIFIER") {
    applyTemporaryStatModifiers(state, source, target, effect, addEvent);
    return;
  }

  addEvent?.(state, "BATTLE_EFFECT_ROUTE_NOT_AUTOMATED", source.player.id, {
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: source.definition.name,
    effectId: effect.id,
    actionType: effect.actionType,
    note: "The trigger was detected, but this action type still needs a specialized resolver."
  });
}

export function resolveBattleTriggeredRuntimeEffects(
  state: MatchState,
  args: {
    timing: string;
    battleSession: PendingBattleSession;
    strike?: ManualBattleStrike;
    addEvent?: AddEventFn;
  }
): void {
  if (!args.strike) return;

  const activeSources = collectActiveEffectSources(state);
  const killedSources = args.timing === "WHEN_CREATURE_KILLED_IN_BATTLE"
    ? collectKilledBattleEffectSources(state, args.strike)
    : [];
  const seen = new Set<string>();
  const sources = [...activeSources, ...killedSources].filter(source => {
    const key = `${source.card.instanceId}:${source.zone}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  for (const source of sources) {
    const effects = getCardEngineEffects(source.definition);

    for (const effect of effects) {
      if (!sourceCanResolveForTiming(source, effect, args.timing, args.strike)) continue;
      if (!conditionPasses(state, source, effect, args.timing, args.strike, args.addEvent)) continue;

      const target = targetForBattleEffect(state, source, effect, args.strike);
      if (!target) continue;

      args.addEvent?.(state, "EFFECT_RUNTIME_TRACE", source.player.id, {
        sourceCardInstanceId: source.card.instanceId,
        sourceCardId: source.card.cardId,
        sourceCardName: source.definition.name,
        sourceZone: source.zone,
        effectId: effect.id,
        trigger: effect.trigger,
        actionType: effect.actionType,
        timing: args.timing,
        targetPlayerId: target.player.id,
        targetCreatureInstanceId: target.card.instanceId,
        targetCreatureName: target.definition.name,
        strikeId: args.strike.id,
        strikeRole: args.strike.role
      });

      resolveEffectAction(state, source, effect, target, args.strike, args.addEvent);
    }
  }
}

export function creatureCannotInflictAttackDamage(card: CardInstance): boolean {
  return (card.activeStatuses ?? []).some(status => status.flags.canInflictAtkDamage === false);
}

export function creatureCannotBeSacrificed(card: CardInstance): boolean {
  return (card.activeStatuses ?? []).some(status => status.flags.canBeSacrificed === false);
}

export function creatureCannotInitiateBattle(
  card: CardInstance,
  cannotInflictAttackDamageBattlePolicy: CannotInflictAttackDamageBattlePolicy = "DAMAGE_ONLY"
): boolean {
  return (card.activeStatuses ?? []).some(status =>
    status.flags.canInitiateBattle === false ||
    (cannotInflictAttackDamageBattlePolicy === "SKIP_BATTLE" &&
      status.flags.canInflictAtkDamage === false)
  );
}

export function creatureCannotReceiveDamage(card: CardInstance): boolean {
  return (card.activeStatuses ?? []).some(status => status.flags.canReceiveDamage === false);
}

export function creatureCannotChangeControl(card: CardInstance): boolean {
  return (card.activeStatuses ?? []).some(status => status.flags.canChangeControl === false);
}

export function creatureCannotBeRemovedFromField(card: CardInstance): boolean {
  return (card.activeStatuses ?? []).some(status => status.flags.canBeRemovedFromField === false);
}

function collectFieldCreatureLocations(state: MatchState): FieldCreatureLocation[] {
  return state.players.flatMap(player => {
    const items: FieldCreatureLocation[] = [];
    if (player.field.primaryCreature) {
      const definition = getCardDefinition(state, player.field.primaryCreature);
      if (definition.cardType === "CREATURE") {
        items.push({ player, card: player.field.primaryCreature, definition, targetKind: "PRIMARY_CREATURE" });
      }
    }
    for (const limited of player.field.limitedSummons) {
      const definition = getCardDefinition(state, limited);
      if (definition.cardType === "CREATURE") {
        items.push({ player, card: limited, definition, targetKind: "LIMITED_SUMMON" });
      }
    }
    return items;
  });
}

type DueRecurringEffect = {
  recurringId: string;
  targetCardInstanceId: string;
  appliedSequenceNumber: number;
  fallbackOrder: number;
};

function processRecurringRuntimeEffectsForTiming(
  state: MatchState,
  tickTiming: ActiveRecurringCreatureEffect["tickTiming"],
  addEvent?: AddEventFn
): void {
  const due: DueRecurringEffect[] = [];
  let fallbackOrder = 0;

  for (const location of collectFieldCreatureLocations(state)) {
    for (const recurring of location.card.activeRecurringEffects ?? []) {
      if (normalizeRecurringTickTiming(recurring.tickTiming) !== tickTiming || recurring.remainingTicks <= 0) {
        fallbackOrder += 1;
        continue;
      }

      if (!shouldRecurringEffectTickNow(state, recurring)) {
        fallbackOrder += 1;
        continue;
      }

      due.push({
        recurringId: recurring.id,
        targetCardInstanceId: location.card.instanceId,
        appliedSequenceNumber: recurring.appliedSequenceNumber ?? Number.MAX_SAFE_INTEGER,
        fallbackOrder
      });
      fallbackOrder += 1;
    }
  }

  due.sort((a, b) =>
    a.appliedSequenceNumber - b.appliedSequenceNumber ||
    a.fallbackOrder - b.fallbackOrder
  );

  for (const dueEffect of due) {
    const location = findFieldCreatureByInstanceId(state, dueEffect.targetCardInstanceId);
    if (!location) continue;

    const active = location.card.activeRecurringEffects ?? [];
    const recurring = active.find(item => item.id === dueEffect.recurringId);
    if (!recurring || recurring.remainingTicks <= 0 || normalizeRecurringTickTiming(recurring.tickTiming) !== tickTiming || !shouldRecurringEffectTickNow(state, recurring)) {
      continue;
    }

    const option = targetOptionFromCreatureLocation(location);
    const ticksRemainingAfterThis = recurring.remainingTicks - 1;

    if (recurring.effectType === "HEAL_OVER_TIME") {
      const result = healCreatureTarget(state, option, recurring.amount);
      addEvent?.(state, "RECURRING_HEAL_TICK_RESOLVED", recurring.sourcePlayerId, {
        sourceCardInstanceId: recurring.sourceCardInstanceId,
        sourceCardName: recurring.sourceCardName,
        sourceEffectId: recurring.sourceEffectId,
        phase: state.turn.phase,
        turnNumber: state.turn.turnNumber,
        turnCycleNumber: state.turn.turnCycleNumber,
        targetPlayerId: result.playerId,
        targetCreatureInstanceId: result.creature.instanceId,
        targetCreatureName: result.creatureName,
        healAmount: result.healAmount,
        remainingHp: result.remainingHp,
        tickTiming,
        ticksRemainingAfterThis,
        boardEvents: [
          {
            type: "RECURRING_EFFECT_TICKED",
            playerId: recurring.sourcePlayerId,
            sourceCardInstanceId: recurring.sourceCardInstanceId,
            sourceEffectId: recurring.sourceEffectId,
            actionType: "APPLY_HEALING_OVER_TIME",
            reason: "RECURRING_HEAL_TICK",
            cardInstanceId: result.creature.instanceId,
            targetCardInstanceId: result.creature.instanceId,
            amount: result.healAmount,
            effectType: recurring.effectType,
            status: recurring.effectType,
            statusLabel: recurring.label,
            ticksRemainingAfterThis,
            ...timingBoardEventFields(state)
          } satisfies BoardEventPayload,
          {
            type: "CARD_HEALED",
            playerId: recurring.sourcePlayerId,
            sourceCardInstanceId: recurring.sourceCardInstanceId,
            sourceEffectId: recurring.sourceEffectId,
            actionType: "APPLY_HEALING_OVER_TIME",
            reason: "RECURRING_HEAL_TICK",
            cardInstanceId: result.creature.instanceId,
            targetCardInstanceId: result.creature.instanceId,
            amount: result.healAmount,
            healType: recurring.effectType,
            ...timingBoardEventFields(state)
          } satisfies BoardEventPayload
        ]
      });
    } else {
      const result = applyDamageToCreatureTarget(state, option, recurring.amount);
      addEvent?.(state, "RECURRING_DAMAGE_TICK_RESOLVED", recurring.sourcePlayerId, {
        sourceCardInstanceId: recurring.sourceCardInstanceId,
        sourceCardName: recurring.sourceCardName,
        sourceEffectId: recurring.sourceEffectId,
        phase: state.turn.phase,
        turnNumber: state.turn.turnNumber,
        turnCycleNumber: state.turn.turnCycleNumber,
        targetPlayerId: result.playerId,
        targetCreatureInstanceId: result.creature.instanceId,
        targetCreatureName: result.creatureName,
        damageAmount: result.damageAmount,
        remainingHp: result.remainingHp,
        killed: result.killed,
        tickTiming,
        ticksRemainingAfterThis,
        boardEvents: [
          {
            type: "RECURRING_EFFECT_TICKED",
            playerId: recurring.sourcePlayerId,
            sourceCardInstanceId: recurring.sourceCardInstanceId,
            sourceEffectId: recurring.sourceEffectId,
            actionType: "APPLY_DAMAGE_OVER_TIME",
            reason: "RECURRING_DAMAGE_TICK",
            cardInstanceId: result.creature.instanceId,
            targetCardInstanceId: result.creature.instanceId,
            amount: result.damageAmount,
            effectType: recurring.effectType,
            status: recurring.effectType,
            statusLabel: recurring.label,
            ticksRemainingAfterThis,
            ...timingBoardEventFields(state)
          } satisfies BoardEventPayload,
          {
            type: "CARD_DAMAGED",
            playerId: recurring.sourcePlayerId,
            sourceCardInstanceId: recurring.sourceCardInstanceId,
            sourceEffectId: recurring.sourceEffectId,
            actionType: "APPLY_DAMAGE_OVER_TIME",
            reason: "RECURRING_DAMAGE_TICK",
            cardInstanceId: result.creature.instanceId,
            targetCardInstanceId: result.creature.instanceId,
            amount: result.damageAmount,
            damageType: recurring.effectType,
            ...timingBoardEventFields(state)
          } satisfies BoardEventPayload
        ]
      });
    }

    const stillOnField = findFieldCreatureByInstanceId(state, dueEffect.targetCardInstanceId);
    if (!stillOnField) continue;

    const updatedActive = stillOnField.card.activeRecurringEffects ?? [];
    const updatedRecurring = updatedActive.find(item => item.id === dueEffect.recurringId);
    if (!updatedRecurring) continue;

    updatedRecurring.remainingTicks = ticksRemainingAfterThis;
    updatedRecurring.lastTickTurnNumber = state.turn.turnNumber;
    updatedRecurring.lastTickTurnCycle = state.turn.turnCycleNumber;

    if (updatedRecurring.remainingTicks > 0) {
      const nextTick = getFollowingRecurringEffectTickSchedule(state, updatedRecurring.sourcePlayerId);
      updatedRecurring.nextTickPlayerId = nextTick.nextTickPlayerId;
      updatedRecurring.nextTickTurnStartCount = nextTick.nextTickTurnStartCount;
      syncRecurringActiveEffectInstance(stillOnField.card, updatedRecurring);
    } else {
      stillOnField.card.activeRecurringEffects = updatedActive.filter(item => item.id !== dueEffect.recurringId);
      stillOnField.card.activeEffectInstances = (stillOnField.card.activeEffectInstances ?? []).filter(instance => !(
        instance.id === dueEffect.recurringId &&
        (instance.kind === "DAMAGE_OVER_TIME" || instance.kind === "HEAL_OVER_TIME")
      ));
      addEvent?.(state, "RECURRING_EFFECT_EXPIRED", updatedRecurring.sourcePlayerId, {
        sourceCardInstanceId: updatedRecurring.sourceCardInstanceId,
        sourceCardName: updatedRecurring.sourceCardName,
        sourceEffectId: updatedRecurring.sourceEffectId,
        phase: state.turn.phase,
        turnNumber: state.turn.turnNumber,
        turnCycleNumber: state.turn.turnCycleNumber,
        targetPlayerId: stillOnField.player.id,
        targetCreatureInstanceId: stillOnField.card.instanceId,
        targetCreatureName: stillOnField.definition.name,
        effectType: updatedRecurring.effectType,
        boardEvents: [
          {
            type: "STATUS_REMOVED",
            playerId: updatedRecurring.sourcePlayerId,
            sourceCardInstanceId: updatedRecurring.sourceCardInstanceId,
            sourceEffectId: updatedRecurring.sourceEffectId,
            actionType: updatedRecurring.effectType === "HEAL_OVER_TIME" ? "APPLY_HEALING_OVER_TIME" : "APPLY_DAMAGE_OVER_TIME",
            reason: "RECURRING_EFFECT_EXPIRED",
            cardInstanceId: stillOnField.card.instanceId,
            targetCardInstanceId: stillOnField.card.instanceId,
            status: updatedRecurring.effectType,
            statusLabel: updatedRecurring.label,
            ...timingBoardEventFields(state)
          } satisfies BoardEventPayload
        ]
      });
    }
  }
}

export function refreshRecurringRuntimeEffectsAtEndOfTurn(
  state: MatchState,
  endingPlayerId: string,
  addEvent?: AddEventFn
): void {
  for (const location of collectFieldCreatureLocations(state)) {
    let changed = false;

    for (const recurring of location.card.activeRecurringEffects ?? []) {
      if (!recurring.refreshAtEndOfSourceOwnerTurn || recurring.sourcePlayerId !== endingPlayerId) {
        continue;
      }

      const refreshAmount = Number.isFinite(Number(recurring.refreshAmount))
        ? Math.max(1, Math.trunc(Number(recurring.refreshAmount)))
        : 1;
      const before = recurring.remainingTicks;
      const afterUncapped = before + refreshAmount;
      const after = Number.isFinite(Number(recurring.maxRefreshCounter))
        ? Math.min(Math.trunc(Number(recurring.maxRefreshCounter)), afterUncapped)
        : afterUncapped;

      recurring.remainingTicks = after;
      changed = true;

      addEvent?.(state, "RECURRING_EFFECT_COUNTER_REFRESHED", endingPlayerId, {
        sourceCardInstanceId: recurring.sourceCardInstanceId,
        sourceCardName: recurring.sourceCardName,
        sourceEffectId: recurring.sourceEffectId,
        targetPlayerId: location.player.id,
        targetCreatureInstanceId: location.card.instanceId,
        targetCreatureName: location.definition.name,
        effectType: recurring.effectType,
        before,
        refreshAmount,
        after,
        maxRefreshCounter: recurring.maxRefreshCounter
      });
    }

    if (changed) {
      for (const recurring of location.card.activeRecurringEffects ?? []) {
        syncRecurringActiveEffectInstance(location.card, recurring);
      }
    }
  }
}


function isRegeneratingHealInstance(instance: ActiveEffectInstance): boolean {
  return instance.kind === "REGENERATING_HEAL" || instance.actionType === "APPLY_REGENERATING_HEAL";
}

function positiveInteger(value: unknown, fallback: number): number {
  const amount = Number(value ?? fallback);
  return Number.isFinite(amount) && amount > 0 ? Math.trunc(amount) : fallback;
}

export function refreshRegeneratingHealsAtEndOfTurn(
  state: MatchState,
  endingPlayerId: string,
  addEvent?: AddEventFn
): void {
  for (const location of collectFieldCreatureLocations(state)) {
    let changed = false;

    for (const instance of location.card.activeEffectInstances ?? []) {
      if (!isRegeneratingHealInstance(instance)) continue;
      if (!instance.refreshAtEndOfSourceOwnerTurn || instance.sourcePlayerId !== endingPlayerId) continue;

      const refreshAmount = positiveInteger(instance.refreshAmount, 1);
      const before = positiveInteger(instance.ticksRemaining, 0);
      const afterUncapped = before + refreshAmount;
      const after = Number.isFinite(Number(instance.maxRefreshCounter))
        ? Math.min(Math.trunc(Number(instance.maxRefreshCounter)), afterUncapped)
        : afterUncapped;

      instance.ticksRemaining = after;
      changed = true;

      addEvent?.(state, "REGENERATING_HEAL_COUNTER_REFRESHED", endingPlayerId, {
        sourceCardInstanceId: instance.sourceCardInstanceId,
        sourceCardName: instance.sourceCardName,
        sourceEffectId: instance.sourceEffectId,
        targetPlayerId: location.player.id,
        targetCreatureInstanceId: location.card.instanceId,
        targetCreatureName: location.definition.name,
        before,
        refreshAmount,
        after,
        maxRefreshCounter: instance.maxRefreshCounter
      });
    }

    if (changed) {
      location.card.activeEffectInstances = [...(location.card.activeEffectInstances ?? [])];
    }
  }
}

export function processRegeneratingHealsAtTurnStart(
  state: MatchState,
  addEvent?: AddEventFn
): void {
  if (state.turn.phase !== "DRAW") return;

  const due: Array<{
    instanceId: string;
    targetCardInstanceId: string;
    appliedSequenceNumber: number;
    fallbackOrder: number;
  }> = [];
  let fallbackOrder = 0;

  for (const location of collectFieldCreatureLocations(state)) {
    for (const instance of location.card.activeEffectInstances ?? []) {
      if (!isRegeneratingHealInstance(instance)) {
        fallbackOrder += 1;
        continue;
      }

      const tickPlayerId = instance.nextTickPlayerId ?? instance.sourcePlayerId;
      const currentTickPlayerTurnStartCount = state.turn.turnStartCountsByPlayer[tickPlayerId] ?? 0;
      const requiredTickTurnStartCount = instance.nextTickTurnStartCount ?? currentTickPlayerTurnStartCount;
      const alreadyTickedThisTurn = instance.lastTickTurnNumber === state.turn.turnNumber &&
        instance.lastTickTurnCycle === state.turn.turnCycleNumber;

      if (
        state.turn.activePlayerId !== tickPlayerId ||
        currentTickPlayerTurnStartCount < requiredTickTurnStartCount ||
        positiveInteger(instance.ticksRemaining, 0) <= 0 ||
        alreadyTickedThisTurn
      ) {
        fallbackOrder += 1;
        continue;
      }

      due.push({
        instanceId: instance.id,
        targetCardInstanceId: location.card.instanceId,
        appliedSequenceNumber: instance.appliedSequenceNumber ?? Number.MAX_SAFE_INTEGER,
        fallbackOrder
      });
      fallbackOrder += 1;
    }
  }

  due.sort((a, b) => a.appliedSequenceNumber - b.appliedSequenceNumber || a.fallbackOrder - b.fallbackOrder);

  for (const item of due) {
    const location = findFieldCreatureByInstanceId(state, item.targetCardInstanceId);
    if (!location) continue;

    const instance = (location.card.activeEffectInstances ?? []).find(effect => effect.id === item.instanceId);
    if (!instance || !isRegeneratingHealInstance(instance)) continue;

    const tickPlayerId = instance.nextTickPlayerId ?? instance.sourcePlayerId;
    const currentTickPlayerTurnStartCount = state.turn.turnStartCountsByPlayer[tickPlayerId] ?? 0;
    const requiredTickTurnStartCount = instance.nextTickTurnStartCount ?? currentTickPlayerTurnStartCount;
    const alreadyTickedThisTurn = instance.lastTickTurnNumber === state.turn.turnNumber &&
      instance.lastTickTurnCycle === state.turn.turnCycleNumber;

    if (
      state.turn.activePlayerId !== tickPlayerId ||
      currentTickPlayerTurnStartCount < requiredTickTurnStartCount ||
      positiveInteger(instance.ticksRemaining, 0) <= 0 ||
      alreadyTickedThisTurn
    ) {
      continue;
    }

    const amount = positiveInteger(instance.healAmount ?? instance.amount, 0);
    if (amount <= 0) continue;

    const option = targetOptionFromCreatureLocation(location);
    const result = healCreatureTarget(state, option, amount);
    const ticksRemainingAfterThis = positiveInteger(instance.ticksRemaining, 0) - 1;

    instance.ticksRemaining = ticksRemainingAfterThis;
    instance.lastTickTurnNumber = state.turn.turnNumber;
    instance.lastTickTurnCycle = state.turn.turnCycleNumber;
    instance.nextTickPlayerId = instance.sourcePlayerId;
    instance.nextTickTurnStartCount = (state.turn.turnStartCountsByPlayer[instance.sourcePlayerId] ?? 0) + 1;

    addEvent?.(state, "REGENERATING_HEAL_TURN_START_TICK_RESOLVED", instance.sourcePlayerId, {
      sourceCardInstanceId: instance.sourceCardInstanceId,
      sourceCardName: instance.sourceCardName,
      sourceEffectId: instance.sourceEffectId,
      phase: state.turn.phase,
      turnNumber: state.turn.turnNumber,
      turnCycleNumber: state.turn.turnCycleNumber,
      targetPlayerId: result.playerId,
      targetCreatureInstanceId: result.creature.instanceId,
      targetCreatureName: result.creatureName,
      healAmount: result.healAmount,
      requestedHealAmount: amount,
      remainingHp: result.remainingHp,
      ticksRemainingAfterThis,
      nextTickPlayerId: instance.nextTickPlayerId,
      nextTickTurnStartCount: instance.nextTickTurnStartCount,
      boardEvents: [
        {
          type: "RECURRING_EFFECT_TICKED",
          playerId: instance.sourcePlayerId,
          sourceCardInstanceId: instance.sourceCardInstanceId,
          sourceEffectId: instance.sourceEffectId,
          actionType: "APPLY_REGENERATING_HEAL",
          reason: "REGENERATING_HEAL_TICK",
          cardInstanceId: result.creature.instanceId,
          targetCardInstanceId: result.creature.instanceId,
          amount: result.healAmount,
          effectType: "REGENERATING_HEAL",
          status: "REGENERATING_HEAL",
          statusLabel: instance.label,
          ticksRemainingAfterThis,
          ...timingBoardEventFields(state)
        } satisfies BoardEventPayload,
        {
          type: "CARD_HEALED",
          playerId: instance.sourcePlayerId,
          sourceCardInstanceId: instance.sourceCardInstanceId,
          sourceEffectId: instance.sourceEffectId,
          actionType: "APPLY_REGENERATING_HEAL",
          reason: "REGENERATING_HEAL_TICK",
          cardInstanceId: result.creature.instanceId,
          targetCardInstanceId: result.creature.instanceId,
          amount: result.healAmount,
          healType: "REGENERATING_HEAL",
          ...timingBoardEventFields(state)
        } satisfies BoardEventPayload
      ]
    });

    if (instance.ticksRemaining <= 0) {
      // Keep the source-linked effect visible but empty. The end-of-turn refresh
      // can add a counter back while the source equip remains on the field.
      instance.debug = [
        ...(instance.debug ?? []),
        "No counters remain. This can refresh at end of the source owner's turn while the source remains equipped."
      ];
    }
  }
}

export function processBeginningOfTurnRuntimeEffects(
  state: MatchState,
  addEvent?: AddEventFn
): void {
  processRegeneratingHealsAtTurnStart(state, addEvent);
  processRecurringRuntimeEffectsForTiming(state, "BEGINNING_OF_TURN", addEvent);
}

export function processBeginningOfCombatRuntimeEffects(
  state: MatchState,
  addEvent?: AddEventFn
): void {
  processRecurringRuntimeEffectsForTiming(state, "BEGINNING_OF_COMBAT_PHASE", addEvent);
}

export function processEndOfCombatRuntimeEffects(
  state: MatchState,
  addEvent?: AddEventFn
): void {
  processRecurringRuntimeEffectsForTiming(state, "END_OF_COMBAT_PHASE", addEvent);
}
