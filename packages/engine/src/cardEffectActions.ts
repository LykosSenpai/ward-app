import type {
  ActiveEffectInstance,
  CardDefinition,
  CardInstance,
  MatchState,
  PendingEffectRollSession,
  PlayerState,
  WardEngineEffect
} from "@ward/shared";
import { v4 as uuidv4 } from "uuid";
import { addEvent, cloneState, getCardName, getOpponentPlayer, getPlayer } from "./engineRuntime.js";
import { rollD6WithDev } from "./devRolls.js";
import {
  getCardEngineEffects,
  isAutomaticMagicEffectSupported,
  tryResolveAutomaticMagicEffect
} from "./effectResolver.js";
import { areCreatureEffectsSuppressed } from "./creatureEffectSuppression.js";
import { createEffectTargetPromptFromChainLink } from "./effectPrompts.js";
import { inferTargetQueryForEffect } from "./targets.js";
import { moveMagicSlotCardToCemetery } from "./cardMovement.js";

const ACTIVATED_EFFECT_USAGE_ACTION = "ACTIVATED_EFFECT_USAGE";

export type CardEffectSourceZone = "PRIMARY_CREATURE" | "LIMITED_SUMMON" | "MAGIC_SLOT";

export type AvailableCardEffectAction = {
  sourceInstanceId: string;
  sourceCardId: string;
  sourceCardName: string;
  sourceZone: CardEffectSourceZone;
  controllerPlayerId: string;

  effectId: string;
  trigger?: string;
  actionType: string;
  effectGroup?: string;
  label: string;
  description?: string;

  requiresRoll: boolean;
  disabledReason?: string;
};

type FieldEffectSource = {
  player: PlayerState;
  card: CardInstance;
  definition: CardDefinition;
  zone: CardEffectSourceZone;
};

function promptBoardEvents(prompt: NonNullable<MatchState["pendingEffectTargetPrompt"]>) {
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
      toZoneRef: deckOptions.length > 0
        ? { playerId: prompt.controllerPlayerId, zone: "DECK" }
        : { playerId: prompt.controllerPlayerId, zone: "PROMPT" }
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
          fromZoneRef: { playerId: option.playerId, zone: "DECK" },
          toZoneRef: { playerId: prompt.controllerPlayerId, zone: "PROMPT" }
        }]
      : [])
  ];
}

type RollCondition = {
  dieSize: number;
  successValues: number[];
  text?: string;
};

function normalizeText(...values: Array<unknown>): string {
  return values
    .filter(value => value !== undefined && value !== null)
    .map(value => (typeof value === "string" ? value : JSON.stringify(value)))
    .join(" ")
    .toLowerCase();
}

function getEffectDescription(effect: WardEngineEffect): string | undefined {
  return effect.actionText ?? effect.value ?? effect.params?.valueText;
}

function isManualFieldTrigger(effect: WardEngineEffect): boolean {
  const trigger = (effect.trigger ?? "").trim().toUpperCase();
  if (isStatusEscapeRollEffect(effect)) return true;

  return [
    "WHILE_ON_FIELD",
    "STATIC_WHILE_ON_FIELD",
    "DURING_YOUR_TURN_ACTIVATED",
    "ONCE_PER_TURN_ACTIVATED",
    "ACTIVATED",
    "DURING_YOUR_TURN",
    "REQUEST_BASED"
  ].includes(trigger);
}

function isRevealOpponentHandEffect(effect: WardEngineEffect): boolean {
  const text = normalizeText(
    effect.actionType,
    effect.effectGroup,
    effect.actionText,
    effect.target,
    effect.value,
    effect.params?.target,
    effect.params?.valueText
  );

  return (
    effect.actionType === "APPLY_PLAY_RESTRICTION" &&
    text.includes("opponent") &&
    text.includes("hand") &&
    (text.includes("reveal") || text.includes("show"))
  );
}

function isActivatedRollEffect(effect: WardEngineEffect): boolean {
  const trigger = (effect.trigger ?? "").trim().toUpperCase();
  return ["DURING_YOUR_TURN_ACTIVATED", "ONCE_PER_TURN_ACTIVATED", "ACTIVATED", "DURING_YOUR_TURN"].includes(trigger) ||
    isStatusEscapeRollEffect(effect);
}

function consumesOncePerTurnActivation(effect: WardEngineEffect): boolean {
  const trigger = (effect.trigger ?? "").trim().toUpperCase();
  return trigger === "DURING_YOUR_TURN_ACTIVATED" ||
    trigger === "ONCE_PER_TURN_ACTIVATED";
}

function hasUsedEffectThisTurn(
  state: MatchState,
  source: FieldEffectSource,
  effect: WardEngineEffect
): boolean {
  return (source.card.activeEffectInstances ?? []).some(instance =>
    instance.actionType === ACTIVATED_EFFECT_USAGE_ACTION &&
    instance.sourceEffectId === effect.id &&
    instance.sourceCardInstanceId === source.card.instanceId &&
    instance.appliedTurnNumber === state.turn.turnNumber
  );
}

function createActivatedEffectUsageMarker(
  state: MatchState,
  source: FieldEffectSource,
  effect: WardEngineEffect,
  playerId: string
): ActiveEffectInstance {
  return {
    id: uuidv4(),
    kind: "OTHER",
    sourceEffectId: effect.id,
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: getCardName(state, source.card),
    sourcePlayerId: playerId,
    targetPlayerId: playerId,
    targetCardInstanceId: source.card.instanceId,
    targetCardName: getCardName(state, source.card),
    actionType: ACTIVATED_EFFECT_USAGE_ACTION,
    label: "Effect used this turn",
    durationType: "TARGET_PLAYER_TURN_STARTS",
    expiresOnPlayerId: playerId,
    expiresAtPlayerTurnStartCount: (state.turn.turnStartCountsByPlayer[playerId] ?? 0) + 1,
    appliedTurnNumber: state.turn.turnNumber,
    appliedTurnCycle: state.turn.turnCycleNumber
  };
}

function isStatusEscapeRollEffect(effect: WardEngineEffect): boolean {
  return effect.actionType === "RESOLVE_STATUS_ESCAPE_ROLL";
}

function isSupportedCardEffect(effect: WardEngineEffect): boolean {
  if (!isManualFieldTrigger(effect)) {
    return false;
  }

  if (isRevealOpponentHandEffect(effect)) {
    return true;
  }

  if (isActivatedRollEffect(effect)) {
    return isStatusEscapeRollEffect(effect) ||
      isAutomaticMagicEffectSupported(effect) ||
      !!inferTargetQueryForEffect(effect);
  }

  return !!inferTargetQueryForEffect(effect);
}

function getRollConditionValue(effect: WardEngineEffect): RollCondition | undefined {
  const candidates = [effect.condition, effect.params?.condition];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const data = candidate as {
      dieSize?: unknown;
      successValues?: unknown;
      text?: unknown;
    };

    const dieSize = Number(data.dieSize ?? 6);
    const successValues = Array.isArray(data.successValues)
      ? data.successValues.map(value => Number(value)).filter(value => Number.isInteger(value))
      : [];

    if (Number.isInteger(dieSize) && dieSize > 0 && successValues.length > 0) {
      return {
        dieSize,
        successValues,
        text: typeof data.text === "string" ? data.text : undefined
      };
    }
  }

  const text = normalizeText(effect.condition, effect.actionText, effect.value, effect.params?.condition, effect.params?.valueText);
  const range = text.match(/(\d+)\s*[-–—]\s*(\d+)/);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (Number.isInteger(min) && Number.isInteger(max)) {
      const low = Math.max(1, Math.min(6, Math.min(min, max)));
      const high = Math.max(1, Math.min(6, Math.max(min, max)));
      return {
        dieSize: 6,
        successValues: Array.from({ length: high - low + 1 }, (_, index) => low + index),
        text
      };
    }
  }

  return undefined;
}

function getAttachedCreatureControlledByPlayer(
  state: MatchState,
  magicCard: CardInstance,
  playerId: string
): CardInstance | undefined {
  if (!magicCard.attachedToInstanceId) return undefined;
  const player = getPlayer(state, playerId);
  return [
    player.field.primaryCreature,
    ...player.field.limitedSummons
  ].find((card): card is CardInstance => !!card && card.instanceId === magicCard.attachedToInstanceId);
}

function canPlayerUseStatusEscapeRoll(
  state: MatchState,
  source: FieldEffectSource,
  playerId: string
): boolean {
  const attached = getAttachedCreatureControlledByPlayer(state, source.card, playerId);
  if (!attached) return false;
  return (attached.activeStatuses ?? []).some(status =>
    status.status === "FROZEN" &&
    status.sourceCardInstanceId === source.card.instanceId &&
    status.flags.canInflictAtkDamage === false
  );
}

function getEffectLabel(effect: WardEngineEffect): string {
  if (isRevealOpponentHandEffect(effect)) {
    return "Reveal opponent hand";
  }

  if (isActivatedRollEffect(effect)) {
    const description = getEffectDescription(effect);
    return description ? `Use effect: ${description}` : "Use creature effect";
  }

  return effect.actionText ?? effect.value ?? effect.actionType;
}

function successRangesFromValues(values: number[]): PendingEffectRollSession["successRanges"] {
  return values
    .map(value => Math.trunc(Number(value)))
    .filter(value => Number.isInteger(value) && value > 0)
    .map(value => ({ min: value, max: value }));
}

function createPendingActivatedEffectRoll(
  state: MatchState,
  args: {
    playerId: string;
    source: FieldEffectSource;
    effect: WardEngineEffect;
    condition: RollCondition;
  }
): PendingEffectRollSession {
  const now = new Date().toISOString();
  const sourceCardName = getCardName(state, args.source.card);

  return {
    id: uuidv4(),
    status: "AWAITING_ROLL",
    createdAt: now,
    updatedAt: now,
    sourcePlayerId: args.playerId,
    sourceCardInstanceId: args.source.card.instanceId,
    sourceCardId: args.source.card.cardId,
    sourceCardName,
    rollPlayerId: args.playerId,
    effectId: args.effect.id,
    trigger: args.effect.trigger ?? "DURING_YOUR_TURN_ACTIVATED",
    actionType: args.effect.actionType,
    actionText: args.effect.actionText ?? args.effect.value ?? args.effect.params?.valueText,
    diceKind: "EFFECT_ROLL",
    diceCount: 1,
    successRanges: successRangesFromValues(args.condition.successValues),
    onSuccessActionType: args.effect.actionType,
    message: `${sourceCardName} is ready. Roll 1D6 for its effect.`
  };
}

function sourceDisabledReason(
  state: MatchState,
  source: FieldEffectSource,
  effect: WardEngineEffect,
  playerId: string
): string | undefined {
  if ((state.status ?? "ACTIVE") === "COMPLETE") {
    return "Match is complete.";
  }

  if (source.card.controllerPlayerId !== playerId && !(
    isStatusEscapeRollEffect(effect) && canPlayerUseStatusEscapeRoll(state, source, playerId)
  )) {
    return "You do not control this card.";
  }

  if (source.definition.cardType === "CREATURE" && areCreatureEffectsSuppressed(state, source.card)) {
    return "This creature's effects are currently suppressed.";
  }

  if (source.zone === "LIMITED_SUMMON" && source.definition.cardType === "CREATURE") {
    return "Limited Summons lose their creature effects.";
  }

  if (state.pendingPrompt) {
    return "Resolve the pending reveal/redraw prompt first.";
  }

  if (state.pendingEffectTargetPrompt) {
    return "Resolve the pending effect target first.";
  }

  if (state.pendingChain) {
    return "Resolve the Magic Chain first.";
  }

  if (state.pendingBattle && state.pendingBattle.status !== "COMPLETE") {
    return "Finish the pending battle first.";
  }

  if (state.pendingEffectRoll) {
    return "Resolve the pending effect roll before using another effect.";
  }

  if (isActivatedRollEffect(effect) && state.turn.activePlayerId !== playerId) {
    return "This activated effect can only be used during your turn.";
  }

  if (consumesOncePerTurnActivation(effect) && hasUsedEffectThisTurn(state, source, effect)) {
    return "This effect has already been used this turn.";
  }

  return undefined;
}

function collectFieldEffectSources(state: MatchState, playerId?: string): FieldEffectSource[] {
  const sources: FieldEffectSource[] = [];

  for (const player of state.players) {
    const add = (card: CardInstance | undefined, zone: CardEffectSourceZone) => {
      if (!card) return;

      const definition = state.cardCatalog[card.cardId];
      if (!definition) return;

      if (playerId && player.id !== playerId) {
        const isEscapableAttachedMagic = definition.cardType === "MAGIC" &&
          getCardEngineEffects(definition).some(isStatusEscapeRollEffect) &&
          !!getAttachedCreatureControlledByPlayer(state, card, playerId);
        if (!isEscapableAttachedMagic) return;
      }

      sources.push({ player, card, definition, zone });
    };

    add(player.field.primaryCreature, "PRIMARY_CREATURE");

    for (const limited of player.field.limitedSummons) {
      add(limited, "LIMITED_SUMMON");
    }

    for (const magic of player.field.magicSlots) {
      add(magic, "MAGIC_SLOT");
    }
  }

  return sources;
}

function findFieldEffectSource(
  state: MatchState,
  sourceInstanceId: string
): FieldEffectSource | undefined {
  return collectFieldEffectSources(state).find(
    source => source.card.instanceId === sourceInstanceId
  );
}

export function listAvailableCardEffectActions(
  state: MatchState,
  playerId: string
): AvailableCardEffectAction[] {
  const sources = collectFieldEffectSources(state, playerId);
  const actions: AvailableCardEffectAction[] = [];

  for (const source of sources) {
    const effects = getCardEngineEffects(source.definition);

    for (const effect of effects) {
      if (!isSupportedCardEffect(effect)) {
        continue;
      }

      actions.push({
        sourceInstanceId: source.card.instanceId,
        sourceCardId: source.card.cardId,
        sourceCardName: source.definition.name,
        sourceZone: source.zone,
        controllerPlayerId: source.card.controllerPlayerId,
        effectId: effect.id,
        trigger: effect.trigger,
        actionType: effect.actionType,
        effectGroup: effect.effectGroup,
        label: getEffectLabel(effect),
        description: getEffectDescription(effect),
        requiresRoll: !!getRollConditionValue(effect),
        disabledReason: sourceDisabledReason(state, source, effect, playerId)
      });
    }
  }

  return actions;
}

function createRevealedCardPayload(state: MatchState, player: PlayerState) {
  return player.hand.map(card => {
    const definition = state.cardCatalog[card.cardId];

    return {
      cardInstanceId: card.instanceId,
      cardId: card.cardId,
      cardName: definition?.name ?? card.cardId,
      cardType: definition?.cardType ?? "CREATURE"
    };
  });
}

function activateRevealOpponentHandEffect(
  nextState: MatchState,
  args: {
    playerId: string;
    source: FieldEffectSource;
    effect: WardEngineEffect;
  }
): MatchState {
  const viewer = getPlayer(nextState, args.playerId);
  const revealedPlayer = getOpponentPlayer(nextState, args.playerId);
  const revealedCards = createRevealedCardPayload(nextState, revealedPlayer);

  addEvent(nextState, "CARD_EFFECT_REVEAL_HAND_RESOLVED", args.playerId, {
    sourceCardInstanceId: args.source.card.instanceId,
    sourceCardId: args.source.card.cardId,
    sourceCardName: getCardName(nextState, args.source.card),
    effectId: args.effect.id,
    actionType: args.effect.actionType,
    viewerPlayerId: viewer.id,
    viewerPlayerName: viewer.displayName,
    revealedPlayerId: revealedPlayer.id,
    revealedPlayerName: revealedPlayer.displayName,
    revealedCardCount: revealedCards.length,
    revealedCards,
    boardEvents: [
      {
        type: "HAND_REVEALED",
        playerId: viewer.id,
        sourceCardInstanceId: args.source.card.instanceId,
        sourceCardId: args.source.card.cardId,
        sourceEffectId: args.effect.id,
        actionType: args.effect.actionType,
        reason: "REVEAL_HAND",
        fromZoneRef: { playerId: revealedPlayer.id, zone: "HAND" },
        toZoneRef: { playerId: viewer.id, zone: "PROMPT" },
        metadata: {
          viewerPlayerId: viewer.id,
          revealedPlayerId: revealedPlayer.id
        }
      },
      ...revealedCards.map(card => ({
        type: "CARD_REVEALED",
        cardInstanceId: card.cardInstanceId,
        playerId: viewer.id,
        sourceCardInstanceId: args.source.card.instanceId,
        sourceCardId: args.source.card.cardId,
        sourceEffectId: args.effect.id,
        actionType: args.effect.actionType,
        reason: "REVEAL_HAND",
        fromZoneRef: { playerId: revealedPlayer.id, zone: "HAND" },
        toZoneRef: { playerId: viewer.id, zone: "PROMPT" }
      }))
    ]
  });

  return nextState;
}

function activateRollBasedEffect(
  nextState: MatchState,
  args: {
    playerId: string;
    source: FieldEffectSource;
    effect: WardEngineEffect;
  }
): MatchState {
  const condition = getRollConditionValue(args.effect);

  if (!condition) {
    const targetQuery = inferTargetQueryForEffect(args.effect);

    if (targetQuery) {
      nextState.pendingEffectTargetPrompt = createEffectTargetPromptFromChainLink(
        nextState,
        {
          cardInstanceId: args.source.card.instanceId,
          cardId: args.source.card.cardId,
          cardName: getCardName(nextState, args.source.card),
          playerId: args.playerId
        },
        args.effect
      );

      addEvent(nextState, "CARD_EFFECT_TARGET_PROMPT_CREATED", args.playerId, {
        sourceCardInstanceId: args.source.card.instanceId,
        sourceCardId: args.source.card.cardId,
        sourceCardName: getCardName(nextState, args.source.card),
        effectId: args.effect.id,
        actionType: args.effect.actionType,
        promptId: nextState.pendingEffectTargetPrompt.id,
        optionCount: nextState.pendingEffectTargetPrompt.options.length,
        boardEvents: promptBoardEvents(nextState.pendingEffectTargetPrompt)
      });

      return nextState;
    }

    addEvent(nextState, "CARD_EFFECT_ACTIVATED_MANUAL_FALLBACK", args.playerId, {
      sourceCardInstanceId: args.source.card.instanceId,
      sourceCardId: args.source.card.cardId,
      sourceCardName: getCardName(nextState, args.source.card),
      effectId: args.effect.id,
      actionType: args.effect.actionType,
      reason: "This activated effect does not have a supported roll condition or target route yet."
    });

    return nextState;
  }

  if (condition.dieSize !== 6) {
    throw new Error("Only D6 activated creature effects are supported right now.");
  }

  if (!isStatusEscapeRollEffect(args.effect) && isAutomaticMagicEffectSupported(args.effect)) {
    if (nextState.pendingEffectRoll) {
      throw new Error("Resolve the pending effect roll before using another dice effect.");
    }

    const session = createPendingActivatedEffectRoll(nextState, {
      playerId: args.playerId,
      source: args.source,
      effect: args.effect,
      condition
    });
    nextState.pendingEffectRoll = session;

    addEvent(nextState, "CARD_EFFECT_ROLL_CREATED", args.playerId, {
      effectRollSessionId: session.id,
      sourceCardInstanceId: args.source.card.instanceId,
      sourceCardId: args.source.card.cardId,
      sourceCardName: getCardName(nextState, args.source.card),
      effectId: args.effect.id,
      actionType: args.effect.actionType,
      diceCount: session.diceCount,
      successRanges: session.successRanges,
      message: session.message
    });

    return nextState;
  }

  const roll = rollD6WithDev(nextState, {
    kind: "EFFECT_ROLL",
    count: 1,
    playerId: args.playerId,
    label: `${getCardName(nextState, args.source.card)} ${args.effect.id} activated effect roll`,
    addEvent,
    context: { effectId: args.effect.id, actionType: args.effect.actionType, sourceCardInstanceId: args.source.card.instanceId }
  })[0];
  const success = condition.successValues.includes(roll);

  addEvent(
    nextState,
    success ? "CARD_EFFECT_ROLL_SUCCEEDED" : "CARD_EFFECT_ROLL_FAILED",
    args.playerId,
    {
      sourceCardInstanceId: args.source.card.instanceId,
      sourceCardId: args.source.card.cardId,
      sourceCardName: getCardName(nextState, args.source.card),
      effectId: args.effect.id,
      actionType: args.effect.actionType,
      conditionText: condition.text,
      dieSize: condition.dieSize,
      roll,
      successValues: condition.successValues,
      success
    }
  );

  if (!success) {
    return nextState;
  }

  if (isStatusEscapeRollEffect(args.effect)) {
    const attached = getAttachedCreatureControlledByPlayer(nextState, args.source.card, args.playerId);
    if (!attached) {
      throw new Error("The frozen creature is no longer attached to this effect.");
    }

    const beforeStatusCount = attached.activeStatuses?.length ?? 0;
    attached.activeStatuses = (attached.activeStatuses ?? []).filter(status =>
      !(status.status === "FROZEN" && status.sourceCardInstanceId === args.source.card.instanceId)
    );
    attached.activeEffectInstances = (attached.activeEffectInstances ?? []).filter(instance =>
      instance.sourceCardInstanceId !== args.source.card.instanceId
    );

    const destroyed = moveMagicSlotCardToCemetery(
      nextState,
      args.source.player.id,
      args.source.card.instanceId,
      addEvent,
      "STATUS_ESCAPE_ROLL_SUCCEEDED"
    );

    addEvent(nextState, "STATUS_ESCAPE_ROLL_RESOLVED", args.playerId, {
      sourceCardInstanceId: args.source.card.instanceId,
      sourceCardId: args.source.card.cardId,
      sourceCardName: getCardName(nextState, args.source.card),
      effectId: args.effect.id,
      actionType: args.effect.actionType,
      targetPlayerId: args.playerId,
      targetCreatureInstanceId: attached.instanceId,
      removedStatusCount: beforeStatusCount - (attached.activeStatuses?.length ?? 0),
      destroyedCardName: destroyed.destroyedCardName,
      destroyedCardInstanceId: destroyed.magicCard.instanceId,
      roll
    });

    return nextState;
  }

  if (isAutomaticMagicEffectSupported(args.effect)) {
    const resolved = tryResolveAutomaticMagicEffect(nextState, {
      effect: args.effect,
      controllerPlayerId: args.playerId,
      sourceCardName: getCardName(nextState, args.source.card),
      sourceCardInstanceId: args.source.card.instanceId,
      addEvent
    });

    if (resolved) {
      return nextState;
    }
  }

  const targetQuery = inferTargetQueryForEffect(args.effect);

  if (targetQuery) {
    nextState.pendingEffectTargetPrompt = createEffectTargetPromptFromChainLink(
      nextState,
      {
        cardInstanceId: args.source.card.instanceId,
        cardId: args.source.card.cardId,
        cardName: getCardName(nextState, args.source.card),
        playerId: args.playerId
      },
      args.effect
    );

    addEvent(nextState, "CARD_EFFECT_TARGET_PROMPT_CREATED", args.playerId, {
      sourceCardInstanceId: args.source.card.instanceId,
      sourceCardId: args.source.card.cardId,
      sourceCardName: getCardName(nextState, args.source.card),
      effectId: args.effect.id,
      actionType: args.effect.actionType,
      promptId: nextState.pendingEffectTargetPrompt.id,
      optionCount: nextState.pendingEffectTargetPrompt.options.length,
      boardEvents: promptBoardEvents(nextState.pendingEffectTargetPrompt)
    });

    return nextState;
  }

  addEvent(nextState, "CARD_EFFECT_ACTIVATED_MANUAL_FALLBACK", args.playerId, {
    sourceCardInstanceId: args.source.card.instanceId,
    sourceCardId: args.source.card.cardId,
    sourceCardName: getCardName(nextState, args.source.card),
    effectId: args.effect.id,
    actionType: args.effect.actionType,
    reason: "The roll succeeded, but this effect does not have an automated result route yet."
  });

  return nextState;
}

export function activateCardEffect(
  state: MatchState,
  args: {
    playerId: string;
    sourceInstanceId: string;
    effectId: string;
  }
): MatchState {
  const source = findFieldEffectSource(state, args.sourceInstanceId);

  if (!source) {
    throw new Error("The source card is no longer on the field.");
  }

  const effect = getCardEngineEffects(source.definition).find(
    candidate => candidate.id === args.effectId
  );

  if (!effect) {
    throw new Error("The selected effect was not found on the source card.");
  }

  const isStatusEscape = isStatusEscapeRollEffect(effect);
  if (source.card.controllerPlayerId !== args.playerId && !(isStatusEscape && canPlayerUseStatusEscapeRoll(state, source, args.playerId))) {
    throw new Error("You can only activate effects from cards you control.");
  }

  if (!isSupportedCardEffect(effect)) {
    throw new Error(`This effect is not supported by Effect Runtime v1 yet: ${effect.actionType}.`);
  }

  const disabledReason = sourceDisabledReason(state, source, effect, args.playerId);

  if (disabledReason) {
    throw new Error(disabledReason);
  }

  const nextState = cloneState(state);
  const nextSource = findFieldEffectSource(nextState, args.sourceInstanceId);

  if (!nextSource) {
    throw new Error("The source card was not found after cloning state.");
  }

  if (consumesOncePerTurnActivation(effect)) {
    nextSource.card.activeEffectInstances = (nextSource.card.activeEffectInstances ?? []).filter(instance => !(
      instance.actionType === ACTIVATED_EFFECT_USAGE_ACTION &&
      instance.sourceEffectId === effect.id &&
      instance.appliedTurnNumber === nextState.turn.turnNumber
    ));
    nextSource.card.activeEffectInstances.push(createActivatedEffectUsageMarker(nextState, nextSource, effect, args.playerId));
  }

  if (isRevealOpponentHandEffect(effect)) {
    return activateRevealOpponentHandEffect(nextState, {
      playerId: args.playerId,
      source: nextSource,
      effect
    });
  }

  if (isActivatedRollEffect(effect)) {
    return activateRollBasedEffect(nextState, {
      playerId: args.playerId,
      source: nextSource,
      effect
    });
  }

  throw new Error(`No runtime route exists for effect action: ${effect.actionType}.`);
}
