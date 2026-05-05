import { v4 as uuidv4 } from "uuid";
import type {
  ActiveCreatureStatus,
  ActiveEffectInstance,
  ActiveRecurringCreatureEffect,
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
import { isAutomaticMagicEffectSupported, tryResolveAutomaticMagicEffect } from "./effectResolver.js";
import { resolveEffectProgramTargetPrompt } from "./effectProgramRunner.js";
import { getRuntimeBlockDurationData, getRuntimeBlockDurationText, getRuntimeBlockText, getRuntimeBlockValueText } from "./effectBlockRuntime.js";
export { effectNeedsSingleMagicSlotTargetPrompt } from "./effectRegistry.js";

export type ChainLinkEffectSource = {
  cardInstanceId: string;
  cardId: string;
  cardName: string;
  playerId: string;
};

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

  return actionType === "SEARCH_DECK_TO_HAND" || (
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
    options: getTargetOptionsForQuery(state, link.playerId, targetQuery)
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
          reason: "No legal cards matched this deck/search effect. The effect resolves without opening manual fallback."
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
      effectId: prompt.effectId,
      actionType: prompt.actionType,
      destroyedCardName: result.destroyedCardName,
      destroyedCardInstanceId: result.magicCard.instanceId,
      fieldOwnerPlayerId: result.fieldOwnerPlayerId,
      cardOwnerPlayerId: result.cardOwnerPlayerId,
      linkedDestroyedCreatures: result.linkedDestroyedCreatures.map(item => ({
        creatureName: item.creatureName,
        creatureInstanceId: item.creature.instanceId,
        fieldOwnerPlayerId: item.fieldOwnerPlayerId,
        ownerPlayerId: item.ownerPlayerId
      }))
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
      effectId: prompt.effectId,
      actionType: prompt.actionType,
      selectedPlayerId: selectedOption.playerId,
      destroyedCount: result.destroyedCount,
      destroyedCards: result.destroyedCards.map(item => ({
        destroyedCardName: item.destroyedCardName,
        destroyedCardInstanceId: item.magicCard.instanceId,
        fieldOwnerPlayerId: item.fieldOwnerPlayerId,
        cardOwnerPlayerId: item.cardOwnerPlayerId,
        linkedDestroyedCreatureCount: item.linkedDestroyedCreatures.length
      }))
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
        killed: result.killed
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
        maxHp: result.maxHp
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
      note: "The roll was automated, but the table outcome needs manual follow-up."
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
      killed: result.killed
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
      maxHp: result.maxHp
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
        note: "Card returned to deck and deck shuffled."
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
      destinationPlayerId: result.destinationPlayerId
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
      effectId: prompt.effectId,
      actionType: prompt.actionType,
      selectedCardName: result.cardName,
      selectedCardInstanceId: result.card.instanceId,
      sourcePlayerId: result.sourcePlayerId,
      sourceZone: result.sourceZone,
      destinationPlayerId: result.destinationPlayerId
    });

    return nextState;
  }

  if (prompt.actionType === "SEARCH_DECK_TO_HAND" || prompt.actionType === "MOVE_CARD") {
    const selectedCardOption = requireSelectedCardOption(selectedOption);
    const result = moveSelectedCardToHand(nextState, selectedCardOption);

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
        effectId: prompt.effectId,
        actionType: prompt.actionType,
        selectedCardName: result.cardName,
        selectedCardInstanceId: result.card.instanceId,
        sourcePlayerId: result.sourcePlayerId,
        sourceZone: result.sourceZone,
        destinationPlayerId: result.destinationPlayerId
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
      effectId: prompt.effectId,
      actionType: prompt.actionType,
      summonedCardName: result.cardName,
      summonedCardInstanceId: result.card.instanceId,
      equippedMagicCardName: result.equippedMagicCardName,
      equippedMagicCardInstanceId: result.equippedMagicCard.instanceId,
      attachedToInstanceId: result.card.instanceId,
      replacedPrimaryCardName: result.replacedPrimaryCardName,
      replacedPrimaryCardInstanceId: result.replacedPrimaryCardInstanceId,
      sourcePlayerId: result.sourcePlayerId,
      sourceZone: result.sourceZone,
      controllerPlayerId: result.controllerPlayerId,
      magicSlotCount: result.magicSlotCount,
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
        effectId: prompt.effectId,
        actionType: prompt.actionType,
        summonedCardName: result.cardName,
        summonedCardInstanceId: result.card.instanceId,
        equippedMagicCardName: result.equippedMagicCardName,
        equippedMagicCardInstanceId: result.equippedMagicCard.instanceId,
        attachedToInstanceId: result.card.instanceId,
        sourcePlayerId: result.sourcePlayerId,
        sourceZone: result.sourceZone,
        controllerPlayerId: result.controllerPlayerId,
        limitedSummonSlotCount: result.slotCount,
        magicSlotCount: result.magicSlotCount,
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
      effectId: prompt.effectId,
      actionType: prompt.actionType,
      summonedCardName: result.cardName,
      summonedCardInstanceId: result.card.instanceId,
      sourcePlayerId: result.sourcePlayerId,
      sourceZone: result.sourceZone,
      controllerPlayerId: result.controllerPlayerId,
      limitedSummonSlotCount: result.slotCount,
      anchorSourceInstanceId: sourceLinked ? prompt.sourceCardInstanceId : undefined
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
      expiresAtPlayerTurnStartCount: result.activeInstance.expiresAtPlayerTurnStartCount
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
      flags: result.activeStatus.flags,
      expiresOnPlayerId: result.activeStatus.expiresOnPlayerId,
      expiresAtPlayerTurnStartCount: result.activeStatus.expiresAtPlayerTurnStartCount
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
      nextTickTurnStartCount: result.recurring?.nextTickTurnStartCount
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
      modifierId: result.modifierId
    });

    return nextState;
  }

  throw new Error(`Unsupported target prompt action: ${prompt.actionType}`);
}

