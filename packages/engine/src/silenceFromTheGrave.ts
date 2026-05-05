import { v4 as uuidv4 } from "uuid";
import type { ActiveEffectInstance, CardDefinition, CardInstance, MatchState, WardEngineEffect } from "@ward/shared";
import { addEvent as defaultAddEvent, getPlayer, type AddEventFn } from "./engineRuntime.js";
import { getRuntimeBlockDurationText } from "./effectBlockRuntime.js";
import { getTurnCycleExpiration } from "./effectTiming.js";

const MAGIC_LOCK_ACTION = "APPLY_OPPONENT_MAGIC_PLAY_LOCK";
const TURN_CONDITIONAL_SUPPRESSION_ACTION = "APPLY_TURN_CONDITIONAL_OPPONENT_CREATURE_EFFECT_SUPPRESSION";
const REPLACEMENT_SUPPRESSION_ACTION = "SILENCE_FROM_THE_GRAVE_REPLACEMENT_SUPPRESSION";

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function getCardName(state: MatchState, card: CardInstance): string {
  return state.cardCatalog[card.cardId]?.name ?? card.cardId;
}

function getOpponentPlayerId(state: MatchState, playerId: string): string | undefined {
  return state.players.find(player => player.id !== playerId)?.id;
}

function forEachCardInstance(state: MatchState, callback: (card: CardInstance) => void): void {
  const seen = new Set<string>();
  const visit = (card: CardInstance | undefined) => {
    if (!card || seen.has(card.instanceId)) return;
    seen.add(card.instanceId);
    callback(card);
  };

  for (const player of state.players) {
    for (const card of player.deck) visit(card);
    for (const card of player.hand) visit(card);
    for (const card of player.cemetery) visit(card);
    for (const card of player.removedFromGame) visit(card);
    visit(player.field.primaryCreature);
    for (const card of player.field.limitedSummons) visit(card);
    for (const card of player.field.magicSlots) visit(card);
  }

  for (const card of state.chainZone) visit(card);
}

function findCardInstance(state: MatchState, cardInstanceId: string | undefined): CardInstance | undefined {
  if (!cardInstanceId) return undefined;

  let found: CardInstance | undefined;
  forEachCardInstance(state, card => {
    if (!found && card.instanceId === cardInstanceId) {
      found = card;
    }
  });

  return found;
}

function isExpired(state: MatchState, instance: ActiveEffectInstance): boolean {
  if (!instance.expiresOnPlayerId || typeof instance.expiresAtPlayerTurnStartCount !== "number") {
    return false;
  }

  const currentTurnStartCount = state.turn.turnStartCountsByPlayer[instance.expiresOnPlayerId] ?? 0;
  return currentTurnStartCount >= instance.expiresAtPlayerTurnStartCount;
}

function isActiveSilenceInstance(state: MatchState, instance: ActiveEffectInstance, actionType: string): boolean {
  return normalize(instance.actionType) === actionType && !isExpired(state, instance);
}

function collectActiveSilenceInstances(state: MatchState, actionType: string): Array<{ card: CardInstance; instance: ActiveEffectInstance }> {
  const results: Array<{ card: CardInstance; instance: ActiveEffectInstance }> = [];

  forEachCardInstance(state, card => {
    for (const instance of card.activeEffectInstances ?? []) {
      if (isActiveSilenceInstance(state, instance, actionType)) {
        results.push({ card, instance });
      }
    }
  });

  return results;
}

function effectDurationText(effect: WardEngineEffect): string {
  return getRuntimeBlockDurationText(effect) ?? effect.duration?.text ?? effect.params?.duration?.text ?? "2 turn cycles";
}

function effectDurationAmount(effect: WardEngineEffect): number {
  const directAmount = effect.duration?.amount;
  if (typeof directAmount === "number" && Number.isFinite(directAmount) && directAmount > 0) {
    return directAmount;
  }

  const paramsAmount = effect.params?.duration?.amount;
  if (typeof paramsAmount === "number" && Number.isFinite(paramsAmount) && paramsAmount > 0) {
    return paramsAmount;
  }

  return 2;
}

function createSourceLinkedPlayerEffectInstance(args: {
  state: MatchState;
  effect: WardEngineEffect;
  sourceCard: CardInstance;
  controllerPlayerId: string;
  targetPlayerId: string;
  actionType: string;
  label: string;
}): ActiveEffectInstance {
  const expiration = getTurnCycleExpiration({
    state: args.state,
    sourcePlayerId: args.controllerPlayerId,
    targetPlayerId: args.targetPlayerId,
    effect: args.effect,
    fallbackDuration: 2
  });

  return {
    id: uuidv4(),
    kind: "OTHER",
    sourceEffectId: args.effect.id,
    sourceCardInstanceId: args.sourceCard.instanceId,
    sourceCardName: getCardName(args.state, args.sourceCard),
    sourcePlayerId: args.controllerPlayerId,
    targetPlayerId: args.targetPlayerId,
    actionType: args.actionType,
    label: args.label,
    durationType: "TURN_CYCLES",
    durationText: effectDurationText(args.effect),
    turnCyclesTotal: effectDurationAmount(args.effect),
    expiresOnPlayerId: expiration.expiresOnPlayerId,
    expiresAtPlayerTurnStartCount: expiration.expiresAtPlayerTurnStartCount,
    appliedTurnNumber: args.state.turn.turnNumber,
    appliedTurnCycle: args.state.turn.turnCycleNumber,
    debug: [
      "Created by Silence From The Grave after the Magic Chain resolves.",
      "The opponent may still respond with Lightning before this instance exists.",
      `Expires when ${expiration.expiresOnPlayerId} reaches turn-start count ${expiration.expiresAtPlayerTurnStartCount}.`
    ]
  };
}

export function applyOpponentMagicPlayLockEffect(
  state: MatchState,
  args: {
    effect: WardEngineEffect;
    controllerPlayerId: string;
    sourceCardInstanceId?: string;
    sourceCardName: string;
    addEvent: AddEventFn;
  }
): boolean {
  const targetPlayerId = getOpponentPlayerId(state, args.controllerPlayerId);
  const sourceCard = findCardInstance(state, args.sourceCardInstanceId);

  if (!targetPlayerId || !sourceCard) {
    args.addEvent(state, "SILENCE_MAGIC_PLAY_LOCK_SKIPPED", args.controllerPlayerId, {
      sourceCardName: args.sourceCardName,
      effectId: args.effect.id,
      actionType: args.effect.actionType,
      reason: !targetPlayerId ? "No opponent player found." : "Source card instance was not found."
    });
    return false;
  }

  sourceCard.activeEffectInstances ??= [];
  sourceCard.activeEffectInstances = sourceCard.activeEffectInstances.filter(instance => !(
    normalize(instance.actionType) === MAGIC_LOCK_ACTION &&
    instance.sourceCardInstanceId === sourceCard.instanceId &&
    instance.sourceEffectId === args.effect.id
  ));

  const instance = createSourceLinkedPlayerEffectInstance({
    state,
    effect: args.effect,
    sourceCard,
    controllerPlayerId: args.controllerPlayerId,
    targetPlayerId,
    actionType: MAGIC_LOCK_ACTION,
    label: args.effect.value ?? args.effect.actionText ?? "Opponent cannot play Magic cards."
  });

  sourceCard.activeEffectInstances.push(instance);

  args.addEvent(state, "SILENCE_MAGIC_PLAY_LOCK_APPLIED", args.controllerPlayerId, {
    sourceCardName: args.sourceCardName,
    sourceCardInstanceId: sourceCard.instanceId,
    effectId: args.effect.id,
    targetPlayerId,
    durationText: instance.durationText,
    expiresOnPlayerId: instance.expiresOnPlayerId,
    expiresAtPlayerTurnStartCount: instance.expiresAtPlayerTurnStartCount,
    note: "Opponent cannot play any Magic cards while this lock is active. Initial Lightning responses before Silence resolves are still allowed."
  });

  return true;
}

export function applyTurnConditionalOpponentCreatureSuppressionEffect(
  state: MatchState,
  args: {
    effect: WardEngineEffect;
    controllerPlayerId: string;
    sourceCardInstanceId?: string;
    sourceCardName: string;
    addEvent: AddEventFn;
  }
): boolean {
  const targetPlayerId = getOpponentPlayerId(state, args.controllerPlayerId);
  const sourceCard = findCardInstance(state, args.sourceCardInstanceId);

  if (!targetPlayerId || !sourceCard) {
    args.addEvent(state, "SILENCE_TURN_CONDITIONAL_SUPPRESSION_SKIPPED", args.controllerPlayerId, {
      sourceCardName: args.sourceCardName,
      effectId: args.effect.id,
      actionType: args.effect.actionType,
      reason: !targetPlayerId ? "No opponent player found." : "Source card instance was not found."
    });
    return false;
  }

  sourceCard.activeEffectInstances ??= [];
  sourceCard.activeEffectInstances = sourceCard.activeEffectInstances.filter(instance => !(
    normalize(instance.actionType) === TURN_CONDITIONAL_SUPPRESSION_ACTION &&
    instance.sourceCardInstanceId === sourceCard.instanceId &&
    instance.sourceEffectId === args.effect.id
  ));

  const instance = createSourceLinkedPlayerEffectInstance({
    state,
    effect: args.effect,
    sourceCard,
    controllerPlayerId: args.controllerPlayerId,
    targetPlayerId,
    actionType: TURN_CONDITIONAL_SUPPRESSION_ACTION,
    label: args.effect.value ?? args.effect.actionText ?? "Opponent creature effects are negated during your turns."
  });

  sourceCard.activeEffectInstances.push(instance);

  args.addEvent(state, "SILENCE_TURN_CONDITIONAL_SUPPRESSION_APPLIED", args.controllerPlayerId, {
    sourceCardName: args.sourceCardName,
    sourceCardInstanceId: sourceCard.instanceId,
    effectId: args.effect.id,
    targetPlayerId,
    durationText: instance.durationText,
    expiresOnPlayerId: instance.expiresOnPlayerId,
    expiresAtPlayerTurnStartCount: instance.expiresAtPlayerTurnStartCount,
    note: "Opponent creature effects are suppressed only during the Silence controller's turns. Already-active unaffected-by-Magic creature effects ignore this suppression."
  });

  return true;
}

export function playerIsMagicLockedBySilenceFromTheGrave(state: MatchState, playerId: string): boolean {
  return collectActiveSilenceInstances(state, MAGIC_LOCK_ACTION).some(({ instance }) => instance.targetPlayerId === playerId);
}

export function assertPlayerCanPlayMagicUnderSilenceFromTheGrave(state: MatchState, playerId: string): void {
  if (!playerIsMagicLockedBySilenceFromTheGrave(state, playerId)) {
    return;
  }

  const player = getPlayer(state, playerId);
  throw new Error(`${player.displayName} cannot play Magic cards while Silence From The Grave is active.`);
}

function cardDefinitionHasUnaffectedByMagicText(definition: CardDefinition | undefined): boolean {
  if (!definition || definition.cardType !== "CREATURE") {
    return false;
  }

  const effects = Array.isArray((definition as CardDefinition & { effects?: WardEngineEffect[] }).effects)
    ? (definition as CardDefinition & { effects?: WardEngineEffect[] }).effects ?? []
    : [];

  const text = [
    definition.text,
    ...effects.flatMap(effect => [
      effect.actionType,
      effect.effectGroup,
      effect.actionText,
      effect.target,
      effect.value,
      effect.params?.target,
      effect.params?.valueText,
      effect.notes
    ])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return text.includes("unaffected") && text.includes("magic");
}

export function hasActiveSilenceReplacementSuppression(state: MatchState, card: CardInstance): boolean {
  return (card.activeEffectInstances ?? []).some(instance =>
    isActiveSilenceInstance(state, instance, REPLACEMENT_SUPPRESSION_ACTION)
  );
}

export function creatureIgnoresSilenceFromTheGrave(state: MatchState, card: CardInstance): boolean {
  if (card.isLimitedSummon || card.effectsSuppressed || hasActiveSilenceReplacementSuppression(state, card)) {
    return false;
  }

  return cardDefinitionHasUnaffectedByMagicText(state.cardCatalog[card.cardId]);
}

function activeTurnConditionalSilenceForTargetPlayer(
  state: MatchState,
  targetPlayerId: string
): { card: CardInstance; instance: ActiveEffectInstance } | undefined {
  return collectActiveSilenceInstances(state, TURN_CONDITIONAL_SUPPRESSION_ACTION).find(({ instance }) =>
    instance.targetPlayerId === targetPlayerId &&
    instance.sourcePlayerId === state.turn.activePlayerId
  );
}

export function isCreatureSuppressedBySilenceFromTheGrave(state: MatchState, card: CardInstance): boolean {
  if (hasActiveSilenceReplacementSuppression(state, card)) {
    return true;
  }

  if (creatureIgnoresSilenceFromTheGrave(state, card)) {
    return false;
  }

  return Boolean(activeTurnConditionalSilenceForTargetPlayer(state, card.controllerPlayerId));
}

export function markReplacementCreatureForSilenceFromTheGraveIfNeeded(
  state: MatchState,
  card: CardInstance,
  addEvent: AddEventFn = defaultAddEvent
): void {
  if (state.turn.phase !== "COMBAT") {
    return;
  }

  const activeSuppression = activeTurnConditionalSilenceForTargetPlayer(state, card.controllerPlayerId);
  if (!activeSuppression) {
    return;
  }

  card.activeEffectInstances ??= [];

  if (hasActiveSilenceReplacementSuppression(state, card)) {
    return;
  }

  const expiresAtPlayerTurnStartCount = (state.turn.turnStartCountsByPlayer[card.controllerPlayerId] ?? 0) + 1;

  const instance: ActiveEffectInstance = {
    id: uuidv4(),
    kind: "OTHER",
    sourceEffectId: `${activeSuppression.instance.sourceEffectId}:replacement-window`,
    sourceCardInstanceId: activeSuppression.instance.sourceCardInstanceId,
    sourceCardName: activeSuppression.instance.sourceCardName,
    sourcePlayerId: activeSuppression.instance.sourcePlayerId,
    targetPlayerId: card.controllerPlayerId,
    targetCardInstanceId: card.instanceId,
    targetCardName: getCardName(state, card),
    actionType: REPLACEMENT_SUPPRESSION_ACTION,
    label: "Effects suppressed until owner Draw phase by Silence From The Grave replacement window.",
    durationType: "UNTIL_OWNER_NEXT_TURN_START",
    durationText: "Until this creature owner's next Draw/start turn.",
    expiresOnPlayerId: card.controllerPlayerId,
    expiresAtPlayerTurnStartCount,
    appliedTurnNumber: state.turn.turnNumber,
    appliedTurnCycle: state.turn.turnCycleNumber,
    debug: [
      "Applied because this creature entered as a replacement during the Silence controller's Combat Phase.",
      "When the owner reaches their next Draw/start turn, this temporary suppression expires. If the creature then has unaffected-by-Magic text, it ignores Silence From The Grave going forward."
    ]
  };

  card.activeEffectInstances.push(instance);

  addEvent(state, "SILENCE_REPLACEMENT_CREATURE_SUPPRESSION_APPLIED", card.controllerPlayerId, {
    cardInstanceId: card.instanceId,
    cardName: getCardName(state, card),
    sourceCardName: activeSuppression.instance.sourceCardName,
    sourcePlayerId: activeSuppression.instance.sourcePlayerId,
    expiresOnPlayerId: instance.expiresOnPlayerId,
    expiresAtPlayerTurnStartCount: instance.expiresAtPlayerTurnStartCount
  });
}

export function removeExpiredSilenceFromTheGraveEffects(
  state: MatchState,
  activePlayerId: string,
  addEvent: AddEventFn = defaultAddEvent
): void {
  const removed: Array<{
    cardInstanceId: string;
    cardName: string;
    actionType: string;
    label: string;
    sourceCardName: string;
  }> = [];

  forEachCardInstance(state, card => {
    const before = card.activeEffectInstances ?? [];
    const after = before.filter(instance => {
      const actionType = normalize(instance.actionType);
      const isSilenceAction = actionType === MAGIC_LOCK_ACTION ||
        actionType === TURN_CONDITIONAL_SUPPRESSION_ACTION ||
        actionType === REPLACEMENT_SUPPRESSION_ACTION;

      if (!isSilenceAction || !isExpired(state, instance)) {
        return true;
      }

      removed.push({
        cardInstanceId: card.instanceId,
        cardName: getCardName(state, card),
        actionType: instance.actionType,
        label: instance.label,
        sourceCardName: instance.sourceCardName
      });
      return false;
    });

    if (after.length !== before.length) {
      card.activeEffectInstances = after;
    }
  });

  if (removed.length > 0) {
    addEvent(state, "SILENCE_FROM_THE_GRAVE_EXPIRED_EFFECTS_REMOVED", activePlayerId, {
      activePlayerId,
      removedCount: removed.length,
      removed
    });
  }
}
