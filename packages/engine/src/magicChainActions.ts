import { v4 as uuidv4 } from "uuid";
import type { CardInstance, EffectTargetOption, MagicChainLink, MagicChainState, MatchState, PendingEffectTargetPrompt, PlayerState, WardEngineEffect } from "@ward/shared";
import {
  getCardEngineEffects,
  isAutomaticMagicEffectSupported,
  isDeferredToAttachmentEffect,
  tryResolveAutomaticMagicEffect
} from "./effectResolver.js";
import { createEffectTargetPromptFromChainLink } from "./effectPrompts.js";
import { getEffectResolutionMode } from "./effectRegistry.js";
import { addEvent, cloneState, getCardDefinition, getOpponentPlayer, getPlayer } from "./engineRuntime.js";
import {
  ensureNoHandDiscardRequired,
  ensureNoOpenChain,
  ensureNoPendingManualEffects
} from "./actionGuards.js";
import {
  createManualEffectRequestFromChainLink,
  effectShouldResolveWhenCardIsPlayed,
  shuffleCards
} from "./actionCards.js";
import { assertPlayerCanPlayMagicUnderActivePlayRestrictions } from "./silenceFromTheGrave.js";
import { resolveBattleResponseChainLinkInPlace } from "./battle.js";
import { removeActiveEffectInstancesFromSource } from "./activeEffectInstances.js";
import { removeStatModifiersFromSourceCard } from "./effectiveStats.js";
import { moveAttachedMagicCardsToCemeteryForCreature } from "./attachments.js";
import { advancePrimaryReplacementRequirement } from "./replacementRequirements.js";
import { assertCanAddMagicToField, countInfiniteMagicOnField, MAX_INFINITE_MAGIC_ON_FIELD } from "./magicField.js";

const FOOLISH_TRICKS_CARD_ID = "gen1_086_foolish_tricks";
const JUDGEMENT_CARD_ID = "gen1_113_judgement";
const FOOLISH_TRICKS_MAX_ARMOR_LEVEL = 6;
const FORCED_AL_SUMMON_MAX_ARMOR_LEVEL = 6;

type ForcedAlSummonPrompt = Extract<NonNullable<MatchState["pendingPrompt"]>, { type: "FORCED_AL_SUMMON" }>;
type ForcedAlPromptSource = ForcedAlSummonPrompt["promptSource"];
type ForcedAlSourceLink = {
  cardInstanceId: string;
  cardId: string;
  cardName: string;
  playerId: string;
  id?: string;
};

function getOpponentPlayerId(state: MatchState, playerId: string): string | undefined {
  return state.players.find(player => player.id !== playerId)?.id;
}

function chainBoardZoneRef(playerId: string) {
  return { playerId, zone: "CHAIN" as const };
}

function handBoardZoneRef(playerId: string) {
  return { playerId, zone: "HAND" as const };
}

function cemeteryBoardZoneRef(playerId: string) {
  return { playerId, zone: "CEMETERY" as const };
}

function deckBoardZoneRef(playerId: string) {
  return { playerId, zone: "DECK" as const };
}

function promptBoardEvents(prompt: PendingEffectTargetPrompt) {
  const deckOptions = prompt.options.filter(option => option.zone === "DECK");
  return [
    {
      type: "PROMPT_OPENED",
      playerId: prompt.controllerPlayerId,
      sourceCardInstanceId: prompt.sourceCardInstanceId,
      sourceCardId: prompt.sourceCardId,
      sourceEffectId: prompt.effectId,
      actionType: prompt.actionType,
      reason: "PROMPT_OPENED",
      promptId: prompt.id,
      toZoneRef: deckOptions.length > 0 ? deckBoardZoneRef(prompt.controllerPlayerId) : { playerId: prompt.controllerPlayerId, zone: "PROMPT" as const }
    },
    ...deckOptions.flatMap(option => option.cardInstanceId
      ? [{
          type: "CARD_REVEALED",
          playerId: prompt.controllerPlayerId,
          sourceCardInstanceId: prompt.sourceCardInstanceId,
          sourceCardId: prompt.sourceCardId,
          sourceEffectId: prompt.effectId,
          actionType: prompt.actionType,
          reason: "DECK_SEARCH_OPTION_REVEALED",
          promptId: prompt.id,
          cardInstanceId: option.cardInstanceId,
          fromZoneRef: deckBoardZoneRef(option.playerId),
          toZoneRef: { playerId: prompt.controllerPlayerId, zone: "PROMPT" as const }
        }]
      : [])
  ];
}

function isForcedAlCreature(state: MatchState, card: CardInstance, maxArmorLevel: number): boolean {
  const definition = state.cardCatalog[card.cardId];
  return definition?.cardType === "CREATURE" && definition.armorLevel <= maxArmorLevel;
}

function getForcedAlSummonOptions(state: MatchState, player: PlayerState, maxArmorLevel: number): CardInstance[] {
  return player.hand.filter(card => isForcedAlCreature(state, card, maxArmorLevel));
}

function hasAccessibleForcedAlCreature(state: MatchState, player: PlayerState, maxArmorLevel: number): boolean {
  return [...player.hand, ...player.deck].some(card => isForcedAlCreature(state, card, maxArmorLevel));
}

function resetReturnedCreatureForHand(card: CardInstance, definition: { hp?: number; cardType?: string }): void {
  card.isLimitedSummon = false;
  card.effectsSuppressed = false;
  card.attachedToInstanceId = undefined;
  card.anchorSourceInstanceId = undefined;
  card.activeStatModifiers = [];
  card.activeStatuses = [];
  card.activeRecurringEffects = [];
  card.activeEffectInstances = [];

  if (definition.cardType === "CREATURE" && typeof definition.hp === "number") {
    card.baseHp = definition.hp;
    card.currentHp = definition.hp;
  }
}

function removeSourceLinkedRuntimeEffects(state: MatchState, sourceCardInstanceId: string): void {
  removeStatModifiersFromSourceCard(state, sourceCardInstanceId);

  for (const player of state.players) {
    if (player.field.primaryCreature) {
      removeActiveEffectInstancesFromSource(player.field.primaryCreature, sourceCardInstanceId);
    }

    for (const creature of player.field.limitedSummons) {
      removeActiveEffectInstancesFromSource(creature, sourceCardInstanceId);
    }
  }
}

function returnCardToOwnerHand(state: MatchState, card: CardInstance): PlayerState {
  const owner = getPlayer(state, card.ownerPlayerId);
  const definition = getCardDefinition(state, card);

  card.zone = "HAND";
  card.controllerPlayerId = owner.id;
  card.attachedToInstanceId = undefined;
  card.anchorSourceInstanceId = undefined;

  if (definition.cardType === "CREATURE") {
    resetReturnedCreatureForHand(card, definition);
  } else {
    removeSourceLinkedRuntimeEffects(state, card.instanceId);
  }

  owner.hand.push(card);
  return owner;
}

function returnOpponentFieldToHandForFoolishTricks(
  state: MatchState,
  link: { playerId: string; cardInstanceId: string; cardId: string; cardName: string }
): Array<{ card: CardInstance; cardName: string; sourcePlayerId: string; destinationPlayerId: string; sourceZone: "PRIMARY_CREATURE" | "MAGIC_SLOT" }> {
  const opponent = getOpponentPlayer(state, link.playerId);
  const returned: Array<{ card: CardInstance; cardName: string; sourcePlayerId: string; destinationPlayerId: string; sourceZone: "PRIMARY_CREATURE" | "MAGIC_SLOT" }> = [];

  const primary = opponent.field.primaryCreature;
  if (primary) {
    opponent.field.primaryCreature = undefined;
    const definition = getCardDefinition(state, primary);
    const destination = returnCardToOwnerHand(state, primary);
    returned.push({
      card: primary,
      cardName: definition.name,
      sourcePlayerId: opponent.id,
      destinationPlayerId: destination.id,
      sourceZone: "PRIMARY_CREATURE"
    });
  }

  const magicSlots = [...opponent.field.magicSlots];
  opponent.field.magicSlots = [];

  for (const magicCard of magicSlots) {
    const definition = getCardDefinition(state, magicCard);
    const destination = returnCardToOwnerHand(state, magicCard);
    returned.push({
      card: magicCard,
      cardName: definition.name,
      sourcePlayerId: opponent.id,
      destinationPlayerId: destination.id,
      sourceZone: "MAGIC_SLOT"
    });
  }

  if (returned.length > 0) {
    addEvent(state, "FOOLISH_TRICKS_FIELD_RETURNED_TO_HAND", link.playerId, {
      sourceCardInstanceId: link.cardInstanceId,
      sourceCardId: link.cardId,
      sourceCardName: link.cardName,
      targetPlayerId: opponent.id,
      returnedCards: returned.map(item => ({
        cardInstanceId: item.card.instanceId,
        cardName: item.cardName,
        sourceZone: item.sourceZone,
        destinationPlayerId: item.destinationPlayerId
      })),
      boardEvents: returned.map(item => ({
        type: "CARD_RETURNED_TO_HAND",
        playerId: link.playerId,
        cardInstanceId: item.card.instanceId,
        sourceCardInstanceId: link.cardInstanceId,
        sourceCardId: link.cardId,
        actionType: "FOOLISH_TRICKS_RETURN_TO_HAND",
        reason: "FOOLISH_TRICKS",
        fromZoneRef: { playerId: item.sourcePlayerId, zone: item.sourceZone },
        toZoneRef: handBoardZoneRef(item.destinationPlayerId)
      }))
    });
  }

  if (primary) {
    moveAttachedMagicCardsToCemeteryForCreature(state, primary.instanceId, addEvent);
  }

  state.setup.primaryReplacementRequiredForPlayerId = undefined;
  return returned;
}

function completeForcedAlSummonLossInPlace(
  state: MatchState,
  losingPlayerId: string,
  sourcePlayerId: string,
  reason: string
): void {
  if ((state.status ?? "ACTIVE") === "COMPLETE") return;

  const loser = getPlayer(state, losingPlayerId);
  const winner = getOpponentPlayer(state, losingPlayerId);

  loser.hasLost = true;
  loser.lossReason = reason;

  state.status = "COMPLETE";
  state.winnerPlayerId = winner.id;
  state.losingPlayerId = loser.id;
  state.completionReason = reason;
  state.completedAt = new Date().toISOString();
  state.pendingPrompt = undefined;
  state.setup.primaryReplacementRequiredForPlayerId = undefined;

  addEvent(state, "MATCH_COMPLETED", winner.id, {
    winnerPlayerId: winner.id,
    winnerName: winner.displayName,
    losingPlayerId: loser.id,
    loserName: loser.displayName,
    completionReason: reason,
    causedByPlayerId: sourcePlayerId
  });
}

function moveHeldResolvedMagicToCemetery(
  state: MatchState,
  prompt: Extract<NonNullable<MatchState["pendingPrompt"]>, { type: "FORCED_AL_SUMMON" }>
): void {
  const chainCardIndex = state.chainZone.findIndex(card => card.instanceId === prompt.sourceCardInstanceId);
  if (chainCardIndex === -1) return;

  const [chainCard] = state.chainZone.splice(chainCardIndex, 1);
  const ownerPlayer = getPlayer(state, chainCard.ownerPlayerId);

  chainCard.zone = "CEMETERY";
  chainCard.controllerPlayerId = ownerPlayer.id;
  ownerPlayer.cemetery.push(chainCard);

  addEvent(state, "MAGIC_RESOLVED_TO_CEMETERY", prompt.sourcePlayerId, {
    chainLinkId: prompt.sourceChainLinkId,
    cardInstanceId: prompt.sourceCardInstanceId,
    cardName: prompt.sourceCardName,
    magicType: "STANDARD",
    isLightningResponse: false,
    reason: "FORCED_SUMMON_PROMPT_RESOLVED",
    boardEvents: [
      {
        type: "CHAIN_LINK_RESOLVED",
        playerId: prompt.sourcePlayerId,
        cardInstanceId: prompt.sourceCardInstanceId,
        sourceCardInstanceId: prompt.sourceCardInstanceId,
        sourceCardId: prompt.sourceCardId,
        actionType: "RESOLVE_MAGIC_CHAIN_LINK",
        reason: "FORCED_SUMMON_PROMPT_RESOLVED",
        fromZoneRef: chainBoardZoneRef(prompt.sourcePlayerId),
        toZoneRef: cemeteryBoardZoneRef(ownerPlayer.id),
        chainLinkId: prompt.sourceChainLinkId
      },
      {
        type: "MAGIC_RESOLVED",
        playerId: prompt.sourcePlayerId,
        cardInstanceId: prompt.sourceCardInstanceId,
        sourceCardInstanceId: prompt.sourceCardInstanceId,
        sourceCardId: prompt.sourceCardId,
        actionType: "RESOLVE_MAGIC_CHAIN_LINK",
        reason: "FORCED_SUMMON_PROMPT_RESOLVED",
        fromZoneRef: chainBoardZoneRef(prompt.sourcePlayerId),
        toZoneRef: cemeteryBoardZoneRef(ownerPlayer.id),
        chainLinkId: prompt.sourceChainLinkId
      }
    ]
  });
}

function getForcedAlPromptSource(cardId: string): ForcedAlPromptSource {
  if (cardId === FOOLISH_TRICKS_CARD_ID) return "FOOLISH_TRICKS";
  if (cardId === JUDGEMENT_CARD_ID) return "JUDGEMENT";
  return "CARD_EFFECT";
}

function promptSourceReason(promptSource: ForcedAlPromptSource): string {
  if (promptSource === "FOOLISH_TRICKS") return "FOOLISH_TRICKS_FORCED_SUMMON";
  if (promptSource === "JUDGEMENT") return "JUDGEMENT_FORCED_SUMMON";
  return "CARD_EFFECT_FORCED_SUMMON";
}

function createForcedAlSummonPrompt(
  state: MatchState,
  link: MagicChainLink | ForcedAlSourceLink,
  args: {
    targetPlayerId: string;
    pendingTargetPlayerIds?: string[];
    returnedCardInstanceIds: string[];
    returnedCardNames: string[];
  }
): void {
  const targetPlayer = getPlayer(state, args.targetPlayerId);
  const promptSource = getForcedAlPromptSource(link.cardId);
  const reason = promptSourceReason(promptSource);

  state.pendingPrompt = {
    id: uuidv4(),
    type: "FORCED_AL_SUMMON",
    promptSource,
    message: `${targetPlayer.displayName} must summon an AL ${FORCED_AL_SUMMON_MAX_ARMOR_LEVEL} or lower creature.`,
    sourcePlayerId: link.playerId,
    targetPlayerId: targetPlayer.id,
    controllerPlayerId: targetPlayer.id,
    approvingPlayerId: targetPlayer.id,
    sourceCardInstanceId: link.cardInstanceId,
    sourceCardId: link.cardId,
    sourceCardName: link.cardName,
    sourceChainLinkId: link.id,
    maxArmorLevel: FORCED_AL_SUMMON_MAX_ARMOR_LEVEL,
    redrawCount: targetPlayer.hand.length,
    mulliganCount: 0,
    pendingTargetPlayerIds: args.pendingTargetPlayerIds,
    returnedCardInstanceIds: args.returnedCardInstanceIds,
    returnedCardNames: args.returnedCardNames,
    createdAt: new Date().toISOString()
  };

  addEvent(state, "FORCED_AL_SUMMON_PROMPT_CREATED", targetPlayer.id, {
    sourceCardInstanceId: link.cardInstanceId,
    sourceCardId: link.cardId,
    sourceCardName: link.cardName,
    promptSource,
    targetPlayerId: targetPlayer.id,
    maxArmorLevel: FORCED_AL_SUMMON_MAX_ARMOR_LEVEL,
    pendingTargetPlayerIds: args.pendingTargetPlayerIds ?? [],
    validHandOptionCount: getForcedAlSummonOptions(state, targetPlayer, FORCED_AL_SUMMON_MAX_ARMOR_LEVEL).length,
    canMulligan: targetPlayer.hand.length > 0,
    boardEvents: [
      {
        type: "PROMPT_OPENED",
        playerId: targetPlayer.id,
        sourceCardInstanceId: link.cardInstanceId,
        sourceCardId: link.cardId,
        actionType: "FORCE_SUMMON_FROM_HAND",
        reason,
        promptId: state.pendingPrompt.id,
        toZoneRef: { playerId: targetPlayer.id, zone: "PROMPT" as const }
      }
    ]
  });
}

function tryResolveFoolishTricksEffects(
  state: MatchState,
  link: MagicChainLink | ForcedAlSourceLink
): boolean {
  if (link.cardId !== FOOLISH_TRICKS_CARD_ID) {
    return false;
  }

  const returnedCards = returnOpponentFieldToHandForFoolishTricks(state, link);
  const targetPlayer = getOpponentPlayer(state, link.playerId);

  if (!hasAccessibleForcedAlCreature(state, targetPlayer, FOOLISH_TRICKS_MAX_ARMOR_LEVEL)) {
    completeForcedAlSummonLossInPlace(
      state,
      targetPlayer.id,
      link.playerId,
      `${targetPlayer.displayName} could not summon an AL ${FOOLISH_TRICKS_MAX_ARMOR_LEVEL} or lower creature for Foolish Tricks.`
    );
    return true;
  }

  createForcedAlSummonPrompt(state, link, {
    targetPlayerId: targetPlayer.id,
    returnedCardInstanceIds: returnedCards.map(item => item.card.instanceId),
    returnedCardNames: returnedCards.map(item => item.cardName)
  });
  return true;
}

function returnPrimaryCreaturesToOwnerHandsForJudgement(
  state: MatchState,
  link: MagicChainLink | ForcedAlSourceLink
): Array<{ card: CardInstance; cardName: string; sourcePlayerId: string; destinationPlayerId: string }> {
  const returned: Array<{ card: CardInstance; cardName: string; sourcePlayerId: string; destinationPlayerId: string }> = [];

  for (const player of state.players) {
    const primary = player.field.primaryCreature;
    if (!primary) continue;

    player.field.primaryCreature = undefined;
    const definition = getCardDefinition(state, primary);
    moveAttachedMagicCardsToCemeteryForCreature(state, primary.instanceId, addEvent);
    const destination = returnCardToOwnerHand(state, primary);

    returned.push({
      card: primary,
      cardName: definition.name,
      sourcePlayerId: player.id,
      destinationPlayerId: destination.id
    });
  }

  state.setup.primaryReplacementRequiredForPlayerId = undefined;

  addEvent(state, "JUDGEMENT_PRIMARY_CREATURES_RETURNED_TO_HAND", link.playerId, {
    sourceCardInstanceId: link.cardInstanceId,
    sourceCardId: link.cardId,
    sourceCardName: link.cardName,
    returnedCards: returned.map(item => ({
      cardInstanceId: item.card.instanceId,
      cardName: item.cardName,
      sourcePlayerId: item.sourcePlayerId,
      destinationPlayerId: item.destinationPlayerId
    })),
    boardEvents: returned.map(item => ({
      type: "CARD_RETURNED_TO_HAND",
      playerId: link.playerId,
      cardInstanceId: item.card.instanceId,
      sourceCardInstanceId: link.cardInstanceId,
      sourceCardId: link.cardId,
      actionType: "JUDGEMENT_RETURN_TO_HAND",
      reason: "JUDGEMENT",
      fromZoneRef: { playerId: item.sourcePlayerId, zone: "PRIMARY_CREATURE" },
      toZoneRef: handBoardZoneRef(item.destinationPlayerId)
    }))
  });

  return returned;
}

function orderedForcedSummonPlayerIds(state: MatchState): string[] {
  const ordered = state.turn.currentTurnOrder.filter(playerId =>
    state.players.some(player => player.id === playerId)
  );
  const missing = state.players
    .map(player => player.id)
    .filter(playerId => !ordered.includes(playerId));
  return [...ordered, ...missing];
}

function tryResolveJudgementEffects(
  state: MatchState,
  link: MagicChainLink | ForcedAlSourceLink
): boolean {
  if (link.cardId !== JUDGEMENT_CARD_ID) {
    return false;
  }

  const returnedCards = returnPrimaryCreaturesToOwnerHandsForJudgement(state, link);
  const targetPlayerIds = orderedForcedSummonPlayerIds(state);

  for (const targetPlayerId of targetPlayerIds) {
    const targetPlayer = getPlayer(state, targetPlayerId);
    if (hasAccessibleForcedAlCreature(state, targetPlayer, FORCED_AL_SUMMON_MAX_ARMOR_LEVEL)) {
      continue;
    }

    completeForcedAlSummonLossInPlace(
      state,
      targetPlayer.id,
      link.playerId,
      `${targetPlayer.displayName} could not summon an AL ${FORCED_AL_SUMMON_MAX_ARMOR_LEVEL} or lower creature for ${link.cardName}.`
    );
    return true;
  }

  const [firstTargetPlayerId, ...pendingTargetPlayerIds] = targetPlayerIds;
  if (!firstTargetPlayerId) {
    return true;
  }

  createForcedAlSummonPrompt(state, link, {
    targetPlayerId: firstTargetPlayerId,
    pendingTargetPlayerIds,
    returnedCardInstanceIds: returnedCards.map(item => item.card.instanceId),
    returnedCardNames: returnedCards.map(item => item.cardName)
  });

  return true;
}

function shouldHoldResolvedMagicForPendingPrompt(state: MatchState, link: MagicChainLink): boolean {
  return state.pendingPrompt?.type === "FORCED_AL_SUMMON" &&
    state.pendingPrompt.sourceCardInstanceId === link.cardInstanceId &&
    state.pendingPrompt.sourceChainLinkId === link.id;
}

function isSilenceFromTheGraveDefinition(definition: { id?: string; name?: string; cardNumber?: string }): boolean {
  const id = String(definition.id ?? "").trim().toLowerCase();
  const name = String(definition.name ?? "").trim().toLowerCase();
  const cardNumber = String(definition.cardNumber ?? "").trim();

  return id.includes("silence-from-the-grave") ||
    id.includes("silence_from_the_grave") ||
    name === "silence from the grave" ||
    (cardNumber === "151" && name.includes("silence"));
}

function getSilenceFromTheGravePreChainCostOptions(
  state: MatchState,
  playerId: string,
  silenceCardInstanceId: string
): EffectTargetOption[] {
  const player = getPlayer(state, playerId);

  return player.hand
    .filter(card => card.instanceId !== silenceCardInstanceId)
    .filter(card => state.cardCatalog[card.cardId]?.cardType === "MAGIC")
    .map(card => {
      const definition = getCardDefinition(state, card);
      return {
        id: card.instanceId,
        label: definition.name + " (hand)",
        targetKind: "CARD_IN_HAND" as const,
        playerId,
        cardInstanceId: card.instanceId,
        cardId: card.cardId,
        cardName: definition.name,
        zone: "HAND" as const
      };
    });
}

function createSilenceFromTheGravePreChainCostPrompt(args: {
  state: MatchState;
  playerId: string;
  card: CardInstance;
  cardName: string;
}): PendingEffectTargetPrompt {
  return {
    id: uuidv4(),
    sourceCardInstanceId: args.card.instanceId,
    sourceCardId: args.card.cardId,
    sourceCardName: args.cardName,
    controllerPlayerId: args.playerId,
    effectId: "SILENCE_FROM_THE_GRAVE_PRE_CHAIN_COST",
    actionType: "PAY_SILENCE_FROM_THE_GRAVE_PRE_CHAIN_COST",
    effectGroup: "Cost",
    actionText: "Discard 1 other Magic card from your hand before playing Silence From The Grave.",
    promptText: "Discard 1 other Magic card from your hand to play Silence From The Grave.",
    targetKind: "CARD_IN_HAND",
    options: getSilenceFromTheGravePreChainCostOptions(args.state, args.playerId, args.card.instanceId)
  };
}



function noTargetPromptShouldResolveWithoutManual(effect: WardEngineEffect): boolean {
  const actionType = effect.actionType.trim().toUpperCase();
  const text = linkEffectText(effect);

  return actionType === "APPLY_CREATURE_EFFECT_NEGATION" ||
    actionType === "SEARCH_DECK_TO_HAND" || (
    actionType === "MOVE_CARD" &&
    text.includes("deck") &&
    text.includes("hand")
  );
}

function linkEffectText(effect: WardEngineEffect): string {
  return [
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

function effectNegatesMagicChainLink(effect: WardEngineEffect): boolean {
  const actionType = effect.actionType.trim().toUpperCase();
  const text = linkEffectText(effect);

  if (
    actionType.includes("NEGATE_ATTACK") ||
    actionType.includes("PREVENT_ATTACK") ||
    actionType.includes("PREVENT_DAMAGE") ||
    actionType.includes("NEGATE_CREATURE_EFFECT")
  ) {
    return actionType.includes("MAGIC") || text.includes("magic card") || text.includes("magic effect");
  }

  if (
    actionType.includes("NEGATE_MAGIC") ||
    actionType.includes("NEGATE_CARD") ||
    actionType.includes("NEGATE_EFFECT") ||
    actionType.includes("NEGATE_LIGHTNING")
  ) {
    return true;
  }

  return text.includes("negate") && (
    text.includes("magic") ||
    text.includes("lightning") ||
    text.includes("card") ||
    text.includes("effect")
  );
}

function effectTextIncludesOpponentMagicTrigger(effect: WardEngineEffect): boolean {
  const trigger = String(effect.trigger ?? "").trim().toUpperCase();
  const conditionType = typeof effect.condition === "object" && effect.condition && "type" in effect.condition
    ? String((effect.condition as { type?: unknown }).type ?? "").trim().toUpperCase()
    : "";
  const paramsCondition = effect.params?.condition;
  const paramsConditionType = typeof paramsCondition === "object" && paramsCondition && "type" in paramsCondition
    ? String((paramsCondition as { type?: unknown }).type ?? "").trim().toUpperCase()
    : "";
  const text = linkEffectText(effect);

  return (
    trigger.includes("OPPONENT_PLAYS_MAGIC") ||
    conditionType.includes("OPPONENT_PLAYS_MAGIC") ||
    paramsConditionType.includes("OPPONENT_PLAYS_MAGIC") ||
    text.includes("opponent plays a magic") ||
    text.includes("opponent magic card")
  );
}

function effectTextRequiresOpponentLightning(effect: WardEngineEffect): boolean {
  const trigger = String(effect.trigger ?? "").trim().toUpperCase();
  const conditionType = typeof effect.condition === "object" && effect.condition && "type" in effect.condition
    ? String((effect.condition as { type?: unknown }).type ?? "").trim().toUpperCase()
    : "";
  const paramsCondition = effect.params?.condition;
  const paramsConditionType = typeof paramsCondition === "object" && paramsCondition && "type" in paramsCondition
    ? String((paramsCondition as { type?: unknown }).type ?? "").trim().toUpperCase()
    : "";

  return (
    trigger.includes("OPPONENT_PLAYS_LIGHTNING") ||
    conditionType.includes("OPPONENT_PLAYS_LIGHTNING") ||
    paramsConditionType.includes("OPPONENT_PLAYS_LIGHTNING")
  );
}

function effectCanRespondToPreviousChainLink(effect: WardEngineEffect, previousLink: MagicChainLink): boolean {
  if (!effectNegatesMagicChainLink(effect)) {
    return false;
  }

  if (effectTextRequiresOpponentLightning(effect)) {
    return previousLink.magicType === "LIGHTNING" || previousLink.isLightningResponse;
  }

  return effectTextIncludesOpponentMagicTrigger(effect);
}

export function getLightningResponseDisabledReason(
  state: MatchState,
  playerId: string,
  cardInstanceId: string
): string | undefined {
  if (state.pendingPrompt) return "Resolve the pending prompt before playing a Lightning response.";
  if (state.setup.handDiscardRequiredForPlayerId) return "A hand discard is required before any Magic Chain response.";
  if (!state.pendingChain) return "Lightning responses can only be played during an active Magic Chain.";

  const player = getPlayer(state, playerId);
  const card = player.hand.find(item => item.instanceId === cardInstanceId);
  if (!card) return "Card is not in this player's hand.";

  const definition = getCardDefinition(state, card);
  if (definition.cardType !== "MAGIC" || definition.magicType !== "LIGHTNING") {
    return "Only Lightning Magic cards can be played as a chain response.";
  }

  try {
    assertPlayerCanPlayMagicUnderActivePlayRestrictions(state, playerId);
  } catch (error) {
    return error instanceof Error ? error.message : "A Magic play lock prevents this Lightning response.";
  }

  const chain = state.pendingChain;
  const previousLink = chain.links[chain.links.length - 1];
  if (!previousLink) return "Magic Chain has no link to respond to.";
  if (chain.priorityPlayerId && chain.priorityPlayerId !== playerId) {
    return "Only the current Magic Chain priority player can respond.";
  }
  if (previousLink.playerId === playerId) {
    return "A player cannot respond to their own chain link.";
  }

  const effects = getLinkEffects(state, { cardId: card.cardId });
  if (effects.length === 0) {
    return "This Lightning card has no parsed chain-response effect.";
  }

  if (!effects.some(effect => effectCanRespondToPreviousChainLink(effect, previousLink))) {
    const lightningOnly = effects.some(effectTextRequiresOpponentLightning);
    return lightningOnly && previousLink.magicType !== "LIGHTNING" && !previousLink.isLightningResponse
      ? "This Lightning card can only respond when the opponent plays Lightning."
      : "This Lightning card's trigger or condition does not match the current chain link.";
  }

  return undefined;
}

function getLinkEffects(state: MatchState, link: { cardId: string; selectedEffectId?: string }): WardEngineEffect[] {
  const definition = state.cardCatalog[link.cardId];
  const effects = getCardEngineEffects(definition);

  if (!link.selectedEffectId) {
    return effects;
  }

  const selected = effects.find(effect => effect.id === link.selectedEffectId);
  return selected ? [selected] : effects;
}

function linkHasNegateEffect(state: MatchState, link: { cardId: string; text?: string; selectedEffectId?: string }): boolean {
  const effects = getLinkEffects(state, link);

  if (effects.length > 0) {
    return link.selectedEffectId
      ? effects.some(effectNegatesMagicChainLink)
      : effects.some(effectNegatesMagicChainLink);
  }

  const rawText = String(link.text ?? "").toLowerCase();
  if (rawText.includes("attack") && !rawText.includes("magic")) {
    return false;
  }

  return rawText.includes("negate") && (rawText.includes("magic") || rawText.includes("lightning") || rawText.includes("effect") || rawText.includes("card"));
}

function isSilenceFromTheGraveLink(state: MatchState, link: { cardId: string; cardName?: string }): boolean {
  const definition = state.cardCatalog[link.cardId];
  const id = String(definition?.id ?? "").trim().toLowerCase();
  const name = String(definition?.name ?? link.cardName ?? "").trim().toLowerCase();
  const cardNumber = String(definition?.cardNumber ?? "").trim();

  return id.includes("silence-from-the-grave") ||
    id.includes("silence_from_the_grave") ||
    name === "silence from the grave" ||
    (cardNumber === "151" && name.includes("silence"));
}

function getNormalizedActionType(effect: WardEngineEffect): string {
  return String(effect.actionType ?? "").trim().toUpperCase();
}

function isSilenceFromTheGravePreChainCostEffect(effect: WardEngineEffect): boolean {
  return getNormalizedActionType(effect) === "PAY_DISCARD_MAGIC_COST";
}

function isSilenceFromTheGraveSplitRuntimeEffect(effect: WardEngineEffect): boolean {
  const actionType = getNormalizedActionType(effect);

  return actionType === "APPLY_OPPONENT_MAGIC_PLAY_LOCK" ||
    actionType === "APPLY_TURN_CONDITIONAL_OPPONENT_CREATURE_EFFECT_SUPPRESSION";
}

function silenceEffectIsAutomatic(effect: WardEngineEffect): boolean {
  return isSilenceFromTheGraveSplitRuntimeEffect(effect) || isAutomaticMagicEffectSupported(effect);
}

function suppressesMagicResponseWindow(effect: WardEngineEffect): boolean {
  const actionType = getNormalizedActionType(effect);
  const canBeNegated = (effect.params as { canBeNegated?: unknown } | undefined)?.canBeNegated;
  const text = linkEffectText(effect);

  return actionType === "SET_CAN_BE_NEGATED" &&
    canBeNegated === false &&
    text.includes("cannot be negated");
}

function cardSuppressesMagicResponseWindow(state: MatchState, cardId: string): boolean {
  return getCardEngineEffects(state.cardCatalog[cardId]).some(suppressesMagicResponseWindow);
}


function orderImmediateEffectsForResolution(effects: WardEngineEffect[]): WardEngineEffect[] {
  const hasDamage = effects.some(effect => effect.actionType.trim().toUpperCase().includes("DAMAGE"));
  const hasHeal = effects.some(effect => effect.actionType.trim().toUpperCase().includes("HEAL"));

  if (!hasDamage || !hasHeal) {
    return effects;
  }

  const priority = (effect: WardEngineEffect): number => {
    const actionType = effect.actionType.trim().toUpperCase();
    if (actionType.includes("DAMAGE") && !actionType.includes("HEAL")) return 0;
    if (actionType.includes("HEAL")) return 1;
    return 2;
  };

  return [...effects].sort((left, right) => priority(left) - priority(right));
}

function shouldSkipResolvedLightningEffect(state: MatchState, link: { cardId: string; isLightningResponse: boolean; text?: string; selectedEffectId?: string }): boolean {
  if (!link.isLightningResponse) return false;
  const effects = getLinkEffects(state, link);

  if (effects.length === 0) {
    return linkHasNegateEffect(state, link);
  }

  return effects.every(effectNegatesMagicChainLink);
}

function isDragonRageLink(state: MatchState, link: { cardId: string; cardName?: string }): boolean {
  const definition = state.cardCatalog[link.cardId];
  const id = String(definition?.id ?? link.cardId).trim().toLowerCase();
  const name = String(definition?.name ?? link.cardName ?? "").trim().toLowerCase();
  const cardNumber = String(definition?.cardNumber ?? "").trim();

  return id.includes("dragon_rage") ||
    id.includes("dragon-rage") ||
    name === "dragon rage" ||
    (cardNumber === "042" && name.includes("dragon") && name.includes("rage"));
}

function isTwisterLink(state: MatchState, link: { cardId: string; cardName?: string }): boolean {
  const definition = state.cardCatalog[link.cardId];
  const id = String(definition?.id ?? link.cardId).trim().toLowerCase();
  const name = String(definition?.name ?? link.cardName ?? "").trim().toLowerCase();
  const cardNumber = String(definition?.cardNumber ?? "").trim();

  return id.includes("twister") ||
    name === "twister" ||
    (cardNumber === "105" && name.includes("twister"));
}

function isRevivalPriestLink(state: MatchState, link: { cardId: string; cardName?: string }): boolean {
  const definition = state.cardCatalog[link.cardId];
  const id = String(definition?.id ?? link.cardId).trim().toLowerCase();
  const name = String(definition?.name ?? link.cardName ?? "").trim().toLowerCase();
  const cardNumber = String(definition?.cardNumber ?? "").trim();

  return id.includes("revival_priest") ||
    id.includes("revival-priest") ||
    name === "revival priest" ||
    (cardNumber === "115" && name.includes("revival") && name.includes("priest"));
}

function isRevivalPriestPreSummonCleanupEffect(effect: WardEngineEffect): boolean {
  const actionType = getNormalizedActionType(effect);
  const text = linkEffectText(effect);

  return actionType === "MOVE_CARD" &&
    text.includes("existing") &&
    text.includes("creature") &&
    text.includes("hand");
}

function resolveDragonRageFollowupEffects(
  state: MatchState,
  link: {
    cardInstanceId: string;
    cardId: string;
    cardName: string;
    playerId: string;
  }
): void {
  if (!isDragonRageLink(state, link)) return;

  const definition = state.cardCatalog[link.cardId];
  const followupEffects = getCardEngineEffects(definition).filter(effect => {
    const actionType = getNormalizedActionType(effect);
    return actionType === "DESTROY_MAGIC_CARDS" || actionType === "DESTROY_ALL_MAGIC" || actionType === "DRAW_CARDS";
  });

  for (const effect of followupEffects) {
    const resolved = tryResolveAutomaticMagicEffect(state, {
      effect,
      controllerPlayerId: link.playerId,
      sourceCardName: link.cardName,
      sourceCardInstanceId: link.cardInstanceId,
      addEvent
    });

    if (!resolved) {
      state.manualEffectQueue.push(createManualEffectRequestFromChainLink({
        ...link,
        magicType: "LIGHTNING",
        magicSubType: "NONE",
        text: definition?.text ?? ""
      }, effect));
    }
  }
}

function resolveTwisterFollowupEffects(
  state: MatchState,
  link: {
    cardInstanceId: string;
    cardId: string;
    cardName: string;
    playerId: string;
  }
): void {
  if (!isTwisterLink(state, link)) return;

  const definition = state.cardCatalog[link.cardId];
  const followupEffects = getCardEngineEffects(definition).filter(effect =>
    getNormalizedActionType(effect) === "DRAW_CARDS"
  );

  for (const effect of followupEffects) {
    const resolved = tryResolveAutomaticMagicEffect(state, {
      effect,
      controllerPlayerId: link.playerId,
      sourceCardName: link.cardName,
      sourceCardInstanceId: link.cardInstanceId,
      addEvent
    });

    if (!resolved) {
      state.manualEffectQueue.push(createManualEffectRequestFromChainLink({
        ...link,
        magicType: "STANDARD",
        magicSubType: "NONE",
        text: definition?.text ?? ""
      }, effect));
    }
  }
}

function isCosmicNegationLink(state: MatchState, link: { cardId: string; cardName?: string }): boolean {
  const definition = state.cardCatalog[link.cardId];
  const id = String(definition?.id ?? link.cardId).trim().toLowerCase();
  const name = String(definition?.name ?? link.cardName ?? "").trim().toLowerCase();

  return id.includes("cosmic_negation") ||
    id.includes("cosmic-negation") ||
    name === "cosmic negation";
}

function resolveCosmicNegationFollowupEffects(
  state: MatchState,
  link: {
    cardInstanceId: string;
    cardId: string;
    cardName: string;
    playerId: string;
  }
): void {
  if (!isCosmicNegationLink(state, link)) return;

  const definition = state.cardCatalog[link.cardId];
  const followupEffects = getCardEngineEffects(definition).filter(effect => {
    const actionType = getNormalizedActionType(effect);
    const trigger = String(effect.trigger ?? "").trim().toUpperCase();
    return actionType === "APPLY_PLAY_RESTRICTION" && trigger === "AFTER_DESTROY";
  });

  for (const effect of followupEffects) {
    const resolved = tryResolveAutomaticMagicEffect(state, {
      effect,
      controllerPlayerId: link.playerId,
      sourceCardName: link.cardName,
      sourceCardInstanceId: link.cardInstanceId,
      addEvent
    });

    if (resolved) {
      addEvent(state, "COSMIC_NEGATION_FOLLOWUP_EFFECT_RESOLVED", link.playerId, {
        sourceCardName: link.cardName,
        effectId: effect.id,
        actionType: effect.actionType
      });
    }
  }
}

export function createMagicChainLink(
  state: MatchState,
  playerId: string,
  card: CardInstance,
  isLightningResponse: boolean,
  respondsToLinkId?: string,
  selectedEffectId?: string
): MagicChainLink {
  const definition = getCardDefinition(state, card);

  if (definition.cardType !== "MAGIC") {
    throw new Error("Only Magic cards can be added to a Magic Chain.");
  }

  return {
    id: uuidv4(),
    playerId,
    cardInstanceId: card.instanceId,
    cardId: card.cardId,
    cardName: definition.name,
    magicType: definition.magicType,
    magicSubType: definition.magicSubType,
    text: definition.text ?? "",
    isLightningResponse,
    respondsToLinkId,
    selectedEffectId,
    status: "PENDING" as const
  };
}


export function resolveOrQueueResolvedMagicEffects(
  state: MatchState,
  link: {
    cardInstanceId: string;
    cardId: string;
    cardName: string;
    magicType: "STANDARD" | "INFINITE" | "LIGHTNING" | "BATTLE_LIGHTNING";
    magicSubType: "FIELD" | "EQUIP" | "NONE";
    playerId: string;
    text: string;
    status: "PENDING" | "RESOLVED" | "NEGATED";
    isLightningResponse: boolean;
    selectedEffectId?: string;
  }
): void {
  if (link.status !== "RESOLVED") {
    return;
  }

  const definition = state.cardCatalog[link.cardId];
  const effects = getLinkEffects(state, link);

  if (shouldSkipResolvedLightningEffect(state, link)) {
    return;
  }

  if (tryResolveFoolishTricksEffects(state, link)) {
    return;
  }

  if (tryResolveJudgementEffects(state, link)) {
    return;
  }

  if (effects.length === 0) {
    state.manualEffectQueue.push(createManualEffectRequestFromChainLink(link));

    addEvent(state, "MANUAL_MAGIC_EFFECT_QUEUED", link.playerId, {
      sourceCardName: link.cardName,
      text: link.text,
      reason: "No parsed effects were found on this card."
    });

    return;
  }

  const effectsThatResolveNow = effects
    .filter(effectShouldResolveWhenCardIsPlayed)
    .filter(effect => !(link.isLightningResponse && effectNegatesMagicChainLink(effect)));

  const effectsThatResolveNowWithoutPreChainCosts = isSilenceFromTheGraveLink(state, link)
    ? effectsThatResolveNow.filter(effect => !isSilenceFromTheGravePreChainCostEffect(effect))
    : effectsThatResolveNow;
  const runtimeEffectsThatResolveNow = effectsThatResolveNowWithoutPreChainCosts.filter(effect => {
    if (suppressesMagicResponseWindow(effect)) return false;
    if (isRevivalPriestLink(state, link) && isRevivalPriestPreSummonCleanupEffect(effect)) return false;
    return true;
  });

  if (effectsThatResolveNowWithoutPreChainCosts.length !== effectsThatResolveNow.length) {
    addEvent(state, "SILENCE_FROM_THE_GRAVE_PRE_CHAIN_COST_SKIPPED_AFTER_RESOLUTION", link.playerId, {
      sourceCardName: link.cardName,
      skippedCostEffectCount: effectsThatResolveNow.length - effectsThatResolveNowWithoutPreChainCosts.length,
      note: "Silence From The Grave's discard-Magic cost was already paid before the card entered the Magic Chain."
    });
  }

  if (runtimeEffectsThatResolveNow.length === 0) {
    addEvent(state, "NO_ON_PLAY_MAGIC_EFFECTS_TO_RESOLVE", link.playerId, {
      sourceCardName: link.cardName,
      effectCount: effects.length,
      reason:
        "This card has parsed effects, but none of them resolve when the card is played after pre-chain costs are removed."
    });

    return;
  }

  const immediateEffects = orderImmediateEffectsForResolution(
    runtimeEffectsThatResolveNow.filter(effect => !isDeferredToAttachmentEffect(effect))
  );

  if (immediateEffects.length === 0) {
    addEvent(state, "MAGIC_EFFECTS_DEFERRED_TO_ATTACHMENT", link.playerId, {
      sourceCardName: link.cardName,
      effectCount: runtimeEffectsThatResolveNow.length
    });

    return;
  }

  if (
    immediateEffects.length === 1 &&
    !isAutomaticMagicEffectSupported(immediateEffects[0]) &&
    (
      getEffectResolutionMode(immediateEffects[0]) === "TARGET_PROMPT" ||
      getEffectResolutionMode(immediateEffects[0]) === "CARD_SELECTION_PROMPT"
    )
  ) {
    const effect = immediateEffects[0];
    const prompt = createEffectTargetPromptFromChainLink(state, link, effect);

    if (prompt.options.length === 0) {
      if (noTargetPromptShouldResolveWithoutManual(effect)) {
        addEvent(state, "AUTO_EFFECT_NO_VALID_TARGETS", link.playerId, {
          sourceCardName: link.cardName,
          effectId: effect.id,
      actionType: effect.actionType,
      reason: "No legal cards matched this deck/search effect. The effect resolves without opening manual fallback.",
      boardEvents: [
        {
          type: "PROMPT_RESOLVED",
          playerId: link.playerId,
          sourceCardInstanceId: link.cardInstanceId,
          sourceCardId: link.cardId,
          sourceEffectId: effect.id,
          actionType: effect.actionType,
          reason: "NO_VALID_TARGETS"
        }
      ]
    });

        return;
      }

      state.manualEffectQueue.push(
        createManualEffectRequestFromChainLink(link, effect)
      );

      addEvent(state, "MANUAL_MAGIC_EFFECT_QUEUED", link.playerId, {
        sourceCardName: link.cardName,
        effectId: effect.id,
        actionType: effect.actionType,
        reason: "No legal targets were available for this effect."
      });

      return;
    }

    state.pendingEffectTargetPrompt = prompt;

    addEvent(state, "EFFECT_TARGET_PROMPT_CREATED", link.playerId, {
      sourceCardName: link.cardName,
      effectId: effect.id,
      actionType: effect.actionType,
      targetKind: prompt.targetKind,
      optionCount: prompt.options.length,
      boardEvents: promptBoardEvents(prompt)
    });

    return;
  }

  const allImmediateEffectsAreAutomatic = immediateEffects.every(effect =>
    isSilenceFromTheGraveLink(state, link)
      ? silenceEffectIsAutomatic(effect)
      : isAutomaticMagicEffectSupported(effect)
  );

  if (allImmediateEffectsAreAutomatic) {
    for (const effect of immediateEffects) {
      const resolved = tryResolveAutomaticMagicEffect(state, {
        effect,
        controllerPlayerId: link.playerId,
        sourceCardName: link.cardName,
        sourceCardInstanceId: link.cardInstanceId,
        addEvent
      });

      if (!resolved) {
        state.manualEffectQueue.push(
          createManualEffectRequestFromChainLink(link, effect)
        );
      }
    }

    return;
  }

  for (const effect of immediateEffects) {
    if (
      isAutomaticMagicEffectSupported(effect) ||
      (isSilenceFromTheGraveLink(state, link) && isSilenceFromTheGraveSplitRuntimeEffect(effect))
    ) {
      const resolved = tryResolveAutomaticMagicEffect(state, {
        effect,
        controllerPlayerId: link.playerId,
        sourceCardName: link.cardName,
        sourceCardInstanceId: link.cardInstanceId,
        addEvent
      });

      if (resolved) {
        continue;
      }
    }

    const mode = getEffectResolutionMode(effect);

    if (
      !state.pendingEffectTargetPrompt &&
      (mode === "TARGET_PROMPT" || mode === "CARD_SELECTION_PROMPT")
    ) {
      const currentEffectIndex = immediateEffects.findIndex(item => item.id === effect.id);
      const remainingEffectIds = currentEffectIndex >= 0
        ? immediateEffects.slice(currentEffectIndex + 1).map(item => item.id)
        : [];
      const prompt = createEffectTargetPromptFromChainLink(state, link, effect, remainingEffectIds);

      if (prompt.options.length > 0) {
        state.pendingEffectTargetPrompt = prompt;

        addEvent(state, "EFFECT_TARGET_PROMPT_CREATED", link.playerId, {
          sourceCardName: link.cardName,
          effectId: effect.id,
          actionType: effect.actionType,
          targetKind: prompt.targetKind,
          optionCount: prompt.options.length,
          remainingEffectIds,
          boardEvents: promptBoardEvents(prompt),
          note: "One effect from a multi-effect card was routed to a prompt. Remaining effects will continue after this prompt resolves."
        });

        return;
      }
    }

    state.manualEffectQueue.push(
      createManualEffectRequestFromChainLink(link, effect)
    );

    addEvent(state, "MANUAL_MAGIC_EFFECT_QUEUED", link.playerId, {
      sourceCardName: link.cardName,
      effectId: effect.id,
      actionType: effect.actionType,
      actionText: effect.actionText,
      value: effect.value,
      duration: effect.duration?.text,
      reason: state.pendingEffectTargetPrompt
        ? "Another effect from this card is awaiting target selection. Resolve this queued effect manually after the prompt."
        : "Effect action is not automated yet."
    });
  }
}

function returnHandToDeckAndDrawInPlace(player: PlayerState, redrawCount: number): {
  returnedCardCount: number;
  drawnCardCount: number;
} {
  const cardsToReturn = [...player.hand];
  player.hand = [];

  for (const card of cardsToReturn) {
    card.zone = "DECK";
    card.controllerPlayerId = card.ownerPlayerId;
    player.deck.push(card);
  }

  player.deck = shuffleCards(player.deck);

  const safeRedrawCount = Math.max(1, Math.trunc(redrawCount));
  let drawnCardCount = 0;

  for (let index = 0; index < safeRedrawCount; index++) {
    const card = player.deck.shift();
    if (!card) break;

    card.zone = "HAND";
    card.controllerPlayerId = player.id;
    player.hand.push(card);
    drawnCardCount += 1;
  }

  return {
    returnedCardCount: cardsToReturn.length,
    drawnCardCount
  };
}

export function resolveForcedAlSummonPrompt(
  state: MatchState,
  playerId: string,
  cardInstanceId: string
): MatchState {
  const nextState = cloneState(state);
  const prompt = nextState.pendingPrompt;

  if (!prompt || prompt.type !== "FORCED_AL_SUMMON") {
    throw new Error("There is no forced summon prompt to resolve.");
  }

  if (prompt.controllerPlayerId !== playerId) {
    throw new Error("Only the prompted player can resolve this forced summon.");
  }

  const player = getPlayer(nextState, prompt.targetPlayerId);
  const handIndex = player.hand.findIndex(card => card.instanceId === cardInstanceId);

  if (handIndex === -1) {
    throw new Error("Selected card is not in the prompted player's hand.");
  }

  const card = player.hand[handIndex];

  if (!isForcedAlCreature(nextState, card, prompt.maxArmorLevel)) {
    throw new Error(`${prompt.sourceCardName} requires an AL ${prompt.maxArmorLevel} or lower creature.`);
  }

  if (player.field.primaryCreature) {
    throw new Error("The prompted player already has a primary creature.");
  }

  const [summonedCard] = player.hand.splice(handIndex, 1);
  const definition = getCardDefinition(nextState, summonedCard);

  if (definition.cardType !== "CREATURE") {
    throw new Error("Only a creature can be summoned for this prompt.");
  }

  summonedCard.zone = "PRIMARY_CREATURE";
  summonedCard.controllerPlayerId = player.id;
  summonedCard.isLimitedSummon = false;
  summonedCard.effectsSuppressed = false;
  summonedCard.attachedToInstanceId = undefined;
  summonedCard.anchorSourceInstanceId = undefined;
  summonedCard.baseHp = definition.hp;
  summonedCard.currentHp = definition.hp;
  summonedCard.activeStatModifiers = [];
  summonedCard.activeStatuses = [];
  summonedCard.activeRecurringEffects = [];
  summonedCard.activeEffectInstances = [];

  player.field.primaryCreature = summonedCard;
  advancePrimaryReplacementRequirement(nextState, player.id);
  nextState.pendingPrompt = undefined;

  addEvent(nextState, "FORCED_AL_SUMMON_RESOLVED", player.id, {
    promptId: prompt.id,
    sourceCardInstanceId: prompt.sourceCardInstanceId,
    sourceCardId: prompt.sourceCardId,
    sourceCardName: prompt.sourceCardName,
    promptSource: prompt.promptSource,
    cardInstanceId: summonedCard.instanceId,
    cardName: definition.name,
    maxArmorLevel: prompt.maxArmorLevel,
    mulliganCount: prompt.mulliganCount,
    pendingTargetPlayerIds: prompt.pendingTargetPlayerIds ?? [],
    boardEvents: [
      {
        type: "PROMPT_RESOLVED",
        playerId: player.id,
        sourceCardInstanceId: prompt.sourceCardInstanceId,
        sourceCardId: prompt.sourceCardId,
        actionType: "FORCE_SUMMON_FROM_HAND",
        reason: promptSourceReason(prompt.promptSource),
        promptId: prompt.id
      },
      {
        type: "CREATURE_SUMMONED_PRIMARY",
        playerId: player.id,
        cardInstanceId: summonedCard.instanceId,
        sourceCardInstanceId: prompt.sourceCardInstanceId,
        sourceCardId: prompt.sourceCardId,
        actionType: "FORCE_SUMMON_FROM_HAND",
        reason: promptSourceReason(prompt.promptSource),
        fromZoneRef: handBoardZoneRef(player.id),
        toZoneRef: { playerId: player.id, zone: "PRIMARY_CREATURE" as const }
      }
    ]
  });

  const [nextTargetPlayerId, ...remainingTargetPlayerIds] = prompt.pendingTargetPlayerIds ?? [];
  if (nextTargetPlayerId) {
    const nextTargetPlayer = getPlayer(nextState, nextTargetPlayerId);

    if (!hasAccessibleForcedAlCreature(nextState, nextTargetPlayer, prompt.maxArmorLevel)) {
      moveHeldResolvedMagicToCemetery(nextState, prompt);
      completeForcedAlSummonLossInPlace(
        nextState,
        nextTargetPlayer.id,
        prompt.sourcePlayerId,
        `${nextTargetPlayer.displayName} could not summon an AL ${prompt.maxArmorLevel} or lower creature for ${prompt.sourceCardName}.`
      );
      return nextState;
    }

    createForcedAlSummonPrompt(nextState, {
      cardInstanceId: prompt.sourceCardInstanceId,
      cardId: prompt.sourceCardId,
      cardName: prompt.sourceCardName,
      playerId: prompt.sourcePlayerId,
      id: prompt.sourceChainLinkId
    }, {
      targetPlayerId: nextTargetPlayerId,
      pendingTargetPlayerIds: remainingTargetPlayerIds,
      returnedCardInstanceIds: prompt.returnedCardInstanceIds,
      returnedCardNames: prompt.returnedCardNames
    });
    return nextState;
  }

  moveHeldResolvedMagicToCemetery(nextState, prompt);
  return nextState;
}

export function mulliganForcedAlSummonPrompt(
  state: MatchState,
  playerId: string
): MatchState {
  const nextState = cloneState(state);
  const prompt = nextState.pendingPrompt;

  if (!prompt || prompt.type !== "FORCED_AL_SUMMON") {
    throw new Error("There is no forced summon prompt to mulligan.");
  }

  if (prompt.controllerPlayerId !== playerId) {
    throw new Error("Only the prompted player can mulligan for this forced summon.");
  }

  const player = getPlayer(nextState, prompt.targetPlayerId);
  const validHandOptions = getForcedAlSummonOptions(nextState, player, prompt.maxArmorLevel);

  if (validHandOptions.length > 0) {
    throw new Error(`You must summon an AL ${prompt.maxArmorLevel} or lower creature from hand.`);
  }

  if (!hasAccessibleForcedAlCreature(nextState, player, prompt.maxArmorLevel)) {
    moveHeldResolvedMagicToCemetery(nextState, prompt);
    completeForcedAlSummonLossInPlace(
      nextState,
      player.id,
      prompt.sourcePlayerId,
      `${player.displayName} could not summon an AL ${prompt.maxArmorLevel} or lower creature for ${prompt.sourceCardName}.`
    );
    return nextState;
  }

  const redrawCount = Math.max(1, player.hand.length || prompt.redrawCount);
  const result = returnHandToDeckAndDrawInPlace(player, redrawCount);
  const nextPrompt = nextState.pendingPrompt;

  if (!nextPrompt || nextPrompt.type !== "FORCED_AL_SUMMON") {
    throw new Error("Forced summon prompt was lost during mulligan.");
  }

  nextPrompt.redrawCount = player.hand.length;
  nextPrompt.mulliganCount += 1;
  nextPrompt.message = `${player.displayName} must summon an AL ${nextPrompt.maxArmorLevel} or lower creature.`;

  addEvent(nextState, "FORCED_AL_SUMMON_MULLIGAN", player.id, {
    promptId: nextPrompt.id,
    sourceCardInstanceId: nextPrompt.sourceCardInstanceId,
    sourceCardId: nextPrompt.sourceCardId,
    sourceCardName: nextPrompt.sourceCardName,
    promptSource: nextPrompt.promptSource,
    targetPlayerId: player.id,
    returnedCardCount: result.returnedCardCount,
    drawnCardCount: result.drawnCardCount,
    mulliganCount: nextPrompt.mulliganCount,
    validHandOptionCount: getForcedAlSummonOptions(nextState, player, nextPrompt.maxArmorLevel).length
  });

  if (!hasAccessibleForcedAlCreature(nextState, player, nextPrompt.maxArmorLevel)) {
    moveHeldResolvedMagicToCemetery(nextState, nextPrompt);
    completeForcedAlSummonLossInPlace(
      nextState,
      player.id,
      nextPrompt.sourcePlayerId,
      `${player.displayName} could not summon an AL ${nextPrompt.maxArmorLevel} or lower creature for ${nextPrompt.sourceCardName}.`
    );
  }

  return nextState;
}


export function playMagicFromHand(
  state: MatchState,
  playerId: string,
  cardInstanceId: string
): MatchState {
  if (state.pendingPrompt) {
    throw new Error("Resolve the pending prompt before playing magic.");
  }

  ensureNoHandDiscardRequired(state);
  ensureNoOpenChain(state);
  ensureNoPendingManualEffects(state);
  

  if (state.setup.primaryReplacementRequiredForPlayerId) {
    throw new Error("A primary creature replacement is required. You cannot play magic until the creature is replaced.");
  }

  if (state.turn.activePlayerId !== playerId) {
    throw new Error("Only the active player can play magic with this action.");
  }

  if (
    state.turn.phase !== "SUMMON_MAGIC" &&
    state.turn.phase !== "SECOND_MAGIC"
  ) {
    throw new Error("Magic cards can only be played during the Summoning/Magic Phase or 2nd Magic Phase.");
  }

  const nextState = cloneState(state);
  const player = getPlayer(nextState, playerId);

  const handIndex = player.hand.findIndex(card => card.instanceId === cardInstanceId);

  if (handIndex === -1) {
    throw new Error("Card is not in this player's hand.");
  }

  const card = player.hand[handIndex];
  const definition = getCardDefinition(nextState, card);

  if (definition.cardType !== "MAGIC") {
    throw new Error("Only magic cards can be played with this action.");
  }

  assertPlayerCanPlayMagicUnderActivePlayRestrictions(nextState, playerId);

  if (definition.magicType === "INFINITE" && countInfiniteMagicOnField(nextState, player) >= MAX_INFINITE_MAGIC_ON_FIELD) {
    throw new Error(`You already have ${MAX_INFINITE_MAGIC_ON_FIELD} Infinite Magic cards on your side of the field.`);
  }

  if (isSilenceFromTheGraveDefinition(definition)) {
    const options = getSilenceFromTheGravePreChainCostOptions(nextState, playerId, card.instanceId);

    if (options.length === 0) {
      throw new Error("Silence From The Grave requires discarding 1 other Magic card from your hand before it can be played.");
    }

    nextState.pendingEffectTargetPrompt = createSilenceFromTheGravePreChainCostPrompt({
      state: nextState,
      playerId,
      card,
      cardName: definition.name
    });

    addEvent(nextState, "SILENCE_FROM_THE_GRAVE_PRE_CHAIN_COST_PROMPT_CREATED", playerId, {
      cardInstanceId,
      cardName: definition.name,
      optionCount: options.length,
      boardEvents: promptBoardEvents(nextState.pendingEffectTargetPrompt),
      note: "Silence From The Grave stays in hand until its discard-Magic cost is paid. Opponent cannot respond until the card enters the Magic Chain."
    });

    return nextState;
  }

  player.hand.splice(handIndex, 1);

  card.zone = "CHAIN";
    nextState.chainZone.push(card);

    const chainLink = createMagicChainLink(
        nextState,
        playerId,
        card,
        false
  );

  const pendingChain: MagicChainState = {
    id: uuidv4(),
    startedByPlayerId: playerId,
    links: [chainLink],
    respondedPlayerIds: [],
    priorityPlayerId: getOpponentPlayerId(nextState, playerId),
    lastLinkPlayerId: playerId,
    passesSinceLastResponse: 0
  };

  nextState.pendingChain = pendingChain;

  addEvent(nextState, "MAGIC_CHAIN_STARTED", playerId, {
    chainId: pendingChain.id,
    chainLinkId: chainLink.id,
    cardInstanceId,
    cardName: definition.name,
    magicType: definition.magicType,
    magicSubType: definition.magicSubType,
    nextPriorityPlayerId: pendingChain.priorityPlayerId,
    boardEvents: [
      {
        type: "CHAIN_LINK_ADDED",
        playerId,
        cardInstanceId,
        sourceCardInstanceId: cardInstanceId,
        sourceCardId: card.cardId,
        actionType: "PLAY_MAGIC",
        reason: "MAGIC_CHAIN_STARTED",
        fromZoneRef: handBoardZoneRef(playerId),
        toZoneRef: chainBoardZoneRef(playerId),
        chainLinkId: chainLink.id,
        metadata: {
          chainId: pendingChain.id,
          nextPriorityPlayerId: pendingChain.priorityPlayerId
        }
      },
      {
        type: "MAGIC_PLAYED_TO_CHAIN",
        playerId,
        cardInstanceId,
        sourceCardInstanceId: cardInstanceId,
        sourceCardId: card.cardId,
        actionType: "PLAY_MAGIC",
        reason: "MAGIC_CHAIN_STARTED",
        fromZoneRef: handBoardZoneRef(playerId),
        toZoneRef: chainBoardZoneRef(playerId),
        chainLinkId: chainLink.id
      }
    ]
  });

  if (cardSuppressesMagicResponseWindow(nextState, card.cardId)) {
    addEvent(nextState, "MAGIC_CHAIN_RESPONSE_WINDOW_SUPPRESSED", playerId, {
      chainId: pendingChain.id,
      cardInstanceId,
      cardName: definition.name,
      note: "This card cannot be negated when played, so no Lightning response window opens."
    });

    return resolveMagicChain(nextState);
  }

  return nextState;
}

export function playLightningResponseFromHand(
  state: MatchState,
  playerId: string,
  cardInstanceId: string,
  options: { selectedEffectId?: string } = {}
): MatchState {
  if (state.pendingPrompt) {
    throw new Error("Resolve the pending prompt before playing a Lightning response.");
  }

  ensureNoHandDiscardRequired(state);

  if (!state.pendingChain) {
    throw new Error("There is no active Magic Chain to respond to.");
  }


  const nextState = cloneState(state);
  const player = getPlayer(nextState, playerId);

  const chain = nextState.pendingChain;

  if (!chain) {
    throw new Error("Magic Chain was not found after cloning state.");
  }

  const handIndex = player.hand.findIndex(card => card.instanceId === cardInstanceId);

  if (handIndex === -1) {
    throw new Error("Card is not in this player's hand.");
  }

  const card = player.hand[handIndex];
  const definition = getCardDefinition(nextState, card);

  if (definition.cardType !== "MAGIC" || definition.magicType !== "LIGHTNING") {
    throw new Error("Only Lightning Magic cards can be played as a response.");
  }

  const previousLink = chain.links[chain.links.length - 1];

  if (!previousLink) {
    throw new Error("Magic Chain has no link to respond to.");
  }

  const disabledReason = getLightningResponseDisabledReason(nextState, playerId, cardInstanceId);
  if (disabledReason) {
    throw new Error(disabledReason);
  }

  player.hand.splice(handIndex, 1);
  card.zone = "CHAIN";
  nextState.chainZone.push(card);

  const chainLink = createMagicChainLink(
    nextState,
    playerId,
    card,
    true,
    previousLink.id,
    options.selectedEffectId
  );

  chain.links.push(chainLink);
  chain.respondedPlayerIds.push(playerId);
  chain.lastLinkPlayerId = playerId;
  chain.priorityPlayerId = getOpponentPlayerId(nextState, playerId);
  chain.passesSinceLastResponse = 0;

  addEvent(nextState, "LIGHTNING_RESPONSE_ADDED", playerId, {
    chainId: chain.id,
    chainLinkId: chainLink.id,
    cardInstanceId,
    cardName: definition.name,
    respondsToLinkId: previousLink.id,
    respondsToCardName: previousLink.cardName,
    nextPriorityPlayerId: chain.priorityPlayerId,
    turnNumber: nextState.turn.turnNumber,
    turnCycleNumber: nextState.turn.turnCycleNumber,
    boardEvents: [
      {
        type: "CHAIN_LINK_ADDED",
        playerId,
        cardInstanceId,
        sourceCardInstanceId: cardInstanceId,
        sourceCardId: card.cardId,
        actionType: "PLAY_LIGHTNING_RESPONSE",
        reason: "LIGHTNING_RESPONSE",
        fromZoneRef: handBoardZoneRef(playerId),
        toZoneRef: chainBoardZoneRef(playerId),
        chainLinkId: chainLink.id,
        metadata: {
          chainId: chain.id,
          respondsToLinkId: previousLink.id,
          nextPriorityPlayerId: chain.priorityPlayerId
        }
      },
      {
        type: "CARD_MOVED",
        playerId,
        cardInstanceId,
        sourceCardInstanceId: cardInstanceId,
        sourceCardId: card.cardId,
        actionType: "PLAY_LIGHTNING_RESPONSE",
        reason: "LIGHTNING_RESPONSE_TO_CHAIN",
        fromZoneRef: handBoardZoneRef(playerId),
        toZoneRef: chainBoardZoneRef(playerId)
      }
    ]
  });

  return nextState;
}



export function passMagicChainPriority(
  state: MatchState,
  playerId: string
): MatchState {
  if (state.pendingPrompt) {
    throw new Error("Resolve the pending prompt before passing chain priority.");
  }

  ensureNoHandDiscardRequired(state);

  if (!state.pendingChain) {
    throw new Error("There is no Magic Chain priority to pass.");
  }

  if (state.pendingChain.priorityPlayerId && state.pendingChain.priorityPlayerId !== playerId) {
    throw new Error("Only the player with current Magic Chain priority can pass.");
  }

  if (state.pendingChain.lastLinkPlayerId === playerId) {
    throw new Error("The player who played the latest chain link cannot pass priority for the opponent.");
  }

  const nextState = cloneState(state);
  const chain = nextState.pendingChain;

  if (!chain) {
    throw new Error("Magic Chain was not found after cloning state.");
  }

  chain.passesSinceLastResponse = Number(chain.passesSinceLastResponse ?? 0) + 1;

  addEvent(nextState, "MAGIC_CHAIN_PRIORITY_PASSED", playerId, {
    chainId: chain.id,
    playerId,
    passesSinceLastResponse: chain.passesSinceLastResponse,
    lastLinkPlayerId: chain.lastLinkPlayerId,
    boardEvents: [
      {
        type: "CHAIN_PRIORITY_PASSED",
        playerId,
        actionType: "PASS_MAGIC_CHAIN_PRIORITY",
        reason: "PASS_PRIORITY",
        metadata: {
          chainId: chain.id,
          passesSinceLastResponse: chain.passesSinceLastResponse,
          lastLinkPlayerId: chain.lastLinkPlayerId
        }
      }
    ]
  });

  // WARD 1v1 priority only requires the opponent of the latest chain link to
  // decline a response. Once that player passes, resolve the whole chain in
  // reverse order.
  return resolveMagicChain(nextState);
}

export function resolveMagicChain(state: MatchState): MatchState {
  if (state.pendingPrompt) {
    throw new Error("Resolve the pending prompt before resolving the Magic Chain.");
  }

  ensureNoHandDiscardRequired(state);

  if (!state.pendingChain) {
    throw new Error("There is no Magic Chain to resolve.");
  }

  const nextState = cloneState(state);
  const chain = nextState.pendingChain;

  if (!chain) {
    throw new Error("Magic Chain was not found after cloning state.");
  }

  chain.lastLinkPlayerId ??= chain.links[chain.links.length - 1]?.playerId;
  chain.priorityPlayerId ??= chain.lastLinkPlayerId
    ? getOpponentPlayerId(nextState, chain.lastLinkPlayerId)
    : undefined;
  chain.passesSinceLastResponse ??= 0;

  const linksById = new Map(chain.links.map(link => [link.id, link]));

  for (const link of [...chain.links].reverse()) {
    if (link.status === "NEGATED") {
      continue;
    }

    if (link.isLightningResponse && link.respondsToLinkId && linkHasNegateEffect(nextState, link)) {
      const targetLink = linksById.get(link.respondsToLinkId);

      if (targetLink && targetLink.status === "PENDING") {
        targetLink.status = "NEGATED";

        addEvent(nextState, "CHAIN_LINK_NEGATED", link.playerId, {
          chainId: chain.id,
          chainLinkId: link.id,
          cardInstanceId: link.cardInstanceId,
          sourceCardInstanceId: link.cardInstanceId,
          targetCardInstanceId: targetLink.cardInstanceId,
          negatingCardName: link.cardName,
          negatedCardName: targetLink.cardName,
          negatedLinkId: targetLink.id,
          boardEvents: [
            {
              type: "CHAIN_LINK_NEGATED",
              playerId: link.playerId,
              cardInstanceId: targetLink.cardInstanceId,
              sourceCardInstanceId: link.cardInstanceId,
              sourceCardId: link.cardId,
              targetCardInstanceId: targetLink.cardInstanceId,
              actionType: "NEGATE_MAGIC_CHAIN_LINK",
              reason: "LIGHTNING_NEGATED_CHAIN_LINK",
              chainLinkId: targetLink.id,
              metadata: {
                chainId: chain.id,
                negatingLinkId: link.id,
                negatedLinkId: targetLink.id
              }
            },
            {
              type: "MAGIC_NEGATED",
              playerId: link.playerId,
              cardInstanceId: targetLink.cardInstanceId,
              sourceCardInstanceId: link.cardInstanceId,
              sourceCardId: link.cardId,
              targetCardInstanceId: targetLink.cardInstanceId,
              actionType: "NEGATE_MAGIC_CHAIN_LINK",
              reason: "LIGHTNING_NEGATED_MAGIC",
              chainLinkId: targetLink.id
            }
          ]
        });
      }
    }

    link.status = "RESOLVED";
  }

  for (const link of [...chain.links].reverse()) {
    const chainCardIndex = nextState.chainZone.findIndex(
      card => card.instanceId === link.cardInstanceId
    );

    if (chainCardIndex === -1) {
      continue;
    }

    const chainCard = nextState.chainZone[chainCardIndex];

    const ownerPlayer = getPlayer(nextState, chainCard.ownerPlayerId);

    if (link.status === "NEGATED") {
      nextState.chainZone.splice(chainCardIndex, 1);
      chainCard.zone = "CEMETERY";
      ownerPlayer.cemetery.push(chainCard);

      addEvent(nextState, "CHAIN_LINK_SENT_TO_CEMETERY_NEGATED", link.playerId, {
        chainId: chain.id,
        chainLinkId: link.id,
        cardInstanceId: link.cardInstanceId,
        cardName: link.cardName,
        boardEvents: [
          {
            type: "CARD_SENT_TO_CEMETERY",
            playerId: link.playerId,
            cardInstanceId: link.cardInstanceId,
            sourceCardInstanceId: link.cardInstanceId,
            sourceCardId: link.cardId,
            actionType: "MOVE_NEGATED_CHAIN_LINK",
            reason: "CHAIN_LINK_NEGATED",
            fromZoneRef: chainBoardZoneRef(link.playerId),
            toZoneRef: cemeteryBoardZoneRef(ownerPlayer.id),
            chainLinkId: link.id
          }
        ]
      });

      continue;
    }

    const resolvedBattleResponse = resolveBattleResponseChainLinkInPlace(nextState, link);

    if (!resolvedBattleResponse) {
      // SILENCE_SOURCE_LINKED_EFFECTS_RESOLVE_BEFORE_CARD_LEAVES_CHAIN
      // Source-linked resolved effects must run while the source card is still findable in chainZone.
      // Silence From The Grave uses this to attach its Magic lock and turn-conditional creature suppression.
      resolveOrQueueResolvedMagicEffects(nextState, link);
      resolveDragonRageFollowupEffects(nextState, link);
      resolveTwisterFollowupEffects(nextState, link);
      resolveCosmicNegationFollowupEffects(nextState, link);
    }

    if (shouldHoldResolvedMagicForPendingPrompt(nextState, link)) {
      continue;
    }

    nextState.chainZone.splice(chainCardIndex, 1);

    const resolvesToMagicSlot =
      !link.isLightningResponse &&
      (
        link.magicType === "INFINITE" ||
        (link.magicType === "STANDARD" && (link.magicSubType === "EQUIP" || link.magicSubType === "FIELD"))
      );

    if (resolvesToMagicSlot) {
      const fieldOwner = getPlayer(nextState, link.playerId);
      const resolutionKind = link.magicType === "INFINITE"
        ? "INFINITE"
        : link.magicSubType === "FIELD"
          ? "FIELD"
          : "TEMP_EQUIP";
      const reason = resolutionKind === "INFINITE"
        ? "INFINITE_MAGIC_TO_FIELD"
        : resolutionKind === "FIELD"
          ? "FIELD_MAGIC_TO_FIELD"
          : "TEMP_EQUIP_MAGIC_TO_FIELD";
      const slotFullReason = "INFINITE_MAGIC_SLOT_FULL";
      const failedEventType = "INFINITE_MAGIC_FAILED_SLOT_FULL";
      const resolvedEventType = resolutionKind === "INFINITE"
        ? "INFINITE_MAGIC_RESOLVED_TO_FIELD"
        : resolutionKind === "FIELD"
          ? "FIELD_MAGIC_RESOLVED_TO_FIELD"
          : "TEMP_EQUIP_MAGIC_RESOLVED_TO_FIELD";

      const infiniteMagicSlotFull =
        link.magicType === "INFINITE" &&
        countInfiniteMagicOnField(nextState, fieldOwner) >= MAX_INFINITE_MAGIC_ON_FIELD;

      if (infiniteMagicSlotFull) {
        addEvent(nextState, failedEventType, link.playerId, {
          chainId: chain.id,
          chainLinkId: link.id,
          cardInstanceId: link.cardInstanceId,
          cardName: link.cardName,
          magicType: link.magicType,
          magicSubType: link.magicSubType,
          message: `${fieldOwner.displayName} already has ${MAX_INFINITE_MAGIC_ON_FIELD} Infinite Magic cards. You can't play that magic card.`,
          boardEvents: [
            {
              type: "CHAIN_LINK_RESOLVED",
              playerId: link.playerId,
              cardInstanceId: link.cardInstanceId,
              sourceCardInstanceId: link.cardInstanceId,
              sourceCardId: link.cardId,
              actionType: "RESOLVE_MAGIC_CHAIN_LINK",
              reason: slotFullReason,
              fromZoneRef: chainBoardZoneRef(link.playerId),
              toZoneRef: chainBoardZoneRef(link.playerId),
              chainLinkId: link.id
            }
          ]
        });
      }

      if (!infiniteMagicSlotFull) {
        assertCanAddMagicToField(nextState, fieldOwner, chainCard, {
          message: `${fieldOwner.displayName} already has ${MAX_INFINITE_MAGIC_ON_FIELD} Infinite Magic cards.`
        });
        chainCard.zone = "MAGIC_SLOT";
        fieldOwner.field.magicSlots.push(chainCard);

        addEvent(nextState, resolvedEventType, link.playerId, {
          chainId: chain.id,
          chainLinkId: link.id,
          cardInstanceId: link.cardInstanceId,
          cardName: link.cardName,
          magicType: link.magicType,
          magicSubType: link.magicSubType,
          boardEvents: [
            {
              type: "CHAIN_LINK_RESOLVED",
              playerId: link.playerId,
              cardInstanceId: link.cardInstanceId,
              sourceCardInstanceId: link.cardInstanceId,
              sourceCardId: link.cardId,
              actionType: "RESOLVE_MAGIC_CHAIN_LINK",
              reason,
              fromZoneRef: chainBoardZoneRef(link.playerId),
              toZoneRef: { playerId: fieldOwner.id, zone: "MAGIC_SLOT" as const },
              chainLinkId: link.id
            },
            {
              type: "MAGIC_RESOLVED",
              playerId: link.playerId,
              cardInstanceId: link.cardInstanceId,
              sourceCardInstanceId: link.cardInstanceId,
              sourceCardId: link.cardId,
              actionType: "RESOLVE_MAGIC_CHAIN_LINK",
              reason,
              fromZoneRef: chainBoardZoneRef(link.playerId),
              toZoneRef: { playerId: fieldOwner.id, zone: "MAGIC_SLOT" as const },
              chainLinkId: link.id
            }
          ]
        });
      }

      continue;
    }

    chainCard.zone = "CEMETERY";
    ownerPlayer.cemetery.push(chainCard);

    addEvent(nextState, "MAGIC_RESOLVED_TO_CEMETERY", link.playerId, {
      chainId: chain.id,
      chainLinkId: link.id,
      cardInstanceId: link.cardInstanceId,
      cardName: link.cardName,
      magicType: link.magicType,
      isLightningResponse: link.isLightningResponse,
      boardEvents: [
        {
          type: "CHAIN_LINK_RESOLVED",
          playerId: link.playerId,
          cardInstanceId: link.cardInstanceId,
          sourceCardInstanceId: link.cardInstanceId,
          sourceCardId: link.cardId,
          actionType: "RESOLVE_MAGIC_CHAIN_LINK",
          reason: "MAGIC_RESOLVED_TO_CEMETERY",
          fromZoneRef: chainBoardZoneRef(link.playerId),
          toZoneRef: cemeteryBoardZoneRef(ownerPlayer.id),
          chainLinkId: link.id
        },
        {
          type: "MAGIC_RESOLVED",
          playerId: link.playerId,
          cardInstanceId: link.cardInstanceId,
          sourceCardInstanceId: link.cardInstanceId,
          sourceCardId: link.cardId,
          actionType: "RESOLVE_MAGIC_CHAIN_LINK",
          reason: "MAGIC_RESOLVED_TO_CEMETERY",
          fromZoneRef: chainBoardZoneRef(link.playerId),
          toZoneRef: cemeteryBoardZoneRef(ownerPlayer.id),
          chainLinkId: link.id
        }
      ]
    });
  }

  addEvent(nextState, "MAGIC_CHAIN_RESOLVED", chain.startedByPlayerId, {
    chainId: chain.id,
    linkCount: chain.links.length,
    resolutionOrder: [...chain.links].reverse().map(link => ({
      linkId: link.id,
      cardName: link.cardName,
      status: link.status
    }))
  });

  nextState.pendingChain = undefined;

  return nextState;
}
