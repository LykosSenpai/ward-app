import type { WardEngineEffect } from "@ward/shared";
import { inferTargetQueryForEffect } from "./targets.js";

export type EffectResolutionMode =
  | "AUTO_NOW"
  | "TARGET_PROMPT"
  | "CARD_SELECTION_PROMPT"
  | "TRIGGER_ONLY"
  | "MANUAL_FALLBACK"
  | "UNSUPPORTED";

const TRIGGER_ONLY_TRIGGERS = new Set([
  "WHILE_EQUIPPED",
  "WHILE_FIELD_ACTIVE",
  "WHILE_ON_FIELD",
  "STATIC_WHILE_ON_FIELD",
  "STATIC_WHILE_EQUIPPED",
  "STATIC_IN_CEMETERY",
  "STATIC_RULE",
  "SUMMON_REQUIREMENT",
  "ON_CARD_REMOVED_FROM_FIELD",
  "ON_SOURCE_INVALIDATED",
  "ON_LEAVES_FIELD",
  "DELAYED_TRIGGER",
  "AT_BEGINNING_OF_YOUR_TURN",
  "BEGINNING_OF_YOUR_TURN",
  "AT_END_OF_YOUR_TURN",
  "END_OF_YOUR_TURN",
  "AT_END_OF_YOUR_TURN_FIELD",
  "OPPONENT_TURN_WHILE_EQUIPPED",
  "OPPONENT_TURN_WHILE_WRAPPED",
  "PRIOR_TO_BATTLE",
  "PRIOR_TO_EACH_BATTLE_WITH_THIS_CREATURE",
  "DAMAGE_CALC_ON_THIS_CARD",
  "DURING_DAMAGE_CALC",
  "DURING_DAMAGE_CALC_OR_STATIC",
  "DURING_DAMAGE_CALC_OR_WHILE_IN_HAND_COUNT"
]);

const CARD_SELECTION_TARGET_KINDS = new Set([
  "CARD_IN_HAND",
  "CARD_IN_DECK",
  "CARD_IN_CEMETERY",
  "CARD_IN_REMOVED_FROM_GAME"
]);

function normalizeTrigger(trigger?: string): string {
  return trigger?.trim().toUpperCase() ?? "";
}

function effectText(effect: WardEngineEffect): string {
  return [
    effect.actionType,
    effect.actionText,
    effect.target,
    effect.params?.target,
    effect.value,
    effect.params?.valueText
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function effectDestroysAllMagic(effect: WardEngineEffect): boolean {
  const actionType = effect.actionType.trim().toUpperCase();
  const text = effectText(effect);

  return (
    actionType === "DESTROY_ALL_MAGIC" ||
    (
      (actionType === "DESTROY_MAGIC_CARDS" || actionType === "DESTROY_MAGIC") &&
      (text.includes("destroy all magic") || text.includes("all magic cards") || text.includes("all magic on the field"))
    )
  );
}

export function isTriggerOnlyEffect(effect: WardEngineEffect): boolean {
  return TRIGGER_ONLY_TRIGGERS.has(normalizeTrigger(effect.trigger));
}

export function getEffectResolutionMode(effect: WardEngineEffect): EffectResolutionMode {
  if (isTriggerOnlyEffect(effect)) {
    return "TRIGGER_ONLY";
  }

  const targetQuery = inferTargetQueryForEffect(effect);

  if (targetQuery) {
    if (CARD_SELECTION_TARGET_KINDS.has(targetQuery.kind)) {
      return "CARD_SELECTION_PROMPT";
    }

    return "TARGET_PROMPT";
  }

  if (effect.actionType === "DRAW_CARDS" || effectDestroysAllMagic(effect)) {
    return "AUTO_NOW";
  }

  return "MANUAL_FALLBACK";
}

export function effectNeedsTargetPrompt(effect: WardEngineEffect): boolean {
  const mode = getEffectResolutionMode(effect);

  return mode === "TARGET_PROMPT" || mode === "CARD_SELECTION_PROMPT";
}

export function effectNeedsSingleMagicSlotTargetPrompt(
  effect: WardEngineEffect
): boolean {
  const targetQuery = inferTargetQueryForEffect(effect);

  return (
    effect.actionType === "DESTROY_MAGIC_CARDS" &&
    targetQuery?.kind === "MAGIC_SLOT_CARD"
  );
}
