import { v4 as uuidv4 } from "uuid";
import type { CardInstance, EffectTargetOption, MagicChainLink, MagicChainState, MatchState, PendingEffectTargetPrompt, WardEngineEffect } from "@ward/shared";
import {
  getCardEngineEffects,
  isAutomaticMagicEffectSupported,
  isDeferredToAttachmentEffect,
  tryResolveAutomaticMagicEffect
} from "./effectResolver.js";
import { createEffectTargetPromptFromChainLink } from "./effectPrompts.js";
import { getEffectResolutionMode } from "./effectRegistry.js";
import { addEvent, cloneState, getCardDefinition, getPlayer } from "./engineRuntime.js";
import {
  ensureNoHandDiscardRequired,
  ensureNoOpenChain,
  ensureNoPendingManualEffects
} from "./actionGuards.js";
import {
  createManualEffectRequestFromChainLink,
  effectShouldResolveWhenCardIsPlayed
} from "./actionCards.js";
import { assertPlayerCanPlayMagicUnderSilenceFromTheGrave } from "./silenceFromTheGrave.js";
import { resolveBattleResponseChainLinkInPlace } from "./battle.js";

function getOpponentPlayerId(state: MatchState, playerId: string): string | undefined {
  return state.players.find(player => player.id !== playerId)?.id;
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

  return actionType === "SEARCH_DECK_TO_HAND" || (
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
    return false;
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

function linkHasNegateEffect(state: MatchState, link: { cardId: string; text?: string }): boolean {
  const definition = state.cardCatalog[link.cardId];
  const effects = getCardEngineEffects(definition);

  if (effects.some(effectNegatesMagicChainLink)) {
    return true;
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

function shouldSkipResolvedLightningEffect(state: MatchState, link: { cardId: string; isLightningResponse: boolean; text?: string }): boolean {
  if (!link.isLightningResponse) return false;
  const definition = state.cardCatalog[link.cardId];
  const effects = getCardEngineEffects(definition);

  if (effects.length === 0) {
    return linkHasNegateEffect(state, link);
  }

  return effects.every(effectNegatesMagicChainLink);
}

export function createMagicChainLink(
  state: MatchState,
  playerId: string,
  card: CardInstance,
  isLightningResponse: boolean,
  respondsToLinkId?: string
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
  }
): void {
  if (link.status !== "RESOLVED") {
    return;
  }

  const definition = state.cardCatalog[link.cardId];
  const effects = getCardEngineEffects(definition);

  if (shouldSkipResolvedLightningEffect(state, link)) {
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

  const effectsThatResolveNow = effects.filter(effectShouldResolveWhenCardIsPlayed);

  const effectsThatResolveNowWithoutPreChainCosts = isSilenceFromTheGraveLink(state, link)
    ? effectsThatResolveNow.filter(effect => !isSilenceFromTheGravePreChainCostEffect(effect))
    : effectsThatResolveNow;

  if (effectsThatResolveNowWithoutPreChainCosts.length !== effectsThatResolveNow.length) {
    addEvent(state, "SILENCE_FROM_THE_GRAVE_PRE_CHAIN_COST_SKIPPED_AFTER_RESOLUTION", link.playerId, {
      sourceCardName: link.cardName,
      skippedCostEffectCount: effectsThatResolveNow.length - effectsThatResolveNowWithoutPreChainCosts.length,
      note: "Silence From The Grave's discard-Magic cost was already paid before the card entered the Magic Chain."
    });
  }

  if (effectsThatResolveNowWithoutPreChainCosts.length === 0) {
    addEvent(state, "NO_ON_PLAY_MAGIC_EFFECTS_TO_RESOLVE", link.playerId, {
      sourceCardName: link.cardName,
      effectCount: effects.length,
      reason:
        "This card has parsed effects, but none of them resolve when the card is played after pre-chain costs are removed."
    });

    return;
  }

  const immediateEffects = orderImmediateEffectsForResolution(
    effectsThatResolveNowWithoutPreChainCosts.filter(effect => !isDeferredToAttachmentEffect(effect))
  );

  if (immediateEffects.length === 0) {
    addEvent(state, "MAGIC_EFFECTS_DEFERRED_TO_ATTACHMENT", link.playerId, {
      sourceCardName: link.cardName,
      effectCount: effectsThatResolveNow.length
    });

    return;
  }

  if (
    immediateEffects.length === 1 &&
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
          reason: "No legal cards matched this deck/search effect. The effect resolves without opening manual fallback."
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
      optionCount: prompt.options.length
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

  assertPlayerCanPlayMagicUnderSilenceFromTheGrave(nextState, playerId);

  if (definition.magicType === "INFINITE" && player.field.magicSlots.length >= 5) {
    throw new Error("You already have 5 Infinite Magic cards on your side of the field.");
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
    cardInstanceId,
    cardName: definition.name,
    magicType: definition.magicType,
    magicSubType: definition.magicSubType
  });

  return nextState;
}

export function playLightningResponseFromHand(
  state: MatchState,
  playerId: string,
  cardInstanceId: string
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

  assertPlayerCanPlayMagicUnderSilenceFromTheGrave(nextState, playerId);

  const previousLink = chain.links[chain.links.length - 1];

  if (!previousLink) {
    throw new Error("Magic Chain has no link to respond to.");
  }

  if (chain.priorityPlayerId && chain.priorityPlayerId !== playerId) {
    throw new Error("This player does not currently have Magic Chain response priority.");
  }

  if (previousLink.playerId === playerId) {
    throw new Error("A player cannot respond to their own chain link.");
  }

  player.hand.splice(handIndex, 1);
  card.zone = "CHAIN";
  nextState.chainZone.push(card);

  const chainLink = createMagicChainLink(
    nextState,
    playerId,
    card,
    true,
    previousLink.id
  );

  chain.links.push(chainLink);
  chain.respondedPlayerIds.push(playerId);
  chain.lastLinkPlayerId = playerId;
  chain.priorityPlayerId = getOpponentPlayerId(nextState, playerId);
  chain.passesSinceLastResponse = 0;

  addEvent(nextState, "LIGHTNING_RESPONSE_ADDED", playerId, {
    chainId: chain.id,
    cardInstanceId,
    cardName: definition.name,
    respondsToLinkId: previousLink.id,
    respondsToCardName: previousLink.cardName,
    nextPriorityPlayerId: chain.priorityPlayerId
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
    lastLinkPlayerId: chain.lastLinkPlayerId
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
          negatingCardName: link.cardName,
          negatedCardName: targetLink.cardName,
          negatedLinkId: targetLink.id
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
        cardName: link.cardName
      });

      continue;
    }

    const resolvedBattleResponse = resolveBattleResponseChainLinkInPlace(nextState, link);

    if (!resolvedBattleResponse) {
      // SILENCE_SOURCE_LINKED_EFFECTS_RESOLVE_BEFORE_CARD_LEAVES_CHAIN
      // Source-linked resolved effects must run while the source card is still findable in chainZone.
      // Silence From The Grave uses this to attach its Magic lock and turn-conditional creature suppression.
      resolveOrQueueResolvedMagicEffects(nextState, link);
    }

    nextState.chainZone.splice(chainCardIndex, 1);

    if (link.magicType === "INFINITE" && !link.isLightningResponse) {
      const fieldOwner = getPlayer(nextState, link.playerId);

      if (fieldOwner.field.magicSlots.length >= 5) {
        chainCard.zone = "CEMETERY";
        ownerPlayer.cemetery.push(chainCard);

        addEvent(nextState, "INFINITE_MAGIC_FAILED_SLOT_FULL", link.playerId, {
          chainId: chain.id,
          cardName: link.cardName
        });
      } else {
        chainCard.zone = "MAGIC_SLOT";
        fieldOwner.field.magicSlots.push(chainCard);

        addEvent(nextState, "INFINITE_MAGIC_RESOLVED_TO_FIELD", link.playerId, {
          chainId: chain.id,
          cardName: link.cardName
        });
      }

      continue;
    }

    chainCard.zone = "CEMETERY";
    ownerPlayer.cemetery.push(chainCard);

    addEvent(nextState, "MAGIC_RESOLVED_TO_CEMETERY", link.playerId, {
      chainId: chain.id,
      cardName: link.cardName,
      magicType: link.magicType,
      isLightningResponse: link.isLightningResponse
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
