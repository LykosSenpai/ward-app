import type { CardInstance, MatchState } from "@ward/shared";
import {
  applyOnEquipGlobalCreatureEffectNegationEffects,
  applyOnEquipImmediateEffects,
  applyOnEquipPercentageDamageEffects,
  applyOnEquipRecurringEffects,
  applyOnEquipRegeneratingHealEffects,
  applyWhileEquippedBattleRequirementEffects,
  applyWhileEquippedStatModifiers
} from "./effectResolver.js";
import { moveMagicSlotCardToCemetery } from "./cardMovement.js";
import { addEvent, cloneState, getCardDefinition, getPlayer } from "./engineRuntime.js";
import {
  ensureNoHandDiscardRequired,
  ensureNoOpenChain,
  ensureNoPendingManualEffects
} from "./actionGuards.js";

function findCreatureAttachmentTarget(
  state: MatchState,
  targetPlayerId: string,
  targetCreatureInstanceId: string,
  targetKind: "PRIMARY_CREATURE" | "LIMITED_SUMMON"
): CardInstance {
  const targetPlayer = getPlayer(state, targetPlayerId);

  if (targetKind === "PRIMARY_CREATURE") {
    const targetPrimary = targetPlayer.field.primaryCreature;

    if (!targetPrimary || targetPrimary.instanceId !== targetCreatureInstanceId) {
      throw new Error("Selected primary creature target is no longer on the field.");
    }

    return targetPrimary;
  }

  const targetLimitedSummon = targetPlayer.field.limitedSummons.find(
    card => card.instanceId === targetCreatureInstanceId
  );

  if (!targetLimitedSummon) {
    throw new Error("Selected limited summon target is no longer on the field.");
  }

  return targetLimitedSummon;
}

export function destroyMagicSlotCard(
  state: MatchState,
  fieldOwnerPlayerId: string,
  cardInstanceId: string
): MatchState {
  if (state.pendingPrompt) {
    throw new Error("Resolve the pending prompt before destroying magic.");
  }

  ensureNoHandDiscardRequired(state);
  ensureNoOpenChain(state);
  ensureNoPendingManualEffects(state);

  if (state.setup.primaryReplacementRequiredForPlayerId) {
    throw new Error("Resolve the required primary creature replacement before destroying magic.");
  }

  const nextState = cloneState(state);
  const result = moveMagicSlotCardToCemetery(
    nextState,
    fieldOwnerPlayerId,
    cardInstanceId,
    addEvent,
    "MANUAL_DESTROY_MAGIC_SLOT_CARD"
  );
  const definition = getCardDefinition(nextState, result.magicCard);

  addEvent(nextState, "MAGIC_SLOT_CARD_DESTROYED", fieldOwnerPlayerId, {
    cardInstanceId,
    cardName: result.destroyedCardName,
    magicType: definition.cardType === "MAGIC" ? definition.magicType : undefined,
    magicSubType: definition.cardType === "MAGIC" ? definition.magicSubType : undefined,
    fieldOwnerPlayerId,
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

export function attachEquipMagicToCreature(
  state: MatchState,
  fieldOwnerPlayerId: string,
  magicCardInstanceId: string,
  targetPlayerId: string,
  targetCreatureInstanceId: string,
  targetKind: "PRIMARY_CREATURE" | "LIMITED_SUMMON"
): MatchState {
  if (state.pendingPrompt) {
    throw new Error("Resolve the pending prompt before attaching Equip Magic.");
  }

  ensureNoHandDiscardRequired(state);
  ensureNoOpenChain(state);

  if (state.setup.primaryReplacementRequiredForPlayerId) {
    throw new Error("Resolve the required primary creature replacement before attaching Equip Magic.");
  }

  const nextState = cloneState(state);

  const fieldOwner = getPlayer(nextState, fieldOwnerPlayerId);
  const targetCreature = findCreatureAttachmentTarget(
    nextState,
    targetPlayerId,
    targetCreatureInstanceId,
    targetKind
  );

  const magicCard = fieldOwner.field.magicSlots.find(
    card => card.instanceId === magicCardInstanceId
  );

  if (!magicCard) {
    throw new Error("Equip Magic card was not found in this player's Magic Slots.");
  }

  const definition = getCardDefinition(nextState, magicCard);

  if (definition.cardType !== "MAGIC") {
    throw new Error("Selected card is not Magic.");
  }

  if (definition.magicSubType !== "EQUIP") {
    throw new Error("Only Equip Magic can be attached to a creature.");
  }

  if (definition.magicType !== "INFINITE" && definition.magicType !== "STANDARD") {
    throw new Error("Only Infinite or temporary Standard Equip Magic can remain attached.");
  }

  if (magicCard.attachedToInstanceId) {
    throw new Error("This Equip Magic is already attached to a creature.");
  }

  magicCard.attachedToInstanceId = targetCreature.instanceId;

  const automaticEquipModifierCount = applyWhileEquippedStatModifiers(
    nextState,
    {
      sourceMagicCard: magicCard,
      targetCreature,
      addEvent
    }
  );

  const automaticBattleRequirementCount = applyWhileEquippedBattleRequirementEffects(
    nextState,
    {
      sourceMagicCard: magicCard,
      targetCreature,
      addEvent
    }
  );

  const automaticOnEquipEffectCount = applyOnEquipImmediateEffects(
    nextState,
    {
      sourceMagicCard: magicCard,
      targetCreature,
      addEvent
    }
  );

  const automaticOnEquipPercentageDamageCount = applyOnEquipPercentageDamageEffects(
    nextState,
    {
      sourceMagicCard: magicCard,
      targetCreature,
      addEvent
    }
  );

  const automaticGlobalCreatureEffectNegationCount = applyOnEquipGlobalCreatureEffectNegationEffects(
    nextState,
    {
      sourceMagicCard: magicCard,
      targetCreature,
      addEvent
    }
  );

  const automaticOnEquipRecurringEffectCount = applyOnEquipRecurringEffects(
    nextState,
    {
      sourceMagicCard: magicCard,
      targetCreature,
      addEvent
    }
  );

  const automaticOnEquipRegeneratingHealCount = applyOnEquipRegeneratingHealEffects(
    nextState,
    {
      sourceMagicCard: magicCard,
      targetCreature,
      addEvent
    }
  );

  addEvent(nextState, "EQUIP_MAGIC_ATTACHED", fieldOwnerPlayerId, {
    magicCardInstanceId,
    magicCardName: definition.name,
    targetPlayerId,
    targetKind,
    targetCreatureInstanceId: targetCreature.instanceId,
    targetCreatureName: getCardDefinition(nextState, targetCreature).name,
    automaticEquipModifierCount,
    automaticBattleRequirementCount,
    automaticOnEquipEffectCount,
    automaticOnEquipPercentageDamageCount,
    automaticGlobalCreatureEffectNegationCount,
    automaticOnEquipRecurringEffectCount,
    automaticOnEquipRegeneratingHealCount
  });

  return nextState;
}

export function attachEquipMagicToPrimaryCreature(
  state: MatchState,
  fieldOwnerPlayerId: string,
  magicCardInstanceId: string,
  targetPlayerId: string
): MatchState {
  const targetPlayer = getPlayer(state, targetPlayerId);
  const targetPrimary = targetPlayer.field.primaryCreature;

  if (!targetPrimary) {
    throw new Error("Target player has no primary creature to attach Equip Magic to.");
  }

  return attachEquipMagicToCreature(
    state,
    fieldOwnerPlayerId,
    magicCardInstanceId,
    targetPlayerId,
    targetPrimary.instanceId,
    "PRIMARY_CREATURE"
  );
}
