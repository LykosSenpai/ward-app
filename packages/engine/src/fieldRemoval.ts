import type { CardInstance, MatchState, PlayerState } from "@ward/shared";
import { moveAttachedMagicCardsToCemeteryForCreature } from "./attachments.js";
import { calculateCemeteryCreatureHp } from "./cemetery.js";
import { addEvent as defaultAddEvent, getCardDefinition, getPlayer, type AddEventFn } from "./engineRuntime.js";
import { runCardRemovedFromFieldTriggers, type RemovedFromFieldTriggerResult } from "./triggers.js";
import { markReplacementCreatureForSilenceFromTheGraveIfNeeded } from "./silenceFromTheGrave.js";

export type FieldCreatureZone = "PRIMARY_CREATURE" | "LIMITED_SUMMON";

export type FieldCreatureRemovalResult = {
  creature: CardInstance;
  creatureName: string;
  removedFromZone: FieldCreatureZone;
  fieldOwnerPlayerId: string;
  ownerPlayerId: string;
  cemeteryCreatureHpTotal: number;
  primaryReplacementRequired: boolean;
  autoPromotedLimitedSummon?: {
    cardInstanceId: string;
    cardName: string;
    previousAnchorSourceInstanceId?: string;
  };
  linkedDestroyedCreatures: RemovedFromFieldTriggerResult["linkedDestroyedCreatures"];
};

function findLimitedSummonIndex(player: PlayerState, cardInstanceId: string): number {
  return player.field.limitedSummons.findIndex(card => card.instanceId === cardInstanceId);
}

function promoteSingleLimitedSummonToPrimaryIfRequired(
  state: MatchState,
  player: PlayerState,
  removedPrimaryInstanceId?: string,
  addEvent?: AddEventFn
): FieldCreatureRemovalResult["autoPromotedLimitedSummon"] | undefined {
  if (player.field.primaryCreature || player.field.limitedSummons.length !== 1) {
    return undefined;
  }

  const onlyLimited = player.field.limitedSummons[0];

  // A Limited Summon anchored by the primary that just left the field cannot
  // become the replacement primary. The anchor cleanup trigger should remove it,
  // but this guard prevents a stale anchored Limited Summon from being promoted.
  if (removedPrimaryInstanceId && onlyLimited.anchorSourceInstanceId === removedPrimaryInstanceId) {
    return undefined;
  }

  const [promotedCreature] = player.field.limitedSummons.splice(0, 1);
  const definition = getCardDefinition(state, promotedCreature);

  if (definition.cardType !== "CREATURE") {
    throw new Error("Only Creature cards can be promoted to primary creature.");
  }

  const previousAnchorSourceInstanceId = promotedCreature.anchorSourceInstanceId;

  promotedCreature.zone = "PRIMARY_CREATURE";
  promotedCreature.controllerPlayerId = player.id;
  promotedCreature.isLimitedSummon = false;
  promotedCreature.effectsSuppressed = false;
  promotedCreature.anchorSourceInstanceId = undefined;
  promotedCreature.baseHp = definition.hp;
  promotedCreature.currentHp = definition.hp;

  player.field.primaryCreature = promotedCreature;
  markReplacementCreatureForSilenceFromTheGraveIfNeeded(state, promotedCreature, addEvent ?? defaultAddEvent);
  state.setup.primaryReplacementRequiredForPlayerId = undefined;

  addEvent?.(state, "LIMITED_SUMMON_AUTO_PROMOTED_AFTER_PRIMARY_REMOVAL", player.id, {
    cardInstanceId: promotedCreature.instanceId,
    cardName: definition.name,
    previousAnchorSourceInstanceId,
    effectsRestored: true,
    reason: "Only one non-expired Limited Summon was available after primary creature removal."
  });

  return {
    cardInstanceId: promotedCreature.instanceId,
    cardName: definition.name,
    previousAnchorSourceInstanceId
  };
}

export function moveFieldCreatureToCemetery(
  state: MatchState,
  args: {
    fieldOwnerPlayerId: string;
    creatureInstanceId: string;
    removedFromZone?: FieldCreatureZone;
    causedByPlayerId?: string;
    reason: string;
    requirePrimaryReplacement?: boolean;
    autoPromoteSingleLimitedSummon?: boolean;
    addEvent?: AddEventFn;
  }
): FieldCreatureRemovalResult {
  const fieldOwner = getPlayer(state, args.fieldOwnerPlayerId);
  let removedFromZone: FieldCreatureZone | undefined;
  let creature: CardInstance | undefined;

  if (args.removedFromZone === "PRIMARY_CREATURE" || !args.removedFromZone) {
    const primary = fieldOwner.field.primaryCreature;
    if (primary?.instanceId === args.creatureInstanceId) {
      creature = primary;
      removedFromZone = "PRIMARY_CREATURE";
      fieldOwner.field.primaryCreature = undefined;
    }
  }

  if (!creature && (args.removedFromZone === "LIMITED_SUMMON" || !args.removedFromZone)) {
    const limitedIndex = findLimitedSummonIndex(fieldOwner, args.creatureInstanceId);
    if (limitedIndex !== -1) {
      creature = fieldOwner.field.limitedSummons[limitedIndex];
      removedFromZone = "LIMITED_SUMMON";
      fieldOwner.field.limitedSummons.splice(limitedIndex, 1);
    }
  }

  if (!creature || !removedFromZone) {
    throw new Error("Selected field creature is no longer on the field.");
  }

  const finalRemovedFromZone: FieldCreatureZone = removedFromZone;
  const definition = getCardDefinition(state, creature);
  if (definition.cardType !== "CREATURE") {
    throw new Error("Selected field card is not a creature.");
  }

  const ownerPlayer = getPlayer(state, creature.ownerPlayerId);

  creature.zone = "CEMETERY";
  creature.currentHp = 0;
  creature.isLimitedSummon = false;
  creature.effectsSuppressed = false;

  ownerPlayer.cemetery.push(creature);
  ownerPlayer.cemeteryCreatureHpTotal = calculateCemeteryCreatureHp(ownerPlayer);

  moveAttachedMagicCardsToCemeteryForCreature(
    state,
    creature.instanceId,
    args.addEvent ?? defaultAddEvent
  );

  const triggerResult = runCardRemovedFromFieldTriggers(state, {
    removedCard: creature,
    removedCardName: definition.name,
    removedFromZone: finalRemovedFromZone,
    causedByPlayerId: args.causedByPlayerId,
    reason: args.reason,
    addEvent: args.addEvent ?? defaultAddEvent
  });

  // Trigger cleanup can destroy source-linked Limited Summons and update the same cemetery.
  // Recalculate here so the caller receives the final post-cleanup cemetery HP total.
  ownerPlayer.cemeteryCreatureHpTotal = calculateCemeteryCreatureHp(ownerPlayer);

  let primaryReplacementRequired = false;
  let autoPromotedLimitedSummon: FieldCreatureRemovalResult["autoPromotedLimitedSummon"] | undefined;

  if (finalRemovedFromZone === "PRIMARY_CREATURE" && args.requirePrimaryReplacement !== false) {
    state.setup.primaryReplacementRequiredForPlayerId = fieldOwner.id;
    primaryReplacementRequired = true;

    if (args.autoPromoteSingleLimitedSummon !== false) {
      autoPromotedLimitedSummon = promoteSingleLimitedSummonToPrimaryIfRequired(
        state,
        fieldOwner,
        creature.instanceId,
        args.addEvent ?? defaultAddEvent
      );
      primaryReplacementRequired = state.setup.primaryReplacementRequiredForPlayerId === fieldOwner.id;
    }
  }

  return {
    creature,
    creatureName: definition.name,
    removedFromZone: finalRemovedFromZone,
    fieldOwnerPlayerId: fieldOwner.id,
    ownerPlayerId: ownerPlayer.id,
    cemeteryCreatureHpTotal: ownerPlayer.cemeteryCreatureHpTotal,
    primaryReplacementRequired,
    autoPromotedLimitedSummon,
    linkedDestroyedCreatures: triggerResult.linkedDestroyedCreatures
  };
}
