import { v4 as uuidv4 } from "uuid";
import { getRuntimeBlockActionType, getRuntimeBlockDurationText } from "./effectBlockRuntime.js";
import type { CardDefinition, CardInstance, MatchState, PlayerState, WardEngineEffect } from "@ward/shared";
import { getRequiredSacrificesForCreatureDefinition } from "./summonRules.js";
import { getCardDefinition } from "./engineRuntime.js";
import { creatureCannotBeSacrificed } from "./creatureRuntimeEffects.js";

export function sourceMagicIsCurrentlyOnField(
  state: MatchState,
  sourceCardInstanceId: string
): boolean {
  return state.players.some(player =>
    player.field.magicSlots.some(
      card => card.instanceId === sourceCardInstanceId
    )
  );
}


export function shuffleCards<T>(cards: T[]): T[] {
  const shuffled = [...cards];

  for (let index = shuffled.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [
      shuffled[randomIndex],
      shuffled[index]
    ];
  }

  return shuffled;
}


export function validateHandSacrificesForCreature(
  state: MatchState,
  player: PlayerState,
  targetCard: CardInstance,
  sacrificeCardInstanceIds: string[]
): {
  requiredSacrifices: number;
  sacrificeCards: CardInstance[];
} {
  const targetDefinition = getCardDefinition(state, targetCard);

  if (targetDefinition.cardType !== "CREATURE") {
    throw new Error("Only creature cards can be summoned as primary.");
  }

  const requiredSacrifices =
    getRequiredSacrificesForCreatureDefinition(targetDefinition);

  const uniqueSacrificeIds = [...new Set(sacrificeCardInstanceIds)];

  if (uniqueSacrificeIds.length !== sacrificeCardInstanceIds.length) {
    throw new Error("Duplicate sacrifice cards were selected.");
  }

  if (uniqueSacrificeIds.includes(targetCard.instanceId)) {
    throw new Error("The creature being summoned cannot sacrifice itself.");
  }

  if (uniqueSacrificeIds.length !== requiredSacrifices) {
    throw new Error(
      `${targetDefinition.name} requires ${requiredSacrifices} sacrifice(s). Selected: ${uniqueSacrificeIds.length}.`
    );
  }

  const primaryCreature = player.field.primaryCreature;

  const primaryCannotBeSacrificed = primaryCreature
    ? creatureCannotBeSacrificed(primaryCreature)
    : false;

  if (
    primaryCreature &&
    uniqueSacrificeIds.includes(primaryCreature.instanceId) &&
    primaryCannotBeSacrificed
  ) {
    const primaryDefinition = getCardDefinition(state, primaryCreature);

    throw new Error(
      `${primaryDefinition.name} cannot be used as sacrifice material because of an active card effect/status. Pay required sacrifices from hand instead.`
    );
  }

  if (
    primaryCreature &&
    !primaryCannotBeSacrificed &&
    !uniqueSacrificeIds.includes(primaryCreature.instanceId)
  ) {
    throw new Error(
      "Primary creature slot is occupied. Select the current primary creature as one of the sacrifices to summon a new primary creature."
    );
  }

  const sacrificeCards = uniqueSacrificeIds.map(sacrificeId => {
    const sacrificeCard =
      player.hand.find(card => card.instanceId === sacrificeId) ??
      (primaryCreature?.instanceId === sacrificeId ? primaryCreature : undefined);

    if (!sacrificeCard) {
      throw new Error(
        "Selected sacrifice card is not in this player's hand or primary creature field slot."
      );
    }

    const sacrificeDefinition = getCardDefinition(state, sacrificeCard);

    if (sacrificeDefinition.cardType !== "CREATURE") {
      throw new Error("Only creature cards can be used as sacrifices.");
    }

    if (sacrificeCard.isLimitedSummon || sacrificeCard.zone === "LIMITED_SUMMON") {
      throw new Error("Limited Summons cannot be used as sacrifices.");
    }

    if (creatureCannotBeSacrificed(sacrificeCard)) {
      throw new Error(`${sacrificeDefinition.name} cannot be sacrificed because of an active card effect/status.`);
    }

    return sacrificeCard;
  });

  if (requiresDragonQualifiedSacrifices(targetDefinition)) {
    const invalidSacrifice = sacrificeCards.find(sacrificeCard =>
      !isDragonQualifiedSacrifice(state, sacrificeCard)
    );

    if (invalidSacrifice) {
      const sacrificeDefinition = getCardDefinition(state, invalidSacrifice);
      throw new Error(
        `${targetDefinition.name} requires Dragon-named or Dragon-type sacrifices. ${sacrificeDefinition.name} is not a valid sacrifice.`
      );
    }
  }

  return {
    requiredSacrifices,
    sacrificeCards
  };
}

function requiresDragonQualifiedSacrifices(definition: CardDefinition): boolean {
  if (definition.cardType !== "CREATURE") return false;

  return (definition.effects ?? []).some(effect => {
    const actionType = String(effect.actionType ?? "").trim().toUpperCase();
    const trigger = String(effect.trigger ?? "").trim().toUpperCase();
    const condition = effect.condition as { text?: unknown } | undefined;
    const text = [
      condition?.text,
      effect.notes,
      effect.actionText,
      effect.value,
      definition.text
    ].filter(Boolean).join(" ").toLowerCase();

    return actionType === "VALIDATE_SUMMON_REQUIREMENT" &&
      trigger === "SUMMON_REQUIREMENT" &&
      text.includes("dragon");
  });
}

function isDragonQualifiedSacrifice(state: MatchState, card: CardInstance): boolean {
  const definition = getCardDefinition(state, card);
  if (definition.cardType !== "CREATURE") return false;
  return `${definition.name} ${definition.creatureType}`.toLowerCase().includes("dragon");
}


export function createManualEffectRequestFromChainLink(
  link: {
    cardInstanceId: string;
    cardId: string;
    cardName: string;
    magicType: "STANDARD" | "INFINITE" | "LIGHTNING" | "BATTLE_LIGHTNING";
    magicSubType: "FIELD" | "EQUIP" | "NONE";
    playerId: string;
    text: string;
  },
  effect?: WardEngineEffect
) {
  return {
    id: uuidv4(),

    sourceCardInstanceId: link.cardInstanceId,
    sourceCardId: link.cardId,
    sourceCardName: link.cardName,

    magicType: link.magicType,
    magicSubType: link.magicSubType,

    effectId: effect?.id,
    actionType: effect?.actionType,
    effectGroup: effect?.effectGroup,
    actionText: effect?.actionText,
    effectValue: effect?.value,
    durationText: effect ? getRuntimeBlockDurationText(effect) : undefined,

    controllerPlayerId: link.playerId,
    text: effect
      ? `${effect.actionText ?? effect.actionType}: ${effect.value ?? ""}\n\n${link.text}`
      : link.text,
    completed: false
  };
}


export function effectShouldResolveWhenCardIsPlayed(effect: WardEngineEffect): boolean {
  const trigger = effect.trigger?.trim().toUpperCase();
  const actionType = getRuntimeBlockActionType(effect).trim().toUpperCase();

  return (
    !trigger ||
    trigger === "ON_PLAY" ||
    trigger === "ON_PLAY_FIELD" ||
    trigger === "ON_EQUIP_OR_PLAY" ||
    trigger === "ON_PLAY_OR_SUMMON" ||
    trigger === "ON_RESOLVE" ||
    trigger === "ON_MAGIC_RESOLVES" ||
    trigger === "ON_OPPONENT_PLAYS_MAGIC" ||
    actionType === "APPLY_FORCED_FIRST_AUTO_HIT_MULTIPLIER"
  );
}
