import type { MatchState } from "@ward/shared";
import { calculateCemeteryCreatureHp } from "./cemetery.js";
import { moveAttachedMagicCardsToCemeteryForCreature } from "./attachments.js";
import { addEvent, cloneState, getCardDefinition, getPlayer } from "./engineRuntime.js";
import {
  ensureNoHandDiscardRequired,
  ensureNoOpenChain,
  ensureNoPendingManualEffects
} from "./actionGuards.js";
import { validateHandSacrificesForCreature } from "./actionCards.js";
import { creatureCannotBeSacrificed } from "./creatureRuntimeEffects.js";
import { createEffectTargetPromptFromChainLink } from "./effectPrompts.js";
import { effectNeedsTargetPrompt } from "./effectRegistry.js";
import { runCardRemovedFromFieldTriggers } from "./triggers.js";
import { moveFieldCreatureToCemetery } from "./fieldRemoval.js";
import { markReplacementCreatureForSilenceFromTheGraveIfNeeded } from "./silenceFromTheGrave.js";
import { advancePrimaryReplacementRequirement } from "./replacementRequirements.js";

function createOnSummonTargetPromptIfNeeded(
  state: MatchState,
  playerId: string,
  cardInstanceId: string
): void {
  if (state.pendingEffectTargetPrompt) return;

  const player = getPlayer(state, playerId);
  const creature = player.field.primaryCreature;
  if (!creature || creature.instanceId !== cardInstanceId) return;

  const definition = getCardDefinition(state, creature);
  const onSummonTargetEffects = (definition.effects ?? []).filter(effect =>
    String(effect.trigger ?? "").trim().toUpperCase() === "ON_SUMMON" &&
    effectNeedsTargetPrompt(effect)
  );

  const [effect] = onSummonTargetEffects;
  if (!effect) return;

  const prompt = createEffectTargetPromptFromChainLink(
    state,
    {
      cardInstanceId: creature.instanceId,
      cardId: creature.cardId,
      cardName: definition.name,
      playerId
    },
    effect,
    onSummonTargetEffects.slice(1).map(item => item.id)
  );

  if (prompt.options.length === 0) {
    addEvent(state, "ON_SUMMON_EFFECT_NO_VALID_TARGETS", playerId, {
      sourceCardInstanceId: creature.instanceId,
      sourceCardId: creature.cardId,
      sourceCardName: definition.name,
      effectId: effect.id,
      actionType: effect.actionType
    });
    return;
  }

  state.pendingEffectTargetPrompt = prompt;

  addEvent(state, "ON_SUMMON_EFFECT_TARGET_PROMPT_CREATED", playerId, {
    sourceCardInstanceId: creature.instanceId,
    sourceCardId: creature.cardId,
    sourceCardName: definition.name,
    effectId: effect.id,
    actionType: effect.actionType,
    targetKind: prompt.targetKind,
    optionCount: prompt.options.length
  });
}

export function playCreatureFromHandAsPrimary(
  state: MatchState,
  playerId: string,
  cardInstanceId: string,
  sacrificeCardInstanceIds: string[] = []
): MatchState {
  if (state.pendingPrompt) {
    throw new Error("Resolve the pending prompt before playing cards.");
  }

  ensureNoHandDiscardRequired(state);
  ensureNoOpenChain(state);
  ensureNoPendingManualEffects(state);

  const isForcedPrimaryReplacement =
    state.setup.primaryReplacementRequiredForPlayerId === playerId;

  if (!isForcedPrimaryReplacement) {
    if (state.turn.activePlayerId !== playerId) {
      throw new Error("Only the active player can normal summon a primary creature right now.");
    }

    if (state.turn.phase !== "SUMMON_MAGIC") {
      throw new Error("Normal primary summons can only be performed during the Summoning/Magic Phase.");
    }
  }

  const nextState = cloneState(state);
  const player = getPlayer(nextState, playerId);

  if (isForcedPrimaryReplacement && player.field.limitedSummons.length > 0) {
    throw new Error(
      "A Limited Summon is available and must be promoted to primary before summoning a replacement from hand."
    );
  }

  if (!isForcedPrimaryReplacement && player.turnFlags.normalSummonUsed) {
    throw new Error(
      "This player has already normal summoned a primary creature this turn. Forced replacements are still allowed if their current primary creature is killed or removed."
    );
  }

  const targetCard = player.hand.find(card => card.instanceId === cardInstanceId);

  if (!targetCard) {
    throw new Error("Card is not in this player's hand.");
  }

  const targetDefinition = getCardDefinition(nextState, targetCard);

  if (targetDefinition.cardType !== "CREATURE") {
    throw new Error("Only creature cards can be placed as the primary creature.");
  }

  const { requiredSacrifices, sacrificeCards } =
    validateHandSacrificesForCreature(
      nextState,
      player,
      targetCard,
      sacrificeCardInstanceIds
    );

  const sacrificeIds = new Set(sacrificeCards.map(card => card.instanceId));
  const occupiedPrimary = player.field.primaryCreature;
  const primarySacrifice = occupiedPrimary &&
    sacrificeIds.has(occupiedPrimary.instanceId)
    ? occupiedPrimary
    : undefined;
  const autoRemovedPrimary = occupiedPrimary &&
    !primarySacrifice &&
    creatureCannotBeSacrificed(occupiedPrimary)
    ? occupiedPrimary
    : undefined;

  if (occupiedPrimary && !primarySacrifice && !autoRemovedPrimary) {
    throw new Error(
      "Primary creature slot is already occupied. Select the current primary creature as a sacrifice first."
    );
  }

  if (primarySacrifice) {
    const primarySacrificeDefinition = getCardDefinition(nextState, primarySacrifice);

    player.field.primaryCreature = undefined;

    moveAttachedMagicCardsToCemeteryForCreature(
      nextState,
      primarySacrifice.instanceId,
      addEvent
    );

    runCardRemovedFromFieldTriggers(nextState, {
      removedCard: primarySacrifice,
      removedCardName: primarySacrificeDefinition.name,
      removedFromZone: "PRIMARY_CREATURE",
      causedByPlayerId: playerId,
      reason: "CREATURE_SACRIFICED_FOR_SUMMON",
      addEvent
    });
  }

  if (autoRemovedPrimary) {
    const autoRemovedDefinition = getCardDefinition(nextState, autoRemovedPrimary);

    player.field.primaryCreature = undefined;
    autoRemovedPrimary.zone = "CEMETERY";
    autoRemovedPrimary.currentHp = 0;
    player.cemetery.push(autoRemovedPrimary);

    moveAttachedMagicCardsToCemeteryForCreature(
      nextState,
      autoRemovedPrimary.instanceId,
      addEvent
    );

    runCardRemovedFromFieldTriggers(nextState, {
      removedCard: autoRemovedPrimary,
      removedCardName: autoRemovedDefinition.name,
      removedFromZone: "PRIMARY_CREATURE",
      causedByPlayerId: playerId,
      reason: "PRIMARY_CREATURE_REPLACED_NOT_SACRIFICED",
      addEvent
    });

    addEvent(nextState, "PRIMARY_CREATURE_REPLACED_NOT_SACRIFICED", playerId, {
      cardInstanceId: autoRemovedPrimary.instanceId,
      cardName: autoRemovedDefinition.name,
      replacementCardInstanceId: targetCard.instanceId,
      replacementCardName: targetDefinition.name,
      reason: "CURRENT_PRIMARY_CANNOT_BE_SACRIFICED"
    });
  }

  player.hand = player.hand.filter(card => {
    return card.instanceId !== targetCard.instanceId && !sacrificeIds.has(card.instanceId);
  });

  const attachSacrificesUnderSource = targetDefinition.effects?.some(effect =>
    String(effect.actionType ?? "").trim().toUpperCase() === "ATTACH_CARDS_UNDER_SOURCE"
  ) ?? false;

  if (attachSacrificesUnderSource) {
    targetCard.attachedUnder = [];
  }

  for (const sacrificeCard of sacrificeCards) {
    const sacrificeDefinition = getCardDefinition(nextState, sacrificeCard);
    const sacrificeSourceZone =
      sacrificeCard.instanceId === primarySacrifice?.instanceId
        ? "PRIMARY_CREATURE"
        : "HAND";

    if (attachSacrificesUnderSource) {
      sacrificeCard.zone = "ATTACHED_UNDER";
      sacrificeCard.currentHp = sacrificeDefinition.cardType === "CREATURE"
        ? sacrificeDefinition.hp
        : sacrificeCard.currentHp;
      targetCard.attachedUnder?.push(sacrificeCard);
    } else {
      sacrificeCard.zone = "CEMETERY";
      sacrificeCard.currentHp = 0;
      player.cemetery.push(sacrificeCard);
    }

    addEvent(nextState, "CREATURE_SACRIFICED_FOR_SUMMON", playerId, {
      cardInstanceId: sacrificeCard.instanceId,
      cardName: sacrificeDefinition.name,
      summonedCardName: targetDefinition.name,
      sacrificeSourceZone,
      attachedUnderSource: attachSacrificesUnderSource
    });

    if (attachSacrificesUnderSource) {
      addEvent(nextState, "CREATURE_SACRIFICE_ATTACHED_UNDER_SOURCE", playerId, {
        cardInstanceId: sacrificeCard.instanceId,
        cardName: sacrificeDefinition.name,
        sourceCardInstanceId: targetCard.instanceId,
        sourceCardName: targetDefinition.name,
        sacrificeSourceZone
      });
    }
  }

  targetCard.zone = "PRIMARY_CREATURE";
  targetCard.currentHp = targetDefinition.hp;
  targetCard.baseHp = targetDefinition.hp;

  player.field.primaryCreature = targetCard;

  if (isForcedPrimaryReplacement) {
    markReplacementCreatureForSilenceFromTheGraveIfNeeded(nextState, targetCard, addEvent);
  }

  player.turnFlags.playedCreatureThisTurn = true;


  
  if (!isForcedPrimaryReplacement) {
    player.turnFlags.normalSummonUsed = true;
  }

  if (isForcedPrimaryReplacement) {
    advancePrimaryReplacementRequirement(nextState, playerId);
  }

  player.cemeteryCreatureHpTotal = calculateCemeteryCreatureHp(player);

  addEvent(nextState, "PRIMARY_CREATURE_PLAYED", playerId, {
    cardInstanceId,
    cardName: targetDefinition.name,
    requiredSacrifices,
    sacrificeCount: sacrificeCards.length,
    attachedUnderCount: targetCard.attachedUnder?.length ?? 0,
    sacrificedCurrentPrimary: !!primarySacrifice,
    autoRemovedCurrentPrimary: !!autoRemovedPrimary,
    wasForcedReplacement: isForcedPrimaryReplacement,
    cemeteryCreatureHpTotal: player.cemeteryCreatureHpTotal
  });

  nextState.setup.summonResponseWindow = {
    playerId,
    creatureInstanceId: targetCard.instanceId,
    cardId: targetCard.cardId,
    openedTurnNumber: nextState.turn.turnNumber,
    openedTurnCycle: nextState.turn.turnCycleNumber,
    openedPhase: nextState.turn.phase
  };

  createOnSummonTargetPromptIfNeeded(nextState, playerId, targetCard.instanceId);

  return nextState;
}


export function promoteLimitedSummonToPrimary(
  state: MatchState,
  playerId: string,
  cardInstanceId: string
): MatchState {
  if (state.pendingPrompt) {
    throw new Error("Resolve the pending prompt before promoting a Limited Summon.");
  }

  ensureNoHandDiscardRequired(state);
  ensureNoOpenChain(state);
  ensureNoPendingManualEffects(state);

  if (state.setup.primaryReplacementRequiredForPlayerId !== playerId) {
    throw new Error("This player is not currently required to replace their primary creature.");
  }

  const nextState = cloneState(state);
  const player = getPlayer(nextState, playerId);

  if (player.field.primaryCreature) {
    throw new Error("This player already has a primary creature.");
  }

  const limitedSummonIndex = player.field.limitedSummons.findIndex(
    card => card.instanceId === cardInstanceId
  );

  if (limitedSummonIndex === -1) {
    throw new Error("Selected Limited Summon is no longer on this player's field.");
  }

  const [promotedCreature] = player.field.limitedSummons.splice(limitedSummonIndex, 1);
  const definition = getCardDefinition(nextState, promotedCreature);

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
  markReplacementCreatureForSilenceFromTheGraveIfNeeded(nextState, promotedCreature, addEvent);
  advancePrimaryReplacementRequirement(nextState, playerId);

  addEvent(nextState, "LIMITED_SUMMON_PROMOTED_TO_PRIMARY", playerId, {
    cardInstanceId: promotedCreature.instanceId,
    cardName: definition.name,
    previousAnchorSourceInstanceId,
    limitedSummonSlotCount: player.field.limitedSummons.length,
    effectsRestored: true,
    wasForcedReplacement: true
  });

  return nextState;
}

export function sendPrimaryCreatureToCemetery(
  state: MatchState,
  playerId: string
): MatchState {
  if (state.pendingPrompt) {
    throw new Error("Resolve the pending prompt before moving creatures.");
  }

  ensureNoHandDiscardRequired(state);
  ensureNoOpenChain(state);
  ensureNoPendingManualEffects(state);

  const nextState = cloneState(state);
  const player = getPlayer(nextState, playerId);

  const primaryCreature = player.field.primaryCreature;

  if (!primaryCreature) {
    throw new Error("Player has no primary creature.");
  }

  const removal = moveFieldCreatureToCemetery(nextState, {
    fieldOwnerPlayerId: playerId,
    creatureInstanceId: primaryCreature.instanceId,
    removedFromZone: "PRIMARY_CREATURE",
    causedByPlayerId: playerId,
    reason: "PRIMARY_CREATURE_SENT_TO_CEMETERY",
    requirePrimaryReplacement: true,
    autoPromoteSingleLimitedSummon: true,
    addEvent
  });

  addEvent(nextState, "PRIMARY_CREATURE_SENT_TO_CEMETERY", playerId, {
    cardInstanceId: primaryCreature.instanceId,
    cardName: removal.creatureName,
    reason: "BATTLE_OR_CARD_EFFECT",
    cemeteryCreatureHpTotal: removal.cemeteryCreatureHpTotal,
    primaryReplacementRequired: removal.primaryReplacementRequired,
    autoPromotedLimitedSummon: removal.autoPromotedLimitedSummon,
    usedNormalSummon: false
  });

  return nextState;
}

export function killOwnPrimaryCreature(
  state: MatchState,
  playerId: string
): MatchState {
  if (state.pendingPrompt) {
    throw new Error("Resolve the pending prompt before killing your own creature.");
  }

  ensureNoHandDiscardRequired(state);
  ensureNoOpenChain(state);
  ensureNoPendingManualEffects(state);

  if (state.turn.activePlayerId !== playerId) {
    throw new Error("Only the active player can kill their own primary creature.");
  }

  if (state.turn.phase !== "SUMMON_MAGIC") {
    throw new Error("You can only kill your own primary creature during your Summoning/Magic Phase.");
  }

  const nextState = cloneState(state);
  const player = getPlayer(nextState, playerId);

  if (!player.field.primaryCreature) {
    throw new Error("You do not have a primary creature to kill.");
  }

  if (player.turnFlags.killedOwnCreatureThisTurn) {
    throw new Error("You can only kill your own primary creature once per turn.");
  }

  if (player.turnFlags.normalSummonUsed) {
    throw new Error(
      "You cannot kill your own primary creature because your normal primary summon has already been used this turn."
    );
  }

  const primaryCreature = player.field.primaryCreature;

  const removal = moveFieldCreatureToCemetery(nextState, {
    fieldOwnerPlayerId: playerId,
    creatureInstanceId: primaryCreature.instanceId,
    removedFromZone: "PRIMARY_CREATURE",
    causedByPlayerId: playerId,
    reason: "OWN_PRIMARY_CREATURE_KILLED",
    requirePrimaryReplacement: true,
    autoPromoteSingleLimitedSummon: true,
    addEvent
  });

  player.turnFlags.killedOwnCreatureThisTurn = true;
  player.turnFlags.normalSummonUsed = true;

  addEvent(nextState, "OWN_PRIMARY_CREATURE_KILLED", playerId, {
    cardInstanceId: primaryCreature.instanceId,
    cardName: removal.creatureName,
    reason: "PLAYER_CHOSE_TO_KILL_OWN_CREATURE",
    cemeteryCreatureHpTotal: removal.cemeteryCreatureHpTotal,
    primaryReplacementRequired: removal.primaryReplacementRequired,
    autoPromotedLimitedSummon: removal.autoPromotedLimitedSummon,
    usedNormalSummon: true
  });

  return nextState;
}
