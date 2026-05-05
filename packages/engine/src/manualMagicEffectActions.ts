import { v4 as uuidv4 } from "uuid";
import type { MatchState, StatModifierDurationType, StatModifierKey } from "@ward/shared";
import { calculateCemeteryCreatureHp } from "./cemetery.js";
import { removeStatModifiersFromSourceCard } from "./effectiveStats.js";
import { moveAttachedMagicCardsToCemeteryForCreature } from "./attachments.js";
import { addEvent, cloneState, getCardDefinition, getPlayer } from "./engineRuntime.js";
import {
  ensureNoHandDiscardRequired,
  ensureNoOpenChain
} from "./actionGuards.js";
import { sourceMagicIsCurrentlyOnField } from "./actionCards.js";

export function getManualEffectOrThrow(state: MatchState, effectId: string) {
  const effect = state.manualEffectQueue.find(item => item.id === effectId);

  if (!effect) {
    throw new Error(`Manual effect not found: ${effectId}`);
  }

  if (effect.completed) {
    throw new Error("This manual effect has already been completed.");
  }

  return effect;
}


export function completeManualMagicEffect(
  state: MatchState,
  effectId: string
): MatchState {
  if (state.pendingPrompt) {
    throw new Error("Resolve the pending prompt before completing Magic effects.");
  }

  ensureNoHandDiscardRequired(state);
  ensureNoOpenChain(state);

  const nextState = cloneState(state);
  const effect = getManualEffectOrThrow(nextState, effectId);

  effect.completed = true;

  addEvent(nextState, "MANUAL_MAGIC_EFFECT_COMPLETED", effect.controllerPlayerId, {
    effectId,
    sourceCardName: effect.sourceCardName
  });

  return nextState;
}

export function applyManualMagicDamageToPrimaryCreature(
  state: MatchState,
  effectId: string,
  targetPlayerId: string,
  damageAmount: number
): MatchState {
  if (state.pendingPrompt) {
    throw new Error("Resolve the pending prompt before applying Magic damage.");
  }

  ensureNoHandDiscardRequired(state);
  ensureNoOpenChain(state);

  if (state.setup.primaryReplacementRequiredForPlayerId) {
    throw new Error("Resolve the required primary creature replacement before applying more Magic effects.");
  }

  if (!Number.isFinite(damageAmount) || damageAmount <= 0) {
    throw new Error("Damage amount must be greater than 0.");
  }

  const nextState = cloneState(state);
  const effect = getManualEffectOrThrow(nextState, effectId);
  const player = getPlayer(nextState, targetPlayerId);

  const primaryCreature = player.field.primaryCreature;

  if (!primaryCreature) {
    throw new Error("Target player has no primary creature.");
  }

  const definition = getCardDefinition(nextState, primaryCreature);

  if (definition.cardType !== "CREATURE") {
    throw new Error("Target primary card is not a creature.");
  }

  const currentHp = primaryCreature.currentHp ?? primaryCreature.baseHp ?? definition.hp;
  const nextHp = Math.max(0, currentHp - damageAmount);

  primaryCreature.currentHp = nextHp;

  if (nextHp === 0) {
    primaryCreature.zone = "CEMETERY";

    player.field.primaryCreature = undefined;
    player.cemetery.push(primaryCreature);
    player.cemeteryCreatureHpTotal = calculateCemeteryCreatureHp(player);

    moveAttachedMagicCardsToCemeteryForCreature(
      nextState,
      primaryCreature.instanceId,
      addEvent
    );

    nextState.setup.primaryReplacementRequiredForPlayerId = targetPlayerId;
  }

  addEvent(nextState, "MANUAL_MAGIC_DAMAGE_APPLIED", effect.controllerPlayerId, {
    effectId,
    sourceCardName: effect.sourceCardName,
    targetPlayerId,
    targetCardName: definition.name,
    damageAmount,
    remainingHp: nextHp,
    killed: nextHp === 0,
    cemeteryCreatureHpTotal: player.cemeteryCreatureHpTotal
  });

  return nextState;
}

export function applyManualMagicHealToPrimaryCreature(
  state: MatchState,
  effectId: string,
  targetPlayerId: string,
  healAmount: number
): MatchState {
  if (state.pendingPrompt) {
    throw new Error("Resolve the pending prompt before applying Magic healing.");
  }

  ensureNoHandDiscardRequired(state);
  ensureNoOpenChain(state);

  if (state.setup.primaryReplacementRequiredForPlayerId) {
    throw new Error("Resolve the required primary creature replacement before applying more Magic effects.");
  }

  if (!Number.isFinite(healAmount) || healAmount <= 0) {
    throw new Error("Heal amount must be greater than 0.");
  }

  const nextState = cloneState(state);
  const effect = getManualEffectOrThrow(nextState, effectId);
  const player = getPlayer(nextState, targetPlayerId);

  const primaryCreature = player.field.primaryCreature;

  if (!primaryCreature) {
    throw new Error("Target player has no primary creature.");
  }

  const definition = getCardDefinition(nextState, primaryCreature);

  if (definition.cardType !== "CREATURE") {
    throw new Error("Target primary card is not a creature.");
  }

  const maxHp = primaryCreature.baseHp ?? definition.hp;
  const currentHp = primaryCreature.currentHp ?? maxHp;
  const nextHp = Math.min(maxHp, currentHp + healAmount);

  primaryCreature.currentHp = nextHp;

  addEvent(nextState, "MANUAL_MAGIC_HEAL_APPLIED", effect.controllerPlayerId, {
    effectId,
    sourceCardName: effect.sourceCardName,
    targetPlayerId,
    targetCardName: definition.name,
    healAmount,
    remainingHp: nextHp,
    maxHp
  });

  return nextState;
}

export function applyManualMagicStatModifierToPrimaryCreature(
  state: MatchState,
  effectId: string,
  targetPlayerId: string,
  stat: StatModifierKey,
  delta: number,
  durationType: StatModifierDurationType,
  durationTargetPlayerTurnStarts?: number
): MatchState {
  if (state.pendingPrompt) {
    throw new Error("Resolve the pending prompt before applying Magic stat modifiers.");
  }

  ensureNoHandDiscardRequired(state);
  ensureNoOpenChain(state);

  if (state.setup.primaryReplacementRequiredForPlayerId) {
    throw new Error("Resolve the required primary creature replacement before applying more Magic effects.");
  }

  if (!Number.isFinite(delta) || delta === 0) {
    throw new Error("Stat modifier amount cannot be 0.");
  }

  const safeDurationTargetPlayerTurnStarts =
    durationTargetPlayerTurnStarts ?? 1;

  if (
    durationType === "TARGET_PLAYER_TURN_STARTS" &&
    (!Number.isInteger(safeDurationTargetPlayerTurnStarts) ||
      safeDurationTargetPlayerTurnStarts <= 0)
  ) {
    throw new Error("Duration must be at least 1 target-player turn start.");
  }

  const nextState = cloneState(state);
  const effect = getManualEffectOrThrow(nextState, effectId);

  if (
    durationType === "PERMANENT_UNTIL_SOURCE_REMOVED" &&
    effect.magicType !== "INFINITE"
  ) {
    throw new Error(
      "Permanent stat modifiers are only allowed from Infinite Magic cards. Standard and Lightning cards must use timed or one-time effects."
    );
  }

  if (
    durationType === "PERMANENT_UNTIL_SOURCE_REMOVED" &&
    !sourceMagicIsCurrentlyOnField(nextState, effect.sourceCardInstanceId)
  ) {
    throw new Error(
      "Permanent stat modifier source is not currently on the field. The source Infinite Magic must remain in a Magic Slot."
    );
  }
  const player = getPlayer(nextState, targetPlayerId);

  const primaryCreature = player.field.primaryCreature;

  if (!primaryCreature) {
    throw new Error("Target player has no primary creature.");
  }

  const definition = getCardDefinition(nextState, primaryCreature);

  if (definition.cardType !== "CREATURE") {
    throw new Error("Target primary card is not a creature.");
  }

  primaryCreature.activeStatModifiers ??= [];

  const targetPlayerTurnStartCount =
    nextState.turn.turnStartCountsByPlayer[targetPlayerId] ?? 0;

  const modifier = {
    id: uuidv4(),
    sourceEffectId: effectId,
    sourceCardInstanceId: effect.sourceCardInstanceId,
    sourceCardName: effect.sourceCardName,
    stat,
    delta,
    durationType,
    appliedTurnNumber: nextState.turn.turnNumber,
    appliedTurnCycle: nextState.turn.turnCycleNumber,
    expiresOnPlayerId:
      durationType === "TARGET_PLAYER_TURN_STARTS"
        ? targetPlayerId
        : undefined,
    expiresAtPlayerTurnStartCount:
      durationType === "TARGET_PLAYER_TURN_STARTS"
        ? targetPlayerTurnStartCount + safeDurationTargetPlayerTurnStarts
        : undefined
  };

  primaryCreature.activeStatModifiers.push(modifier);

  addEvent(nextState, "MANUAL_MAGIC_STAT_MODIFIER_APPLIED", effect.controllerPlayerId, {
    effectId,
    sourceCardName: effect.sourceCardName,
    sourceCardInstanceId: effect.sourceCardInstanceId,
    targetPlayerId,
    targetCardName: definition.name,
    stat,
    delta,
    durationType,
    durationTargetPlayerTurnStarts,
    expiresOnPlayerId: modifier.expiresOnPlayerId,
    expiresAtPlayerTurnStartCount: modifier.expiresAtPlayerTurnStartCount
  });

  return nextState;
}

export function destroyMagicSlotCardFromManualEffect(
  state: MatchState,
  effectId: string,
  fieldOwnerPlayerId: string,
  cardInstanceId: string
): MatchState {
  if (state.pendingPrompt) {
    throw new Error("Resolve the pending prompt before destroying Magic.");
  }

  ensureNoHandDiscardRequired(state);
  ensureNoOpenChain(state);

  if (state.setup.primaryReplacementRequiredForPlayerId) {
    throw new Error("Resolve the required primary creature replacement before applying more Magic effects.");
  }

  const nextState = cloneState(state);
  const effect = getManualEffectOrThrow(nextState, effectId);
  const fieldOwner = getPlayer(nextState, fieldOwnerPlayerId);

  const magicSlotIndex = fieldOwner.field.magicSlots.findIndex(
    card => card.instanceId === cardInstanceId
  );

  if (magicSlotIndex === -1) {
    throw new Error("Magic card was not found in this player's Magic Slots.");
  }

  const magicCard = fieldOwner.field.magicSlots[magicSlotIndex];
  const definition = getCardDefinition(nextState, magicCard);

  if (definition.cardType !== "MAGIC") {
    throw new Error("Only Magic cards can be destroyed from Magic Slots.");
  }

  fieldOwner.field.magicSlots.splice(magicSlotIndex, 1);

  const ownerPlayer = getPlayer(nextState, magicCard.ownerPlayerId);

  magicCard.zone = "CEMETERY";
  magicCard.attachedToInstanceId = undefined;

  ownerPlayer.cemetery.push(magicCard);
  ownerPlayer.cemeteryCreatureHpTotal = calculateCemeteryCreatureHp(ownerPlayer);

  removeStatModifiersFromSourceCard(nextState, magicCard.instanceId);

  addEvent(nextState, "MANUAL_MAGIC_DESTROYED_MAGIC_SLOT_CARD", effect.controllerPlayerId, {
    effectId,
    sourceCardName: effect.sourceCardName,
    destroyedCardName: definition.name,
    fieldOwnerPlayerId,
    cardOwnerPlayerId: magicCard.ownerPlayerId
  });

  return nextState;
}
