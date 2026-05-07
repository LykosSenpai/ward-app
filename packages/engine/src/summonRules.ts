import type {
  CardDefinition,
  CardInstance,
  MatchState,
  PlayerState
} from "@ward/shared";
import { creatureCannotBeSacrificed } from "./creatureRuntimeEffects.js";

export function getRequiredSacrificesFromArmorLevel(armorLevel: number): number {
  if (armorLevel >= 1 && armorLevel <= 6) return 0;
  if (armorLevel >= 7 && armorLevel <= 11) return 1;
  if (armorLevel === 12) return 2;

  throw new Error(`Invalid Armor Level: ${armorLevel}`);
}

export function getRequiredSacrificesForCreatureDefinition(
  definition: CardDefinition
): number {
  if (definition.cardType !== "CREATURE") {
    throw new Error("Only creature cards have sacrifice requirements.");
  }

  if (hasNoSacrificeRequirementOverride(definition)) {
    return 0;
  }

  return getRequiredSacrificesFromArmorLevel(definition.armorLevel);
}

function hasNoSacrificeRequirementOverride(
  definition: Extract<CardDefinition, { cardType: "CREATURE" }>
): boolean {
  const text = String(definition.text ?? "").toLowerCase();
  if (text.includes("does not require a sacrifice") || text.includes("no sacrifice required")) {
    return true;
  }

  return (definition.effects ?? []).some(effect => {
    const actionType = String(effect.actionType ?? "").trim().toUpperCase();
    const trigger = String(effect.trigger ?? "").trim().toUpperCase();
    const valueText = [
      effect.actionText,
      effect.value,
      effect.params?.valueText,
      effect.notes
    ].filter(Boolean).join(" ").toLowerCase();

    return trigger === "SUMMON_REQUIREMENT" &&
      actionType === "OVERRIDE_SUMMON_SACRIFICE_REQUIREMENT" &&
      (
        valueText.includes("no sacrifice") ||
        valueText.includes("ignore sacrifice")
      );
  });
}

export function getHandCreatureCards(
  state: MatchState,
  player: PlayerState,
  excludeCardInstanceId?: string
): CardInstance[] {
  return player.hand.filter(card => {
    if (card.instanceId === excludeCardInstanceId) return false;
    if (creatureCannotBeSacrificed(card)) return false;

    const definition = state.cardCatalog[card.cardId];

    return definition?.cardType === "CREATURE";
  });
}

export function getAvailablePrimarySummonSacrificeCards(
  state: MatchState,
  player: PlayerState,
  targetCardInstanceId?: string
): CardInstance[] {
  const handSacrifices = getHandCreatureCards(
    state,
    player,
    targetCardInstanceId
  );

  const primaryCreature = player.field.primaryCreature;

  if (!primaryCreature || primaryCreature.instanceId === targetCardInstanceId) {
    return handSacrifices;
  }

  const primaryDefinition = state.cardCatalog[primaryCreature.cardId];

  if (primaryDefinition?.cardType !== "CREATURE") {
    return handSacrifices;
  }

  if (creatureCannotBeSacrificed(primaryCreature)) {
    return handSacrifices;
  }

  return [primaryCreature, ...handSacrifices];
}

export function canSummonCreatureFromHandAsPrimary(
  state: MatchState,
  player: PlayerState,
  card: CardInstance
): boolean {
  const definition = state.cardCatalog[card.cardId];

  if (!definition || definition.cardType !== "CREATURE") {
    return false;
  }

  const requiredSacrifices =
    getRequiredSacrificesForCreatureDefinition(definition);

  const primaryCreature = player.field.primaryCreature;

  const primaryCannotBeSacrificed = primaryCreature
    ? creatureCannotBeSacrificed(primaryCreature)
    : false;

  // A normal primary slot is only opened by sacrificing the current primary
  // or by using the explicit kill-own-primary action. However, a primary with
  // canBeSacrificed:false cannot be used as sacrifice material. In that case,
  // summoning a replacement is legal as long as the actual sacrifice cost is
  // paid from hand; the occupied primary is removed separately.
  if (primaryCreature && requiredSacrifices === 0 && !primaryCannotBeSacrificed) {
    return false;
  }

  const availableSacrifices = getAvailablePrimarySummonSacrificeCards(
    state,
    player,
    card.instanceId
  );

  if (
    primaryCreature &&
    !primaryCannotBeSacrificed &&
    !availableSacrifices.some(
      sacrifice => sacrifice.instanceId === primaryCreature.instanceId
    )
  ) {
    return false;
  }

  return availableSacrifices.length >= requiredSacrifices;
}

export function playerHasSummonableCreatureInHand(
  state: MatchState,
  player: PlayerState
): boolean {
  return player.hand.some(card =>
    canSummonCreatureFromHandAsPrimary(state, player, card)
  );
}
