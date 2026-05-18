import { v4 as uuidv4 } from "uuid";
import type {
  ActiveCreatureStatus,
  ActiveEffectInstance,
  ActiveRecurringCreatureEffect,
  BattleParticipantSnapshot,
  BoardEventType,
  BoardZoneKind,
  BoardZoneRef,
  CardDefinition,
  CardInstance,
  EffectTargetOption,
  MatchState,
  PendingEffectTargetPrompt,
  StatModifierDurationType,
  StatModifierKey,
  WardEffectStatChange,
  WardEngineEffect
} from "@ward/shared";
import {
  applyDamageToCreatureTarget,
  applyStatModifierToCreatureTarget,
  healCreatureTarget,
  discardSelectedCardToCemetery,
  limitedSummonSelectedCreature,
  limitedSummonSelectedCreatureAndEquipSource,
  summonPrimaryFromCemeteryAndEquipSource,
  moveAllMagicSlotCardsToCemetery,
  moveMagicSlotCardToCemetery,
  moveSelectedCardToHand
} from "./cardMovement.js";
import { addEvent, cloneState, getCardDefinition, getPlayer } from "./engineRuntime.js";
import { moveFieldCreatureToCemetery } from "./fieldRemoval.js";
import { calculateCemeteryCreatureHp } from "./cemetery.js";
import { rollD6WithDev } from "./devRolls.js";
import { sumDice } from "./dice.js";
import {
  getTargetOptionsForQuery,
  inferTargetQueryForEffect
} from "./targets.js";
import { syncRecurringActiveEffectInstance, syncStatusActiveEffectInstance } from "./activeEffectInstances.js";
import { getNextRecurringEffectTickSchedule } from "./effectTiming.js";
import { getEffectResolutionMode } from "./effectRegistry.js";
import { applyDestroyedMagicCountModifier, isAutomaticMagicEffectSupported, tryResolveAutomaticMagicEffect } from "./effectResolver.js";
import { resolveEffectProgramTargetPrompt } from "./effectProgramRunner.js";
import { getRuntimeBlockDurationData, getRuntimeBlockDurationText, getRuntimeBlockText, getRuntimeBlockValueText } from "./effectBlockRuntime.js";
import { returnLinkedSummonsForInvalidatedSource } from "./triggers.js";
import { getEffectiveCreatureStats } from "./effectiveStats.js";
import {
  collectBattleEffectSuggestions,
  getSuggestedSpeedModifiers
} from "./battleEffectAdapter.js";
export { effectNeedsSingleMagicSlotTargetPrompt } from "./effectRegistry.js";

const HOGGAN_CARD_ID = "gen3_009_hoggan";
const HOGGAN_BATTLE_INTERCEPT_ACTION = "HOGGAN_BATTLE_INTERCEPT";
const CABAL_RETALIATION_CHOICE_ACTION = "CABAL_RETALIATION_CHOICE";

export type ChainLinkEffectSource = {
  cardInstanceId: string;
  cardId: string;
  cardName: string;
  playerId: string;
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
  fromZoneRef?: BoardZoneRef;
  toZoneRef?: BoardZoneRef;
  targetCardInstanceId?: string;
  promptId?: string;
  amount?: number;
  damageType?: string;
  healType?: string;
  status?: string;
  statusLabel?: string;
  effectType?: string;
  stat?: string;
  delta?: number;
  modifierId?: string;
  rollKind?: string;
  values?: number[];
  diceLimitMode?: string;
  diceLimitValue?: number;
  metadata?: Record<string, unknown>;
};

function boardZoneRef(playerId: string | undefined, zone: BoardZoneKind): BoardZoneRef {
  return {
    ...(playerId ? { playerId } : {}),
    zone
  };
}

function promptBoardEventBase(prompt: PendingEffectTargetPrompt, reason?: string): Pick<
  BoardEventPayload,
  "playerId" | "sourceCardInstanceId" | "sourceCardId" | "sourceEffectId" | "actionType" | "promptId" | "reason"
> {
  return {
    playerId: prompt.controllerPlayerId,
    sourceCardInstanceId: prompt.sourceCardInstanceId,
    sourceCardId: prompt.sourceCardId,
    sourceEffectId: prompt.effectId,
    actionType: prompt.actionType,
    promptId: prompt.id,
    ...(reason ? { reason } : {})
  };
}

function promptOpenedBoardEvents(prompt: PendingEffectTargetPrompt): BoardEventPayload[] {
  const deckOptionCount = prompt.options.filter(option => option.zone === "DECK").length;
  const promptEvents: BoardEventPayload[] = [
    {
      type: "PROMPT_OPENED",
      ...promptBoardEventBase(prompt, "PROMPT_OPENED"),
      toZoneRef: deckOptionCount > 0
        ? boardZoneRef(prompt.controllerPlayerId, "DECK")
        : boardZoneRef(prompt.controllerPlayerId, "PROMPT"),
      metadata: {
        targetKind: prompt.targetKind,
        optionCount: prompt.options.length
      }
    }
  ];

  if (deckOptionCount > 0) {
    promptEvents.push(...prompt.options.flatMap(option => {
      if (option.zone !== "DECK" || !option.cardInstanceId) return [];
      return [{
        type: "CARD_REVEALED",
        ...promptBoardEventBase(prompt, "DECK_SEARCH_OPTION_REVEALED"),
        cardInstanceId: option.cardInstanceId,
        fromZoneRef: boardZoneRef(option.playerId, "DECK"),
        toZoneRef: boardZoneRef(prompt.controllerPlayerId, "PROMPT")
      } satisfies BoardEventPayload];
    }));
  }

  return promptEvents;
}

function promptResolvedBoardEvent(prompt: PendingEffectTargetPrompt, reason = "PROMPT_RESOLVED"): BoardEventPayload {
  return {
    type: "PROMPT_RESOLVED",
    ...promptBoardEventBase(prompt, reason)
  };
}

function cardDamagedBoardEvent(
  prompt: PendingEffectTargetPrompt,
  args: {
    cardInstanceId: string;
    amount: number;
    damageType?: string;
    reason?: string;
  }
): BoardEventPayload {
  return {
    type: "CARD_DAMAGED",
    ...promptBoardEventBase(prompt, args.reason),
    cardInstanceId: args.cardInstanceId,
    targetCardInstanceId: args.cardInstanceId,
    amount: args.amount,
    damageType: args.damageType ?? prompt.actionType
  };
}

function cardHealedBoardEvent(
  prompt: PendingEffectTargetPrompt,
  args: {
    cardInstanceId: string;
    amount: number;
    healType?: string;
    reason?: string;
  }
): BoardEventPayload {
  return {
    type: "CARD_HEALED",
    ...promptBoardEventBase(prompt, args.reason),
    cardInstanceId: args.cardInstanceId,
    targetCardInstanceId: args.cardInstanceId,
    amount: args.amount,
    healType: args.healType ?? prompt.actionType
  };
}

function diceRolledBoardEvent(
  prompt: PendingEffectTargetPrompt,
  args: {
    dice: number[];
    rollTotal: number;
    reason?: string;
  }
): BoardEventPayload {
  return {
    type: "DICE_ROLLED",
    ...promptBoardEventBase(prompt, args.reason ?? "EFFECT_ROLL_TABLE"),
    rollKind: "EFFECT_ROLL",
    values: args.dice,
    metadata: {
      rollTotal: args.rollTotal
    }
  };
}

function isCreatureTargetKind(kind: string): boolean {
  return kind === "PRIMARY_CREATURE" || kind === "LIMITED_SUMMON" || kind === "ANY_CREATURE";
}

type MagicImmunityScope = "ALL_MAGIC" | "OPPONENT_MAGIC";

function definitionMagicImmunityText(definition: CardDefinition | undefined): string {
  if (!definition) return "";

  const effectText = (definition.effects ?? [])
    .flatMap(effect => [
      effect.actionType,
      effect.effectGroup,
      effect.actionText,
      effect.target,
      effect.value,
      effect.params?.target,
      effect.params?.valueText,
      effect.notes
    ])
    .filter(Boolean)
    .join(" ");

  return `${definition.text ?? ""} ${effectText}`.toLowerCase();
}

function getMagicImmunityScope(definition: CardDefinition | undefined): MagicImmunityScope | undefined {
  const text = definitionMagicImmunityText(definition);
  if (!text.includes("magic")) return undefined;
  if (text.includes("normally unaffected") && text.includes("now affected")) return undefined;

  const hasMagicImmunity =
    text.includes("apply_magic_immunity") ||
    text.includes("unaffected") ||
    text.includes("not affected") ||
    text.includes("immune");

  if (!hasMagicImmunity) return undefined;

  return /opponents?'?\s+magic|opposing\s+magic|enemy\s+magic/.test(text)
    ? "OPPONENT_MAGIC"
    : "ALL_MAGIC";
}

function magicImmunityBlocksSource(
  scope: MagicImmunityScope | undefined,
  targetPlayerId: string,
  sourcePlayerId: string
): boolean {
  if (!scope) return false;
  if (scope === "ALL_MAGIC") return true;
  return sourcePlayerId !== targetPlayerId;
}

function targetHasMagicImmunityAgainstSource(
  state: MatchState,
  option: EffectTargetOption,
  link: ChainLinkEffectSource
): boolean {
  if (!option.cardInstanceId || !option.cardId) return false;

  const targetDefinition = state.cardCatalog[option.cardId];
  if (
    targetDefinition?.cardType === "CREATURE" &&
    magicImmunityBlocksSource(getMagicImmunityScope(targetDefinition), option.playerId, link.playerId)
  ) {
    return true;
  }

  return state.players.some(player =>
    player.field.magicSlots.some(magic => {
      if (magic.attachedToInstanceId !== option.cardInstanceId) return false;

      const magicDefinition = state.cardCatalog[magic.cardId];
      if (magicDefinition?.cardType !== "MAGIC") return false;

      const immunityText = definitionMagicImmunityText(magicDefinition);
      if (magic.instanceId === link.cardInstanceId && immunityText.includes("does not include this card")) {
        return false;
      }

      return magicImmunityBlocksSource(getMagicImmunityScope(magicDefinition), option.playerId, link.playerId);
    })
  );
}

function isSummonResponseWindowForTarget(state: MatchState, targetInstanceId: string): boolean {
  const window = state.setup.summonResponseWindow;
  if (!window) return false;

  return window.creatureInstanceId === targetInstanceId &&
    window.openedTurnNumber === state.turn.turnNumber &&
    window.openedTurnCycle === state.turn.turnCycleNumber &&
    window.openedPhase === state.turn.phase;
}

function filterMagicImmuneCreatureTargetOptions(
  state: MatchState,
  link: ChainLinkEffectSource,
  effect: WardEngineEffect,
  targetKind: string,
  options: EffectTargetOption[]
): EffectTargetOption[] {
  const sourceDefinition = state.cardCatalog[link.cardId];
  if (sourceDefinition?.cardType !== "MAGIC" || !isCreatureTargetKind(targetKind)) {
    return options;
  }

  const actionType = String(effect.actionType ?? "").trim().toUpperCase();
  const canUseSummonResponseWindow = actionType === "APPLY_CREATURE_EFFECT_NEGATION";

  return options.filter(option => {
    if (!option.cardInstanceId || !option.cardId) return true;

    if (!targetHasMagicImmunityAgainstSource(state, option, link)) return true;

    return canUseSummonResponseWindow &&
      isSummonResponseWindowForTarget(state, option.cardInstanceId);
  });
}

function getOpponentPlayerId(state: MatchState, playerId: string): string | undefined {
  return state.players.find(player => player.id !== playerId)?.id;
}

function requireSelectedCardOption(
  option: EffectTargetOption
): EffectTargetOption & { cardInstanceId: string } {
  if (!option.cardInstanceId) {
    throw new Error("Selected target option does not contain a card instance ID.");
  }

  return option as EffectTargetOption & { cardInstanceId: string };
}


function noTargetPromptShouldResolveWithoutManual(effect: WardEngineEffect): boolean {
  const actionType = String(effect.actionType ?? "").trim().toUpperCase();
  const text = effectText(effect).toLowerCase();

  return actionType === "APPLY_CREATURE_EFFECT_NEGATION" ||
    actionType === "SEARCH_DECK_TO_HAND" || (
    actionType === "MOVE_CARD" &&
    text.includes("deck") &&
    text.includes("hand")
  );
}

function effectText(effect: WardEngineEffect): string {
  return [
    getRuntimeBlockValueText(effect),
    getRuntimeBlockText(effect),
    effect.value,
    effect.params?.valueText,
    effect.actionText,
    effect.target,
    effect.params?.target
  ]
    .filter(Boolean)
    .join(" ");
}


function parseFirstNumber(effect: WardEngineEffect): number | undefined {
  const match = effectText(effect).match(/(\d+)/);

  if (!match) {
    return undefined;
  }

  const value = Number(match[1]);

  return Number.isFinite(value) && value > 0 ? value : undefined;
}



function parseHitDiceLimit(effect: WardEngineEffect): number | undefined {
  const text = effectText(effect);
  const match = text.match(/(?:only|maximum|max|limit(?:ed)?(?: to)?)\s*(?:roll\s*)?(\d+)\s*hit\s*di(?:e|ce)|hit\s*di(?:e|ce).*?(?:only|maximum|max|limit(?:ed)?(?: to)?)\s*(\d+)/i);
  const value = Number(match?.[1] ?? match?.[2] ?? parseFirstNumber(effect));

  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;
}

function durationAmount(effect: WardEngineEffect, fallback = 1): number {
  const blockDuration = getRuntimeBlockDurationData(effect);
  const value = Number(blockDuration?.amount ?? effect.duration?.amount ?? effect.params?.duration?.amount ?? fallback);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}


type RollTableEntry = {
  results?: unknown;
  damage?: unknown;
  heal?: unknown;
  actions?: unknown;
};

type RollTableOutcome = {
  damage?: number;
  heal?: number;
  actions?: unknown;
  entry?: RollTableEntry;
};

function positiveInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) return fallback;
  return Math.trunc(numeric);
}

function getRollDiceCount(effect: WardEngineEffect): number {
  return Math.min(20, positiveInteger(effect.params?.dice ?? effect.params?.diceCount, 1));
}

function getRollDieSize(effect: WardEngineEffect): number {
  return Math.min(100, positiveInteger(effect.params?.dieSize, 6));
}

function rollEffectDice(state: MatchState, prompt: PendingEffectTargetPrompt, effect: WardEngineEffect): number[] {
  const diceCount = getRollDiceCount(effect);
  const dieSize = getRollDieSize(effect);

  if (dieSize !== 6) {
    throw new Error("Only D6 roll-table effects are automated right now.");
  }

  return rollD6WithDev(state, {
    kind: "EFFECT_ROLL",
    count: diceCount,
    playerId: prompt.controllerPlayerId,
    label: `${prompt.sourceCardName} ${prompt.effectId} effect table roll`,
    addEvent,
    context: {
      promptId: prompt.id,
      sourceCardInstanceId: prompt.sourceCardInstanceId,
      effectId: prompt.effectId,
      actionType: prompt.actionType
    }
  });
}

function rollTableResultsMatch(rawResults: unknown, rollTotal: number): boolean {
  if (Array.isArray(rawResults)) {
    return rawResults.map(Number).some(value => Number.isInteger(value) && value === rollTotal);
  }

  if (typeof rawResults === "number") {
    return rawResults === rollTotal;
  }

  if (typeof rawResults === "string") {
    const range = rawResults.match(/(\d+)\s*[-â€“â€”]\s*(\d+)/);
    if (range) {
      const min = Number(range[1]);
      const max = Number(range[2]);
      return rollTotal >= Math.min(min, max) && rollTotal <= Math.max(min, max);
    }

    const exact = Number(rawResults);
    return Number.isInteger(exact) && exact === rollTotal;
  }

  return false;
}

function resolveRollTableOutcome(effect: WardEngineEffect, rollTotal: number): RollTableOutcome | undefined {
  const table = effect.params?.table;
  if (!Array.isArray(table)) return undefined;

  for (const rawEntry of table) {
    if (!rawEntry || typeof rawEntry !== "object") continue;
    const entry = rawEntry as RollTableEntry;
    if (!rollTableResultsMatch(entry.results, rollTotal)) continue;

    const damage = Number(entry.damage);
    const heal = Number(entry.heal);

    return {
      damage: Number.isFinite(damage) && damage > 0 ? Math.trunc(damage) : undefined,
      heal: Number.isFinite(heal) && heal > 0 ? Math.trunc(heal) : undefined,
      actions: entry.actions,
      entry
    };
  }

  return undefined;
}

function getRollTotalHealAmount(effect: WardEngineEffect, rollTotal: number): number | undefined {
  const healAmount = effect.params?.healAmount;
  if (healAmount === "ROLL_TOTAL") return rollTotal;

  const numeric = Number(healAmount);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : undefined;
}

function isRollTablePromptAction(actionType: string): boolean {
  return ["ROLL_DAMAGE_TABLE", "ROLL_TABLE", "ROLL_AND_DAMAGE", "ROLL_AND_HEAL", "HEAL_BY_ROLL"].includes(actionType);
}

function textForRuntimeEffect(effect: WardEngineEffect): string {
  return [
    effect.trigger,
    effect.actionType,
    effect.effectGroup,
    effect.actionText,
    effect.target,
    effect.value,
    effect.params?.target,
    effect.params?.valueText,
    effect.notes
  ].filter(Boolean).join(" ").toLowerCase();
}

function statusFromPromptEffect(effect: WardEngineEffect): { status: string; label: string; flags: ActiveCreatureStatus["flags"] } {
  const text = textForRuntimeEffect(effect);
  const flags: ActiveCreatureStatus["flags"] = {};
  let status = "STATUS";

  if (text.includes("frozen") || text.includes("freeze")) {
    status = "FROZEN";
    flags.canInflictAtkDamage = false;
    flags.canBeSacrificed = false;
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
    status = status === "STATUS" ? "DAMAGE_IMMUNITY" : status;
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

function getCreatureFromTargetOption(state: MatchState, option: EffectTargetOption) {
  const selected = requireSelectedCardOption(option);
  const player = getPlayer(state, selected.playerId);

  if (selected.targetKind === "PRIMARY_CREATURE") {
    const card = player.field.primaryCreature;
    if (!card || card.instanceId !== selected.cardInstanceId) throw new Error("Selected primary creature is no longer on the field.");
    const definition = getCardDefinition(state, card);
    if (definition.cardType !== "CREATURE") throw new Error("Selected primary card is not a creature.");
    return { player, card, definition, targetKind: "PRIMARY_CREATURE" as const };
  }

  if (selected.targetKind === "LIMITED_SUMMON") {
    const card = player.field.limitedSummons.find(item => item.instanceId === selected.cardInstanceId);
    if (!card) throw new Error("Selected limited summon is no longer on the field.");
    const definition = getCardDefinition(state, card);
    if (definition.cardType !== "CREATURE") throw new Error("Selected limited summon is not a creature.");
    return { player, card, definition, targetKind: "LIMITED_SUMMON" as const };
  }

  throw new Error(`Selected option is not a creature target: ${selected.targetKind}`);
}

function takeCardInstanceFromZones(
  state: MatchState,
  cardInstanceId: string
): { playerId: string; card: CardInstance } | undefined {
  const chainIndex = state.chainZone.findIndex(card => card.instanceId === cardInstanceId);
  if (chainIndex >= 0) {
    const [card] = state.chainZone.splice(chainIndex, 1);
    return { playerId: card.controllerPlayerId, card };
  }

  for (const player of state.players) {
    const zones = [
      player.hand,
      player.deck,
      player.cemetery,
      player.removedFromGame,
      player.field.magicSlots,
      player.field.limitedSummons
    ];

    for (const zone of zones) {
      const index = zone.findIndex(card => card.instanceId === cardInstanceId);
      if (index >= 0) {
        const [card] = zone.splice(index, 1);
        return { playerId: player.id, card };
      }
    }
  }

  return undefined;
}

function applyCreatureEffectNegationEquip(
  state: MatchState,
  prompt: PendingEffectTargetPrompt,
  selectedOption: EffectTargetOption,
  effect: WardEngineEffect
): void {
  const target = getCreatureFromTargetOption(state, selectedOption);
  const controller = getPlayer(state, prompt.controllerPlayerId);

  if (controller.field.magicSlots.length >= 5) {
    throw new Error(`${controller.displayName} already has 5 Magic Slot cards and cannot equip this card.`);
  }

  const source = takeCardInstanceFromZones(state, prompt.sourceCardInstanceId);
  if (!source) {
    throw new Error("The source Magic card for this creature effect negation was not found.");
  }

  const sourceDefinition = getCardDefinition(state, source.card);
  if (sourceDefinition.cardType !== "MAGIC") {
    throw new Error("The source card for this creature effect negation is not a Magic card.");
  }

  source.card.zone = "MAGIC_SLOT";
  source.card.controllerPlayerId = prompt.controllerPlayerId;
  source.card.attachedToInstanceId = target.card.instanceId;
  controller.field.magicSlots.push(source.card);

  target.card.activeEffectInstances ??= [];
  target.card.activeEffectInstances = target.card.activeEffectInstances.filter(instance => !(
    instance.sourceCardInstanceId === source.card.instanceId &&
    instance.sourceEffectId === effect.id
  ));
  target.card.activeEffectInstances.push({
    id: uuidv4(),
    kind: "STATIC_MODIFIER",
    sourceEffectId: effect.id,
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: sourceDefinition.name,
    sourcePlayerId: prompt.controllerPlayerId,
    targetPlayerId: target.player.id,
    targetCardInstanceId: target.card.instanceId,
    targetCardName: target.definition.name,
    actionType: "APPLY_CREATURE_EFFECT_NEGATION",
    label: effect.value ?? effect.actionText ?? "Effects negated",
    durationType: "WHILE_EQUIPPED",
    durationText: effect.duration?.text ?? effect.params?.duration?.text ?? "While equipped",
    sourceLinked: true,
    expiresWhenSourceLeaves: true,
    appliedTurnNumber: state.turn.turnNumber,
    appliedTurnCycle: state.turn.turnCycleNumber,
    debug: [
      "Created by Mind Sap after its target creature was chosen.",
      "Runtime suppression checks ignore this creature's effects while Mind Sap remains equipped."
    ]
  });

  const behaviorEffect = state.cardCatalog[prompt.sourceCardId]?.effects?.find(item =>
    String(item.actionType ?? "").trim().toUpperCase() === "SET_TEMPORARY_CARD_BEHAVIOR"
  );
  if (behaviorEffect) {
    source.card.activeEffectInstances ??= [];
    source.card.activeEffectInstances = source.card.activeEffectInstances.filter(instance => !(
      instance.sourceCardInstanceId === source.card.instanceId &&
      instance.sourceEffectId === behaviorEffect.id
    ));
    source.card.activeEffectInstances.push({
      id: uuidv4(),
      kind: "OTHER",
      sourceEffectId: behaviorEffect.id,
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: sourceDefinition.name,
      sourcePlayerId: prompt.controllerPlayerId,
      targetPlayerId: prompt.controllerPlayerId,
      targetCardInstanceId: source.card.instanceId,
      targetCardName: sourceDefinition.name,
      actionType: "SET_TEMPORARY_CARD_BEHAVIOR",
      label: behaviorEffect.value ?? behaviorEffect.actionText ?? "Infinite equip behavior",
      durationType: "WHILE_EQUIPPED",
      durationText: behaviorEffect.duration?.text ?? behaviorEffect.params?.duration?.text ?? "While equipped",
      sourceLinked: true,
      expiresWhenSourceLeaves: true,
      appliedTurnNumber: state.turn.turnNumber,
      appliedTurnCycle: state.turn.turnCycleNumber,
      debug: [
        "Mind Sap acts as an Infinite Equip Magic card while equipped."
      ]
    });

    addEvent(state, "MIND_SAP_TEMPORARY_INFINITE_EQUIP_BEHAVIOR_APPLIED", prompt.controllerPlayerId, {
      promptId: prompt.id,
      sourceCardName: prompt.sourceCardName,
      sourceCardInstanceId: source.card.instanceId,
      effectId: behaviorEffect.id,
      actionType: behaviorEffect.actionType,
      attachedToInstanceId: target.card.instanceId
    });
  }

  const targetHasLinkedSummonCleanup = target.player.field.limitedSummons.length > 0 && (
    target.player.field.limitedSummons.some(limited =>
      limited.anchorSourceInstanceId === target.card.instanceId
    ) ||
    target.definition.effects?.some(item =>
      String(item.actionType ?? "").trim().toUpperCase() === "RETURN_LINKED_SUMMON"
    ) ||
    target.card.cardId === "gen2_004_undead_king" ||
    String(target.definition.name ?? "").trim().toLowerCase() === "undead king"
  );
  if (targetHasLinkedSummonCleanup) {
    const returned = [];
    for (let index = target.player.field.limitedSummons.length - 1; index >= 0; index -= 1) {
      const limited = target.player.field.limitedSummons[index];
      const limitedDefinition = getCardDefinition(state, limited);
      target.player.field.limitedSummons.splice(index, 1);
      const owner = getPlayer(state, limited.ownerPlayerId);
      limited.zone = "CEMETERY";
      limited.currentHp = 0;
      limited.anchorSourceInstanceId = undefined;
      owner.cemetery.push(limited);
      owner.cemeteryCreatureHpTotal = calculateCemeteryCreatureHp(owner);
      returned.push({
        creatureInstanceId: limited.instanceId,
        creatureName: limitedDefinition.name,
        fieldOwnerPlayerId: target.player.id,
        ownerPlayerId: owner.id
      });
      addEvent(state, "LINKED_LIMITED_SUMMON_DESTROYED", target.player.id, {
        creatureInstanceId: limited.instanceId,
        creatureName: limitedDefinition.name,
        sourceCardInstanceId: target.card.instanceId,
        fieldOwnerPlayerId: target.player.id,
        ownerPlayerId: owner.id
      });
    }

    if (returned.length > 0) {
      addEvent(state, "SOURCE_LINKED_SUMMONS_RETURNED_TO_CEMETERY", prompt.controllerPlayerId, {
        sourceCardInstanceId: target.card.instanceId,
        sourceCardName: target.definition.name,
        reason: "SOURCE_EFFECT_NEGATED_BY_MIND_SAP",
        linkedDestroyedCreatures: returned
      });
    }
  }

  returnLinkedSummonsForInvalidatedSource(state, {
    sourceCardInstanceId: target.card.instanceId,
    sourceCardName: target.definition.name,
    causedByPlayerId: prompt.controllerPlayerId,
    reason: "SOURCE_EFFECT_NEGATED_BY_MIND_SAP",
    addEvent
  });

  addEvent(state, "AUTO_EFFECT_CREATURE_EFFECT_NEGATION_EQUIPPED", prompt.controllerPlayerId, {
    promptId: prompt.id,
    sourceCardName: prompt.sourceCardName,
    sourceCardInstanceId: source.card.instanceId,
    effectId: effect.id,
    actionType: effect.actionType,
    targetPlayerId: target.player.id,
    targetCreatureName: target.definition.name,
    targetCreatureInstanceId: target.card.instanceId,
    attachedToInstanceId: target.card.instanceId,
    note: "The selected creature's effects are negated while this Equip Magic remains attached."
  });
}

function applyStatusPromptEffect(
  state: MatchState,
  prompt: PendingEffectTargetPrompt,
  selectedOption: EffectTargetOption,
  effect: WardEngineEffect
) {
  const target = getCreatureFromTargetOption(state, selectedOption);
  const status = statusFromPromptEffect(effect);
  const duration = durationAmount(effect, 1);
  const sourceTurnStartCount = state.turn.turnStartCountsByPlayer[prompt.controllerPlayerId] ?? 0;

  target.card.activeStatuses ??= [];
  const activeStatus: ActiveCreatureStatus = {
    id: uuidv4(),
    sourceEffectId: prompt.effectId,
    sourceCardInstanceId: prompt.sourceCardInstanceId,
    sourceCardName: prompt.sourceCardName,
    sourcePlayerId: prompt.controllerPlayerId,
    status: status.status,
    label: status.label,
    flags: status.flags,
    durationType: "TARGET_PLAYER_TURN_STARTS",
    appliedTurnNumber: state.turn.turnNumber,
    appliedTurnCycle: state.turn.turnCycleNumber,
    expiresOnPlayerId: prompt.controllerPlayerId,
    expiresAtPlayerTurnStartCount: sourceTurnStartCount + duration
  };
  target.card.activeStatuses.push(activeStatus);
  syncStatusActiveEffectInstance(target.card, activeStatus);

  return { target, activeStatus };
}

function getRecurringTickTimingForEffectType(
  _effectType: ActiveRecurringCreatureEffect["effectType"]
): ActiveRecurringCreatureEffect["tickTiming"] {
  return "END_OF_COMBAT_PHASE";
}

function applyRecurringPromptEffect(
  state: MatchState,
  prompt: PendingEffectTargetPrompt,
  selectedOption: EffectTargetOption,
  effect: WardEngineEffect
) {
  const target = getCreatureFromTargetOption(state, selectedOption);
  const amount = parseFirstNumber(effect);
  if (!amount) throw new Error("This recurring effect does not contain an automatic numeric amount yet.");
  const effectType: ActiveRecurringCreatureEffect["effectType"] = effect.actionType.includes("HEAL") ? "HEAL_OVER_TIME" : "DAMAGE_OVER_TIME";
  const totalTicks = durationAmount(effect, 1);
  const tickTiming = getRecurringTickTimingForEffectType(effectType);
  const nextTick = getNextRecurringEffectTickSchedule(state, prompt.controllerPlayerId, tickTiming);
  const stackRule = String(effect.params?.stackRule ?? effect.duration?.stackRule ?? "DO_NOT_STACK");

  target.card.activeRecurringEffects ??= [];
  if (stackRule === "DO_NOT_STACK" && target.card.activeRecurringEffects.some(item => item.effectType === effectType)) {
    throw new Error(`${effectType} does not stack on this creature.`);
  }

  const recurring: ActiveRecurringCreatureEffect = {
    id: uuidv4(),
    sourceEffectId: prompt.effectId,
    sourceCardInstanceId: prompt.sourceCardInstanceId,
    sourceCardName: prompt.sourceCardName,
    sourcePlayerId: prompt.controllerPlayerId,
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
    expiresOnPlayerId: prompt.controllerPlayerId,
    expiresAtPlayerTurnStartCount: (state.turn.turnStartCountsByPlayer[prompt.controllerPlayerId] ?? 0) + totalTicks
  };

  target.card.activeRecurringEffects.push(recurring);
  syncRecurringActiveEffectInstance(target.card, recurring);

  addEvent(state, "RECURRING_EFFECT_APPLIED", prompt.controllerPlayerId, {
    sourceCardInstanceId: prompt.sourceCardInstanceId,
    sourceCardName: prompt.sourceCardName,
    sourceEffectId: prompt.effectId,
    targetPlayerId: target.player.id,
    targetCreatureInstanceId: target.card.instanceId,
    targetCreatureName: target.definition.name,
    effectType,
    amount,
    totalTicks,
    tickTiming,
    nextTickPlayerId: recurring.nextTickPlayerId,
    nextTickTurnStartCount: recurring.nextTickTurnStartCount
  });

  return { target, recurring };
}

function applyDiceLimitPromptEffect(
  state: MatchState,
  prompt: PendingEffectTargetPrompt,
  selectedOption: EffectTargetOption,
  effect: WardEngineEffect
) {
  const target = getCreatureFromTargetOption(state, selectedOption);
  const hitDiceLimit = parseHitDiceLimit(effect);

  if (!hitDiceLimit) {
    throw new Error("This dice limit effect does not contain a supported hit dice limit yet.");
  }

  const duration = getPromptDuration(effect);
  const turnCyclesTotal = duration.durationTargetPlayerTurnStarts ?? durationAmount(effect, 1);
  const expiresAtPlayerTurnStartCount = duration.durationType === "TARGET_PLAYER_TURN_STARTS"
    ? (state.turn.turnStartCountsByPlayer[prompt.controllerPlayerId] ?? 0) + turnCyclesTotal
    : undefined;

  const activeInstance: ActiveEffectInstance = {
    id: uuidv4(),
    kind: "STATIC_MODIFIER",
    sourceEffectId: prompt.effectId,
    sourceCardInstanceId: prompt.sourceCardInstanceId,
    sourceCardName: prompt.sourceCardName,
    sourcePlayerId: prompt.controllerPlayerId,
    targetPlayerId: target.player.id,
    targetCardInstanceId: target.card.instanceId,
    targetCardName: target.definition.name,
    actionType: "APPLY_DICE_LIMIT",
    label: `Hit Roll limited to ${hitDiceLimit}D6`,
    amount: hitDiceLimit,
    rollKind: "HIT_ROLL",
    diceLimitMode: "MAX",
    diceLimitValue: hitDiceLimit,
    durationType: duration.durationType,
    durationText: getRuntimeBlockDurationText(effect) ?? effect.duration?.text ?? effect.params?.duration?.text,
    turnCyclesTotal,
    turnCyclesRemaining: turnCyclesTotal,
    expiresOnPlayerId: duration.durationType === "TARGET_PLAYER_TURN_STARTS" ? prompt.controllerPlayerId : undefined,
    expiresAtPlayerTurnStartCount,
    appliedTurnNumber: state.turn.turnNumber,
    appliedTurnCycle: state.turn.turnCycleNumber,
    debug: [
      "Dice-limit effects are static battle modifiers, not DOT/HOT tick effects.",
      "The limit is applied when this creature rolls Hit Dice."
    ]
  };

  target.card.activeEffectInstances ??= [];
  target.card.activeEffectInstances.push(activeInstance);

  return { target, activeInstance };
}

function isLimitedSummonPromptAction(actionType: string): boolean {
  return [
    "SUMMON_LIMITED_CREATURE",
    "SUMMON_LIMITED_CREATURE_FROM_HAND",
    "SUMMON_LIMITED_CREATURE_AND_EQUIP",
    "FORCE_SUMMON_FROM_HAND",
    "LIMITED_SUMMON",
    "SUMMON_FROM_HAND",
    "SUMMON_FROM_DECK",
    "SUMMON_FROM_CEMETERY",
    "SUMMON_LIMITED_CREATURE_FROM_DECK",
    "SUMMON_LIMITED_CREATURE_FROM_CEMETERY"
  ].includes(actionType);
}

function snapshotBattleParticipant(
  state: MatchState,
  playerId: string,
  card: CardInstance,
  creatureKind: BattleParticipantSnapshot["creatureKind"]
): BattleParticipantSnapshot {
  const definition = getCardDefinition(state, card);
  if (definition.cardType !== "CREATURE") {
    throw new Error("Battle participant must be a Creature card.");
  }

  const stats = getEffectiveCreatureStats(state, card);

  return {
    playerId,
    creatureInstanceId: card.instanceId,
    creatureKind,
    creatureName: definition.name,
    armorLevel: stats.armorLevel,
    speed: stats.speed,
    attackDice: stats.attackDice,
    modifier: stats.modifier,
    currentHp: card.currentHp ?? card.baseHp ?? definition.hp,
    baseHp: card.baseHp ?? definition.hp
  };
}

function resolveHogganBattleInterceptPrompt(
  state: MatchState,
  prompt: PendingEffectTargetPrompt,
  selectedOption: EffectTargetOption,
  promptId: string
): MatchState {
  if (prompt.actionType !== HOGGAN_BATTLE_INTERCEPT_ACTION) return state;

  if (!state.pendingBattle) {
    throw new Error("Hoggan can only intercept an active pending battle.");
  }

  if (state.pendingBattle.status !== "AWAITING_SPEED_CHECK") {
    throw new Error("Hoggan must be played before the battle speed check.");
  }

  if (state.pendingBattle.defendingPlayerId !== prompt.controllerPlayerId) {
    throw new Error("Only the defending player can play Hoggan for this battle.");
  }

  if (selectedOption.id === "hoggan-battle-intercept-skip") {
    state.pendingEffectTargetPrompt = undefined;
    state.pendingBattle.updatedAt = new Date().toISOString();

    addEvent(state, "HOGGAN_BATTLE_INTERCEPT_DECLINED", prompt.controllerPlayerId, {
      promptId,
      battleSessionId: state.pendingBattle.id,
      sourceCardName: prompt.sourceCardName
    });

    return state;
  }

  if (selectedOption.zone !== "HAND" || selectedOption.cardId !== HOGGAN_CARD_ID || !selectedOption.cardInstanceId) {
    throw new Error("Select a Hoggan from your hand.");
  }

  const result = limitedSummonSelectedCreature(
    state,
    selectedOption,
    prompt.controllerPlayerId
  );

  const session = state.pendingBattle;
  const originalDefenderCreatureInstanceId = session.declaredDefender.creatureInstanceId;
  session.declaredDefender = snapshotBattleParticipant(
    state,
    prompt.controllerPlayerId,
    result.card,
    "LIMITED_SUMMON"
  );
  session.updatedAt = new Date().toISOString();
  session.message = "Hoggan intercepted the battle. Run the speed check with Hoggan as the defender.";
  session.suggestedEffects = collectBattleEffectSuggestions(state, session);
  session.speedModifiers = {
    ...session.speedModifiers,
    ...getSuggestedSpeedModifiers(session.suggestedEffects)
  };

  state.pendingEffectTargetPrompt = undefined;

  addEvent(state, "HOGGAN_BATTLE_INTERCEPT_RESOLVED", prompt.controllerPlayerId, {
    promptId,
    battleSessionId: session.id,
    sourceCardName: prompt.sourceCardName,
    summonedCardName: result.cardName,
    summonedCardInstanceId: result.card.instanceId,
    originalDefenderCreatureInstanceId,
    note: "Hoggan entered as a Limited Summon and replaced the defending primary creature for this battle."
  });

  return state;
}

function resolveCabalRetaliationChoicePrompt(
  state: MatchState,
  prompt: PendingEffectTargetPrompt,
  selectedOption: EffectTargetOption,
  promptId: string
): MatchState {
  if (prompt.actionType !== CABAL_RETALIATION_CHOICE_ACTION) return state;

  const session = state.pendingBattle;
  if (!session) {
    throw new Error("Cabal Warchief retaliation choice requires a pending battle.");
  }

  if (session.status !== "AWAITING_SPEED_CHECK") {
    throw new Error("Choose the Cabal Warchief retaliation timing before the speed check.");
  }

  if (session.defendingPlayerId !== prompt.controllerPlayerId) {
    throw new Error("Only the defending player can choose Cabal Warchief retaliation timing.");
  }

  const attackingPlayer = getPlayer(state, session.attackingPlayerId);
  const savedIds = attackingPlayer.turnFlags.retaliationSavedCreatureInstanceIds ?? [];

  if (selectedOption.id === "cabal-save-retaliation") {
    if (!savedIds.includes(prompt.sourceCardInstanceId)) {
      savedIds.push(prompt.sourceCardInstanceId);
    }
    attackingPlayer.turnFlags.retaliationSavedCreatureInstanceIds = savedIds;
    session.limitedSummonNoRetaliation = true;
    session.message = `Defender saved their return attack for ${prompt.sourceCardName}'s next battle. Run the one-way battle speed check.`;
  } else if (selectedOption.id === "cabal-retaliate-now") {
    attackingPlayer.turnFlags.retaliationSavedCreatureInstanceIds = savedIds.filter(
      id => id !== prompt.sourceCardInstanceId
    );
    session.limitedSummonNoRetaliation = false;
    session.message = `Defender chose to return attack in this ${prompt.sourceCardName} battle. Run the speed check.`;
  } else {
    throw new Error("Select a Cabal Warchief retaliation option.");
  }

  session.updatedAt = new Date().toISOString();
  state.pendingEffectTargetPrompt = undefined;

  addEvent(state, "CABAL_RETALIATION_CHOICE_RESOLVED", prompt.controllerPlayerId, {
    promptId,
    battleSessionId: session.id,
    sourceCardInstanceId: prompt.sourceCardInstanceId,
    sourceCardName: prompt.sourceCardName,
    choice: selectedOption.id,
    savedForLater: selectedOption.id === "cabal-save-retaliation",
    note: "Extra-battle return attack choice resolved."
  });

  return state;
}

function isLimitedSummonAndEquipPromptAction(actionType: string): boolean {
  return [
    "SUMMON_LIMITED_CREATURE_AND_EQUIP"
  ].includes(actionType);
}

function normalizeStatKey(rawStat: string): StatModifierKey | undefined {
  const stat = rawStat.trim().toUpperCase();

  if (stat === "AL" || stat === "ARMOR" || stat === "ARMOR_LEVEL") {
    return "armorLevel";
  }

  if (stat === "SPD" || stat === "SPEED") {
    return "speed";
  }

  if (
    stat === "ATTACK_DICE" ||
    stat === "ATK_DICE" ||
    stat === "ATK_DICE_ROLLS" ||
    stat === "ATTACK_DICE_ROLLS"
  ) {
    return "attackDice";
  }

  if (stat === "MOD" || stat === "MODIFIER") {
    return "modifier";
  }

  return undefined;
}

function getDeltaFromStatChange(change: WardEffectStatChange): number | undefined {
  if (!Number.isFinite(change.value)) {
    return undefined;
  }

  const operation = change.operation.trim().toUpperCase();

  if (operation === "ADD") {
    return Number(change.value);
  }

  if (operation === "SUBTRACT") {
    return -Number(change.value);
  }

  return undefined;
}

function getPromptDuration(effect: WardEngineEffect): {
  durationType: StatModifierDurationType;
  durationTargetPlayerTurnStarts?: number;
} {
  const blockDuration = getRuntimeBlockDurationData(effect);
  const explicitDuration = blockDuration ?? effect.duration;
  const fallbackDuration = effect.params?.duration;
  const duration = explicitDuration ?? fallbackDuration;
  const durationText = [
    blockDuration?.text,
    blockDuration?.type,
    getRuntimeBlockDurationText(effect),
    explicitDuration?.text,
    explicitDuration?.type,
    fallbackDuration?.text,
    fallbackDuration?.type,
    effect.actionText,
    effect.value,
    effect.params?.valueText
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const explicitTurnCycles = explicitDuration?.type === "TURN_CYCLES" || /\bturn cycles?\b/.test(durationText);
  if (explicitTurnCycles) {
    const textMatch = durationText.match(/(?:next\s+)?(\d+)\s*turn cycles?/i);
    const amount = Number(explicitDuration?.amount ?? textMatch?.[1] ?? fallbackDuration?.amount ?? 1);
    return {
      durationType: "TARGET_PLAYER_TURN_STARTS",
      durationTargetPlayerTurnStarts: Math.max(1, Number.isFinite(amount) ? Math.trunc(amount) : 1)
    };
  }

  if (duration?.type === "WHILE_EQUIPPED") {
    return { durationType: "PERMANENT_UNTIL_SOURCE_REMOVED" };
  }

  return {
    durationType: "TARGET_PLAYER_TURN_STARTS",
    durationTargetPlayerTurnStarts: Math.max(1, Number(duration?.amount ?? 1))
  };
}


export function createEffectTargetPromptFromChainLink(
  state: MatchState,
  link: ChainLinkEffectSource,
  effect: WardEngineEffect,
  remainingEffectIds: string[] = []
): PendingEffectTargetPrompt {
  const targetQuery = inferTargetQueryForEffect(effect);

  if (!targetQuery) {
    throw new Error(`Effect ${effect.actionType} does not have a supported target prompt yet.`);
  }

  const options = filterMagicImmuneCreatureTargetOptions(
    state,
    link,
    effect,
    targetQuery.kind,
    getTargetOptionsForQuery(state, link.playerId, targetQuery)
  );

  return {
    id: uuidv4(),

    sourceCardInstanceId: link.cardInstanceId,
    sourceCardId: link.cardId,
    sourceCardName: link.cardName,

    controllerPlayerId: link.playerId,

    effectId: effect.id,
    actionType: effect.actionType,
    effectGroup: effect.effectGroup,
    actionText: effect.actionText,
    effectValue: effect.value,
    remainingEffectIds,

    promptText:
      effect.actionText ??
      effect.value ??
      "Choose a target for this effect.",

    targetKind: targetQuery.kind,
    options
  };
}



function moveSelectedTargetToCemetery(
  state: MatchState,
  option: EffectTargetOption,
  reason: string,
  destinationOwnerPlayerId?: string
): {
  sourcePlayerId: string;
  destinationPlayerId: string;
  cardName: string;
  cardInstanceId: string;
  sourceZone: EffectTargetOption["zone"];
} {
  const selected = requireSelectedCardOption(option);

  if (selected.targetKind === "MAGIC_SLOT_CARD") {
    const result = moveMagicSlotCardToCemetery(state, selected.playerId, selected.cardInstanceId, addEvent, reason);
    return {
      sourcePlayerId: result.fieldOwnerPlayerId,
      destinationPlayerId: result.cardOwnerPlayerId,
      cardName: result.destroyedCardName,
      cardInstanceId: result.magicCard.instanceId,
      sourceZone: "MAGIC_SLOT"
    };
  }

  if (selected.targetKind === "PRIMARY_CREATURE" || selected.targetKind === "LIMITED_SUMMON") {
    const sourcePlayer = getPlayer(state, selected.playerId);
    const card = selected.targetKind === "PRIMARY_CREATURE"
      ? sourcePlayer.field.primaryCreature
      : sourcePlayer.field.limitedSummons.find(item => item.instanceId === selected.cardInstanceId);

    if (!card || card.instanceId !== selected.cardInstanceId) {
      throw new Error("Selected creature is no longer on the field.");
    }

    const definition = getCardDefinition(state, card);
    moveFieldCreatureToCemetery(state, {
      fieldOwnerPlayerId: selected.playerId,
      creatureInstanceId: selected.cardInstanceId,
      removedFromZone: selected.targetKind,
      causedByPlayerId: selected.playerId,
      reason,
      requirePrimaryReplacement: selected.targetKind === "PRIMARY_CREATURE",
      autoPromoteSingleLimitedSummon: true,
      addEvent
    });

    return {
      sourcePlayerId: selected.playerId,
      destinationPlayerId: card.ownerPlayerId,
      cardName: definition.name,
      cardInstanceId: card.instanceId,
      sourceZone: selected.targetKind
    };
  }

  if (selected.zone === "HAND") {
    const result = discardSelectedCardToCemetery(state, selected, destinationOwnerPlayerId);
    return {
      sourcePlayerId: result.sourcePlayerId,
      destinationPlayerId: result.destinationPlayerId,
      cardName: result.cardName,
      cardInstanceId: result.card.instanceId,
      sourceZone: result.sourceZone
    };
  }

  if (selected.zone === "DECK" || selected.zone === "REMOVED_FROM_GAME") {
    const sourcePlayer = getPlayer(state, selected.playerId);
    const sourceCards = selected.zone === "DECK" ? sourcePlayer.deck : sourcePlayer.removedFromGame;
    const sourceIndex = sourceCards.findIndex(card => card.instanceId === selected.cardInstanceId);
    if (sourceIndex === -1) throw new Error("Selected card is no longer in the expected source zone.");

    const [card] = sourceCards.splice(sourceIndex, 1);
    const definition = getCardDefinition(state, card);
    const destinationPlayer = getPlayer(state, destinationOwnerPlayerId ?? card.ownerPlayerId);
    card.zone = "CEMETERY";
    card.controllerPlayerId = destinationPlayer.id;
    if (definition.cardType === "CREATURE") card.currentHp = 0;
    destinationPlayer.cemetery.push(card);
    destinationPlayer.cemeteryCreatureHpTotal = calculateCemeteryCreatureHp(destinationPlayer);

    return {
      sourcePlayerId: sourcePlayer.id,
      destinationPlayerId: destinationPlayer.id,
      cardName: definition.name,
      cardInstanceId: card.instanceId,
      sourceZone: selected.zone
    };
  }

  if (selected.zone === "CEMETERY") {
    const player = getPlayer(state, selected.playerId);
    const card = player.cemetery.find(item => item.instanceId === selected.cardInstanceId);
    if (!card) throw new Error("Selected card is no longer in the cemetery.");
    return {
      sourcePlayerId: player.id,
      destinationPlayerId: player.id,
      cardName: getCardDefinition(state, card).name,
      cardInstanceId: card.instanceId,
      sourceZone: "CEMETERY"
    };
  }

  throw new Error(`Cannot send selected target from ${selected.zone} to cemetery.`);
}

function clearCurrentPromptAndQueueNext(
  state: MatchState,
  prompt: PendingEffectTargetPrompt
): void {
  state.pendingEffectTargetPrompt = undefined;

  const remainingEffectIds = prompt.remainingEffectIds ?? [];
  if (remainingEffectIds.length === 0) {
    return;
  }

  const sourceDefinition = state.cardCatalog[prompt.sourceCardId];
  const sourceEffects = sourceDefinition?.effects ?? [];
  const sourceLink: ChainLinkEffectSource = {
    cardInstanceId: prompt.sourceCardInstanceId,
    cardId: prompt.sourceCardId,
    cardName: prompt.sourceCardName,
    playerId: prompt.controllerPlayerId
  };

  for (let index = 0; index < remainingEffectIds.length; index += 1) {
    const effectId = remainingEffectIds[index];
    const effect = sourceEffects.find(item => item.id === effectId);

    if (!effect) {
      continue;
    }

    const mode = getEffectResolutionMode(effect);

    if (isAutomaticMagicEffectSupported(effect)) {
      const resolved = tryResolveAutomaticMagicEffect(state, {
        effect,
        controllerPlayerId: prompt.controllerPlayerId,
        sourceCardName: prompt.sourceCardName,
        sourceCardInstanceId: prompt.sourceCardInstanceId,
        addEvent
      });

      if (resolved) {
        continue;
      }
    }

    if (mode !== "TARGET_PROMPT" && mode !== "CARD_SELECTION_PROMPT") {
      state.manualEffectQueue.push({
        id: uuidv4(),
        sourceCardInstanceId: prompt.sourceCardInstanceId,
        sourceCardId: prompt.sourceCardId,
        sourceCardName: prompt.sourceCardName,
        magicType: sourceDefinition?.cardType === "MAGIC" ? sourceDefinition.magicType : "STANDARD",
        magicSubType: sourceDefinition?.cardType === "MAGIC" ? sourceDefinition.magicSubType : "NONE",
        effectId: effect.id,
        actionType: effect.actionType,
        effectGroup: effect.effectGroup,
        actionText: effect.actionText,
        effectValue: effect.value,
        durationText: effect.duration?.text,
        controllerPlayerId: prompt.controllerPlayerId,
        text: effect.actionText ?? effect.value ?? sourceDefinition?.text ?? "",
        completed: false
      });

      addEvent(state, "MANUAL_MAGIC_EFFECT_QUEUED", prompt.controllerPlayerId, {
        sourceCardName: prompt.sourceCardName,
        effectId: effect.id,
        actionType: effect.actionType,
        reason: "This remaining effect from a multi-effect card is not target-prompt automated yet."
      });

      continue;
    }

    const nextPrompt = createEffectTargetPromptFromChainLink(
      state,
      sourceLink,
      effect,
      remainingEffectIds.slice(index + 1)
    );

    if (nextPrompt.options.length === 0) {
      if (noTargetPromptShouldResolveWithoutManual(effect)) {
        addEvent(state, "AUTO_EFFECT_NO_VALID_TARGETS", prompt.controllerPlayerId, {
          sourceCardName: prompt.sourceCardName,
          effectId: effect.id,
          actionType: effect.actionType,
          reason: "No legal cards matched this deck/search effect. The effect resolves without opening manual fallback.",
          boardEvents: [
            {
              type: "PROMPT_RESOLVED",
              playerId: prompt.controllerPlayerId,
              sourceCardInstanceId: prompt.sourceCardInstanceId,
              sourceCardId: prompt.sourceCardId,
              sourceEffectId: effect.id,
              actionType: effect.actionType,
              reason: "NO_VALID_TARGETS"
            } satisfies BoardEventPayload
          ]
        });

        continue;
      }

      state.manualEffectQueue.push({
        id: uuidv4(),
        sourceCardInstanceId: prompt.sourceCardInstanceId,
        sourceCardId: prompt.sourceCardId,
        sourceCardName: prompt.sourceCardName,
        magicType: sourceDefinition?.cardType === "MAGIC" ? sourceDefinition.magicType : "STANDARD",
        magicSubType: sourceDefinition?.cardType === "MAGIC" ? sourceDefinition.magicSubType : "NONE",
        effectId: effect.id,
        actionType: effect.actionType,
        effectGroup: effect.effectGroup,
        actionText: effect.actionText,
        effectValue: effect.value,
        durationText: effect.duration?.text,
        controllerPlayerId: prompt.controllerPlayerId,
        text: effect.actionText ?? effect.value ?? sourceDefinition?.text ?? "",
        completed: false
      });

      addEvent(state, "MANUAL_MAGIC_EFFECT_QUEUED", prompt.controllerPlayerId, {
        sourceCardName: prompt.sourceCardName,
        effectId: effect.id,
        actionType: effect.actionType,
        reason: "No legal targets were available for this remaining multi-effect prompt."
      });

      continue;
    }

    state.pendingEffectTargetPrompt = nextPrompt;

    addEvent(state, "EFFECT_TARGET_PROMPT_CREATED", prompt.controllerPlayerId, {
      sourceCardName: prompt.sourceCardName,
      effectId: effect.id,
      actionType: effect.actionType,
      targetKind: nextPrompt.targetKind,
      optionCount: nextPrompt.options.length,
      boardEvents: promptOpenedBoardEvents(nextPrompt),
      note: "Next effect from the same multi-effect card."
    });

    return;
  }
}

export function resolvePendingEffectTargetPrompt(
  state: MatchState,
  promptId: string,
  selectedOptionId: string
): MatchState {
  if (state.pendingPrompt) {
    throw new Error("Resolve the pending prompt before selecting an effect target.");
  }

  if (state.pendingChain) {
    throw new Error("Resolve the pending Magic Chain before selecting an effect target.");
  }

  if (!state.pendingEffectTargetPrompt) {
    throw new Error("There is no pending effect target prompt.");
  }

  if (state.pendingEffectTargetPrompt.id !== promptId) {
    throw new Error("The selected target prompt is no longer active.");
  }

  const nextState = cloneState(state);
  const prompt = nextState.pendingEffectTargetPrompt;

  if (!prompt) {
    throw new Error("Target prompt was not found after cloning state.");
  }

  const selectedOption = prompt.options.find(
    option => option.id === selectedOptionId
  );

  if (!selectedOption) {
    throw new Error("Selected target option was not found.");
  }

  if (prompt.actionType === HOGGAN_BATTLE_INTERCEPT_ACTION) {
    return resolveHogganBattleInterceptPrompt(nextState, prompt, selectedOption, promptId);
  }

  if (prompt.actionType === CABAL_RETALIATION_CHOICE_ACTION) {
    return resolveCabalRetaliationChoicePrompt(nextState, prompt, selectedOption, promptId);
  }

  const sourceDefinition = nextState.cardCatalog[prompt.sourceCardId];

  if (prompt.actionType === "PAY_SILENCE_FROM_THE_GRAVE_PRE_CHAIN_COST") {
    const selectedCardOption = requireSelectedCardOption(selectedOption);

    if (selectedCardOption.cardInstanceId === prompt.sourceCardInstanceId) {
      throw new Error("Silence From The Grave cannot discard itself for its own play cost.");
    }

    const result = discardSelectedCardToCemetery(nextState, selectedCardOption);
    const controller = getPlayer(nextState, prompt.controllerPlayerId);
    const sourceHandIndex = controller.hand.findIndex(card => card.instanceId === prompt.sourceCardInstanceId);

    if (sourceHandIndex === -1) {
      throw new Error("Silence From The Grave is no longer in hand after paying its pre-chain cost.");
    }

    const [sourceCard] = controller.hand.splice(sourceHandIndex, 1);
    const chainSourceDefinition = getCardDefinition(nextState, sourceCard);

    if (chainSourceDefinition.cardType !== "MAGIC") {
      throw new Error("Silence From The Grave source card is not a Magic card.");
    }

    sourceCard.zone = "CHAIN";
    nextState.chainZone.push(sourceCard);
    nextState.pendingEffectTargetPrompt = undefined;

    const chainLink = {
      id: uuidv4(),
      playerId: prompt.controllerPlayerId,
      cardInstanceId: sourceCard.instanceId,
      cardId: sourceCard.cardId,
      cardName: chainSourceDefinition.name,
      magicType: chainSourceDefinition.magicType,
      magicSubType: chainSourceDefinition.magicSubType,
      text: chainSourceDefinition.text ?? "",
      isLightningResponse: false,
      status: "PENDING" as const
    };

    const pendingChain = {
      id: uuidv4(),
      startedByPlayerId: prompt.controllerPlayerId,
      links: [chainLink],
      respondedPlayerIds: [],
      priorityPlayerId: getOpponentPlayerId(nextState, prompt.controllerPlayerId),
      lastLinkPlayerId: prompt.controllerPlayerId,
      passesSinceLastResponse: 0
    };

    nextState.pendingChain = pendingChain;

    addEvent(nextState, "SILENCE_FROM_THE_GRAVE_PRE_CHAIN_COST_PAID", prompt.controllerPlayerId, {
      promptId,
      sourceCardName: prompt.sourceCardName,
      discardedCardName: result.cardName,
      discardedCardInstanceId: result.card.instanceId,
      note: "Cost paid before Silence From The Grave entered the Magic Chain. Opponent may now respond before it resolves."
    });

    addEvent(nextState, "MAGIC_CHAIN_STARTED", prompt.controllerPlayerId, {
      chainId: pendingChain.id,
      cardInstanceId: sourceCard.instanceId,
      cardName: chainSourceDefinition.name,
      magicType: chainSourceDefinition.magicType,
      magicSubType: chainSourceDefinition.magicSubType
    });

    return nextState;
  }

  const effect = sourceDefinition?.effects?.find(item => item.id === prompt.effectId);

  if (!effect) {
    throw new Error("The source effect definition was not found.");
  }

  const programResult = resolveEffectProgramTargetPrompt({
    state: nextState,
    prompt,
    selectedOption,
    effect
  });

  if (programResult) {
    clearCurrentPromptAndQueueNext(nextState, prompt);

    addEvent(nextState, "EFFECT_PROGRAM_TARGET_PROMPT_RESOLVED", prompt.controllerPlayerId, {
      promptId,
      sourceCardName: prompt.sourceCardName,
      effectId: prompt.effectId,
      actionType: prompt.actionType,
      targetPlayerId: programResult.target?.player.id,
      targetCreatureInstanceId: programResult.target?.card.instanceId,
      targetCreatureName: programResult.target?.definition.name,
      appliedSteps: programResult.appliedSteps
    });

    return nextState;
  }

  if (prompt.actionType === "APPLY_CREATURE_EFFECT_NEGATION") {
    applyCreatureEffectNegationEquip(nextState, prompt, selectedOption, effect);
    clearCurrentPromptAndQueueNext(nextState, prompt);
    return nextState;
  }

  if (prompt.actionType === "SEND_TO_CEMETERY" || prompt.actionType === "SEND_TO_ORIGINAL_OWNER_CEMETERY") {
    const destinationOwnerPlayerId = prompt.actionType === "SEND_TO_ORIGINAL_OWNER_CEMETERY"
      ? selectedOption.cardInstanceId
        ? undefined
        : undefined
      : undefined;
    const result = moveSelectedTargetToCemetery(nextState, selectedOption, prompt.actionType, destinationOwnerPlayerId);

    clearCurrentPromptAndQueueNext(nextState, prompt);

    addEvent(nextState, "AUTO_EFFECT_SEND_TO_CEMETERY_RESOLVED", prompt.controllerPlayerId, {
      promptId,
      sourceCardName: prompt.sourceCardName,
      effectId: prompt.effectId,
      actionType: prompt.actionType,
      sentCardName: result.cardName,
      sentCardInstanceId: result.cardInstanceId,
      sourcePlayerId: result.sourcePlayerId,
      sourceZone: result.sourceZone,
      destinationPlayerId: result.destinationPlayerId
    });

    return nextState;
  }

  if (
    (prompt.actionType === "DESTROY_MAGIC_CARDS" || prompt.actionType === "DESTROY_MAGIC") &&
    prompt.targetKind === "MAGIC_SLOT_CARD"
  ) {
    const selectedCardOption = requireSelectedCardOption(selectedOption);

    const result = moveMagicSlotCardToCemetery(
      nextState,
      selectedCardOption.playerId,
      selectedCardOption.cardInstanceId
    );

    clearCurrentPromptAndQueueNext(nextState, prompt);

    addEvent(nextState, "AUTO_EFFECT_DESTROY_MAGIC_CARD_RESOLVED", prompt.controllerPlayerId, {
      promptId,
      sourceCardName: prompt.sourceCardName,
      sourceCardInstanceId: prompt.sourceCardInstanceId,
      sourceCardId: prompt.sourceCardId,
      effectId: prompt.effectId,
      sourceEffectId: prompt.effectId,
      actionType: prompt.actionType,
      reason: "DESTROY_MAGIC_EFFECT",
      destroyedCardName: result.destroyedCardName,
      destroyedCardInstanceId: result.magicCard.instanceId,
      cardInstanceId: result.magicCard.instanceId,
      fieldOwnerPlayerId: result.fieldOwnerPlayerId,
      cardOwnerPlayerId: result.cardOwnerPlayerId,
      fromZoneRef: boardZoneRef(result.fieldOwnerPlayerId, "MAGIC_SLOT"),
      toZoneRef: boardZoneRef(result.cardOwnerPlayerId, "CEMETERY"),
      linkedDestroyedCreatures: result.linkedDestroyedCreatures.map(item => ({
        creatureName: item.creatureName,
        creatureInstanceId: item.creature.instanceId,
        fieldOwnerPlayerId: item.fieldOwnerPlayerId,
        ownerPlayerId: item.ownerPlayerId
      })),
      boardEvents: [
        {
          type: "CARD_DESTROYED",
          ...promptBoardEventBase(prompt, "DESTROY_MAGIC_EFFECT"),
          cardInstanceId: result.magicCard.instanceId,
          fromZoneRef: boardZoneRef(result.fieldOwnerPlayerId, "MAGIC_SLOT"),
          toZoneRef: boardZoneRef(result.cardOwnerPlayerId, "CEMETERY")
        } satisfies BoardEventPayload
      ]
    });

    return nextState;
  }

  if (prompt.actionType === "DESTROY_ALL_MAGIC" && prompt.targetKind === "PLAYER") {
    const scopeText = [effect.target, effect.params?.target, effect.value, effect.params?.valueText, effect.actionText]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const scopePlayerIds = scopeText.includes("all magic") || scopeText.includes("all magic cards on the field")
      ? undefined
      : [selectedOption.playerId];

    const result = moveAllMagicSlotCardsToCemetery(
      nextState,
      scopePlayerIds,
      addEvent,
      "DESTROY_ALL_MAGIC_EFFECT"
    );

    clearCurrentPromptAndQueueNext(nextState, prompt);

    addEvent(nextState, "AUTO_EFFECT_DESTROY_ALL_MAGIC_RESOLVED", prompt.controllerPlayerId, {
      promptId,
      sourceCardName: prompt.sourceCardName,
      sourceCardInstanceId: prompt.sourceCardInstanceId,
      sourceCardId: prompt.sourceCardId,
      effectId: prompt.effectId,
      sourceEffectId: prompt.effectId,
      actionType: prompt.actionType,
      reason: "DESTROY_ALL_MAGIC_EFFECT",
      selectedPlayerId: selectedOption.playerId,
      destroyedCount: result.destroyedCount,
      destroyedCards: result.destroyedCards.map(item => ({
        destroyedCardName: item.destroyedCardName,
        destroyedCardInstanceId: item.magicCard.instanceId,
        cardInstanceId: item.magicCard.instanceId,
        fieldOwnerPlayerId: item.fieldOwnerPlayerId,
        cardOwnerPlayerId: item.cardOwnerPlayerId,
        fromZoneRef: boardZoneRef(item.fieldOwnerPlayerId, "MAGIC_SLOT"),
        toZoneRef: boardZoneRef(item.cardOwnerPlayerId, "CEMETERY"),
        linkedDestroyedCreatureCount: item.linkedDestroyedCreatures.length
      })),
      boardEvents: result.destroyedCards.map(item => ({
        type: "CARD_DESTROYED",
        ...promptBoardEventBase(prompt, "DESTROY_ALL_MAGIC_EFFECT"),
        cardInstanceId: item.magicCard.instanceId,
        fromZoneRef: boardZoneRef(item.fieldOwnerPlayerId, "MAGIC_SLOT"),
        toZoneRef: boardZoneRef(item.cardOwnerPlayerId, "CEMETERY")
      } satisfies BoardEventPayload))
    });

    applyDestroyedMagicCountModifier(nextState, {
      sourceCardInstanceId: prompt.sourceCardInstanceId,
      sourceCardName: prompt.sourceCardName,
      controllerPlayerId: prompt.controllerPlayerId,
      destroyedCount: result.destroyedCount,
      addEvent
    });

    return nextState;
  }

  if (isRollTablePromptAction(prompt.actionType)) {
    const dice = rollEffectDice(nextState, prompt, effect);
    const rollTotal = sumDice(dice);
    const outcome = resolveRollTableOutcome(effect, rollTotal);
    const rollTotalHeal = getRollTotalHealAmount(effect, rollTotal);
    let resolved = false;

    if (outcome?.damage !== undefined || (prompt.actionType.includes("DAMAGE") && parseFirstNumber(effect))) {
      const amount = outcome?.damage ?? parseFirstNumber(effect);
      if (!amount) throw new Error("This roll damage effect does not contain an automatic damage amount yet.");
      const result = applyDamageToCreatureTarget(nextState, selectedOption, amount);
      resolved = true;

      clearCurrentPromptAndQueueNext(nextState, prompt);

      addEvent(nextState, "AUTO_EFFECT_ROLL_TABLE_DAMAGE_RESOLVED", prompt.controllerPlayerId, {
        promptId,
        sourceCardName: prompt.sourceCardName,
        effectId: prompt.effectId,
        actionType: prompt.actionType,
        dice,
        rollTotal,
        outcome,
        targetPlayerId: result.playerId,
        targetCreatureName: result.creatureName,
        targetKind: result.targetKind,
        damageAmount: result.damageAmount,
        remainingHp: result.remainingHp,
        killed: result.killed,
        boardEvents: [
          diceRolledBoardEvent(prompt, {
            dice,
            rollTotal,
            reason: "EFFECT_ROLL_TABLE"
          }),
          cardDamagedBoardEvent(prompt, {
            cardInstanceId: result.creature.instanceId,
            amount: result.damageAmount,
            damageType: "ROLL_TABLE_DAMAGE",
            reason: "EFFECT_ROLL_TABLE"
          })
        ]
      });

      return nextState;
    }

    if (outcome?.heal !== undefined || rollTotalHeal !== undefined || prompt.actionType.includes("HEAL")) {
      const amount = outcome?.heal ?? rollTotalHeal ?? parseFirstNumber(effect);
      if (!amount) throw new Error("This roll heal effect does not contain an automatic heal amount yet.");
      const result = healCreatureTarget(nextState, selectedOption, amount);
      resolved = true;

      clearCurrentPromptAndQueueNext(nextState, prompt);

      addEvent(nextState, "AUTO_EFFECT_ROLL_TABLE_HEAL_RESOLVED", prompt.controllerPlayerId, {
        promptId,
        sourceCardName: prompt.sourceCardName,
        effectId: prompt.effectId,
        actionType: prompt.actionType,
        dice,
        rollTotal,
        outcome,
        targetPlayerId: result.playerId,
        targetCreatureName: result.creatureName,
        targetKind: result.targetKind,
        healAmount: result.healAmount,
        remainingHp: result.remainingHp,
        maxHp: result.maxHp,
        boardEvents: [
          diceRolledBoardEvent(prompt, {
            dice,
            rollTotal,
            reason: "EFFECT_ROLL_TABLE"
          }),
          cardHealedBoardEvent(prompt, {
            cardInstanceId: result.creature.instanceId,
            amount: result.healAmount,
            healType: "ROLL_TABLE_HEAL",
            reason: "EFFECT_ROLL_TABLE"
          })
        ]
      });

      return nextState;
    }

    clearCurrentPromptAndQueueNext(nextState, prompt);

    addEvent(nextState, resolved ? "AUTO_EFFECT_ROLL_TABLE_RESOLVED" : "AUTO_EFFECT_ROLL_TABLE_MANUAL_OUTCOME", prompt.controllerPlayerId, {
      promptId,
      sourceCardName: prompt.sourceCardName,
      effectId: prompt.effectId,
      actionType: prompt.actionType,
      dice,
      rollTotal,
      outcome,
      note: "The roll was automated, but the table outcome needs manual follow-up.",
      boardEvents: [
        diceRolledBoardEvent(prompt, {
          dice,
          rollTotal,
          reason: "EFFECT_ROLL_TABLE"
        })
      ]
    });

    return nextState;
  }

  if (
    prompt.actionType === "DEAL_INSTANT_DAMAGE" ||
    prompt.actionType === "DAMAGE_CREATURE" ||
    prompt.actionType === "DAMAGE" ||
    prompt.actionType === "PAY_DAMAGE_COST"
  ) {
    const amount = parseFirstNumber(effect);

    if (!amount) {
      throw new Error("This damage effect does not contain an automatic numeric amount yet.");
    }

    const result = applyDamageToCreatureTarget(nextState, selectedOption, amount);

    clearCurrentPromptAndQueueNext(nextState, prompt);

    addEvent(nextState, "AUTO_EFFECT_DAMAGE_CREATURE_RESOLVED", prompt.controllerPlayerId, {
      promptId,
      sourceCardName: prompt.sourceCardName,
      effectId: prompt.effectId,
      actionType: prompt.actionType,
      targetPlayerId: result.playerId,
      targetCreatureName: result.creatureName,
      targetKind: result.targetKind,
      damageAmount: result.damageAmount,
      remainingHp: result.remainingHp,
      killed: result.killed,
      boardEvents: [
        cardDamagedBoardEvent(prompt, {
          cardInstanceId: result.creature.instanceId,
          amount: result.damageAmount,
          damageType: prompt.actionType,
          reason: "EFFECT_DAMAGE"
        })
      ]
    });

    return nextState;
  }

  if (prompt.actionType === "HEAL_CREATURE" || prompt.actionType === "HEAL" || prompt.actionType === "HEAL_TO_FULL") {
    const amount =
      prompt.actionType === "HEAL_TO_FULL"
        ? 999999
        : parseFirstNumber(effect);

    if (!amount) {
      throw new Error("This heal effect does not contain an automatic numeric amount yet.");
    }

    const result = healCreatureTarget(nextState, selectedOption, amount);

    clearCurrentPromptAndQueueNext(nextState, prompt);

    addEvent(nextState, "AUTO_EFFECT_HEAL_CREATURE_RESOLVED", prompt.controllerPlayerId, {
      promptId,
      sourceCardName: prompt.sourceCardName,
      effectId: prompt.effectId,
      actionType: prompt.actionType,
      targetPlayerId: result.playerId,
      targetCreatureName: result.creatureName,
      targetKind: result.targetKind,
      healAmount: result.healAmount,
      remainingHp: result.remainingHp,
      maxHp: result.maxHp,
      boardEvents: [
        cardHealedBoardEvent(prompt, {
          cardInstanceId: result.creature.instanceId,
          amount: result.healAmount,
          healType: prompt.actionType,
          reason: "EFFECT_HEAL"
        })
      ]
    });

    return nextState;
  }

  if (prompt.actionType === "PAY_CARD_COST") {
    const selectedCardOption = requireSelectedCardOption(selectedOption);
    const valueText = [effect.value, effect.params?.valueText, effect.actionText].filter(Boolean).join(" ").toLowerCase();

    if (valueText.includes("deck") || valueText.includes("shuffle")) {
      const selectedPlayer = getPlayer(nextState, selectedCardOption.playerId);
      const handIndex = selectedPlayer.hand.findIndex(card => card.instanceId === selectedCardOption.cardInstanceId);
      if (handIndex === -1) throw new Error("Selected cost card is no longer in hand.");
      const [card] = selectedPlayer.hand.splice(handIndex, 1);
      card.zone = "DECK";
      selectedPlayer.deck.push(card);
      selectedPlayer.deck.sort(() => Math.random() - 0.5);
      clearCurrentPromptAndQueueNext(nextState, prompt);
      addEvent(nextState, "AUTO_EFFECT_PAY_CARD_COST_TO_DECK_RESOLVED", prompt.controllerPlayerId, {
        promptId,
        sourceCardName: prompt.sourceCardName,
        effectId: prompt.effectId,
        actionType: prompt.actionType,
        selectedCardName: getCardDefinition(nextState, card).name,
        selectedCardInstanceId: card.instanceId,
        playerId: selectedPlayer.id,
        note: "Card returned to deck and deck shuffled.",
        boardEvents: [
          promptResolvedBoardEvent(prompt),
          {
            type: "CARD_RETURNED_TO_DECK",
            ...promptBoardEventBase(prompt, "PAY_CARD_COST_TO_DECK"),
            cardInstanceId: card.instanceId,
            fromZoneRef: boardZoneRef(selectedPlayer.id, "HAND"),
            toZoneRef: boardZoneRef(selectedPlayer.id, "DECK")
          } satisfies BoardEventPayload
        ]
      });
      return nextState;
    }

    const result = discardSelectedCardToCemetery(nextState, selectedCardOption);
    clearCurrentPromptAndQueueNext(nextState, prompt);
    addEvent(nextState, "AUTO_EFFECT_PAY_CARD_COST_TO_CEMETERY_RESOLVED", prompt.controllerPlayerId, {
      promptId,
      sourceCardName: prompt.sourceCardName,
      effectId: prompt.effectId,
      actionType: prompt.actionType,
      selectedCardName: result.cardName,
      selectedCardInstanceId: result.card.instanceId,
      sourcePlayerId: result.sourcePlayerId,
      destinationPlayerId: result.destinationPlayerId,
      boardEvents: [
        promptResolvedBoardEvent(prompt),
        {
          type: "CARD_DISCARDED",
          ...promptBoardEventBase(prompt, "PAY_CARD_COST_TO_CEMETERY"),
          cardInstanceId: result.card.instanceId,
          fromZoneRef: boardZoneRef(result.sourcePlayerId, "HAND"),
          toZoneRef: boardZoneRef(result.destinationPlayerId, "CEMETERY")
        } satisfies BoardEventPayload
      ]
    });
    return nextState;
  }

  if (
    prompt.actionType === "PAY_DISCARD_MAGIC_COST" ||
    prompt.actionType === "PAY_DISCARD_COST" ||
    prompt.actionType === "DISCARD_CARD" ||
    prompt.actionType === "DISCARD_CARDS" ||
    prompt.actionType === "FORCE_DISCARD"
  ) {
    const selectedCardOption = requireSelectedCardOption(selectedOption);
    const result = discardSelectedCardToCemetery(nextState, selectedCardOption);

    clearCurrentPromptAndQueueNext(nextState, prompt);

    addEvent(nextState, "AUTO_EFFECT_DISCARD_TO_CEMETERY_RESOLVED", prompt.controllerPlayerId, {
      promptId,
      sourceCardName: prompt.sourceCardName,
      sourceCardInstanceId: prompt.sourceCardInstanceId,
      sourceCardId: prompt.sourceCardId,
      effectId: prompt.effectId,
      sourceEffectId: prompt.effectId,
      actionType: prompt.actionType,
      reason: "DISCARD_TO_CEMETERY",
      selectedCardName: result.cardName,
      selectedCardInstanceId: result.card.instanceId,
      cardInstanceId: result.card.instanceId,
      sourcePlayerId: result.sourcePlayerId,
      sourceZone: result.sourceZone,
      destinationPlayerId: result.destinationPlayerId,
      fromZoneRef: boardZoneRef(result.sourcePlayerId, "HAND"),
      toZoneRef: boardZoneRef(result.destinationPlayerId, "CEMETERY"),
      boardEvents: [
        promptResolvedBoardEvent(prompt),
        {
          type: "CARD_DISCARDED",
          ...promptBoardEventBase(prompt, "DISCARD_TO_CEMETERY"),
          cardInstanceId: result.card.instanceId,
          fromZoneRef: boardZoneRef(result.sourcePlayerId, "HAND"),
          toZoneRef: boardZoneRef(result.destinationPlayerId, "CEMETERY")
        } satisfies BoardEventPayload,
        {
          type: "CARD_MOVED",
          ...promptBoardEventBase(prompt, "DISCARD_TO_CEMETERY"),
          cardInstanceId: result.card.instanceId,
          fromZoneRef: boardZoneRef(result.sourcePlayerId, "HAND"),
          toZoneRef: boardZoneRef(result.destinationPlayerId, "CEMETERY")
        } satisfies BoardEventPayload
      ]
    });

    return nextState;
  }

  if (prompt.actionType === "SEARCH_DECK_TO_HAND" || prompt.actionType === "MOVE_CARD") {
    const selectedCardOption = requireSelectedCardOption(selectedOption);
    const result = moveSelectedCardToHand(
      nextState,
      selectedCardOption,
      addEvent,
      prompt.actionType === "SEARCH_DECK_TO_HAND" ? "SEARCH_DECK_TO_HAND" : "MOVE_CARD_TO_HAND"
    );

    clearCurrentPromptAndQueueNext(nextState, prompt);

    addEvent(
      nextState,
      prompt.actionType === "SEARCH_DECK_TO_HAND"
        ? "AUTO_EFFECT_SEARCH_DECK_TO_HAND_RESOLVED"
        : "AUTO_EFFECT_MOVE_CARD_TO_HAND_RESOLVED",
      prompt.controllerPlayerId,
      {
        promptId,
        sourceCardName: prompt.sourceCardName,
        sourceCardInstanceId: prompt.sourceCardInstanceId,
        sourceCardId: prompt.sourceCardId,
        effectId: prompt.effectId,
        sourceEffectId: prompt.effectId,
        actionType: prompt.actionType,
        reason: prompt.actionType === "SEARCH_DECK_TO_HAND" ? "SEARCH_DECK_TO_HAND" : "MOVE_CARD_TO_HAND",
        selectedCardName: result.cardName,
        selectedCardInstanceId: result.card.instanceId,
        cardInstanceId: result.card.instanceId,
        sourcePlayerId: result.sourcePlayerId,
        sourceZone: result.sourceZone,
        destinationPlayerId: result.destinationPlayerId,
        fromZoneRef: boardZoneRef(result.sourcePlayerId, result.sourceZone as BoardZoneKind),
        toZoneRef: boardZoneRef(result.destinationPlayerId, "HAND"),
        boardEvents: [
          promptResolvedBoardEvent(prompt),
          {
            type: "CARD_MOVED",
            ...promptBoardEventBase(prompt, prompt.actionType === "SEARCH_DECK_TO_HAND" ? "SEARCH_DECK_TO_HAND" : "MOVE_CARD_TO_HAND"),
            cardInstanceId: result.card.instanceId,
            fromZoneRef: boardZoneRef(result.sourcePlayerId, result.sourceZone as BoardZoneKind),
            toZoneRef: boardZoneRef(result.destinationPlayerId, "HAND")
          } satisfies BoardEventPayload
        ]
      }
    );

    return nextState;
  }


  if (prompt.actionType === "SUMMON_FROM_CEMETERY_AND_EQUIP") {
    const selectedCardOption = requireSelectedCardOption(selectedOption);
    const result = summonPrimaryFromCemeteryAndEquipSource(
      nextState,
      selectedCardOption,
      prompt.controllerPlayerId,
      prompt.sourceCardInstanceId,
      addEvent
    );

    clearCurrentPromptAndQueueNext(nextState, prompt);

    addEvent(nextState, "AUTO_EFFECT_PRIMARY_SUMMON_FROM_CEMETERY_AND_EQUIP_RESOLVED", prompt.controllerPlayerId, {
      promptId,
      sourceCardName: prompt.sourceCardName,
      sourceCardInstanceId: prompt.sourceCardInstanceId,
      sourceCardId: prompt.sourceCardId,
      effectId: prompt.effectId,
      sourceEffectId: prompt.effectId,
      actionType: prompt.actionType,
      reason: "SUMMON_FROM_CEMETERY_AND_EQUIP",
      summonedCardName: result.cardName,
      summonedCardInstanceId: result.card.instanceId,
      cardInstanceId: result.card.instanceId,
      equippedMagicCardName: result.equippedMagicCardName,
      equippedMagicCardInstanceId: result.equippedMagicCard.instanceId,
      attachedToInstanceId: result.card.instanceId,
      replacedPrimaryCardName: result.replacedPrimaryCardName,
      replacedPrimaryCardInstanceId: result.replacedPrimaryCardInstanceId,
      sourcePlayerId: result.sourcePlayerId,
      sourceZone: result.sourceZone,
      controllerPlayerId: result.controllerPlayerId,
      magicSlotCount: result.magicSlotCount,
      fromZoneRef: boardZoneRef(result.sourcePlayerId, result.sourceZone as BoardZoneKind),
      toZoneRef: boardZoneRef(result.controllerPlayerId, "PRIMARY_CREATURE"),
      boardEvents: [
        {
          type: "CREATURE_SUMMONED_PRIMARY",
          ...promptBoardEventBase(prompt, "SUMMON_FROM_CEMETERY_AND_EQUIP"),
          cardInstanceId: result.card.instanceId,
          fromZoneRef: boardZoneRef(result.sourcePlayerId, result.sourceZone as BoardZoneKind),
          toZoneRef: boardZoneRef(result.controllerPlayerId, "PRIMARY_CREATURE")
        },
        {
          type: "MAGIC_ATTACHED",
          ...promptBoardEventBase(prompt, "SOURCE_MAGIC_ATTACHED"),
          cardInstanceId: result.equippedMagicCard.instanceId,
          fromZoneRef: boardZoneRef(result.equippedMagicSourcePlayerId, result.equippedMagicSourceZone as BoardZoneKind),
          toZoneRef: boardZoneRef(result.controllerPlayerId, "ATTACHED_UNDER"),
          targetCardInstanceId: result.card.instanceId
        },
        {
          type: "ANCHOR_LINK_CREATED",
          ...promptBoardEventBase(prompt, "SOURCE_LINK_CREATED"),
          cardInstanceId: result.card.instanceId,
          targetCardInstanceId: result.card.instanceId
        }
      ] satisfies BoardEventPayload[],
      note: "Source Magic anchors the temporary primary creature. If the source Magic leaves the field, the anchored primary is sent back to the cemetery."
    });

    return nextState;
  }

  if (isLimitedSummonPromptAction(prompt.actionType)) {
    const selectedCardOption = requireSelectedCardOption(selectedOption);

    if (isLimitedSummonAndEquipPromptAction(prompt.actionType)) {
      const result = limitedSummonSelectedCreatureAndEquipSource(
        nextState,
        selectedCardOption,
        prompt.controllerPlayerId,
        prompt.sourceCardInstanceId
      );

      clearCurrentPromptAndQueueNext(nextState, prompt);

      addEvent(nextState, "AUTO_EFFECT_LIMITED_SUMMON_AND_EQUIP_RESOLVED", prompt.controllerPlayerId, {
        promptId,
        sourceCardName: prompt.sourceCardName,
        sourceCardInstanceId: prompt.sourceCardInstanceId,
        sourceCardId: prompt.sourceCardId,
        effectId: prompt.effectId,
        sourceEffectId: prompt.effectId,
        actionType: prompt.actionType,
        reason: "LIMITED_SUMMON_AND_EQUIP",
        summonedCardName: result.cardName,
        summonedCardInstanceId: result.card.instanceId,
        cardInstanceId: result.card.instanceId,
        equippedMagicCardName: result.equippedMagicCardName,
        equippedMagicCardInstanceId: result.equippedMagicCard.instanceId,
        attachedToInstanceId: result.card.instanceId,
        sourcePlayerId: result.sourcePlayerId,
        sourceZone: result.sourceZone,
        controllerPlayerId: result.controllerPlayerId,
        limitedSummonSlotCount: result.slotCount,
        magicSlotCount: result.magicSlotCount,
        fromZoneRef: boardZoneRef(result.sourcePlayerId, result.sourceZone as BoardZoneKind),
        toZoneRef: boardZoneRef(result.controllerPlayerId, "LIMITED_SUMMON"),
        boardEvents: [
          {
            type: "CREATURE_SUMMONED_LIMITED",
            ...promptBoardEventBase(prompt, "LIMITED_SUMMON_AND_EQUIP"),
            cardInstanceId: result.card.instanceId,
            fromZoneRef: boardZoneRef(result.sourcePlayerId, result.sourceZone as BoardZoneKind),
            toZoneRef: boardZoneRef(result.controllerPlayerId, "LIMITED_SUMMON")
          },
          {
            type: "MAGIC_ATTACHED",
            ...promptBoardEventBase(prompt, "SOURCE_MAGIC_ATTACHED"),
            cardInstanceId: result.equippedMagicCard.instanceId,
            fromZoneRef: boardZoneRef(result.equippedMagicSourcePlayerId, result.equippedMagicSourceZone as BoardZoneKind),
            toZoneRef: boardZoneRef(result.controllerPlayerId, "ATTACHED_UNDER"),
            targetCardInstanceId: result.card.instanceId
          },
          {
            type: "ANCHOR_LINK_CREATED",
            ...promptBoardEventBase(prompt, "SOURCE_LINK_CREATED"),
            cardInstanceId: result.card.instanceId,
            targetCardInstanceId: result.card.instanceId
          }
        ] satisfies BoardEventPayload[],
        note:
          "Source Magic is now attached to the summoned Limited Summon. If the source Magic is removed from the field, the anchored Limited Summon is destroyed."
      });

      return nextState;
    }

    const result = limitedSummonSelectedCreature(
      nextState,
      selectedCardOption,
      prompt.controllerPlayerId
    );

    const sourceLinked =
      effect.params?.sourceLinked === true ||
      effect.params?.usesAnchoring === true ||
      effect.duration?.sourceLinked === true;

    if (sourceLinked) {
      result.card.anchorSourceInstanceId = prompt.sourceCardInstanceId;
    }

    clearCurrentPromptAndQueueNext(nextState, prompt);

    addEvent(nextState, "AUTO_EFFECT_LIMITED_SUMMON_RESOLVED", prompt.controllerPlayerId, {
      promptId,
      sourceCardName: prompt.sourceCardName,
      sourceCardInstanceId: prompt.sourceCardInstanceId,
      sourceCardId: prompt.sourceCardId,
      effectId: prompt.effectId,
      sourceEffectId: prompt.effectId,
      actionType: prompt.actionType,
      reason: "LIMITED_SUMMON",
      summonedCardName: result.cardName,
      summonedCardInstanceId: result.card.instanceId,
      cardInstanceId: result.card.instanceId,
      sourcePlayerId: result.sourcePlayerId,
      sourceZone: result.sourceZone,
      controllerPlayerId: result.controllerPlayerId,
      limitedSummonSlotCount: result.slotCount,
      anchorSourceInstanceId: sourceLinked ? prompt.sourceCardInstanceId : undefined,
      fromZoneRef: boardZoneRef(result.sourcePlayerId, result.sourceZone as BoardZoneKind),
      toZoneRef: boardZoneRef(result.controllerPlayerId, "LIMITED_SUMMON"),
      boardEvents: [
        {
          type: "CREATURE_SUMMONED_LIMITED",
          ...promptBoardEventBase(prompt, "LIMITED_SUMMON"),
          cardInstanceId: result.card.instanceId,
          fromZoneRef: boardZoneRef(result.sourcePlayerId, result.sourceZone as BoardZoneKind),
          toZoneRef: boardZoneRef(result.controllerPlayerId, "LIMITED_SUMMON")
        },
        ...(sourceLinked
          ? [{
              type: "ANCHOR_LINK_CREATED",
              ...promptBoardEventBase(prompt, "SOURCE_LINK_CREATED"),
              cardInstanceId: result.card.instanceId,
              targetCardInstanceId: result.card.instanceId
            } satisfies BoardEventPayload]
          : [])
      ] satisfies BoardEventPayload[]
    });

    return nextState;
  }


  if (prompt.actionType === "APPLY_DICE_LIMIT") {
    const result = applyDiceLimitPromptEffect(nextState, prompt, selectedOption, effect);
    clearCurrentPromptAndQueueNext(nextState, prompt);

    addEvent(nextState, "AUTO_EFFECT_DICE_LIMIT_TARGET_RESOLVED", prompt.controllerPlayerId, {
      promptId,
      sourceCardName: prompt.sourceCardName,
      effectId: prompt.effectId,
      actionType: prompt.actionType,
      targetPlayerId: result.target.player.id,
      targetCreatureInstanceId: result.target.card.instanceId,
      targetCreatureName: result.target.definition.name,
      rollKind: result.activeInstance.rollKind,
      diceLimitMode: result.activeInstance.diceLimitMode,
      diceLimitValue: result.activeInstance.diceLimitValue,
      expiresOnPlayerId: result.activeInstance.expiresOnPlayerId,
      expiresAtPlayerTurnStartCount: result.activeInstance.expiresAtPlayerTurnStartCount,
      boardEvents: [
        {
          type: "STAT_MODIFIER_APPLIED",
          ...promptBoardEventBase(prompt, "DICE_LIMIT_APPLIED"),
          cardInstanceId: result.target.card.instanceId,
          targetCardInstanceId: result.target.card.instanceId,
          statusLabel: result.activeInstance.label,
          rollKind: result.activeInstance.rollKind,
          diceLimitMode: result.activeInstance.diceLimitMode,
          diceLimitValue: result.activeInstance.diceLimitValue
        } satisfies BoardEventPayload
      ]
    });

    return nextState;
  }

  if (prompt.actionType === "APPLY_STATUS" || prompt.actionType === "APPLY_STATUS_WITH_ESCAPE_ROLL" || prompt.actionType === "APPLY_DAMAGE_IMMUNITY") {
    const result = applyStatusPromptEffect(nextState, prompt, selectedOption, effect);
    clearCurrentPromptAndQueueNext(nextState, prompt);

    addEvent(nextState, "AUTO_EFFECT_STATUS_TARGET_RESOLVED", prompt.controllerPlayerId, {
      promptId,
      sourceCardName: prompt.sourceCardName,
      effectId: prompt.effectId,
      actionType: prompt.actionType,
      targetPlayerId: result.target.player.id,
      targetCreatureInstanceId: result.target.card.instanceId,
      targetCreatureName: result.target.definition.name,
      status: result.activeStatus.status,
      label: result.activeStatus.label,
      flags: result.activeStatus.flags,
      expiresOnPlayerId: result.activeStatus.expiresOnPlayerId,
      expiresAtPlayerTurnStartCount: result.activeStatus.expiresAtPlayerTurnStartCount,
      boardEvents: [
        {
          type: "STATUS_APPLIED",
          ...promptBoardEventBase(prompt, "STATUS_APPLIED"),
          cardInstanceId: result.target.card.instanceId,
          targetCardInstanceId: result.target.card.instanceId,
          status: result.activeStatus.status,
          statusLabel: result.activeStatus.label
        } satisfies BoardEventPayload
      ]
    });

    return nextState;
  }

  if (prompt.actionType === "APPLY_DAMAGE_OVER_TIME" || prompt.actionType === "APPLY_HEALING_OVER_TIME" || prompt.actionType === "APPLY_HEAL_OVER_TIME") {
    const result = applyRecurringPromptEffect(nextState, prompt, selectedOption, effect);
    clearCurrentPromptAndQueueNext(nextState, prompt);

    addEvent(nextState, "AUTO_EFFECT_RECURRING_TARGET_RESOLVED", prompt.controllerPlayerId, {
      promptId,
      sourceCardName: prompt.sourceCardName,
      effectId: prompt.effectId,
      actionType: prompt.actionType,
      targetPlayerId: result.target.player.id,
      targetCreatureInstanceId: result.target.card.instanceId,
      targetCreatureName: result.target.definition.name,
      effectType: result.recurring?.effectType ?? (prompt.actionType.includes("HEAL") ? "HEAL_OVER_TIME" : "DAMAGE_OVER_TIME"),
      amount: result.recurring?.amount,
      immediateTickApplied: false,
      tickTiming: result.recurring?.tickTiming,
      remainingTicks: result.recurring?.remainingTicks ?? 0,
      nextTickPlayerId: result.recurring?.nextTickPlayerId,
      nextTickTurnStartCount: result.recurring?.nextTickTurnStartCount,
      boardEvents: [
        {
          type: "STATUS_APPLIED",
          ...promptBoardEventBase(prompt, "RECURRING_EFFECT_APPLIED"),
          cardInstanceId: result.target.card.instanceId,
          targetCardInstanceId: result.target.card.instanceId,
          amount: result.recurring?.amount,
          status: result.recurring?.effectType ?? (prompt.actionType.includes("HEAL") ? "HEAL_OVER_TIME" : "DAMAGE_OVER_TIME"),
          statusLabel: result.recurring?.label ?? (prompt.actionType.includes("HEAL") ? "Healing over time" : "Damage over time"),
          effectType: result.recurring?.effectType
        } satisfies BoardEventPayload
      ]
    });

    return nextState;
  }

  if (prompt.actionType === "APPLY_STAT_MODIFIER") {
    const statChange = effect.params?.statChanges?.[0];

    if (!statChange) {
      throw new Error("This stat effect does not contain a supported stat change yet.");
    }

    const stat = normalizeStatKey(statChange.stat);
    const delta = getDeltaFromStatChange(statChange);

    if (!stat || delta === undefined) {
      throw new Error("This stat effect uses a stat or operation that is not automated yet.");
    }

    const duration = getPromptDuration(effect);
    const result = applyStatModifierToCreatureTarget(nextState, selectedOption, {
      sourceEffectId: prompt.effectId,
      sourceCardInstanceId: prompt.sourceCardInstanceId,
      sourceCardName: prompt.sourceCardName,
      stat,
      delta,
      ...duration
    });

    clearCurrentPromptAndQueueNext(nextState, prompt);

    addEvent(nextState, "AUTO_EFFECT_STAT_MODIFIER_RESOLVED", prompt.controllerPlayerId, {
      promptId,
      sourceCardName: prompt.sourceCardName,
      effectId: prompt.effectId,
      actionType: prompt.actionType,
      targetPlayerId: result.playerId,
      targetCreatureName: result.creatureName,
      targetKind: result.targetKind,
      stat: result.stat,
      delta: result.delta,
      modifierId: result.modifierId,
      boardEvents: [
        {
          type: "STAT_MODIFIER_APPLIED",
          ...promptBoardEventBase(prompt, "STAT_MODIFIER_APPLIED"),
          cardInstanceId: result.creature.instanceId,
          targetCardInstanceId: result.creature.instanceId,
          stat: result.stat,
          delta: result.delta,
          modifierId: result.modifierId
        } satisfies BoardEventPayload
      ]
    });

    return nextState;
  }

  throw new Error(`Unsupported target prompt action: ${prompt.actionType}`);
}
