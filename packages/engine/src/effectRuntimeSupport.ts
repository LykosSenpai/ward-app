import type { WardEngineEffect } from "@ward/shared";
import { getEffectActionCatalogEntry } from "./effectActionCatalog.js";

export type RuntimeSupportLevel = "SUPPORTED" | "PARTIAL" | "MANUAL" | "UNSUPPORTED";

export type EffectRuntimeSupportResult = {
  level: RuntimeSupportLevel;
  route: string;
  notes: string;
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
    .join(" ")
    .toLowerCase();
}

function isBattleTrigger(trigger: string): boolean {
  return [
    "ON_HIT",
    "ON_HIT_FIRST",
    "BEFORE_HIT_ROLL",
    "BEFORE_DAMAGE_ROLL",
    "DURING_DAMAGE_CALC",
    "AFTER_DAMAGE_APPLIED",
    "ON_MISS"
  ].includes(trigger);
}

function isPromptSupportedAction(actionType: string): boolean {
  return [
    "DESTROY_MAGIC_CARDS",
    "DESTROY_MAGIC",
    "DESTROY_ALL_MAGIC",
    "ROLL_DAMAGE_TABLE",
    "ROLL_TABLE",
    "ROLL_AND_DAMAGE",
    "ROLL_AND_HEAL",
    "HEAL_BY_ROLL",
    "SEARCH_DECK_TO_HAND",
    "MOVE_CARD",
    "SUMMON_LIMITED_CREATURE",
    "SUMMON_LIMITED_CREATURE_AND_EQUIP",
    "SUMMON_FROM_CEMETERY_AND_EQUIP",
    "FORCE_SUMMON_FROM_HAND",
    "PAY_DISCARD_MAGIC_COST",
    "PAY_DISCARD_COST",
    "DISCARD_CARD",
    "DISCARD_CARDS",
    "FORCE_DISCARD",
    "DRAW_CARDS",
    "DAMAGE",
    "DEAL_INSTANT_DAMAGE",
    "DAMAGE_CREATURE",
    "HEAL",
    "HEAL_CREATURE",
    "APPLY_STATUS",
    "APPLY_STATUS_WITH_ESCAPE_ROLL",
    "APPLY_DAMAGE_IMMUNITY",
    "APPLY_DAMAGE_OVER_TIME",
    "APPLY_HEAL_OVER_TIME",
    "APPLY_HEALING_OVER_TIME",
    "APPLY_REGENERATING_HEAL",
    "APPLY_STAT_MODIFIER"
  ].includes(actionType);
}

export function getEffectRuntimeSupport(effect: WardEngineEffect): EffectRuntimeSupportResult {
  const trigger = normalize(effect.trigger);
  const actionType = normalize(effect.actionType);
  const reusableFunction = normalize(effect.reusableFunction);
  const text = effectText(effect);

  if (actionType === "MANUAL_FALLBACK" || reusableFunction === "MANUALFALLBACK") {
    return {
      level: "MANUAL",
      route: "manualFallback",
      notes: "Effect is intentionally marked for manual resolution/review."
    };
  }

  if (actionType === "DESTROY_LINKED_SUMMONED_CREATURE" || reusableFunction === "DESTROYLINKEDSUMMONEDCREATURE") {
    return {
      level: "SUPPORTED",
      route: "triggers.runCardRemovedFromFieldTriggers / destroyCreaturesAnchoredToCard",
      notes: "Source-linked anchored creatures are automatically destroyed when their source card leaves the field. This is trigger-only cleanup support, not a manual prompt route."
    };
  }


  if (actionType === "APPLY_OPPONENT_MAGIC_PLAY_LOCK") {
    return {
      level: "SUPPORTED",
      route: "effectResolver.applyOpponentMagicPlayLockEffect / magicChainActions guard",
      notes: "Silence From The Grave-style Magic lock is automated after the card resolves. The opponent may still play a valid Lightning response before Silence resolves, but cannot play Magic after the lock is active."
    };
  }

  if (actionType === "APPLY_TURN_CONDITIONAL_OPPONENT_CREATURE_EFFECT_SUPPRESSION") {
    return {
      level: "SUPPORTED",
      route: "effectResolver.applyTurnConditionalOpponentCreatureSuppressionEffect / creatureEffectSuppression",
      notes: "Opponent creature effects are suppressed only during the source player's turns for the lock duration. Already-active unaffected-by-Magic creature effects ignore it; replacement creatures entering during the active suppression window are temporarily suppressed until their owner Draw/start turn."
    };
  }

  if (actionType === "APPLY_PLAY_RESTRICTION") {
    const revealHand = text.includes("opponent") && text.includes("hand") &&
      (text.includes("reveal") || text.includes("show"));

    return revealHand
      ? {
          level: "SUPPORTED",
          route: "cardEffectActions.activateRevealOpponentHandEffect",
          notes: "Request-based reveal-hand effects are exposed as Available Effects buttons."
        }
      : {
          level: "PARTIAL",
          route: "cardEffectActions / play restriction guard needed",
          notes: "Only reveal-hand request effects are automated. Card-play prevention needs a guard route."
        };
  }

  if (trigger === "DURING_YOUR_TURN_ACTIVATED") {
    return {
      level: "PARTIAL",
      route: "cardEffectActions.activateRollBasedEffect",
      notes: "D6 roll and target-prompt creation are automated; the final action depends on target resolver support."
    };
  }

  if (isPromptSupportedAction(actionType)) {
    return {
      level: "SUPPORTED",
      route: "effectPrompts / effectResolver",
      notes: "Immediate or prompted resolver route exists for this action type."
    };
  }

  if (actionType === "ROLL_FOR_EFFECT" || reusableFunction === "ROLLFOREFFECT") {
    return {
      level: "SUPPORTED",
      route: "battle.rollManualBattleHit -> pendingEffectRoll -> effectRollActions",
      notes: "Battle hit effects that roll D6 and apply a status on success are handled in a separate Effect Roll modal after the hit succeeds and before attack damage is rolled."
    };
  }

  if (actionType === "APPLY_STATUS" || actionType === "APPLY_STATUS_WITH_ESCAPE_ROLL" || actionType === "APPLY_DAMAGE_IMMUNITY") {
    return {
      level: actionType === "APPLY_STATUS" || actionType === "APPLY_DAMAGE_IMMUNITY" ? "SUPPORTED" : "PARTIAL",
      route: "creatureRuntimeEffects.addStatusToCreature",
      notes: actionType === "APPLY_STATUS" || actionType === "APPLY_DAMAGE_IMMUNITY"
        ? "Battle status application, status flags, and turn-cycle expiration are automated."
        : "Status application is automated; escape-roll cleanup may still need card-specific validation."
    };
  }

  if (actionType === "APPLY_REGENERATING_HEAL") {
    return {
      level: "SUPPORTED",
      route: "effectResolver.applyOnEquipRegeneratingHealEffects / creatureRuntimeEffects.processRegeneratingHealsAtTurnStart",
      notes: "Troll Regeneration-style healing is handled separately from normal HOT. It heals immediately on equip, then heals at the source owner's Draw/start-of-turn window, refreshes counters at end of source owner's turn, and expires when the source equip leaves field."
    };
  }

  if (actionType.includes("DAMAGE_OVER_TIME") || actionType.includes("HEAL_OVER_TIME") || actionType.includes("HEALING_OVER_TIME")) {
    return {
      level: "SUPPORTED",
      route: "creatureRuntimeEffects.addRecurringEffectToCreature",
      notes: "DOT registration plus source-player beginning-of-Combat damage ticks are automated so HP is accurate before battle selection, even if combat is skipped. Non-damage recurring effects can still use combat-end timing. Multiple due ticks resolve in application order."
    };
  }

  if (["DAMAGE", "DEAL_INSTANT_DAMAGE", "DAMAGE_CREATURE", "HEAL", "HEAL_CREATURE"].includes(actionType)) {
    return {
      level: "PARTIAL",
      route: "creatureRuntimeEffects.applyImmediateDamageOrHeal / manualMagicEffectActions",
      notes: "Flat damage/heal can resolve when target and amount can be inferred. Complex timing still needs handlers."
    };
  }

  if (actionType === "APPLY_DICE_LIMIT") {
    return {
      level: "SUPPORTED",
      route: "effectPrompts.applyDiceLimitPromptEffect / battle.rollManualBattleHit",
      notes: "Targeted dice-limit effects are materialized on the creature and cap Hit Roll dice while active. They are duration/static modifiers, not DOT/HOT ticks."
    };
  }

  if (["APPLY_STAT_MODIFIER", "APPLY_DICE_MODIFIER", "APPLY_CONDITIONAL_DICE_MODIFIER"].includes(actionType)) {
    return {
      level: "SUPPORTED",
      route: "modifierLayers / effectiveStats / battleEffectAdapter / creatureRuntimeEffects.applyTemporaryStatModifiers",
      notes: "Equip/field stat layers, temporary battle stat changes, hit/attack dice, hit bonuses, and Atk flat bonuses are routed through the runtime modifier pipeline. Complex dynamic formulas still require QA."
    };
  }

  if (actionType === "APPLY_ATTACK_DAMAGE_MULTIPLIER" || actionType === "APPLY_DAMAGE_MULTIPLIER") {
    return {
      level: "SUPPORTED",
      route: "creatureRuntimeEffects.applyBattleDamageMultiplier / battle damage pipeline",
      notes: "Triggered and static attack damage multipliers are applied in the damage pipeline with ordered debug trace events."
    };
  }

  if (actionType === "APPLY_ATTACK_PRIORITY_OVERRIDE" || actionType === "APPLY_FORCED_FIRST_AUTO_HIT_MULTIPLIER") {
    return {
      level: "PARTIAL",
      route: "battleEffectAdapter / battle resolver suggestions",
      notes: "Priority and battle overrides can be suggested/applied in the manual battle resolver but need more card tests."
    };
  }

  if (actionType === "VALIDATE_SUMMON_REQUIREMENT" || actionType === "APPLY_SUMMON_REQUIREMENT_OVERRIDE") {
    return {
      level: "PARTIAL",
      route: "summonRules",
      notes: "Normal AL sacrifice logic exists. Custom named/material requirements need card-specific routes."
    };
  }

  if (actionType.includes("LIMITED_SUMMON") || actionType.includes("SUMMON_FROM")) {
    return {
      level: "SUPPORTED",
      route: "effectPrompts / cardMovement / anchoring cleanup",
      notes: "Common limited summon routes from hand/deck/cemetery and source-linked cleanup are automated. Named/material requirements still need QA."
    };
  }

  if (actionType.includes("NEGATE") || actionType.includes("PREVENT")) {
    return {
      level: "PARTIAL",
      route: "magicChainActions.passMagicChainPriority / battle damage prevention",
      notes: "1v1 Lightning response priority and battle damage prevention are automated. Card-specific negate conditions still need validation."
    };
  }

  if (["ROLL_TABLE", "ROLL_DAMAGE_TABLE", "ROLL_AND_DAMAGE", "ROLL_AND_HEAL", "HEAL_BY_ROLL"].includes(actionType)) {
    return {
      level: "PARTIAL",
      route: "effectPrompts.resolvePendingEffectTargetPrompt roll-table resolver",
      notes: "D6 table rolls with flat damage/heal outcomes are automated when target and table data are available. Complex branch actions still create manual follow-up events."
    };
  }

  if (actionType.includes("TAKE_CONTROL") || actionType.includes("STEAL")) {
    return {
      level: "UNSUPPORTED",
      route: "none",
      notes: "Control-change and steal routes still need card-specific ownership/controller handling."
    };
  }

  if (isBattleTrigger(trigger)) {
    return {
      level: "PARTIAL",
      route: "creatureRuntimeEffects.resolveBattleTriggeredRuntimeEffects",
      notes: "Battle trigger is detected, but this action type still needs a dedicated resolver."
    };
  }

  const catalogEntry = getEffectActionCatalogEntry(actionType);

  if (catalogEntry) {
    return {
      level: catalogEntry.supportLevel === "UNSUPPORTED" ? "UNSUPPORTED" : catalogEntry.supportLevel,
      route: catalogEntry.route,
      notes: `${catalogEntry.notes} Family: ${catalogEntry.family}. Current card effects using this action type: ${catalogEntry.currentCardEffectCount}.`
    };
  }

  return {
    level: "UNSUPPORTED",
    route: "none",
    notes: "No runtime route is registered for this action type yet. Add it to effectActionCatalog.ts before patching card data so it appears in the engine work queue."
  };
}

export function getRuntimeSupportSortWeight(level: RuntimeSupportLevel): number {
  switch (level) {
    case "SUPPORTED": return 1;
    case "PARTIAL": return 2;
    case "MANUAL": return 3;
    case "UNSUPPORTED": return 4;
  }
}
