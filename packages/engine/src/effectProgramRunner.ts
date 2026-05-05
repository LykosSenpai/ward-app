import { v4 as uuidv4 } from "uuid";
import type {
  ActiveEffectInstance,
  ActiveRecurringCreatureEffect,
  ActiveStatModifier,
  CardDefinition,
  CardInstance,
  EffectTargetKind,
  EffectTargetOption,
  MatchState,
  PendingEffectTargetPrompt,
  PlayerState,
  StatModifierKey,
  WardEffectProgramStep,
  WardEffectStatChange,
  WardEngineEffect
} from "@ward/shared";
import {
  applyDamageToCreatureTarget,
  discardSelectedCardToCemetery,
  healCreatureTarget,
  limitedSummonSelectedCreature,
  moveMagicSlotCardToCemetery,
  moveSelectedCardToHand
} from "./cardMovement.js";
import { calculateCemeteryCreatureHp } from "./cemetery.js";
import { addEvent, getCardDefinition, getPlayer } from "./engineRuntime.js";
import { moveFieldCreatureToCemetery } from "./fieldRemoval.js";
import {
  getNextRecurringEffectTickSchedule,
  getTurnCycleExpiration,
  normalizeRecurringTickTiming
} from "./effectTiming.js";
import { syncRecurringActiveEffectInstance } from "./activeEffectInstances.js";

type CreatureTarget = {
  player: PlayerState;
  card: CardInstance;
  definition: Extract<CardDefinition, { cardType: "CREATURE" }>;
  targetKind: "PRIMARY_CREATURE" | "LIMITED_SUMMON";
};

type ProgramPromptResolutionResult = {
  appliedSteps: string[];
  target?: CreatureTarget;
};

type SourceLocation = {
  player?: PlayerState;
  card: CardInstance;
  zone:
    | "CHAIN"
    | "HAND"
    | "DECK"
    | "CEMETERY"
    | "REMOVED_FROM_GAME"
    | "MAGIC_SLOT";
  remove: () => void;
};

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stepRecord(step: WardEffectProgramStep): WardEffectProgramStep & Record<string, unknown> {
  return step as WardEffectProgramStep & Record<string, unknown>;
}

function positiveInteger(value: unknown, fallback?: number): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.trunc(numeric);
}

function textFromValues(...values: unknown[]): string {
  return values
    .filter(value => value !== undefined && value !== null && value !== "")
    .map(value => typeof value === "string" ? value : JSON.stringify(value))
    .join(" ");
}

function firstPositiveNumberFromText(text: string): number | undefined {
  const match = text.match(/(\d+)/);
  const parsed = Number(match?.[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function firstPositiveNumberFromStep(effect: WardEngineEffect, step: WardEffectProgramStep): number | undefined {
  const anyStep = stepRecord(step);

  return positiveInteger(anyStep.amount) ??
    positiveInteger(anyStep.damageAmount) ??
    positiveInteger(anyStep.healAmount) ??
    positiveInteger(step.amount) ??
    positiveInteger(effect.params?.amount) ??
    positiveInteger(effect.params?.damageAmount) ??
    positiveInteger(effect.params?.healAmount) ??
    firstPositiveNumberFromText(textFromValues(
      step.valueText,
      step.summary,
      step.label,
      effect.value,
      effect.params?.valueText,
      effect.actionText
    ));
}

function effectForDuration(effect: WardEngineEffect, step: WardEffectProgramStep): WardEngineEffect {
  const duration = step.duration ?? effect.duration ?? effect.params?.duration;
  return duration ? { ...effect, duration } : effect;
}

export function effectHasExecutableProgram(effect: WardEngineEffect): boolean {
  return effect.program?.version === 1 &&
    Array.isArray(effect.program.steps) &&
    effect.program.steps.length > 0;
}

export function getProgramTargetStep(effect: WardEngineEffect): WardEffectProgramStep | undefined {
  if (!effectHasExecutableProgram(effect)) return undefined;
  return effect.program?.steps.find(step => normalize(step.op) === "TARGET.SELECT" && step.targetKind);
}

export function getProgramTargetQuery(effect: WardEngineEffect): {
  kind: EffectTargetKind;
  controllerScope?: "ANY_PLAYER" | "CONTROLLER" | "OPPONENT";
} | undefined {
  const step = getProgramTargetStep(effect);
  if (!step?.targetKind) return undefined;

  return {
    kind: step.targetKind,
    controllerScope: step.controllerScope ?? "ANY_PLAYER"
  };
}

function getCreatureFromOption(state: MatchState, option: EffectTargetOption): CreatureTarget {
  if (!option.cardInstanceId) {
    throw new Error("Selected program target did not include a card instance ID.");
  }

  for (const player of state.players) {
    const primary = player.field.primaryCreature;

    if (primary?.instanceId === option.cardInstanceId) {
      const definition = state.cardCatalog[primary.cardId];

      if (!definition || definition.cardType !== "CREATURE") {
        throw new Error("Selected primary target is not a creature.");
      }

      return {
        player,
        card: primary,
        definition,
        targetKind: "PRIMARY_CREATURE"
      };
    }

    const limited = player.field.limitedSummons.find(card => card.instanceId === option.cardInstanceId);

    if (limited) {
      const definition = state.cardCatalog[limited.cardId];

      if (!definition || definition.cardType !== "CREATURE") {
        throw new Error("Selected limited summon target is not a creature.");
      }

      return {
        player,
        card: limited,
        definition,
        targetKind: "LIMITED_SUMMON"
      };
    }
  }

  throw new Error("Selected program creature target was not found on the field.");
}

function findSourceLocationByInstanceId(state: MatchState, sourceCardInstanceId: string): SourceLocation | undefined {
  const chainIndex = state.chainZone.findIndex(card => card.instanceId === sourceCardInstanceId);

  if (chainIndex !== -1) {
    const card = state.chainZone[chainIndex];

    return {
      card,
      zone: "CHAIN",
      remove: () => {
        state.chainZone.splice(chainIndex, 1);
      }
    };
  }

  for (const player of state.players) {
    const zones: Array<{
      zone: SourceLocation["zone"];
      cards: CardInstance[];
    }> = [
      { zone: "HAND", cards: player.hand },
      { zone: "DECK", cards: player.deck },
      { zone: "CEMETERY", cards: player.cemetery },
      { zone: "REMOVED_FROM_GAME", cards: player.removedFromGame },
      { zone: "MAGIC_SLOT", cards: player.field.magicSlots }
    ];

    for (const zoneInfo of zones) {
      const index = zoneInfo.cards.findIndex(card => card.instanceId === sourceCardInstanceId);

      if (index === -1) {
        continue;
      }

      const card = zoneInfo.cards[index];

      return {
        player,
        card,
        zone: zoneInfo.zone,
        remove: () => {
          zoneInfo.cards.splice(index, 1);
        }
      };
    }
  }

  return undefined;
}

function parseDiceLimitFromStep(step: WardEffectProgramStep): number | undefined {
  const direct = Number(step.diceLimitValue);
  if (Number.isFinite(direct) && direct > 0) return Math.trunc(direct);

  const text = textFromValues(step.valueText, step.summary, step.label);
  const match = text.match(/(?:only|maximum|max|limit(?:ed)?(?: to)?)\s*(?:roll\s*)?(\d+)\s*hit\s*di(?:e|ce)|hit\s*di(?:e|ce).*?(?:only|maximum|max|limit(?:ed)?(?: to)?)\s*(\d+)/i);
  const parsed = Number(match?.[1] ?? match?.[2]);

  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function addDiceLimitInstance(args: {
  state: MatchState;
  prompt: PendingEffectTargetPrompt;
  effect: WardEngineEffect;
  step: WardEffectProgramStep;
  target: CreatureTarget;
}): ActiveEffectInstance {
  const hitDiceLimit = parseDiceLimitFromStep(args.step);

  if (!hitDiceLimit) {
    throw new Error("Program dice-limit step did not contain a supported hit dice limit.");
  }

  const durationEffect = effectForDuration(args.effect, args.step);
  const expiration = getTurnCycleExpiration({
    state: args.state,
    sourcePlayerId: args.prompt.controllerPlayerId,
    targetPlayerId: args.target.player.id,
    effect: durationEffect,
    fallbackDuration: 1
  });

  const turnCyclesTotal = Math.max(1, Number(durationEffect.duration?.amount ?? args.step.duration?.amount ?? 1));

  const activeInstance: ActiveEffectInstance = {
    id: uuidv4(),
    kind: "STATIC_MODIFIER",
    sourceEffectId: args.prompt.effectId,
    sourceCardInstanceId: args.prompt.sourceCardInstanceId,
    sourceCardName: args.prompt.sourceCardName,
    sourcePlayerId: args.prompt.controllerPlayerId,
    targetPlayerId: args.target.player.id,
    targetCardInstanceId: args.target.card.instanceId,
    targetCardName: args.target.definition.name,
    actionType: "APPLY_DICE_LIMIT",
    label: `Hit Roll limited to ${hitDiceLimit}D6`,
    amount: hitDiceLimit,
    rollKind: args.step.rollKind ?? "HIT_ROLL",
    diceLimitMode: args.step.diceLimitMode ?? "MAX",
    diceLimitValue: hitDiceLimit,
    durationType: "TARGET_PLAYER_TURN_STARTS",
    durationText: durationEffect.duration?.text ?? args.step.duration?.text,
    turnCyclesTotal,
    turnCyclesRemaining: turnCyclesTotal,
    expiresOnPlayerId: expiration.expiresOnPlayerId,
    expiresAtPlayerTurnStartCount: expiration.expiresAtPlayerTurnStartCount,
    appliedTurnNumber: args.state.turn.turnNumber,
    appliedTurnCycle: args.state.turn.turnCycleNumber,
    debug: [
      "Applied by Effect Program V2.",
      "Timed runtime modifier; source card may resolve independently."
    ]
  };

  args.target.card.activeEffectInstances ??= [];
  args.target.card.activeEffectInstances.push(activeInstance);

  return activeInstance;
}

function normalizeStatKey(rawStat: string): StatModifierKey | undefined {
  const stat = rawStat.trim().toUpperCase().replace(/[\s-]+/g, "_");

  if (stat === "AL" || stat === "ARMOR" || stat === "ARMOR_LEVEL") return "armorLevel";
  if (stat === "SPD" || stat === "SPEED") return "speed";
  if (stat === "ATTACK_DICE" || stat === "ATK_DICE" || stat === "ATK_DICE_ROLLS" || stat === "ATTACK_DICE_ROLLS") return "attackDice";
  if (stat === "MOD" || stat === "MODIFIER") return "modifier";

  return undefined;
}

function statDelta(change: WardEffectStatChange): number | undefined {
  const value = Number(change.value);
  if (!Number.isFinite(value)) return undefined;

  const op = change.operation.trim().toUpperCase();
  if (op === "ADD") return value;
  if (op === "SUBTRACT") return -value;

  return undefined;
}

function addStatModifiers(args: {
  state: MatchState;
  prompt: PendingEffectTargetPrompt;
  effect: WardEngineEffect;
  step: WardEffectProgramStep;
  target: CreatureTarget;
}): ActiveStatModifier[] {
  const changes = Array.isArray(args.step.statChanges) ? args.step.statChanges : [];
  const durationEffect = effectForDuration(args.effect, args.step);
  const expiration = getTurnCycleExpiration({
    state: args.state,
    sourcePlayerId: args.prompt.controllerPlayerId,
    targetPlayerId: args.target.player.id,
    effect: durationEffect,
    fallbackDuration: 1
  });

  const added: ActiveStatModifier[] = [];
  args.target.card.activeStatModifiers ??= [];

  for (const change of changes) {
    if (!isRecord(change)) continue;

    const typedChange: WardEffectStatChange = {
      stat: String(change.stat ?? ""),
      operation: String(change.operation ?? "ADD"),
      value: Number(change.value ?? 0),
      rounding: change.rounding === undefined || change.rounding === null ? undefined : String(change.rounding)
    };

    const stat = normalizeStatKey(typedChange.stat);
    const delta = statDelta(typedChange);
    if (!stat || delta === undefined) continue;

    const modifier: ActiveStatModifier = {
      id: uuidv4(),
      sourceEffectId: args.prompt.effectId,
      sourceCardInstanceId: args.prompt.sourceCardInstanceId,
      sourceCardName: args.prompt.sourceCardName,
      stat,
      delta,
      durationType: "TARGET_PLAYER_TURN_STARTS",
      appliedTurnNumber: args.state.turn.turnNumber,
      appliedTurnCycle: args.state.turn.turnCycleNumber,
      expiresOnPlayerId: expiration.expiresOnPlayerId,
      expiresAtPlayerTurnStartCount: expiration.expiresAtPlayerTurnStartCount
    };

    args.target.card.activeStatModifiers.push(modifier);
    added.push(modifier);
  }

  return added;
}

function applyDamageStep(args: {
  state: MatchState;
  prompt: PendingEffectTargetPrompt;
  effect: WardEngineEffect;
  step: WardEffectProgramStep;
  selectedOption: EffectTargetOption;
}) {
  const amount = firstPositiveNumberFromStep(args.effect, args.step);

  if (!amount) {
    throw new Error("Program damage step did not contain a supported damage amount.");
  }

  return applyDamageToCreatureTarget(args.state, args.selectedOption, amount);
}

function applyHealStep(args: {
  state: MatchState;
  prompt: PendingEffectTargetPrompt;
  effect: WardEngineEffect;
  step: WardEffectProgramStep;
  selectedOption: EffectTargetOption;
}) {
  const amount = firstPositiveNumberFromStep(args.effect, args.step);

  if (!amount) {
    throw new Error("Program heal step did not contain a supported heal amount.");
  }

  return healCreatureTarget(args.state, args.selectedOption, amount);
}

function registerRecurringStep(args: {
  state: MatchState;
  prompt: PendingEffectTargetPrompt;
  effect: WardEngineEffect;
  step: WardEffectProgramStep;
  target: CreatureTarget;
  effectType: ActiveRecurringCreatureEffect["effectType"];
}): ActiveRecurringCreatureEffect {
  const amount = firstPositiveNumberFromStep(args.effect, args.step);

  if (!amount) {
    throw new Error("Program recurring step did not contain a supported amount.");
  }

  const durationEffect = effectForDuration(args.effect, args.step);
  const totalTicks = Math.max(1, Number(durationEffect.duration?.amount ?? args.step.duration?.amount ?? 1));
  const anyStep = stepRecord(args.step);
  const tickTiming = normalizeRecurringTickTiming(
    typeof anyStep.tickTiming === "string"
      ? anyStep.tickTiming
      : typeof args.effect.params?.tickTiming === "string"
        ? args.effect.params.tickTiming
        : args.step.duration?.tickTiming
  );
  const stackRule = String(anyStep.stackRule ?? args.effect.params?.stackRule ?? args.step.duration?.stackRule ?? "DO_NOT_STACK");

  args.target.card.activeRecurringEffects ??= [];

  if (
    stackRule === "DO_NOT_STACK" &&
    args.target.card.activeRecurringEffects.some(item => item.effectType === args.effectType)
  ) {
    throw new Error(`${args.effectType} does not stack on this creature.`);
  }

  const expiration = getTurnCycleExpiration({
    state: args.state,
    sourcePlayerId: args.prompt.controllerPlayerId,
    targetPlayerId: args.target.player.id,
    effect: durationEffect,
    fallbackDuration: totalTicks
  });
  const nextTick = getNextRecurringEffectTickSchedule(args.state, args.prompt.controllerPlayerId, tickTiming);

  const recurring: ActiveRecurringCreatureEffect = {
    id: uuidv4(),
    sourceEffectId: args.prompt.effectId,
    sourceCardInstanceId: args.prompt.sourceCardInstanceId,
    sourceCardName: args.prompt.sourceCardName,
    sourcePlayerId: args.prompt.controllerPlayerId,
    effectType: args.effectType,
    amount,
    label: args.step.valueText ?? args.effect.value ?? args.effect.actionText ?? args.effect.params?.valueText ?? `${amount}`,
    tickTiming,
    stackRule,
    remainingTicks: totalTicks,
    nextTickPlayerId: nextTick.nextTickPlayerId,
    nextTickTurnStartCount: nextTick.nextTickTurnStartCount,
    durationType: "TARGET_PLAYER_TURN_STARTS",
    appliedTurnNumber: args.state.turn.turnNumber,
    appliedTurnCycle: args.state.turn.turnCycleNumber,
    appliedSequenceNumber: args.state.eventLog.length + 1,
    expiresOnPlayerId: expiration.expiresOnPlayerId,
    expiresAtPlayerTurnStartCount: expiration.expiresAtPlayerTurnStartCount
  };

  args.target.card.activeRecurringEffects.push(recurring);
  syncRecurringActiveEffectInstance(args.target.card, recurring);

  return recurring;
}

function moveSelectedCardByProgram(args: {
  state: MatchState;
  prompt: PendingEffectTargetPrompt;
  step: WardEffectProgramStep;
  selectedOption: EffectTargetOption;
}) {
  const anyStep = stepRecord(args.step);
  const destinationZone = normalize(anyStep.destinationZone ?? args.step.data?.destinationZone);

  if (destinationZone === "HAND") {
    return moveSelectedCardToHand(args.state, args.selectedOption);
  }

  if (destinationZone === "CEMETERY" || destinationZone === "OWNER_CEMETERY") {
    if (args.selectedOption.zone === "HAND") {
      return discardSelectedCardToCemetery(args.state, args.selectedOption);
    }

    if (args.selectedOption.zone === "MAGIC_SLOT" && args.selectedOption.cardInstanceId) {
      return moveMagicSlotCardToCemetery(
        args.state,
        args.selectedOption.playerId,
        args.selectedOption.cardInstanceId,
        addEvent,
        "EFFECT_PROGRAM_CARD_MOVE_TO_CEMETERY"
      );
    }

    if (
      (args.selectedOption.zone === "PRIMARY_CREATURE" || args.selectedOption.zone === "LIMITED_SUMMON") &&
      args.selectedOption.cardInstanceId
    ) {
      return moveFieldCreatureToCemetery(args.state, {
        fieldOwnerPlayerId: args.selectedOption.playerId,
        creatureInstanceId: args.selectedOption.cardInstanceId,
        removedFromZone: args.selectedOption.zone,
        causedByPlayerId: args.prompt.controllerPlayerId,
        reason: "EFFECT_PROGRAM_CARD_MOVE_TO_CEMETERY",
        requirePrimaryReplacement: args.selectedOption.zone === "PRIMARY_CREATURE",
        autoPromoteSingleLimitedSummon: true,
        addEvent
      });
    }

    if (args.selectedOption.zone === "CEMETERY") {
      return { alreadyInCemetery: true, selectedOption: args.selectedOption };
    }
  }

  throw new Error(`Program CARD.MOVE does not support destination ${destinationZone || "(missing)"}.`);
}

function limitedSummonByProgram(args: {
  state: MatchState;
  prompt: PendingEffectTargetPrompt;
  selectedOption: EffectTargetOption;
}) {
  return limitedSummonSelectedCreature(
    args.state,
    args.selectedOption,
    args.prompt.controllerPlayerId
  );
}

function attachSourceToTarget(args: {
  state: MatchState;
  prompt: PendingEffectTargetPrompt;
  target: CreatureTarget;
}): {
  sourceCard: CardInstance;
  sourceCardName: string;
  fieldOwnerPlayerId: string;
  attachedToCardInstanceId: string;
} {
  const sourceLocation = findSourceLocationByInstanceId(args.state, args.prompt.sourceCardInstanceId);

  if (!sourceLocation) {
    throw new Error("Program source card could not be found for attachment.");
  }

  const sourceDefinition = getCardDefinition(args.state, sourceLocation.card);

  if (sourceDefinition.cardType !== "MAGIC") {
    throw new Error("Program source attachment requires a Magic source card.");
  }

  const fieldOwner = getPlayer(args.state, args.prompt.controllerPlayerId);

  if (
    sourceLocation.zone !== "MAGIC_SLOT" &&
    fieldOwner.field.magicSlots.length >= 5
  ) {
    throw new Error(`${fieldOwner.displayName} already has 5 Magic Slot cards.`);
  }

  sourceLocation.remove();

  if (sourceLocation.zone === "CEMETERY" && sourceLocation.player) {
    sourceLocation.player.cemeteryCreatureHpTotal = calculateCemeteryCreatureHp(sourceLocation.player);
  }

  sourceLocation.card.zone = "MAGIC_SLOT";
  sourceLocation.card.controllerPlayerId = fieldOwner.id;
  sourceLocation.card.attachedToInstanceId = args.target.card.instanceId;

  if (!fieldOwner.field.magicSlots.some(card => card.instanceId === sourceLocation.card.instanceId)) {
    fieldOwner.field.magicSlots.push(sourceLocation.card);
  }

  return {
    sourceCard: sourceLocation.card,
    sourceCardName: sourceDefinition.name,
    fieldOwnerPlayerId: fieldOwner.id,
    attachedToCardInstanceId: args.target.card.instanceId
  };
}

function sendSourceToCemetery(args: {
  state: MatchState;
  prompt: PendingEffectTargetPrompt;
}): {
  sourceCard?: CardInstance;
  sourceCardName?: string;
  destinationPlayerId?: string;
  alreadyInCemetery?: boolean;
} {
  const sourceLocation = findSourceLocationByInstanceId(args.state, args.prompt.sourceCardInstanceId);

  if (!sourceLocation) {
    return {};
  }

  if (sourceLocation.zone === "CEMETERY") {
    return {
      sourceCard: sourceLocation.card,
      sourceCardName: getCardDefinition(args.state, sourceLocation.card).name,
      destinationPlayerId: sourceLocation.player?.id,
      alreadyInCemetery: true
    };
  }

  sourceLocation.remove();

  const sourceDefinition = getCardDefinition(args.state, sourceLocation.card);
  const ownerPlayer = getPlayer(args.state, sourceLocation.card.ownerPlayerId);

  sourceLocation.card.zone = "CEMETERY";
  sourceLocation.card.controllerPlayerId = ownerPlayer.id;
  sourceLocation.card.attachedToInstanceId = undefined;

  ownerPlayer.cemetery.push(sourceLocation.card);
  ownerPlayer.cemeteryCreatureHpTotal = calculateCemeteryCreatureHp(ownerPlayer);

  return {
    sourceCard: sourceLocation.card,
    sourceCardName: sourceDefinition.name,
    destinationPlayerId: ownerPlayer.id,
    alreadyInCemetery: false
  };
}

type ProgramConditionResult = {
  passed: boolean;
  failedCondition?: unknown;
  subjectName?: string;
  actualValues?: string[];
  expectedValues?: string[];
};

function normalizedMetadataToken(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toUpperCase().replace(/[\s-]+/g, "_")
    : "";
}

function normalizeExpectedValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => normalizedMetadataToken(item))
      .filter(Boolean);
  }

  const single = normalizedMetadataToken(value);
  return single ? [single] : [];
}

function getDefinitionByInstanceId(state: MatchState, cardInstanceId: string): CardDefinition | undefined {
  for (const player of state.players) {
    const zones = [
      player.hand,
      player.deck,
      player.cemetery,
      player.removedFromGame,
      player.field.magicSlots,
      player.field.limitedSummons,
      player.field.primaryCreature ? [player.field.primaryCreature] : [],
      state.chainZone
    ];

    for (const zone of zones) {
      const card = zone.find(item => item.instanceId === cardInstanceId);

      if (card) {
        return state.cardCatalog[card.cardId];
      }
    }
  }

  return undefined;
}

function getSelectedDefinition(state: MatchState, option: EffectTargetOption): CardDefinition | undefined {
  if (option.cardId) {
    return state.cardCatalog[option.cardId];
  }

  if (option.cardInstanceId) {
    return getDefinitionByInstanceId(state, option.cardInstanceId);
  }

  return undefined;
}

function getSourceDefinition(state: MatchState, prompt: PendingEffectTargetPrompt): CardDefinition | undefined {
  return state.cardCatalog[prompt.sourceCardId] ??
    getDefinitionByInstanceId(state, prompt.sourceCardInstanceId);
}

function getArtworkValues(definition: CardDefinition | undefined): string[] {
  if (!definition) return [];

  const values = new Set<string>();

  for (const tag of definition.artworkTags ?? []) {
    const normalized = normalizedMetadataToken(tag);
    if (normalized) values.add(normalized);
  }

  const freeText = definition.artworkEffect ?? "";
  const commonTokens = [
    "WATER",
    "FIRE",
    "ICE",
    "LIGHTNING",
    "EARTH",
    "FOREST",
    "WINGS",
    "WEAPON",
    "SWORD",
    "AXE",
    "BOW",
    "ARMOR",
    "FLYING",
    "UNDERWATER",
    "SKY",
    "CAVE",
    "CASTLE",
    "TREE",
    "MOON",
    "SUN",
    "DARKNESS",
    "LIGHT"
  ];

  for (const token of commonTokens) {
    if (freeText.toUpperCase().includes(token)) {
      values.add(token);
    }
  }

  return [...values];
}

function getCreatureTypeValues(definition: CardDefinition | undefined): string[] {
  if (!definition || definition.cardType !== "CREATURE") return [];

  const normalized = normalizedMetadataToken(definition.creatureType);
  return normalized ? [normalized] : [];
}

function getRarityValues(definition: CardDefinition | undefined): string[] {
  const rarity = normalizedMetadataToken(definition?.rarity);
  return rarity ? [rarity] : [];
}

function metadataValuesForCondition(definition: CardDefinition | undefined, condition: Record<string, unknown>): string[] {
  const trait = normalizedMetadataToken(
    condition.trait ??
    condition.type ??
    condition.kind ??
    condition.metadataType
  );

  if (trait === "ARTWORK_TAG" || trait === "ARTWORK" || trait === "ARTWORK_EFFECT") {
    return getArtworkValues(definition);
  }

  if (trait === "CREATURE_TYPE" || trait === "TYPE") {
    return getCreatureTypeValues(definition);
  }

  if (trait === "RARITY") {
    return getRarityValues(definition);
  }

  return [];
}

function expectedValuesForCondition(condition: Record<string, unknown>): string[] {
  return normalizeExpectedValues(
    condition.expected ??
    condition.value ??
    condition.values ??
    condition.artworkTag ??
    condition.creatureType ??
    condition.rarity
  );
}

function conditionSubjectDefinition(args: {
  state: MatchState;
  prompt: PendingEffectTargetPrompt;
  selectedOption: EffectTargetOption;
  condition: Record<string, unknown>;
}): CardDefinition | undefined {
  const subject = normalizedMetadataToken(
    args.condition.subjectRef ??
    args.condition.subject ??
    args.condition.cardRef
  );

  if (subject === "TARGET" || subject === "SELECTED" || subject === "SELECTED_CARD") {
    return getSelectedDefinition(args.state, args.selectedOption);
  }

  return getSourceDefinition(args.state, args.prompt);
}

function conditionPasses(actualValues: string[], expectedValues: string[], operator: string): boolean {
  const op = normalizedMetadataToken(operator || "HAS");
  const hasAny = expectedValues.some(expected => actualValues.includes(expected));

  if (op === "NOT_HAS" || op === "NOT_IS" || op === "NOT_IN") {
    return !hasAny;
  }

  return hasAny;
}

function evaluateProgramConditions(args: {
  state: MatchState;
  prompt: PendingEffectTargetPrompt;
  selectedOption: EffectTargetOption;
  effect: WardEngineEffect;
}): ProgramConditionResult {
  const conditions = args.effect.program?.conditions ?? [];

  for (const rawCondition of conditions) {
    if (!isRecord(rawCondition)) continue;

    const condition = rawCondition as Record<string, unknown>;

    const trait = normalizedMetadataToken(
      condition.trait ??
      condition.type ??
      condition.kind ??
      condition.metadataType
    );

    if (
      trait !== "ARTWORK_TAG" &&
      trait !== "ARTWORK" &&
      trait !== "ARTWORK_EFFECT" &&
      trait !== "CREATURE_TYPE" &&
      trait !== "TYPE" &&
      trait !== "RARITY"
    ) {
      continue;
    }

    const subject = conditionSubjectDefinition({
      state: args.state,
      prompt: args.prompt,
      selectedOption: args.selectedOption,
      condition
    });

    const actualValues = metadataValuesForCondition(subject, rawCondition);
    const expectedValues = expectedValuesForCondition(condition);

    if (expectedValues.length === 0) continue;

    const passed = conditionPasses(
      actualValues,
      expectedValues,
      String(condition.operator ?? "HAS")
    );

    if (!passed) {
      return {
        passed: false,
        failedCondition: condition,
        subjectName: subject?.name,
        actualValues,
        expectedValues
      };
    }
  }

  return { passed: true };
}

export function resolveEffectProgramTargetPrompt(args: {
  state: MatchState;
  prompt: PendingEffectTargetPrompt;
  selectedOption: EffectTargetOption;
  effect: WardEngineEffect;
}): ProgramPromptResolutionResult | undefined {
  if (!effectHasExecutableProgram(args.effect)) return undefined;

  const steps = args.effect.program?.steps ?? [];
  const appliedSteps: string[] = [];
  let target: CreatureTarget | undefined;

  
  const conditionResult = evaluateProgramConditions({
    state: args.state,
    prompt: args.prompt,
    selectedOption: args.selectedOption,
    effect: args.effect
  });

  if (!conditionResult.passed) {
    addEvent(args.state, "EFFECT_PROGRAM_CONDITION_NOT_MET", args.prompt.controllerPlayerId, {
      promptId: args.prompt.id,
      sourceCardName: args.prompt.sourceCardName,
      effectId: args.prompt.effectId,
      failedCondition: conditionResult.failedCondition,
      subjectName: conditionResult.subjectName,
      actualValues: conditionResult.actualValues,
      expectedValues: conditionResult.expectedValues
    });

    return {
      appliedSteps: ["CONDITION.NOT_MET"]
    };
  }
for (const step of steps) {
    const op = normalize(step.op);

    if (op === "TARGET.SELECT" || op === "DURATION.REGISTER") {
      continue;
    }

    if (
      op === "MODIFIER.APPLY_DICE_LIMIT" ||
      op === "MODIFIER.APPLY_STAT" ||
      op === "DAMAGE.APPLY" ||
      op === "HEAL.APPLY" ||
      op === "DOT.REGISTER" ||
      op === "HOT.REGISTER" ||
      op === "SOURCE.ATTACH_TO_TARGET"
    ) {
      target ??= getCreatureFromOption(args.state, args.selectedOption);
    }

    if (op === "MODIFIER.APPLY_DICE_LIMIT" && target) {
      const activeInstance = addDiceLimitInstance({
        state: args.state,
        prompt: args.prompt,
        effect: args.effect,
        step,
        target
      });

      appliedSteps.push(step.id);

      addEvent(args.state, "EFFECT_PROGRAM_DICE_LIMIT_APPLIED", args.prompt.controllerPlayerId, {
        promptId: args.prompt.id,
        sourceCardName: args.prompt.sourceCardName,
        effectId: args.prompt.effectId,
        stepId: step.id,
        targetPlayerId: target.player.id,
        targetCreatureInstanceId: target.card.instanceId,
        targetCreatureName: target.definition.name,
        rollKind: activeInstance.rollKind,
        diceLimitMode: activeInstance.diceLimitMode,
        diceLimitValue: activeInstance.diceLimitValue,
        expiresOnPlayerId: activeInstance.expiresOnPlayerId,
        expiresAtPlayerTurnStartCount: activeInstance.expiresAtPlayerTurnStartCount
      });

      continue;
    }

    if (op === "MODIFIER.APPLY_STAT" && target) {
      const modifiers = addStatModifiers({
        state: args.state,
        prompt: args.prompt,
        effect: args.effect,
        step,
        target
      });

      if (modifiers.length > 0) {
        appliedSteps.push(step.id);
      }

      addEvent(args.state, "EFFECT_PROGRAM_STAT_MODIFIERS_APPLIED", args.prompt.controllerPlayerId, {
        promptId: args.prompt.id,
        sourceCardName: args.prompt.sourceCardName,
        effectId: args.prompt.effectId,
        stepId: step.id,
        targetPlayerId: target.player.id,
        targetCreatureInstanceId: target.card.instanceId,
        targetCreatureName: target.definition.name,
        modifierCount: modifiers.length,
        modifiers: modifiers.map(modifier => ({
          stat: modifier.stat,
          delta: modifier.delta,
          expiresOnPlayerId: modifier.expiresOnPlayerId,
          expiresAtPlayerTurnStartCount: modifier.expiresAtPlayerTurnStartCount
        }))
      });

      continue;
    }

    if (op === "DAMAGE.APPLY") {
      const result = applyDamageStep({
        state: args.state,
        prompt: args.prompt,
        effect: args.effect,
        step,
        selectedOption: args.selectedOption
      });

      appliedSteps.push(step.id);

      addEvent(args.state, "EFFECT_PROGRAM_DAMAGE_APPLIED", args.prompt.controllerPlayerId, {
        promptId: args.prompt.id,
        sourceCardName: args.prompt.sourceCardName,
        effectId: args.prompt.effectId,
        stepId: step.id,
        targetPlayerId: result.playerId,
        targetCreatureInstanceId: result.creature.instanceId,
        targetCreatureName: result.creatureName,
        damageAmount: result.damageAmount,
        remainingHp: result.remainingHp,
        killed: result.killed
      });

      continue;
    }

    if (op === "HEAL.APPLY") {
      const result = applyHealStep({
        state: args.state,
        prompt: args.prompt,
        effect: args.effect,
        step,
        selectedOption: args.selectedOption
      });

      appliedSteps.push(step.id);

      addEvent(args.state, "EFFECT_PROGRAM_HEAL_APPLIED", args.prompt.controllerPlayerId, {
        promptId: args.prompt.id,
        sourceCardName: args.prompt.sourceCardName,
        effectId: args.prompt.effectId,
        stepId: step.id,
        targetPlayerId: result.playerId,
        targetCreatureInstanceId: result.creature.instanceId,
        targetCreatureName: result.creatureName,
        healAmount: result.healAmount,
        remainingHp: result.remainingHp,
        maxHp: result.maxHp
      });

      continue;
    }

    if ((op === "DOT.REGISTER" || op === "HOT.REGISTER") && target) {
      const recurring = registerRecurringStep({
        state: args.state,
        prompt: args.prompt,
        effect: args.effect,
        step,
        target,
        effectType: op === "HOT.REGISTER" ? "HEAL_OVER_TIME" : "DAMAGE_OVER_TIME"
      });

      appliedSteps.push(step.id);

      addEvent(args.state, "EFFECT_PROGRAM_RECURRING_REGISTERED", args.prompt.controllerPlayerId, {
        promptId: args.prompt.id,
        sourceCardName: args.prompt.sourceCardName,
        effectId: args.prompt.effectId,
        stepId: step.id,
        targetPlayerId: target.player.id,
        targetCreatureInstanceId: target.card.instanceId,
        targetCreatureName: target.definition.name,
        effectType: recurring.effectType,
        amount: recurring.amount,
        remainingTicks: recurring.remainingTicks,
        tickTiming: recurring.tickTiming,
        nextTickPlayerId: recurring.nextTickPlayerId,
        nextTickTurnStartCount: recurring.nextTickTurnStartCount
      });

      continue;
    }

    if (op === "SUMMON.LIMITED") {
      const result = limitedSummonByProgram({
        state: args.state,
        prompt: args.prompt,
        selectedOption: args.selectedOption
      });

      appliedSteps.push(step.id);

      addEvent(args.state, "EFFECT_PROGRAM_LIMITED_SUMMONED", args.prompt.controllerPlayerId, {
        promptId: args.prompt.id,
        sourceCardName: args.prompt.sourceCardName,
        effectId: args.prompt.effectId,
        stepId: step.id,
        summonedCardInstanceId: result.card.instanceId,
        summonedCardName: result.cardName,
        sourcePlayerId: result.sourcePlayerId,
        controllerPlayerId: result.controllerPlayerId,
        sourceZone: result.sourceZone,
        slotCount: result.slotCount
      });

      continue;
    }

    if (op === "CARD.MOVE") {
      const result = moveSelectedCardByProgram({
        state: args.state,
        prompt: args.prompt,
        step,
        selectedOption: args.selectedOption
      });

      appliedSteps.push(step.id);

      addEvent(args.state, "EFFECT_PROGRAM_CARD_MOVED", args.prompt.controllerPlayerId, {
        promptId: args.prompt.id,
        sourceCardName: args.prompt.sourceCardName,
        effectId: args.prompt.effectId,
        stepId: step.id,
        selectedOption: args.selectedOption,
        result
      });

      continue;
    }

    if (op === "SOURCE.ATTACH_TO_TARGET" && target) {
      const result = attachSourceToTarget({
        state: args.state,
        prompt: args.prompt,
        target
      });

      appliedSteps.push(step.id);

      addEvent(args.state, "EFFECT_PROGRAM_SOURCE_ATTACHED", args.prompt.controllerPlayerId, {
        promptId: args.prompt.id,
        sourceCardName: result.sourceCardName,
        sourceCardInstanceId: result.sourceCard.instanceId,
        effectId: args.prompt.effectId,
        stepId: step.id,
        fieldOwnerPlayerId: result.fieldOwnerPlayerId,
        attachedToCardInstanceId: result.attachedToCardInstanceId,
        attachedToCardName: target.definition.name
      });

      continue;
    }

    if (op === "SOURCE.SEND_TO_CEMETERY") {
      const result = sendSourceToCemetery({
        state: args.state,
        prompt: args.prompt
      });

      appliedSteps.push(step.id);

      addEvent(args.state, "EFFECT_PROGRAM_SOURCE_SENT_TO_CEMETERY", args.prompt.controllerPlayerId, {
        promptId: args.prompt.id,
        sourceCardName: result.sourceCardName ?? args.prompt.sourceCardName,
        sourceCardInstanceId: result.sourceCard?.instanceId ?? args.prompt.sourceCardInstanceId,
        effectId: args.prompt.effectId,
        stepId: step.id,
        destinationPlayerId: result.destinationPlayerId,
        alreadyInCemetery: result.alreadyInCemetery
      });
    }
  }

  if (appliedSteps.length === 0) return undefined;

  return { appliedSteps, target };
}

