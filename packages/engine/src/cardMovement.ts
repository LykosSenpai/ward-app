import { v4 as uuidv4 } from "uuid";
import type {
  CardDefinition,
  CardInstance,
  CreatureCardDefinition,
  EffectTargetOption,
  MatchState,
  PlayerState,
  StatModifierDurationType,
  StatModifierKey
} from "@ward/shared";
import { calculateCemeteryCreatureHp } from "./cemetery.js";
import { removeStatModifiersFromSourceCard } from "./effectiveStats.js";
import { removeActiveEffectInstancesFromSource, removeSourceLinkedRuntimeEffectsFromSource } from "./activeEffectInstances.js";
import { getCardDefinition, getPlayer, type AddEventFn } from "./engineRuntime.js";
import { moveAttachedMagicCardsToCemeteryForCreature } from "./attachments.js";
import { moveFieldCreatureToCemetery, type FieldCreatureRemovalResult } from "./fieldRemoval.js";
import { runCardRemovedFromFieldTriggers } from "./triggers.js";
import { advancePrimaryReplacementRequirement } from "./replacementRequirements.js";
import { assertCanAddMagicToField, MAX_INFINITE_MAGIC_ON_FIELD } from "./magicField.js";

export type MoveMagicSlotToCemeteryResult = {
  magicCard: CardInstance;
  destroyedCardName: string;
  fieldOwnerPlayerId: string;
  cardOwnerPlayerId: string;
  linkedDestroyedCreatures: Array<{
    creature: CardInstance;
    creatureName: string;
    fieldOwnerPlayerId: string;
    ownerPlayerId: string;
  }>;
};

export type CreatureTargetResult = {
  playerId: string;
  creature: CardInstance;
  creatureName: string;
  ownerPlayerId: string;
  targetKind: "PRIMARY_CREATURE" | "LIMITED_SUMMON";
};

type RemovableCardLocation = {
  player?: PlayerState;
  card: CardInstance;
  zone:
    | "HAND"
    | "DECK"
    | "CEMETERY"
    | "REMOVED_FROM_GAME"
    | "MAGIC_SLOT"
    | "CHAIN";
  remove: () => void;
};

function findRemovableCardByInstanceId(
  state: MatchState,
  cardInstanceId: string
): RemovableCardLocation | undefined {
  const chainIndex = state.chainZone.findIndex(
    card => card.instanceId === cardInstanceId
  );

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
      zone:
        | "HAND"
        | "DECK"
        | "CEMETERY"
        | "REMOVED_FROM_GAME"
        | "MAGIC_SLOT";
      cards: CardInstance[];
    }> = [
      { zone: "HAND", cards: player.hand },
      { zone: "DECK", cards: player.deck },
      { zone: "CEMETERY", cards: player.cemetery },
      { zone: "REMOVED_FROM_GAME", cards: player.removedFromGame },
      { zone: "MAGIC_SLOT", cards: player.field.magicSlots }
    ];

    for (const zoneInfo of zones) {
      const index = zoneInfo.cards.findIndex(
        card => card.instanceId === cardInstanceId
      );

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

function destroyLimitedSummonsAnchoredToMagic(
  state: MatchState,
  sourceMagicInstanceId: string
): Array<{
  creature: CardInstance;
  creatureName: string;
  fieldOwnerPlayerId: string;
  ownerPlayerId: string;
}> {
  const destroyed: Array<{
    creature: CardInstance;
    creatureName: string;
    fieldOwnerPlayerId: string;
    ownerPlayerId: string;
  }> = [];

  for (const fieldOwner of state.players) {
    for (let index = fieldOwner.field.limitedSummons.length - 1; index >= 0; index--) {
      const creature = fieldOwner.field.limitedSummons[index];

      if (creature.anchorSourceInstanceId !== sourceMagicInstanceId) {
        continue;
      }

      fieldOwner.field.limitedSummons.splice(index, 1);

      const definition = getCardDefinition(state, creature);

      creature.zone = "CEMETERY";
      creature.currentHp = 0;
      creature.anchorSourceInstanceId = undefined;

      const ownerPlayer = getPlayer(state, creature.ownerPlayerId);
      ownerPlayer.cemetery.push(creature);
      ownerPlayer.cemeteryCreatureHpTotal = calculateCemeteryCreatureHp(ownerPlayer);

      moveAttachedMagicCardsToCemeteryForCreature(
        state,
        creature.instanceId,
        () => undefined
      );

      destroyed.push({
        creature,
        creatureName: definition.name,
        fieldOwnerPlayerId: fieldOwner.id,
        ownerPlayerId: ownerPlayer.id
      });
    }
  }

  return destroyed;
}

export function moveMagicSlotCardToCemetery(
  state: MatchState,
  fieldOwnerPlayerId: string,
  cardInstanceId: string,
  addEvent?: AddEventFn,
  reason = "MAGIC_REMOVED_FROM_FIELD"
): MoveMagicSlotToCemeteryResult {
  const fieldOwner = getPlayer(state, fieldOwnerPlayerId);

  const magicSlotIndex = fieldOwner.field.magicSlots.findIndex(
    card => card.instanceId === cardInstanceId
  );

  if (magicSlotIndex === -1) {
    throw new Error("Selected Magic card is no longer in a Magic Slot.");
  }

  const magicCard = fieldOwner.field.magicSlots[magicSlotIndex];
  const definition = getCardDefinition(state, magicCard);

  if (definition.cardType !== "MAGIC") {
    throw new Error("Selected target is not a Magic card.");
  }

  fieldOwner.field.magicSlots.splice(magicSlotIndex, 1);

  const ownerPlayer = getPlayer(state, magicCard.ownerPlayerId);

  magicCard.zone = "CEMETERY";
  magicCard.attachedToInstanceId = undefined;

  ownerPlayer.cemetery.push(magicCard);
  ownerPlayer.cemeteryCreatureHpTotal = calculateCemeteryCreatureHp(ownerPlayer);

  removeStatModifiersFromSourceCard(state, magicCard.instanceId);
  for (const player of state.players) {
    if (player.field.primaryCreature) {
      removeActiveEffectInstancesFromSource(player.field.primaryCreature, magicCard.instanceId);
    }
    for (const creature of player.field.limitedSummons) {
      removeActiveEffectInstancesFromSource(creature, magicCard.instanceId);
    }
  }

  const triggerResult = runCardRemovedFromFieldTriggers(state, {
    removedCard: magicCard,
    removedCardName: definition.name,
    removedFromZone: "MAGIC_SLOT",
    causedByPlayerId: fieldOwnerPlayerId,
    reason,
    addEvent
  });

  const linkedDestroyedCreatures = triggerResult.linkedDestroyedCreatures;

  return {
    magicCard,
    destroyedCardName: definition.name,
    fieldOwnerPlayerId: fieldOwner.id,
    cardOwnerPlayerId: ownerPlayer.id,
    linkedDestroyedCreatures
  };
}

function requireCardTargetOption(
  option: EffectTargetOption
): EffectTargetOption & { cardInstanceId: string } {
  if (!option.cardInstanceId) {
    throw new Error("Selected target option does not contain a card instance ID.");
  }

  return option as EffectTargetOption & { cardInstanceId: string };
}

function getCreatureTargetFromOption(
  state: MatchState,
  option: EffectTargetOption
): {
  fieldOwnerPlayerId: string;
  fieldOwnerIndex: number;
  creature: CardInstance;
  definition: CreatureCardDefinition;
  targetKind: "PRIMARY_CREATURE" | "LIMITED_SUMMON";
} {
  const selected = requireCardTargetOption(option);
  const fieldOwner = getPlayer(state, selected.playerId);

  if (selected.targetKind === "PRIMARY_CREATURE") {
    const creature = fieldOwner.field.primaryCreature;

    if (!creature || creature.instanceId !== selected.cardInstanceId) {
      throw new Error("Selected primary creature is no longer on the field.");
    }

    const definition = getCardDefinition(state, creature);

    if (definition.cardType !== "CREATURE") {
      throw new Error("Selected primary card is not a creature.");
    }

    return {
      fieldOwnerPlayerId: fieldOwner.id,
      fieldOwnerIndex: -1,
      creature,
      definition,
      targetKind: "PRIMARY_CREATURE"
    };
  }

  if (selected.targetKind === "LIMITED_SUMMON") {
    const index = fieldOwner.field.limitedSummons.findIndex(
      card => card.instanceId === selected.cardInstanceId
    );

    if (index === -1) {
      throw new Error("Selected limited summon is no longer on the field.");
    }

    const creature = fieldOwner.field.limitedSummons[index];
    const definition = getCardDefinition(state, creature);

    if (definition.cardType !== "CREATURE") {
      throw new Error("Selected limited summon is not a creature.");
    }

    return {
      fieldOwnerPlayerId: fieldOwner.id,
      fieldOwnerIndex: index,
      creature,
      definition,
      targetKind: "LIMITED_SUMMON"
    };
  }

  throw new Error(`Unsupported creature target kind: ${selected.targetKind}`);
}


function creatureCannotReceiveHpDamage(card: CardInstance): boolean {
  return (card.activeStatuses ?? []).some(status => status.flags.canReceiveDamage === false);
}

function moveCreatureTargetToCemetery(
  state: MatchState,
  target: ReturnType<typeof getCreatureTargetFromOption>,
  addEvent?: AddEventFn
): FieldCreatureRemovalResult {
  return moveFieldCreatureToCemetery(state, {
    fieldOwnerPlayerId: target.fieldOwnerPlayerId,
    creatureInstanceId: target.creature.instanceId,
    removedFromZone: target.targetKind,
    causedByPlayerId: target.fieldOwnerPlayerId,
    reason: target.targetKind === "PRIMARY_CREATURE"
      ? "PRIMARY_CREATURE_KILLED_BY_EFFECT_DAMAGE"
      : "LIMITED_SUMMON_REMOVED_BY_EFFECT_DAMAGE",
    requirePrimaryReplacement: target.targetKind === "PRIMARY_CREATURE",
    autoPromoteSingleLimitedSummon: true,
    addEvent
  });
}

export function applyDamageToCreatureTarget(
  state: MatchState,
  option: EffectTargetOption,
  damageAmount: number,
  addEvent?: AddEventFn
): CreatureTargetResult & {
  damageAmount: number;
  remainingHp: number;
  killed: boolean;
  removalResult?: FieldCreatureRemovalResult;
} {
  if (!Number.isFinite(damageAmount) || damageAmount <= 0) {
    throw new Error("Damage amount must be greater than 0.");
  }

  const target = getCreatureTargetFromOption(state, option);

  const currentHp =
    target.creature.currentHp ?? target.creature.baseHp ?? target.definition.hp;

  if (creatureCannotReceiveHpDamage(target.creature)) {
    return {
      playerId: target.fieldOwnerPlayerId,
      creature: target.creature,
      creatureName: target.definition.name,
      ownerPlayerId: target.creature.ownerPlayerId,
      targetKind: target.targetKind,
      damageAmount: 0,
      remainingHp: currentHp,
      killed: false
    };
  }

  const nextHp = Math.max(0, currentHp - damageAmount);

  target.creature.currentHp = nextHp;
  const removalResult = nextHp === 0
    ? moveCreatureTargetToCemetery(state, target, addEvent)
    : undefined;

  return {
    playerId: target.fieldOwnerPlayerId,
    creature: target.creature,
    creatureName: target.definition.name,
    ownerPlayerId: target.creature.ownerPlayerId,
    targetKind: target.targetKind,
    damageAmount,
    remainingHp: nextHp,
    killed: nextHp === 0,
    removalResult
  };
}

export function healCreatureTarget(
  state: MatchState,
  option: EffectTargetOption,
  healAmount: number
): CreatureTargetResult & {
  healAmount: number;
  remainingHp: number;
  maxHp: number;
} {
  if (!Number.isFinite(healAmount) || healAmount <= 0) {
    throw new Error("Heal amount must be greater than 0.");
  }

  const target = getCreatureTargetFromOption(state, option);

  const maxHp = target.creature.baseHp ?? target.definition.hp;
  const currentHp = target.creature.currentHp ?? maxHp;
  const nextHp = Math.min(maxHp, currentHp + healAmount);

  target.creature.currentHp = nextHp;

  return {
    playerId: target.fieldOwnerPlayerId,
    creature: target.creature,
    creatureName: target.definition.name,
    ownerPlayerId: target.creature.ownerPlayerId,
    targetKind: target.targetKind,
    healAmount,
    remainingHp: nextHp,
    maxHp
  };
}

export function applyStatModifierToCreatureTarget(
  state: MatchState,
  option: EffectTargetOption,
  args: {
    sourceEffectId: string;
    sourceCardInstanceId: string;
    sourceCardName: string;
    stat: StatModifierKey;
    delta: number;
    durationType: StatModifierDurationType;
    durationTargetPlayerTurnStarts?: number;
  }
): CreatureTargetResult & {
  stat: StatModifierKey;
  delta: number;
  modifierId: string;
} {
  if (!Number.isFinite(args.delta) || args.delta === 0) {
    throw new Error("Stat modifier amount cannot be 0.");
  }

  const target = getCreatureTargetFromOption(state, option);
  const targetPlayerTurnStartCount =
    state.turn.turnStartCountsByPlayer[target.fieldOwnerPlayerId] ?? 0;
  const safeDurationTargetPlayerTurnStarts =
    args.durationTargetPlayerTurnStarts ?? 1;

  target.creature.activeStatModifiers ??= [];

  const modifier = {
    id: uuidv4(),
    sourceEffectId: args.sourceEffectId,
    sourceCardInstanceId: args.sourceCardInstanceId,
    sourceCardName: args.sourceCardName,
    stat: args.stat,
    delta: args.delta,
    durationType: args.durationType,
    appliedTurnNumber: state.turn.turnNumber,
    appliedTurnCycle: state.turn.turnCycleNumber,
    expiresOnPlayerId:
      args.durationType === "TARGET_PLAYER_TURN_STARTS"
        ? target.fieldOwnerPlayerId
        : undefined,
    expiresAtPlayerTurnStartCount:
      args.durationType === "TARGET_PLAYER_TURN_STARTS"
        ? targetPlayerTurnStartCount + safeDurationTargetPlayerTurnStarts
        : undefined
  };

  target.creature.activeStatModifiers.push(modifier);

  return {
    playerId: target.fieldOwnerPlayerId,
    creature: target.creature,
    creatureName: target.definition.name,
    ownerPlayerId: target.creature.ownerPlayerId,
    targetKind: target.targetKind,
    stat: args.stat,
    delta: args.delta,
    modifierId: modifier.id
  };
}

function getMutablePlayerZoneCards(
  player: PlayerState,
  zone: "HAND" | "DECK" | "CEMETERY" | "REMOVED_FROM_GAME"
): CardInstance[] {
  if (zone === "HAND") return player.hand;
  if (zone === "DECK") return player.deck;
  if (zone === "CEMETERY") return player.cemetery;
  return player.removedFromGame;
}

export function moveSelectedCardToHand(
  state: MatchState,
  option: EffectTargetOption,
  addEvent?: AddEventFn,
  reason = "CARD_RETURNED_TO_HAND"
): {
  sourcePlayerId: string;
  destinationPlayerId: string;
  card: CardInstance;
  cardName: string;
  sourceZone: EffectTargetOption["zone"];
} {
  const selected = requireCardTargetOption(option);

  if (selected.zone === "PRIMARY_CREATURE" || selected.zone === "LIMITED_SUMMON") {
    const sourcePlayer = getPlayer(state, selected.playerId);
    const card = selected.zone === "PRIMARY_CREATURE"
      ? sourcePlayer.field.primaryCreature
      : sourcePlayer.field.limitedSummons.find(item => item.instanceId === selected.cardInstanceId);

    if (!card || card.instanceId !== selected.cardInstanceId) {
      throw new Error("Selected field creature is no longer in the expected source zone.");
    }

    if (selected.zone === "PRIMARY_CREATURE") {
      sourcePlayer.field.primaryCreature = undefined;
    } else {
      const index = sourcePlayer.field.limitedSummons.findIndex(item => item.instanceId === selected.cardInstanceId);
      if (index >= 0) sourcePlayer.field.limitedSummons.splice(index, 1);
    }

    const definition = getCardDefinition(state, card);
    const destinationPlayer = getPlayer(state, card.ownerPlayerId);
    moveAttachedMagicCardsToCemeteryForCreature(state, card.instanceId);
    removeSourceLinkedRuntimeEffectsFromSource(state, {
      sourceCardInstanceId: card.instanceId,
      sourceCardId: card.cardId,
      sourceCardName: definition.name,
      sourceDefinition: definition,
      causedByPlayerId: selected.playerId,
      reason,
      addEvent
    });
    removeActiveEffectInstancesFromSource(card, card.instanceId);
    card.zone = "HAND";
    card.controllerPlayerId = destinationPlayer.id;
    card.currentHp = definition.cardType === "CREATURE" ? definition.hp : card.currentHp;
    destinationPlayer.hand.push(card);

    return {
      sourcePlayerId: sourcePlayer.id,
      destinationPlayerId: destinationPlayer.id,
      card,
      cardName: definition.name,
      sourceZone: selected.zone
    };
  }

  if (
    selected.zone !== "DECK" &&
    selected.zone !== "CEMETERY" &&
    selected.zone !== "REMOVED_FROM_GAME"
  ) {
    throw new Error(`Cannot move selected card from ${selected.zone} to hand.`);
  }

  const sourcePlayer = getPlayer(state, selected.playerId);
  const sourceCards = getMutablePlayerZoneCards(sourcePlayer, selected.zone);
  const sourceIndex = sourceCards.findIndex(
    card => card.instanceId === selected.cardInstanceId
  );

  if (sourceIndex === -1) {
    throw new Error("Selected card is no longer in the expected source zone.");
  }

  const [card] = sourceCards.splice(sourceIndex, 1);
  const definition = getCardDefinition(state, card);

  card.zone = "HAND";
  sourcePlayer.hand.push(card);

  if (selected.zone === "CEMETERY") {
    sourcePlayer.cemeteryCreatureHpTotal = calculateCemeteryCreatureHp(sourcePlayer);
  }

  return {
    sourcePlayerId: sourcePlayer.id,
    destinationPlayerId: sourcePlayer.id,
    card,
    cardName: definition.name,
    sourceZone: selected.zone
  };
}


export function discardSelectedCardToCemetery(
  state: MatchState,
  option: EffectTargetOption,
  destinationOwnerPlayerId?: string
): {
  sourcePlayerId: string;
  destinationPlayerId: string;
  card: CardInstance;
  cardName: string;
  sourceZone: EffectTargetOption["zone"];
} {
  const selected = requireCardTargetOption(option);

  if (selected.zone !== "HAND") {
    throw new Error(`Cannot discard selected card from ${selected.zone}.`);
  }

  const sourcePlayer = getPlayer(state, selected.playerId);
  const sourceCards = getMutablePlayerZoneCards(sourcePlayer, selected.zone);
  const sourceIndex = sourceCards.findIndex(
    card => card.instanceId === selected.cardInstanceId
  );

  if (sourceIndex === -1) {
    throw new Error("Selected card is no longer in the expected source zone.");
  }

  const [card] = sourceCards.splice(sourceIndex, 1);
  const definition = getCardDefinition(state, card);
  const destinationPlayer = getPlayer(
    state,
    destinationOwnerPlayerId ?? card.ownerPlayerId
  );

  card.zone = "CEMETERY";
  card.controllerPlayerId = destinationPlayer.id;

  if (definition.cardType === "CREATURE") {
    card.currentHp = 0;
  }

  destinationPlayer.cemetery.push(card);
  destinationPlayer.cemeteryCreatureHpTotal =
    calculateCemeteryCreatureHp(destinationPlayer);

  if (sourcePlayer.id !== destinationPlayer.id) {
    sourcePlayer.cemeteryCreatureHpTotal = calculateCemeteryCreatureHp(sourcePlayer);
  }

  return {
    sourcePlayerId: sourcePlayer.id,
    destinationPlayerId: destinationPlayer.id,
    card,
    cardName: definition.name,
    sourceZone: selected.zone
  };
}


export function limitedSummonSelectedCreature(
  state: MatchState,
  option: EffectTargetOption,
  controllerPlayerId: string
): {
  sourcePlayerId: string;
  controllerPlayerId: string;
  card: CardInstance;
  cardName: string;
  sourceZone: EffectTargetOption["zone"];
  slotCount: number;
} {
  const selected = requireCardTargetOption(option);

  if (
    selected.zone !== "HAND" &&
    selected.zone !== "DECK" &&
    selected.zone !== "CEMETERY" &&
    selected.zone !== "REMOVED_FROM_GAME"
  ) {
    throw new Error(`Cannot Limited Summon selected card from ${selected.zone}.`);
  }

  const sourcePlayer = getPlayer(state, selected.playerId);
  const controllerPlayer = getPlayer(state, controllerPlayerId);

  if (controllerPlayer.field.limitedSummons.length >= 4) {
    throw new Error(`${controllerPlayer.displayName} already has 4 Limited Summons.`);
  }

  const sourceCards = getMutablePlayerZoneCards(sourcePlayer, selected.zone);
  const sourceIndex = sourceCards.findIndex(
    card => card.instanceId === selected.cardInstanceId
  );

  if (sourceIndex === -1) {
    throw new Error("Selected card is no longer in the expected source zone.");
  }

  const [card] = sourceCards.splice(sourceIndex, 1);
  const definition = getCardDefinition(state, card);

  if (definition.cardType !== "CREATURE") {
    throw new Error("Only Creature cards can be Limited Summoned.");
  }

  card.zone = "LIMITED_SUMMON";
  card.controllerPlayerId = controllerPlayer.id;
  card.isLimitedSummon = true;
  card.effectsSuppressed = true;
  card.baseHp = definition.hp;
  card.currentHp = definition.hp;

  controllerPlayer.field.limitedSummons.push(card);

  if (selected.zone === "CEMETERY") {
    sourcePlayer.cemeteryCreatureHpTotal = calculateCemeteryCreatureHp(sourcePlayer);
  }

  return {
    sourcePlayerId: sourcePlayer.id,
    controllerPlayerId: controllerPlayer.id,
    card,
    cardName: definition.name,
    sourceZone: selected.zone,
    slotCount: controllerPlayer.field.limitedSummons.length
  };
}



export function summonPrimaryFromCemeteryAndEquipSource(
  state: MatchState,
  option: EffectTargetOption,
  controllerPlayerId: string,
  sourceMagicCardInstanceId: string,
  addEvent?: AddEventFn
): {
  sourcePlayerId: string;
  controllerPlayerId: string;
  card: CardInstance;
  cardName: string;
  sourceZone: EffectTargetOption["zone"];
  equippedMagicCard: CardInstance;
  equippedMagicCardName: string;
  equippedMagicSourcePlayerId?: string;
  equippedMagicSourceZone: RemovableCardLocation["zone"];
  magicSlotCount: number;
  replacedPrimaryCardInstanceId?: string;
  replacedPrimaryCardName?: string;
} {
  const selected = requireCardTargetOption(option);

  if (selected.zone !== "CEMETERY") {
    throw new Error("This effect must select a creature from the cemetery.");
  }

  const controllerPlayer = getPlayer(state, controllerPlayerId);
  const sourcePlayer = getPlayer(state, selected.playerId);
  const sourceCards = getMutablePlayerZoneCards(sourcePlayer, selected.zone);
  const selectedIndex = sourceCards.findIndex(card => card.instanceId === selected.cardInstanceId);

  if (selectedIndex === -1) {
    throw new Error("Selected cemetery card is no longer available.");
  }

  const sourceLocation = findRemovableCardByInstanceId(
    state,
    sourceMagicCardInstanceId
  );

  if (!sourceLocation) {
    throw new Error("The source Magic card for this anchored summon was not found.");
  }

  const sourceDefinition = getCardDefinition(state, sourceLocation.card);

  if (sourceDefinition.cardType !== "MAGIC") {
    throw new Error("The source card for this anchored summon is not a Magic card.");
  }

  const sourceAlreadyUsesControllerMagicSlot =
    sourceLocation.zone === "MAGIC_SLOT" &&
    sourceLocation.player?.id === controllerPlayer.id;
  assertCanAddMagicToField(state, controllerPlayer, sourceLocation.card, {
    excludeCardInstanceId: sourceAlreadyUsesControllerMagicSlot ? sourceLocation.card.instanceId : undefined,
    message: `${controllerPlayer.displayName} already has ${MAX_INFINITE_MAGIC_ON_FIELD} Infinite Magic cards and cannot anchor this summoned creature.`
  });

  let replacedPrimaryCardInstanceId: string | undefined;
  let replacedPrimaryCardName: string | undefined;
  const existingPrimary = controllerPlayer.field.primaryCreature;

  if (existingPrimary) {
    const existingDefinition = getCardDefinition(state, existingPrimary);
    if (existingDefinition.cardType !== "CREATURE") {
      throw new Error("Existing primary field card is not a creature.");
    }

    controllerPlayer.field.primaryCreature = undefined;
    replacedPrimaryCardInstanceId = existingPrimary.instanceId;
    replacedPrimaryCardName = existingDefinition.name;

    moveAttachedMagicCardsToCemeteryForCreature(
      state,
      existingPrimary.instanceId,
      addEvent
    );

    runCardRemovedFromFieldTriggers(state, {
      removedCard: existingPrimary,
      removedCardName: existingDefinition.name,
      removedFromZone: "PRIMARY_CREATURE",
      causedByPlayerId: controllerPlayer.id,
      reason: "REVIVAL_PRIEST_REPLACED_PRIMARY_TO_HAND",
      addEvent
    });

    existingPrimary.zone = "HAND";
    existingPrimary.controllerPlayerId = existingPrimary.ownerPlayerId;
    existingPrimary.isLimitedSummon = false;
    existingPrimary.effectsSuppressed = false;
    existingPrimary.attachedToInstanceId = undefined;
    existingPrimary.anchorSourceInstanceId = undefined;
    existingPrimary.baseHp = existingDefinition.hp;
    existingPrimary.currentHp = existingDefinition.hp;
    existingPrimary.activeStatModifiers = [];
    existingPrimary.activeStatuses = [];
    existingPrimary.activeRecurringEffects = [];
    existingPrimary.activeEffectInstances = [];

    const existingOwner = getPlayer(state, existingPrimary.ownerPlayerId);
    existingOwner.hand.push(existingPrimary);

    addEvent?.(state, "PRIMARY_CREATURE_RETURNED_TO_HAND_BY_ANCHORED_SUMMON", controllerPlayer.id, {
      cardInstanceId: existingPrimary.instanceId,
      cardName: existingDefinition.name,
      ownerPlayerId: existingOwner.id,
      controllerPlayerId: controllerPlayer.id
    });
  }

  const [card] = sourceCards.splice(selectedIndex, 1);
  const definition = getCardDefinition(state, card);

  if (definition.cardType !== "CREATURE") {
    throw new Error("Only Creature cards can be summoned from the cemetery as a primary creature.");
  }

  card.zone = "PRIMARY_CREATURE";
  card.controllerPlayerId = controllerPlayer.id;
  card.isLimitedSummon = false;
  card.effectsSuppressed = false;
  card.attachedToInstanceId = undefined;
  card.anchorSourceInstanceId = sourceLocation.card.instanceId;
  card.baseHp = definition.hp;
  card.currentHp = definition.hp;

  controllerPlayer.field.primaryCreature = card;
  sourcePlayer.cemeteryCreatureHpTotal = calculateCemeteryCreatureHp(sourcePlayer);
  advancePrimaryReplacementRequirement(state, controllerPlayer.id);

  sourceLocation.remove();

  if (sourceLocation.zone === "CEMETERY" && sourceLocation.player) {
    sourceLocation.player.cemeteryCreatureHpTotal = calculateCemeteryCreatureHp(
      sourceLocation.player
    );
  }

  sourceLocation.card.zone = "MAGIC_SLOT";
  sourceLocation.card.controllerPlayerId = controllerPlayer.id;
  sourceLocation.card.attachedToInstanceId = card.instanceId;

  if (!controllerPlayer.field.magicSlots.some(item => item.instanceId === sourceLocation.card.instanceId)) {
    controllerPlayer.field.magicSlots.push(sourceLocation.card);
  }

  return {
    sourcePlayerId: sourcePlayer.id,
    controllerPlayerId: controllerPlayer.id,
    card,
    cardName: definition.name,
    sourceZone: selected.zone,
    equippedMagicCard: sourceLocation.card,
    equippedMagicCardName: sourceDefinition.name,
    equippedMagicSourcePlayerId: sourceLocation.player?.id ?? sourceLocation.card.controllerPlayerId,
    equippedMagicSourceZone: sourceLocation.zone,
    magicSlotCount: controllerPlayer.field.magicSlots.length,
    replacedPrimaryCardInstanceId,
    replacedPrimaryCardName
  };
}

export function limitedSummonSelectedCreatureAndEquipSource(
  state: MatchState,
  option: EffectTargetOption,
  controllerPlayerId: string,
  sourceMagicCardInstanceId: string
): {
  sourcePlayerId: string;
  controllerPlayerId: string;
  card: CardInstance;
  cardName: string;
  sourceZone: EffectTargetOption["zone"];
  slotCount: number;
  equippedMagicCard: CardInstance;
  equippedMagicCardName: string;
  equippedMagicSourcePlayerId?: string;
  equippedMagicSourceZone: RemovableCardLocation["zone"];
  magicSlotCount: number;
} {
  const controllerPlayer = getPlayer(state, controllerPlayerId);

  const sourceLocation = findRemovableCardByInstanceId(
    state,
    sourceMagicCardInstanceId
  );

  if (!sourceLocation) {
    throw new Error("The source Magic card for this equip effect was not found.");
  }

  const sourceDefinition = getCardDefinition(state, sourceLocation.card);

  if (sourceDefinition.cardType !== "MAGIC") {
    throw new Error("The source card for this equip effect is not a Magic card.");
  }

  const sourceAlreadyUsesControllerMagicSlot =
    sourceLocation.zone === "MAGIC_SLOT" &&
    sourceLocation.player?.id === controllerPlayer.id;
  assertCanAddMagicToField(state, controllerPlayer, sourceLocation.card, {
    excludeCardInstanceId: sourceAlreadyUsesControllerMagicSlot ? sourceLocation.card.instanceId : undefined,
    message: `${controllerPlayer.displayName} already has ${MAX_INFINITE_MAGIC_ON_FIELD} Infinite Magic cards and cannot equip this source card.`
  });

  const summonResult = limitedSummonSelectedCreature(
    state,
    option,
    controllerPlayerId
  );

  sourceLocation.remove();

  if (sourceLocation.zone === "CEMETERY" && sourceLocation.player) {
    sourceLocation.player.cemeteryCreatureHpTotal = calculateCemeteryCreatureHp(
      sourceLocation.player
    );
  }

  sourceLocation.card.zone = "MAGIC_SLOT";
  sourceLocation.card.controllerPlayerId = controllerPlayer.id;
  sourceLocation.card.attachedToInstanceId = summonResult.card.instanceId;

  summonResult.card.anchorSourceInstanceId = sourceLocation.card.instanceId;

  controllerPlayer.field.magicSlots.push(sourceLocation.card);

  return {
    ...summonResult,
    equippedMagicCard: sourceLocation.card,
    equippedMagicCardName: sourceDefinition.name,
    equippedMagicSourcePlayerId: sourceLocation.player?.id ?? sourceLocation.card.controllerPlayerId,
    equippedMagicSourceZone: sourceLocation.zone,
    magicSlotCount: controllerPlayer.field.magicSlots.length
  };
}

export function moveAllMagicSlotCardsToCemetery(
  state: MatchState,
  scopePlayerIds?: string[],
  addEvent?: AddEventFn,
  reason = "MAGIC_REMOVED_FROM_FIELD"
): {
  destroyedCount: number;
  destroyedCards: MoveMagicSlotToCemeteryResult[];
} {
  const allowed = scopePlayerIds ? new Set(scopePlayerIds) : undefined;
  const destroyedCards: MoveMagicSlotToCemeteryResult[] = [];

  for (const player of [...state.players]) {
    if (allowed && !allowed.has(player.id)) continue;

    for (const magic of [...player.field.magicSlots]) {
      destroyedCards.push(
        moveMagicSlotCardToCemetery(
          state,
          player.id,
          magic.instanceId,
          addEvent,
          reason
        )
      );
    }
  }

  return {
    destroyedCount: destroyedCards.length,
    destroyedCards
  };
}
