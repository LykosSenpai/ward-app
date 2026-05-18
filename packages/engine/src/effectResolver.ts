import { v4 as uuidv4 } from "uuid";
import type {
  ActiveCreatureStatus,
  ActiveEffectInstance,
  ActiveRecurringCreatureEffect,
  BoardEventType,
  BoardZoneRef,
  CardDefinition,
  CardInstance,
  MatchState,
  PlayerState,
  StatModifierKey,
  WardEngineEffect,
  WardEffectStatChange
} from "@ward/shared";
import { removeStatModifiersFromSourceCard } from "./effectiveStats.js";
import { addActiveEffectInstance, addActiveStatusIfAbsent, syncRecurringActiveEffectInstance } from "./activeEffectInstances.js";
import { getNextRecurringEffectTickSchedule, getTurnCycleExpiration } from "./effectTiming.js";
import { moveAllMagicSlotCardsToCemetery } from "./cardMovement.js";
import { getRuntimeBlockActionType, getRuntimeBlockDurationText, getRuntimeBlockMultiplier, getRuntimeBlockTargetText, getRuntimeBlockText } from "./effectBlockRuntime.js";
import { isFringeAutomaticMagicEffectSupported, tryResolveFringeAutomaticMagicEffect } from "./fringeEffectHandlers.js";
import { applyOpponentMagicPlayLockEffect, applyOpponentMagicPlayRestrictionEffect, applyTurnConditionalOpponentCreatureSuppressionEffect } from "./silenceFromTheGrave.js";

type AddEventFn = (
  state: MatchState,
  type: string,
  playerId?: string,
  payload?: unknown
) => void;

type BoardEventPayload = {
  type: BoardEventType;
  cardInstanceId?: string;
  playerId?: string;
  sourceCardInstanceId?: string;
  sourceCardId?: string;
  sourceEffectId?: string;
  actionType?: string;
  reason?: string;
  fromZoneRef?: BoardZoneRef;
  toZoneRef?: BoardZoneRef;
  targetCardInstanceId?: string;
  amount?: number;
  damageType?: string;
  healType?: string;
  status?: string;
  statusLabel?: string;
  stat?: string;
  delta?: number;
  modifierId?: string;
};

type CardDefinitionWithEffects = CardDefinition & {
  effects?: WardEngineEffect[];
};

function boardZoneRef(playerId: string | undefined, zone: BoardZoneRef["zone"]): BoardZoneRef {
  return {
    ...(playerId ? { playerId } : {}),
    zone
  };
}

function effectBoardEventBase(args: {
  playerId: string;
  sourceCardInstanceId?: string;
  sourceCardId?: string;
  sourceEffectId: string;
  actionType?: string;
  reason?: string;
}): Omit<BoardEventPayload, "type"> {
  return {
    playerId: args.playerId,
    sourceCardInstanceId: args.sourceCardInstanceId,
    sourceCardId: args.sourceCardId,
    sourceEffectId: args.sourceEffectId,
    actionType: args.actionType,
    reason: args.reason
  };
}

function getPlayerOrThrow(state: MatchState, playerId: string): PlayerState {
  const player = state.players.find(item => item.id === playerId);

  if (!player) {
    throw new Error(`Player not found: ${playerId}`);
  }

  return player;
}

function getCardName(state: MatchState, card: CardInstance): string {
  return state.cardCatalog[card.cardId]?.name ?? card.cardId;
}

export function getCardEngineEffects(
  definition: CardDefinition | undefined
): WardEngineEffect[] {
  if (!definition) {
    return [];
  }

  const withEffects = definition as CardDefinitionWithEffects;

  if (!Array.isArray(withEffects.effects)) {
    return [];
  }

  return withEffects.effects;
}

function allCardInstances(state: MatchState): CardInstance[] {
  return state.players.flatMap(player => [
    ...player.hand,
    ...player.deck,
    ...player.cemetery,
    ...player.removedFromGame,
    ...player.field.magicSlots,
    ...(player.field.primaryCreature ? [player.field.primaryCreature] : []),
    ...player.field.limitedSummons
  ]);
}

function findCardInstance(state: MatchState, instanceId: string | undefined): CardInstance | undefined {
  if (!instanceId) return undefined;

  return allCardInstances(state).find(card => card.instanceId === instanceId);
}

function magicDestroyedModifierEffects(definition: CardDefinition | undefined): WardEngineEffect[] {
  return getCardEngineEffects(definition).filter(effect => {
    const actionType = getRuntimeBlockActionType(effect).trim().toUpperCase();
    const text = [
      getRuntimeBlockText(effect),
      effect.actionText,
      effect.target,
      effect.params?.target,
      effect.value,
      effect.params?.valueText
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return actionType === "APPLY_STAT_MODIFIER" &&
      text.includes("for each magic") &&
      text.includes("destroyed") &&
      text.includes("modifier");
  });
}

export function applyDestroyedMagicCountModifier(
  state: MatchState,
  args: {
    sourceCardInstanceId?: string;
    sourceCardName: string;
    controllerPlayerId: string;
    destroyedCount: number;
    addEvent: AddEventFn;
  }
): number {
  const sourceCard = findCardInstance(state, args.sourceCardInstanceId);
  const sourceDefinition = sourceCard ? state.cardCatalog[sourceCard.cardId] : undefined;

  if (!sourceCard || sourceDefinition?.cardType !== "CREATURE" || args.destroyedCount <= 0) {
    return 0;
  }

  const effects = magicDestroyedModifierEffects(sourceDefinition);
  let appliedCount = 0;

  for (const effect of effects) {
    sourceCard.activeStatModifiers ??= [];
    sourceCard.activeStatModifiers = sourceCard.activeStatModifiers.filter(modifier =>
      !(modifier.sourceCardInstanceId === sourceCard.instanceId && modifier.sourceEffectId === effect.id)
    );
    const modifierId = uuidv4();
    sourceCard.activeStatModifiers.push({
      id: modifierId,
      sourceEffectId: effect.id,
      sourceCardInstanceId: sourceCard.instanceId,
      sourceCardName: args.sourceCardName,
      stat: "modifier",
      delta: args.destroyedCount,
      durationType: "PERMANENT_UNTIL_SOURCE_REMOVED",
      appliedTurnNumber: state.turn.turnNumber,
      appliedTurnCycle: state.turn.turnCycleNumber
    });

    appliedCount += 1;
    args.addEvent(state, "AUTO_DESTROYED_MAGIC_STAT_MODIFIER_APPLIED", args.controllerPlayerId, {
      sourceCardName: args.sourceCardName,
      sourceCardInstanceId: sourceCard.instanceId,
      effectId: effect.id,
      actionType: effect.actionType,
      stat: "modifier",
      delta: args.destroyedCount,
      destroyedCount: args.destroyedCount,
      boardEvents: [
        {
          type: "STAT_MODIFIER_APPLIED",
          ...effectBoardEventBase({
            playerId: args.controllerPlayerId,
            sourceCardInstanceId: sourceCard.instanceId,
            sourceCardId: sourceCard.cardId,
            sourceEffectId: effect.id,
            actionType: effect.actionType,
            reason: "DESTROYED_MAGIC_COUNT"
          }),
          cardInstanceId: sourceCard.instanceId,
          targetCardInstanceId: sourceCard.instanceId,
          stat: "modifier",
          delta: args.destroyedCount,
          modifierId
        } satisfies BoardEventPayload
      ]
    });
  }

  return appliedCount;
}

function effectTargetsAllMagicCards(effect: WardEngineEffect): boolean {
  const actionType = getRuntimeBlockActionType(effect).trim().toUpperCase();
  const text = [
    getRuntimeBlockText(effect),
    effect.actionText,
    effect.target,
    effect.params?.target,
    effect.value,
    effect.params?.valueText
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    actionType === "DESTROY_ALL_MAGIC" ||
    (
      (actionType === "DESTROY_MAGIC_CARDS" || actionType === "DESTROY_MAGIC") &&
      (
        text.includes("destroy all magic") ||
        text.includes("all magic cards") ||
        text.includes("all opponent magic") ||
        text.includes("opponent side magic") ||
        text.includes("all magic on the field")
      )
    )
  );
}

function inferDestroyAllMagicScopePlayerIds(
  state: MatchState,
  controllerPlayerId: string,
  text: string
): string[] | undefined {
  const normalized = text.toLowerCase();
  const opponentIds = state.players.filter(player => player.id !== controllerPlayerId).map(player => player.id);

  if (normalized.includes("opponent")) {
    return opponentIds;
  }

  if (normalized.includes("your")) {
    return [controllerPlayerId];
  }

  return undefined;
}

function normalizeStatKey(rawStat: string): StatModifierKey | undefined {
  const stat = rawStat.trim().toUpperCase();

  if (stat === "AL" || stat === "ARMOR" || stat === "ARMOR_LEVEL") {
    return "armorLevel";
  }

  if (stat === "SPD" || stat === "SPEED") {
    return "speed";
  }

  if (
    stat === "ATTACK_DICE" ||
    stat === "ATK_DICE" ||
    stat === "ATK_DICE_ROLLS" ||
    stat === "ATTACK_DICE_ROLLS"
  ) {
    return "attackDice";
  }

  if (stat === "MOD" || stat === "MODIFIER") {
    return "modifier";
  }

  return undefined;
}

function getDeltaFromStatChange(change: WardEffectStatChange): number | undefined {
  if (!Number.isFinite(change.value)) {
    return undefined;
  }

  const operation = change.operation.trim().toUpperCase();

  if (operation === "ADD") {
    return change.value;
  }

  if (operation === "SUBTRACT") {
    return -change.value;
  }

  // SET effects need a separate modifier layer later because current modifiers are delta-based.
  return undefined;
}

function parseDrawAmount(effect: WardEngineEffect): number | undefined {
  const text = getRuntimeBlockText(effect);

  const match = text.match(/draw\s+(\d+)/i);

  if (!match) {
    return undefined;
  }

  const amount = Number(match[1]);

  return Number.isInteger(amount) && amount > 0 ? amount : undefined;
}

function effectTargetsAllCreaturesOnField(effect: WardEngineEffect): boolean {
  const actionType = getRuntimeBlockActionType(effect).trim().toUpperCase();
  const targetScope = String(effect.params?.targetScope ?? "").trim().toUpperCase();
  const text = [
    getRuntimeBlockText(effect),
    effect.actionText,
    effect.target,
    effect.params?.target,
    effect.value,
    effect.params?.valueText
  ].filter(Boolean).join(" ").toLowerCase();

  return actionType === "DEAL_INSTANT_DAMAGE" && (
    targetScope === "ALL_CREATURES_ON_FIELD" ||
    text.includes("all creatures on the field") ||
    text.includes("all creatures in play")
  );
}

function drawCardsForPlayer(player: PlayerState, count: number): CardInstance[] {
  const drawn: CardInstance[] = [];

  for (let index = 0; index < count; index++) {
    const card = player.deck.shift();

    if (!card) {
      break;
    }

    card.zone = "HAND";
    player.hand.push(card);
    drawn.push(card);
  }

  return drawn;
}

function getDrawTargetPlayers(
  state: MatchState,
  controllerPlayerId: string,
  effect: WardEngineEffect
): PlayerState[] {
  const targetText = getRuntimeBlockText(effect).toLowerCase();

  if (
    targetText.includes("all players") ||
    targetText.includes("both players") ||
    targetText.includes("each player")
  ) {
    return state.players;
  }

  return [getPlayerOrThrow(state, controllerPlayerId)];
}

function applyDamageToAllCreaturesOnField(
  state: MatchState,
  args: {
    effect: WardEngineEffect;
    controllerPlayerId: string;
    sourceCardName: string;
    addEvent: AddEventFn;
  }
): boolean {
  const amount = Number(args.effect.params?.amount ?? parseFirstPositiveNumberFromEffect(args.effect) ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return false;

  const damagedCreatures: Array<{
    playerId: string;
    creatureInstanceId: string;
    creatureName: string;
    previousHp: number;
    damageAmount: number;
    remainingHp: number;
  }> = [];

  for (const player of state.players) {
    const creatures = [
      player.field.primaryCreature,
      ...player.field.limitedSummons
    ].filter((card): card is CardInstance => Boolean(card));

    for (const creature of creatures) {
      const previousHp = creature.currentHp ?? creature.baseHp ?? 0;
      const damageAmount = Math.min(previousHp, Math.trunc(amount));
      creature.currentHp = Math.max(0, previousHp - damageAmount);
      damagedCreatures.push({
        playerId: player.id,
        creatureInstanceId: creature.instanceId,
        creatureName: getCardName(state, creature),
        previousHp,
        damageAmount,
        remainingHp: creature.currentHp
      });
    }
  }

  args.addEvent(state, "AUTO_EFFECT_ALL_CREATURES_DAMAGE_RESOLVED", args.controllerPlayerId, {
    sourceCardName: args.sourceCardName,
    effectId: args.effect.id,
    actionType: args.effect.actionType,
    damageAmount: Math.trunc(amount),
    damagedCreatures,
    boardEvents: damagedCreatures.map(item => ({
      type: "CARD_DAMAGED",
      ...effectBoardEventBase({
        playerId: args.controllerPlayerId,
        sourceEffectId: args.effect.id,
        actionType: args.effect.actionType,
        reason: "ALL_CREATURES_DAMAGE"
      }),
      cardInstanceId: item.creatureInstanceId,
      targetCardInstanceId: item.creatureInstanceId,
      amount: item.damageAmount,
      damageType: args.effect.actionType
    } satisfies BoardEventPayload))
  });

  return true;
}

function parseMultiplierFromEffect(effect: WardEngineEffect, fallback: number): number {
  return getRuntimeBlockMultiplier(effect, fallback) ?? fallback;
}

function applyForcedFirstAutoHitMultiplierEffect(
  state: MatchState,
  args: {
    effect: WardEngineEffect;
    controllerPlayerId: string;
    sourceCardName: string;
    sourceCardInstanceId?: string;
    addEvent: AddEventFn;
  }
): boolean {
  const controller = getPlayerOrThrow(state, args.controllerPlayerId);
  const primaryCreature = controller.field.primaryCreature;

  if (!primaryCreature) {
    args.addEvent(state, "AUTO_BATTLE_OVERRIDE_EFFECT_SKIPPED", args.controllerPlayerId, {
      sourceCardName: args.sourceCardName,
      effectId: args.effect.id,
      actionType: args.effect.actionType,
      reason: "Controller has no primary creature to receive the current-battle override."
    });
    return false;
  }

  const existing = primaryCreature.activeEffectInstances ?? [];
  primaryCreature.activeEffectInstances = existing.filter(instance => !(
    instance.sourceCardInstanceId === args.sourceCardInstanceId &&
    instance.sourceEffectId === args.effect.id
  ));

  const multiplier = parseMultiplierFromEffect(args.effect, 3);
  const activeInstance: ActiveEffectInstance = {
    id: uuidv4(),
    kind: "OTHER",
    sourceEffectId: args.effect.id,
    sourceCardInstanceId: args.sourceCardInstanceId ?? `${args.effect.id}:source`,
    sourceCardName: args.sourceCardName,
    sourcePlayerId: args.controllerPlayerId,
    targetPlayerId: controller.id,
    targetCardInstanceId: primaryCreature.instanceId,
    targetCardName: getCardName(state, primaryCreature),
    actionType: "APPLY_FORCED_FIRST_AUTO_HIT_MULTIPLIER",
    label: `Attack first, auto-hit, ${multiplier}x Atk damage`,
    amount: multiplier,
    durationType: "CURRENT_BATTLE",
    durationText: getRuntimeBlockDurationText(args.effect) ?? "Current battle",
    appliedTurnNumber: state.turn.turnNumber,
    appliedTurnCycle: state.turn.turnCycleNumber,
    debug: [
      "Created when a Standard battle override Magic resolves.",
      "Battle resolver uses this to force first strike, force hit success, and multiply attack damage.",
      "Hit dice are still rolled, so critical hits can still happen and forced-hit ignores critical misses."
    ]
  };

  primaryCreature.activeEffectInstances.push(activeInstance);

  args.addEvent(state, "AUTO_BATTLE_OVERRIDE_EFFECT_APPLIED", args.controllerPlayerId, {
    sourceCardName: args.sourceCardName,
    sourceCardInstanceId: args.sourceCardInstanceId,
    effectId: args.effect.id,
    actionType: args.effect.actionType,
    targetCreatureInstanceId: primaryCreature.instanceId,
    targetCreatureName: activeInstance.targetCardName,
    multiplier,
    durationType: activeInstance.durationType,
    note: "The next battle involving this creature will apply first-strike override, forced hit success, and attack damage multiplier.",
    boardEvents: [
      {
        type: "STAT_MODIFIER_APPLIED",
        ...effectBoardEventBase({
          playerId: args.controllerPlayerId,
          sourceCardInstanceId: args.sourceCardInstanceId,
          sourceEffectId: args.effect.id,
          actionType: args.effect.actionType,
          reason: "ATTACK_DAMAGE_MULTIPLIER"
        }),
        cardInstanceId: primaryCreature.instanceId,
        targetCardInstanceId: primaryCreature.instanceId,
        stat: "attackDamageMultiplier",
        delta: multiplier
      } satisfies BoardEventPayload
    ]
  });

  return true;
}

function applyTemporaryHitOverrideEffect(
  state: MatchState,
  args: {
    effect: WardEngineEffect;
    controllerPlayerId: string;
    sourceCardName: string;
    sourceCardInstanceId?: string;
    addEvent: AddEventFn;
  }
): boolean {
  const controller = getPlayerOrThrow(state, args.controllerPlayerId);
  const primaryCreature = controller.field.primaryCreature;

  if (!primaryCreature) {
    args.addEvent(state, "AUTO_HIT_OVERRIDE_EFFECT_SKIPPED", args.controllerPlayerId, {
      sourceCardName: args.sourceCardName,
      effectId: args.effect.id,
      actionType: args.effect.actionType,
      reason: "Controller has no primary creature to receive the hit override."
    });
    return false;
  }

  const expiration = getTurnCycleExpiration({
    state,
    sourcePlayerId: args.controllerPlayerId,
    targetPlayerId: controller.id,
    effect: args.effect,
    fallbackDuration: 1
  });

  const existing = primaryCreature.activeEffectInstances ?? [];
  primaryCreature.activeEffectInstances = existing.filter(instance => !(
    instance.sourceCardInstanceId === args.sourceCardInstanceId &&
    instance.sourceEffectId === args.effect.id
  ));

  const activeInstance: ActiveEffectInstance = {
    id: uuidv4(),
    kind: "OTHER",
    sourceEffectId: args.effect.id,
    sourceCardInstanceId: args.sourceCardInstanceId ?? `${args.effect.id}:source`,
    sourceCardName: args.sourceCardName,
    sourcePlayerId: args.controllerPlayerId,
    targetPlayerId: controller.id,
    targetCardInstanceId: primaryCreature.instanceId,
    targetCardName: getCardName(state, primaryCreature),
    actionType: "APPLY_TEMPORARY_HIT_OVERRIDE",
    label: "Auto-hit attacks",
    amount: 1,
    durationType: "TARGET_PLAYER_TURN_STARTS",
    durationText: getRuntimeBlockDurationText(args.effect) ?? "1 turn cycle",
    appliedTurnNumber: state.turn.turnNumber,
    appliedTurnCycle: state.turn.turnCycleNumber,
    expiresOnPlayerId: expiration.expiresOnPlayerId,
    expiresAtPlayerTurnStartCount: expiration.expiresAtPlayerTurnStartCount,
    debug: [
      "Created when a temporary hit override Magic resolves.",
      "Battle resolver uses this to force hit success without changing attack damage."
    ]
  };

  primaryCreature.activeEffectInstances.push(activeInstance);

  args.addEvent(state, "AUTO_HIT_OVERRIDE_EFFECT_APPLIED", args.controllerPlayerId, {
    sourceCardName: args.sourceCardName,
    sourceCardInstanceId: args.sourceCardInstanceId,
    effectId: args.effect.id,
    actionType: args.effect.actionType,
    targetCreatureInstanceId: primaryCreature.instanceId,
    targetCreatureName: activeInstance.targetCardName,
    durationType: activeInstance.durationType,
    expiresOnPlayerId: activeInstance.expiresOnPlayerId,
    expiresAtPlayerTurnStartCount: activeInstance.expiresAtPlayerTurnStartCount
  });

  return true;
}

export function isAutomaticMagicEffectSupported(
  effect: WardEngineEffect
): boolean {
  const actionType = getRuntimeBlockActionType(effect).trim().toUpperCase();
  const text = [
    getRuntimeBlockText(effect),
    effect.actionText,
    effect.target,
    effect.params?.target,
    effect.value,
    effect.params?.valueText
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return actionType === "DRAW_CARDS" ||
    effectTargetsAllMagicCards(effect) ||
    effectTargetsAllCreaturesOnField(effect) ||
    actionType === "APPLY_TEMPORARY_HIT_OVERRIDE" ||
    actionType === "APPLY_FORCED_FIRST_AUTO_HIT_MULTIPLIER" ||
    actionType === "APPLY_OPPONENT_MAGIC_PLAY_LOCK" ||
    (
      actionType === "APPLY_PLAY_RESTRICTION" &&
      (text.includes("opponent") || text.includes("all players") || text.includes("both players") || text.includes("each player")) &&
      text.includes("cannot play magic")
    ) ||
    actionType === "APPLY_TURN_CONDITIONAL_OPPONENT_CREATURE_EFFECT_SUPPRESSION" ||
    isFringeAutomaticMagicEffectSupported(effect);
}

export function isDeferredToAttachmentEffect(
  effect: WardEngineEffect
): boolean {
  const target = (getRuntimeBlockTargetText(effect) ?? "").toLowerCase();
  const durationType = effect.duration?.type ?? effect.params?.duration?.type;

  const actionType = getRuntimeBlockActionType(effect).trim().toUpperCase();

  return (
    (actionType === "APPLY_STAT_MODIFIER" || actionType === "APPLY_MULTI_MODIFIER") &&
    target.includes("equipped creature") &&
    durationType === "WHILE_EQUIPPED"
  );
}

export function tryResolveAutomaticMagicEffect(
  state: MatchState,
  args: {
    effect: WardEngineEffect;
    controllerPlayerId: string;
    sourceCardName: string;
    sourceCardInstanceId?: string;
    addEvent: AddEventFn;
  }
): boolean {
  const { effect, controllerPlayerId, sourceCardName, addEvent } = args;
  const actionType = getRuntimeBlockActionType(effect).trim().toUpperCase();

  if (actionType === "APPLY_FORCED_FIRST_AUTO_HIT_MULTIPLIER") {
    return applyForcedFirstAutoHitMultiplierEffect(state, args);
  }

  if (actionType === "APPLY_TEMPORARY_HIT_OVERRIDE") {
    return applyTemporaryHitOverrideEffect(state, args);
  }

  if (actionType === "APPLY_OPPONENT_MAGIC_PLAY_LOCK") {
    return applyOpponentMagicPlayLockEffect(state, args);
  }

  if (actionType === "APPLY_PLAY_RESTRICTION") {
    return applyOpponentMagicPlayRestrictionEffect(state, args);
  }

  if (actionType === "APPLY_TURN_CONDITIONAL_OPPONENT_CREATURE_EFFECT_SUPPRESSION") {
    return applyTurnConditionalOpponentCreatureSuppressionEffect(state, args);
  }

  if (effectTargetsAllMagicCards(effect)) {
    const text = [
      getRuntimeBlockText(effect),
      effect.actionText,
      effect.target,
      effect.params?.target,
      effect.value,
      effect.params?.valueText
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const scopePlayerIds = inferDestroyAllMagicScopePlayerIds(state, controllerPlayerId, text);

    const result = moveAllMagicSlotCardsToCemetery(
      state,
      scopePlayerIds,
      addEvent,
      "DESTROY_ALL_MAGIC_EFFECT"
    );

    addEvent(state, "AUTO_EFFECT_DESTROY_ALL_MAGIC_RESOLVED", controllerPlayerId, {
      sourceCardName,
      sourceCardInstanceId: args.sourceCardInstanceId,
      effectId: effect.id,
      sourceEffectId: effect.id,
      actionType: effect.actionType,
      reason: "DESTROY_ALL_MAGIC_EFFECT",
      destroyedCount: result.destroyedCount,
      destroyedCards: result.destroyedCards.map(item => ({
        destroyedCardName: item.destroyedCardName,
        destroyedCardInstanceId: item.magicCard.instanceId,
        cardInstanceId: item.magicCard.instanceId,
        fieldOwnerPlayerId: item.fieldOwnerPlayerId,
        cardOwnerPlayerId: item.cardOwnerPlayerId,
        fromZoneRef: boardZoneRef(item.fieldOwnerPlayerId, "MAGIC_SLOT"),
        toZoneRef: boardZoneRef(item.cardOwnerPlayerId, "CEMETERY"),
        linkedDestroyedCreatureCount: item.linkedDestroyedCreatures.length
      })),
      boardEvents: result.destroyedCards.map(item => ({
        type: "CARD_DESTROYED",
        playerId: controllerPlayerId,
        sourceCardInstanceId: args.sourceCardInstanceId,
        sourceEffectId: effect.id,
        actionType: effect.actionType,
        reason: "DESTROY_ALL_MAGIC_EFFECT",
        cardInstanceId: item.magicCard.instanceId,
        fromZoneRef: boardZoneRef(item.fieldOwnerPlayerId, "MAGIC_SLOT"),
        toZoneRef: boardZoneRef(item.cardOwnerPlayerId, "CEMETERY")
      }))
    });

    applyDestroyedMagicCountModifier(state, {
      sourceCardInstanceId: args.sourceCardInstanceId,
      sourceCardName,
      controllerPlayerId,
      destroyedCount: result.destroyedCount,
      addEvent
    });

    return true;
  }

  if (effectTargetsAllCreaturesOnField(effect)) {
    return applyDamageToAllCreaturesOnField(state, args);
  }

  if (actionType !== "DRAW_CARDS") {
    return tryResolveFringeAutomaticMagicEffect(state, args);
  }

  const drawAmount = parseDrawAmount(effect);

  if (!drawAmount) {
    return false;
  }

  const targetPlayers = getDrawTargetPlayers(state, controllerPlayerId, effect);

  const results = targetPlayers.map(player => {
    const drawn = drawCardsForPlayer(player, drawAmount);

    return {
      playerId: player.id,
      playerName: player.displayName,
      requestedDraw: drawAmount,
      actualDrawn: drawn.length,
      drawnCardInstanceIds: drawn.map(card => card.instanceId),
      drawnCardIds: drawn.map(card => card.cardId),
      deckRemaining: player.deck.length,
      handSize: player.hand.length,
      boardEvents: drawn.map(card => ({
        type: "CARD_MOVED",
        playerId: controllerPlayerId,
        sourceCardInstanceId: args.sourceCardInstanceId,
        sourceEffectId: effect.id,
        actionType: effect.actionType,
        reason: "DRAW_CARDS",
        cardInstanceId: card.instanceId,
        fromZoneRef: boardZoneRef(player.id, "DECK"),
        toZoneRef: boardZoneRef(player.id, "HAND")
      } satisfies BoardEventPayload))
    };
  });

  addEvent(state, "AUTO_EFFECT_DRAW_CARDS_RESOLVED", controllerPlayerId, {
    sourceCardName,
    effectId: effect.id,
    actionType: effect.actionType,
    results,
    boardEvents: results.flatMap(result => result.boardEvents)
  });

  return true;
}

export function applyWhileEquippedStatModifiers(
  state: MatchState,
  args: {
    sourceMagicCard: CardInstance;
    targetCreature: CardInstance;
    addEvent: AddEventFn;
  }
): number {
  const { sourceMagicCard, targetCreature, addEvent } = args;

  const definition = state.cardCatalog[sourceMagicCard.cardId];
  const effects = getCardEngineEffects(definition);

  const equipStatEffects = effects.filter(isDeferredToAttachmentEffect);

  if (equipStatEffects.length === 0) {
    return 0;
  }

  removeStatModifiersFromSourceCard(state, sourceMagicCard.instanceId);

  targetCreature.activeStatModifiers ??= [];

  let appliedCount = 0;

  for (const effect of equipStatEffects) {
    const statChanges = effect.params?.statChanges ?? [];
    const boardEvents: BoardEventPayload[] = [];

    for (const change of statChanges) {
      const stat = normalizeStatKey(change.stat);
      const delta = getDeltaFromStatChange(change);

      if (!stat || delta === undefined) {
        addEvent(state, "AUTO_EQUIP_STAT_MODIFIER_SKIPPED", sourceMagicCard.controllerPlayerId, {
          sourceCardName: getCardName(state, sourceMagicCard),
          effectId: effect.id,
          rawStat: change.stat,
          operation: change.operation,
          value: change.value,
          reason: "Unsupported stat or operation for current delta-based modifier system."
        });

        continue;
      }

      const modifierId = uuidv4();
      targetCreature.activeStatModifiers.push({
        id: modifierId,
        sourceEffectId: effect.id,
        sourceCardInstanceId: sourceMagicCard.instanceId,
        sourceCardName: getCardName(state, sourceMagicCard),
        stat,
        delta,
        durationType: "PERMANENT_UNTIL_SOURCE_REMOVED",
        appliedTurnNumber: state.turn.turnNumber,
        appliedTurnCycle: state.turn.turnCycleNumber
      });

      appliedCount++;
      boardEvents.push({
        type: "STAT_MODIFIER_APPLIED",
        ...effectBoardEventBase({
          playerId: sourceMagicCard.controllerPlayerId,
          sourceCardInstanceId: sourceMagicCard.instanceId,
          sourceCardId: sourceMagicCard.cardId,
          sourceEffectId: effect.id,
          actionType: effect.actionType,
          reason: "WHILE_EQUIPPED"
        }),
        cardInstanceId: targetCreature.instanceId,
        targetCardInstanceId: targetCreature.instanceId,
        stat,
        delta,
        modifierId
      });
    }

    addEvent(state, "AUTO_EQUIP_STAT_EFFECT_RESOLVED", sourceMagicCard.controllerPlayerId, {
      sourceCardName: getCardName(state, sourceMagicCard),
      sourceCardInstanceId: sourceMagicCard.instanceId,
      targetCreatureInstanceId: targetCreature.instanceId,
      targetCreatureName: getCardName(state, targetCreature),
      effectId: effect.id,
      actionType: effect.actionType,
      value: effect.value,
      appliedCount,
      boardEvents
    });
  }

  return appliedCount;
}

export function applyWhileEquippedBattleRequirementEffects(
  state: MatchState,
  args: {
    sourceMagicCard: CardInstance;
    targetCreature: CardInstance;
    addEvent: AddEventFn;
  }
): number {
  const { sourceMagicCard, targetCreature, addEvent } = args;
  const definition = state.cardCatalog[sourceMagicCard.cardId];
  if (!definition || definition.cardType !== "MAGIC") return 0;

  const effects = getCardEngineEffects(definition).filter(effect => {
    const actionType = getRuntimeBlockActionType(effect).trim().toUpperCase();
    const trigger = String(effect.trigger ?? "").trim().toUpperCase();
    const durationType = String(effect.duration?.type ?? effect.params?.duration?.type ?? "").trim().toUpperCase();
    const targetText = (getRuntimeBlockTargetText(effect) ?? "").toLowerCase();
    return actionType === "APPLY_BATTLE_REQUIREMENT" &&
      (trigger === "WHILE_EQUIPPED" || durationType === "WHILE_EQUIPPED") &&
      targetText.includes("equipped creature");
  });

  if (effects.length === 0) return 0;

  targetCreature.activeEffectInstances ??= [];
  targetCreature.activeEffectInstances = targetCreature.activeEffectInstances.filter(instance =>
    !(instance.sourceCardInstanceId === sourceMagicCard.instanceId &&
      effects.some(effect => effect.id === instance.sourceEffectId))
  );

  let appliedCount = 0;
  const sourcePlacement = definition.magicType === "STANDARD" ? "TEMP_EQUIP" : "MAGIC_SLOT";

  for (const effect of effects) {
    const text = [
      getRuntimeBlockText(effect),
      effect.value,
      effect.params?.valueText,
      effect.notes
    ].filter(Boolean).join(" ").toLowerCase();
    const extraInitiatedBattles = Number.isFinite(Number(effect.params?.extraInitiatedBattles))
      ? Math.max(0, Math.trunc(Number(effect.params?.extraInitiatedBattles)))
      : text.includes("battle twice") || text.includes("initiate battle twice")
        ? 1
        : undefined;
    const maxReturnAttacksAgainstThisEffect = Number.isFinite(Number(effect.params?.maxReturnAttacksAgainstThisEffect))
      ? Math.max(0, Math.trunc(Number(effect.params?.maxReturnAttacksAgainstThisEffect)))
      : text.includes("only return attack for 1") || text.includes("only return attack for one")
        ? 1
        : undefined;

    targetCreature.activeEffectInstances.push({
      id: uuidv4(),
      kind: "STATIC_MODIFIER",
      sourceEffectId: effect.id,
      sourceCardInstanceId: sourceMagicCard.instanceId,
      sourceCardName: getCardName(state, sourceMagicCard),
      sourcePlayerId: sourceMagicCard.controllerPlayerId,
      targetPlayerId: targetCreature.controllerPlayerId,
      targetCardInstanceId: targetCreature.instanceId,
      targetCardName: getCardName(state, targetCreature),
      actionType: "APPLY_BATTLE_REQUIREMENT",
      label: effect.value ?? effect.actionText ?? "Battle requirement",
      durationType: "WHILE_EQUIPPED",
      durationText: effect.duration?.text ?? effect.params?.duration?.text ?? "While equipped",
      sourcePlacement,
      sourceLinked: true,
      expiresWhenSourceLeaves: true,
      extraInitiatedBattles,
      maxReturnAttacksAgainstThisEffect,
      appliedTurnNumber: state.turn.turnNumber,
      appliedTurnCycle: state.turn.turnCycleNumber,
      debug: [
        `${getCardName(state, sourceMagicCard)} is attached as ${sourcePlacement === "TEMP_EQUIP" ? "a temporary Equip Magic" : "an Equip Magic"}.`,
        extraInitiatedBattles
          ? `Equipped creature gains ${extraInitiatedBattles} extra initiated battle(s).`
          : "No extra battle count was parsed.",
        maxReturnAttacksAgainstThisEffect !== undefined
          ? `Opponent return attacks against this effect are capped at ${maxReturnAttacksAgainstThisEffect}.`
          : "No return-attack cap was parsed."
      ]
    });
    appliedCount++;

    addEvent(state, "AUTO_EQUIP_BATTLE_REQUIREMENT_ACTIVE", sourceMagicCard.controllerPlayerId, {
      sourceCardName: getCardName(state, sourceMagicCard),
      sourceCardInstanceId: sourceMagicCard.instanceId,
      effectId: effect.id,
      actionType: effect.actionType,
      targetCreatureInstanceId: targetCreature.instanceId,
      targetCreatureName: getCardName(state, targetCreature),
      sourcePlacement,
      extraInitiatedBattles,
      maxReturnAttacksAgainstThisEffect,
      note: "Battle permission and return-attack limits remain active while this Equip Magic stays attached."
    });
  }

  return appliedCount;
}

function parseFirstPositiveNumberFromEffect(effect: WardEngineEffect): number | undefined {
  const text = [effect.value, effect.params?.valueText, effect.actionText]
    .filter(Boolean)
    .join(" ");
  const match = text.match(/(\d+)/);
  const amount = Number(match?.[1]);
  return Number.isFinite(amount) && amount > 0 ? Math.trunc(amount) : undefined;
}

function positiveIntegerFromUnknown(value: unknown, fallback: number): number {
  const amount = Number(value ?? fallback);
  return Number.isFinite(amount) && amount > 0 ? Math.trunc(amount) : fallback;
}

function isOnEquipRecurringHealEffect(effect: WardEngineEffect): boolean {
  const trigger = String(effect.trigger ?? "").trim().toUpperCase();
  const actionType = String(effect.actionType ?? "").trim().toUpperCase();
  const text = [effect.target, effect.params?.target, effect.value, effect.params?.valueText, effect.actionText]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const targetsEquippedCreature = text.includes("equipped creature") || text.includes("attached creature");

  return trigger === "ON_EQUIP" &&
    targetsEquippedCreature &&
    (actionType === "APPLY_HEALING_OVER_TIME" || actionType === "APPLY_HEAL_OVER_TIME" || actionType === "HEAL_OVER_TIME");
}


function isOnEquipRegeneratingHealEffect(effect: WardEngineEffect): boolean {
  const trigger = String(effect.trigger ?? "").trim().toUpperCase();
  const actionType = String(effect.actionType ?? "").trim().toUpperCase();
  const reusableFunction = String(effect.reusableFunction ?? "").trim().toUpperCase();
  const text = [effect.target, effect.params?.target, effect.value, effect.params?.valueText, effect.actionText, effect.notes]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const targetsEquippedCreature = text.includes("equipped creature") || text.includes("attached creature");

  return trigger === "ON_EQUIP" &&
    targetsEquippedCreature &&
    (
      actionType === "APPLY_REGENERATING_HEAL" ||
      actionType === "APPLY_TROLL_REGENERATION" ||
      reusableFunction === "APPLYREGENERATINGHEAL" ||
      reusableFunction === "REGENERATINGHEAL"
    );
}

export function applyOnEquipRegeneratingHealEffects(
  state: MatchState,
  args: {
    sourceMagicCard: CardInstance;
    targetCreature: CardInstance;
    addEvent: AddEventFn;
  }
): number {
  const { sourceMagicCard, targetCreature, addEvent } = args;
  const definition = state.cardCatalog[sourceMagicCard.cardId];
  const effects = getCardEngineEffects(definition);
  const targetDefinition = state.cardCatalog[targetCreature.cardId];

  if (targetDefinition?.cardType !== "CREATURE") {
    return 0;
  }

  targetCreature.activeEffectInstances ??= [];

  let appliedCount = 0;

  for (const effect of effects) {
    if (!isOnEquipRegeneratingHealEffect(effect)) {
      continue;
    }

    const amount = parseFirstPositiveNumberFromEffect(effect);

    if (!amount) {
      addEvent(state, "AUTO_EQUIP_REGENERATING_HEAL_SKIPPED", sourceMagicCard.controllerPlayerId, {
        sourceCardName: getCardName(state, sourceMagicCard),
        sourceCardInstanceId: sourceMagicCard.instanceId,
        effectId: effect.id,
        actionType: effect.actionType,
        reason: "No automatic heal amount was found."
      });
      continue;
    }

    const stackRule = String(effect.params?.stackRule ?? "DO_NOT_STACK");
    const existingIndex = targetCreature.activeEffectInstances.findIndex(item =>
      item.sourceCardInstanceId === sourceMagicCard.instanceId &&
      item.sourceEffectId === effect.id &&
      item.actionType === "APPLY_REGENERATING_HEAL"
    );

    if (existingIndex >= 0) {
      targetCreature.activeEffectInstances.splice(existingIndex, 1);
    } else if (stackRule === "DO_NOT_STACK" && targetCreature.activeEffectInstances.some(item => item.kind === "REGENERATING_HEAL")) {
      addEvent(state, "AUTO_EQUIP_REGENERATING_HEAL_NOT_STACKED", sourceMagicCard.controllerPlayerId, {
        sourceCardName: getCardName(state, sourceMagicCard),
        sourceCardInstanceId: sourceMagicCard.instanceId,
        targetCreatureInstanceId: targetCreature.instanceId,
        targetCreatureName: getCardName(state, targetCreature),
        effectId: effect.id,
        actionType: effect.actionType
      });
      continue;
    }

    const startingTicks = positiveIntegerFromUnknown(effect.params?.startingTicks ?? effect.duration?.amount, 2);
    const refreshAmount = positiveIntegerFromUnknown(effect.params?.refreshAmount, 1);
    const maxRefreshCounterRaw = effect.params?.maxRefreshCounter;
    const maxRefreshCounter = maxRefreshCounterRaw === undefined || maxRefreshCounterRaw === null
      ? undefined
      : positiveIntegerFromUnknown(maxRefreshCounterRaw, startingTicks);
    const currentSourceTurnStartCount = state.turn.turnStartCountsByPlayer[sourceMagicCard.controllerPlayerId] ?? 0;

    const instance: ActiveEffectInstance = {
      id: uuidv4(),
      kind: "REGENERATING_HEAL",
      sourceEffectId: effect.id,
      sourceCardInstanceId: sourceMagicCard.instanceId,
      sourceCardName: getCardName(state, sourceMagicCard),
      sourcePlayerId: sourceMagicCard.controllerPlayerId,
      targetCardInstanceId: targetCreature.instanceId,
      targetCardName: getCardName(state, targetCreature),
      targetPlayerId: targetCreature.controllerPlayerId,
      actionType: "APPLY_REGENERATING_HEAL",
      label: effect.value ?? effect.actionText ?? effect.params?.valueText ?? `${amount} HP at start of your turn`,
      amount,
      healAmount: amount,
      effectType: "REGENERATING_HEAL",
      tickTiming: "BEGINNING_OF_TURN",
      stackRule,
      ticksRemaining: startingTicks,
      nextTickPlayerId: sourceMagicCard.controllerPlayerId,
      nextTickTurnStartCount: currentSourceTurnStartCount + 1,
      appliedSequenceNumber: state.eventLog.length + 1,
      refreshAtEndOfSourceOwnerTurn: Boolean(effect.params?.refreshAtEndOfSourceOwnerTurn ?? true),
      refreshAmount,
      maxRefreshCounter,
      sourceLinked: true,
      expiresWhenSourceLeaves: effect.params?.expiresWhenSourceLeaves !== false,
      healImmediatelyOnApply: Boolean(effect.params?.healImmediatelyOnApply ?? true),
      durationType: "PERMANENT_UNTIL_SOURCE_REMOVED",
      appliedTurnNumber: state.turn.turnNumber,
      appliedTurnCycle: state.turn.turnCycleNumber,
      debug: [
        `Regenerating heal ${amount} from ${getCardName(state, sourceMagicCard)}.`,
        `Heals immediately, then at the start of ${sourceMagicCard.controllerPlayerId}'s turn.`,
        `Starts with ${startingTicks} counter(s) and refreshes +${refreshAmount} at end of source owner's turn.`
      ]
    };

    addActiveEffectInstance(targetCreature, instance);

    if (instance.healImmediatelyOnApply) {
      const maxHp = targetCreature.baseHp ?? targetDefinition.hp;
      const hpBefore = targetCreature.currentHp ?? maxHp;
      const hpAfter = Math.min(maxHp, hpBefore + amount);
      targetCreature.currentHp = hpAfter;

      addEvent(state, "REGENERATING_HEAL_INITIAL_TICK_RESOLVED", sourceMagicCard.controllerPlayerId, {
        sourceCardName: getCardName(state, sourceMagicCard),
        sourceCardInstanceId: sourceMagicCard.instanceId,
        targetCreatureInstanceId: targetCreature.instanceId,
        targetCreatureName: getCardName(state, targetCreature),
        effectId: effect.id,
        actionType: effect.actionType,
        healAmount: hpAfter - hpBefore,
        requestedHealAmount: amount,
        hpBefore,
        remainingHp: hpAfter,
        maxHp,
        counterConsumed: false,
        boardEvents: [
          {
            type: "CARD_HEALED",
            ...effectBoardEventBase({
              playerId: sourceMagicCard.controllerPlayerId,
              sourceCardInstanceId: sourceMagicCard.instanceId,
              sourceCardId: sourceMagicCard.cardId,
              sourceEffectId: effect.id,
              actionType: effect.actionType,
              reason: "REGENERATING_HEAL_INITIAL_TICK"
            }),
            cardInstanceId: targetCreature.instanceId,
            targetCardInstanceId: targetCreature.instanceId,
            amount: hpAfter - hpBefore,
            healType: "REGENERATING_HEAL"
          } satisfies BoardEventPayload
        ]
      });
    }

    appliedCount += 1;

    addEvent(state, "REGENERATING_HEAL_APPLIED", sourceMagicCard.controllerPlayerId, {
      sourceCardName: getCardName(state, sourceMagicCard),
      sourceCardInstanceId: sourceMagicCard.instanceId,
      targetCreatureInstanceId: targetCreature.instanceId,
      targetCreatureName: getCardName(state, targetCreature),
      effectId: effect.id,
      actionType: effect.actionType,
      amount,
      tickTiming: "BEGINNING_OF_TURN",
      remainingTicks: instance.ticksRemaining,
      healImmediatelyOnApply: instance.healImmediatelyOnApply,
      refreshAtEndOfSourceOwnerTurn: instance.refreshAtEndOfSourceOwnerTurn,
      refreshAmount: instance.refreshAmount,
      maxRefreshCounter: instance.maxRefreshCounter,
      nextTickPlayerId: instance.nextTickPlayerId,
      nextTickTurnStartCount: instance.nextTickTurnStartCount,
      boardEvents: [
        {
          type: "STATUS_APPLIED",
          ...effectBoardEventBase({
            playerId: sourceMagicCard.controllerPlayerId,
            sourceCardInstanceId: sourceMagicCard.instanceId,
            sourceCardId: sourceMagicCard.cardId,
            sourceEffectId: effect.id,
            actionType: effect.actionType,
            reason: "REGENERATING_HEAL_APPLIED"
          }),
          cardInstanceId: targetCreature.instanceId,
          targetCardInstanceId: targetCreature.instanceId,
          amount,
          status: "REGENERATING_HEAL",
          statusLabel: instance.label
        } satisfies BoardEventPayload
      ]
    });
  }

  return appliedCount;
}

export function applyOnEquipRecurringEffects(
  state: MatchState,
  args: {
    sourceMagicCard: CardInstance;
    targetCreature: CardInstance;
    addEvent: AddEventFn;
  }
): number {
  const { sourceMagicCard, targetCreature, addEvent } = args;
  const definition = state.cardCatalog[sourceMagicCard.cardId];
  const effects = getCardEngineEffects(definition);
  const targetDefinition = state.cardCatalog[targetCreature.cardId];

  if (targetDefinition?.cardType !== "CREATURE") {
    return 0;
  }

  targetCreature.activeRecurringEffects ??= [];

  let appliedCount = 0;

  for (const effect of effects) {
    if (!isOnEquipRecurringHealEffect(effect)) {
      continue;
    }

    const amount = parseFirstPositiveNumberFromEffect(effect);

    if (!amount) {
      addEvent(state, "AUTO_EQUIP_RECURRING_HEAL_SKIPPED", sourceMagicCard.controllerPlayerId, {
        sourceCardName: getCardName(state, sourceMagicCard),
        sourceCardInstanceId: sourceMagicCard.instanceId,
        effectId: effect.id,
        actionType: effect.actionType,
        reason: "No automatic heal amount was found."
      });
      continue;
    }

    const stackRule = String(effect.params?.stackRule ?? "DO_NOT_STACK");
    const existingIndex = targetCreature.activeRecurringEffects.findIndex(item =>
      item.sourceCardInstanceId === sourceMagicCard.instanceId &&
      item.sourceEffectId === effect.id
    );

    if (existingIndex >= 0) {
      targetCreature.activeRecurringEffects.splice(existingIndex, 1);
    } else if (stackRule === "DO_NOT_STACK" && targetCreature.activeRecurringEffects.some(item => item.effectType === "HEAL_OVER_TIME")) {
      addEvent(state, "AUTO_EQUIP_RECURRING_HEAL_NOT_STACKED", sourceMagicCard.controllerPlayerId, {
        sourceCardName: getCardName(state, sourceMagicCard),
        sourceCardInstanceId: sourceMagicCard.instanceId,
        targetCreatureInstanceId: targetCreature.instanceId,
        targetCreatureName: getCardName(state, targetCreature),
        effectId: effect.id,
        actionType: effect.actionType
      });
      continue;
    }

    const tickTiming = "BEGINNING_OF_TURN" as const;
    const startingTicks = positiveIntegerFromUnknown(effect.params?.startingTicks ?? effect.duration?.amount, 2);
    const refreshAmount = positiveIntegerFromUnknown(effect.params?.refreshAmount, 1);
    const maxRefreshCounterRaw = effect.params?.maxRefreshCounter;
    const maxRefreshCounter = maxRefreshCounterRaw === undefined || maxRefreshCounterRaw === null
      ? undefined
      : positiveIntegerFromUnknown(maxRefreshCounterRaw, startingTicks);
    const nextTick = getNextRecurringEffectTickSchedule(state, sourceMagicCard.controllerPlayerId, tickTiming);

    const recurring: ActiveRecurringCreatureEffect = {
      id: uuidv4(),
      sourceEffectId: effect.id,
      sourceCardInstanceId: sourceMagicCard.instanceId,
      sourceCardName: getCardName(state, sourceMagicCard),
      sourcePlayerId: sourceMagicCard.controllerPlayerId,
      effectType: "HEAL_OVER_TIME",
      amount,
      label: effect.value ?? effect.actionText ?? effect.params?.valueText ?? `${amount} HP`,
      tickTiming,
      stackRule,
      remainingTicks: startingTicks,
      nextTickPlayerId: nextTick.nextTickPlayerId,
      nextTickTurnStartCount: nextTick.nextTickTurnStartCount,
      appliedSequenceNumber: state.eventLog.length + 1,
      refreshAtEndOfSourceOwnerTurn: Boolean(effect.params?.refreshAtEndOfSourceOwnerTurn),
      refreshAmount,
      maxRefreshCounter,
      expiresWhenSourceLeaves: effect.params?.expiresWhenSourceLeaves !== false,
      healImmediatelyOnApply: Boolean(effect.params?.healImmediatelyOnApply),
      durationType: "PERMANENT_UNTIL_SOURCE_REMOVED",
      appliedTurnNumber: state.turn.turnNumber,
      appliedTurnCycle: state.turn.turnCycleNumber
    };

    targetCreature.activeRecurringEffects.push(recurring);
    syncRecurringActiveEffectInstance(targetCreature, recurring);

    if (recurring.healImmediatelyOnApply) {
      const maxHp = targetCreature.baseHp ?? targetDefinition.hp;
      const hpBefore = targetCreature.currentHp ?? maxHp;
      const hpAfter = Math.min(maxHp, hpBefore + amount);
      targetCreature.currentHp = hpAfter;

      addEvent(state, "AUTO_EQUIP_RECURRING_HEAL_INITIAL_TICK_RESOLVED", sourceMagicCard.controllerPlayerId, {
        sourceCardName: getCardName(state, sourceMagicCard),
        sourceCardInstanceId: sourceMagicCard.instanceId,
        targetCreatureInstanceId: targetCreature.instanceId,
        targetCreatureName: getCardName(state, targetCreature),
        effectId: effect.id,
        actionType: effect.actionType,
        healAmount: hpAfter - hpBefore,
        requestedHealAmount: amount,
        hpBefore,
        remainingHp: hpAfter,
        maxHp,
        counterConsumed: false,
        boardEvents: [
          {
            type: "CARD_HEALED",
            ...effectBoardEventBase({
              playerId: sourceMagicCard.controllerPlayerId,
              sourceCardInstanceId: sourceMagicCard.instanceId,
              sourceCardId: sourceMagicCard.cardId,
              sourceEffectId: effect.id,
              actionType: effect.actionType,
              reason: "HEAL_OVER_TIME_INITIAL_TICK"
            }),
            cardInstanceId: targetCreature.instanceId,
            targetCardInstanceId: targetCreature.instanceId,
            amount: hpAfter - hpBefore,
            healType: "HEAL_OVER_TIME"
          } satisfies BoardEventPayload
        ]
      });
    }

    appliedCount += 1;

    addEvent(state, "AUTO_EQUIP_RECURRING_HEAL_APPLIED", sourceMagicCard.controllerPlayerId, {
      sourceCardName: getCardName(state, sourceMagicCard),
      sourceCardInstanceId: sourceMagicCard.instanceId,
      targetCreatureInstanceId: targetCreature.instanceId,
      targetCreatureName: getCardName(state, targetCreature),
      effectId: effect.id,
      actionType: effect.actionType,
      amount,
      tickTiming,
      remainingTicks: recurring.remainingTicks,
      healImmediatelyOnApply: recurring.healImmediatelyOnApply,
      refreshAtEndOfSourceOwnerTurn: recurring.refreshAtEndOfSourceOwnerTurn,
      refreshAmount: recurring.refreshAmount,
      maxRefreshCounter: recurring.maxRefreshCounter,
      nextTickPlayerId: recurring.nextTickPlayerId,
      nextTickTurnStartCount: recurring.nextTickTurnStartCount,
      boardEvents: [
        {
          type: "STATUS_APPLIED",
          ...effectBoardEventBase({
            playerId: sourceMagicCard.controllerPlayerId,
            sourceCardInstanceId: sourceMagicCard.instanceId,
            sourceCardId: sourceMagicCard.cardId,
            sourceEffectId: effect.id,
            actionType: effect.actionType,
            reason: "HEAL_OVER_TIME_APPLIED"
          }),
          cardInstanceId: targetCreature.instanceId,
          targetCardInstanceId: targetCreature.instanceId,
          amount,
          status: "HEAL_OVER_TIME",
          statusLabel: recurring.label
        } satisfies BoardEventPayload
      ]
    });
  }

  return appliedCount;
}


function parsePercentageDamageAmount(currentHp: number, effect: WardEngineEffect): number {
  const text = [
    getRuntimeBlockText(effect),
    effect.actionText,
    effect.target,
    effect.params?.target,
    effect.value,
    effect.params?.valueText
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (text.includes("1/2") || text.includes("half") || text.includes("by 1/2")) {
    return Math.floor(currentHp / 2);
  }

  const percentMatch = text.match(/(\d+)\s*%/);
  if (percentMatch) {
    return Math.floor(currentHp * (Number(percentMatch[1]) / 100));
  }

  return 0;
}

export function applyOnEquipPercentageDamageEffects(
  state: MatchState,
  args: {
    sourceMagicCard: CardInstance;
    targetCreature: CardInstance;
    addEvent: AddEventFn;
  }
): number {
  const { sourceMagicCard, targetCreature, addEvent } = args;
  const definition = state.cardCatalog[sourceMagicCard.cardId];
  const effects = getCardEngineEffects(definition);
  const targetDefinition = state.cardCatalog[targetCreature.cardId];

  if (targetDefinition?.cardType !== "CREATURE") {
    return 0;
  }

  let resolvedCount = 0;

  for (const effect of effects) {
    const trigger = String(effect.trigger ?? "").trim().toUpperCase();
    const actionType = getRuntimeBlockActionType(effect).trim().toUpperCase();

    if (trigger !== "ON_EQUIP" || actionType !== "DEAL_PERCENTAGE_DAMAGE") {
      continue;
    }

    const maxHp = targetCreature.baseHp ?? targetDefinition.hp;
    const currentHp = targetCreature.currentHp ?? maxHp;
    const damageAmount = Math.min(currentHp, Math.max(0, parsePercentageDamageAmount(currentHp, effect)));

    if (damageAmount <= 0) {
      continue;
    }

    targetCreature.currentHp = Math.max(0, currentHp - damageAmount);
    resolvedCount += 1;

    addEvent(state, "AUTO_EQUIP_ON_EQUIP_PERCENTAGE_DAMAGE_RESOLVED", sourceMagicCard.controllerPlayerId, {
      sourceCardName: getCardName(state, sourceMagicCard),
      sourceCardInstanceId: sourceMagicCard.instanceId,
      targetCreatureInstanceId: targetCreature.instanceId,
      targetCreatureName: getCardName(state, targetCreature),
      effectId: effect.id,
      actionType: effect.actionType,
      previousHp: currentHp,
      damageAmount,
      remainingHp: targetCreature.currentHp,
      maxHp,
      note: "Percentage damage uses current remaining HP. Half values round up for damage.",
      boardEvents: [
        {
          type: "CARD_DAMAGED",
          ...effectBoardEventBase({
            playerId: sourceMagicCard.controllerPlayerId,
            sourceCardInstanceId: sourceMagicCard.instanceId,
            sourceCardId: sourceMagicCard.cardId,
            sourceEffectId: effect.id,
            actionType: effect.actionType,
            reason: "ON_EQUIP_PERCENTAGE_DAMAGE"
          }),
          cardInstanceId: targetCreature.instanceId,
          targetCardInstanceId: targetCreature.instanceId,
          amount: damageAmount,
          damageType: "PERCENTAGE_DAMAGE"
        } satisfies BoardEventPayload
      ]
    });
  }

  return resolvedCount;
}

export function applyOnEquipGlobalCreatureEffectNegationEffects(
  state: MatchState,
  args: {
    sourceMagicCard: CardInstance;
    targetCreature: CardInstance;
    addEvent: AddEventFn;
  }
): number {
  const { sourceMagicCard, addEvent } = args;
  const definition = state.cardCatalog[sourceMagicCard.cardId];
  const effects = getCardEngineEffects(definition);

  let resolvedCount = 0;

  sourceMagicCard.activeEffectInstances ??= [];

  for (const effect of effects) {
    const actionType = getRuntimeBlockActionType(effect).trim().toUpperCase();
    const trigger = String(effect.trigger ?? "").trim().toUpperCase();
    const durationType = effect.duration?.type ?? effect.params?.duration?.type;

    if (actionType !== "APPLY_GLOBAL_CREATURE_EFFECT_NEGATION") {
      continue;
    }

    if (trigger !== "WHILE_EQUIPPED" && durationType !== "WHILE_EQUIPPED") {
      continue;
    }

    const existingIndex = sourceMagicCard.activeEffectInstances.findIndex(instance =>
      instance.sourceCardInstanceId === sourceMagicCard.instanceId &&
      instance.sourceEffectId === effect.id &&
      instance.actionType === "APPLY_GLOBAL_CREATURE_EFFECT_NEGATION"
    );

    const instance: ActiveEffectInstance = {
      id: existingIndex >= 0 ? sourceMagicCard.activeEffectInstances[existingIndex].id : uuidv4(),
      kind: "STATIC_MODIFIER",
      sourceEffectId: effect.id,
      sourceCardInstanceId: sourceMagicCard.instanceId,
      sourceCardName: getCardName(state, sourceMagicCard),
      sourcePlayerId: sourceMagicCard.controllerPlayerId,
      targetPlayerId: "ALL_PLAYERS",
      actionType: "APPLY_GLOBAL_CREATURE_EFFECT_NEGATION",
      label: effect.value ?? effect.actionText ?? "Negate all creature effects on the field.",
      durationType: "WHILE_EQUIPPED",
      durationText: effect.duration?.text ?? effect.params?.duration?.text ?? "While equipped",
      sourceLinked: true,
      expiresWhenSourceLeaves: true,
      appliedTurnNumber: state.turn.turnNumber,
      appliedTurnCycle: state.turn.turnCycleNumber,
      debug: [
        "Created by an Equip Magic with global creature-effect negation.",
        "Runtime suppression checks treat creature effects as suppressed while this source remains in a Magic Slot."
      ]
    };

    if (existingIndex >= 0) {
      sourceMagicCard.activeEffectInstances[existingIndex] = instance;
    } else {
      sourceMagicCard.activeEffectInstances.push(instance);
    }

    resolvedCount += 1;

    addEvent(state, "AUTO_EQUIP_GLOBAL_CREATURE_EFFECT_NEGATION_ACTIVE", sourceMagicCard.controllerPlayerId, {
      sourceCardName: getCardName(state, sourceMagicCard),
      sourceCardInstanceId: sourceMagicCard.instanceId,
      effectId: effect.id,
      actionType: effect.actionType,
      note: "All creature effects are suppressed while this Equip Magic remains on the field."
    });
  }

  return resolvedCount;
}

export function applyOnEquipImmediateEffects(
  state: MatchState,
  args: {
    sourceMagicCard: CardInstance;
    targetCreature: CardInstance;
    addEvent: AddEventFn;
  }
): number {
  const { sourceMagicCard, targetCreature, addEvent } = args;
  const definition = state.cardCatalog[sourceMagicCard.cardId];
  const effects = getCardEngineEffects(definition);
  const targetDefinition = state.cardCatalog[targetCreature.cardId];

  if (targetDefinition?.cardType !== "CREATURE") {
    return 0;
  }

  let resolvedCount = 0;

  for (const effect of effects) {
    const trigger = String(effect.trigger ?? "").trim().toUpperCase();
    const actionType = getRuntimeBlockActionType(effect).trim().toUpperCase();
    const durationType = String(effect.duration?.type ?? effect.params?.duration?.type ?? "").trim().toUpperCase();
    const text = [effect.target, effect.params?.target, effect.value, effect.params?.valueText, effect.actionText]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const targetsEquippedCreature = text.includes("equipped creature") || text.includes("on equip") || text.includes("fully heal");
    const isEquipDamageImmunity = (
      trigger === "ON_EQUIP" ||
      trigger === "WHILE_EQUIPPED" ||
      durationType === "WHILE_EQUIPPED"
    ) &&
      targetsEquippedCreature &&
      actionType === "APPLY_DAMAGE_IMMUNITY";
    const isOnEquipHeal = trigger === "ON_EQUIP" && targetsEquippedCreature && (
      actionType === "HEAL_TO_FULL" ||
      actionType === "HEAL" ||
      actionType === "HEAL_CREATURE"
    );

    if (isEquipDamageImmunity) {
      const isWhileEquipped = trigger === "WHILE_EQUIPPED" || durationType === "WHILE_EQUIPPED";
      const expiration = isWhileEquipped
        ? undefined
        : getTurnCycleExpiration({
            state,
            sourcePlayerId: sourceMagicCard.controllerPlayerId,
            targetPlayerId: targetCreature.controllerPlayerId,
            effect,
            fallbackDuration: 1
          });
      const status: ActiveCreatureStatus = {
        id: uuidv4(),
        sourceEffectId: effect.id,
        sourceCardInstanceId: sourceMagicCard.instanceId,
        sourceCardName: getCardName(state, sourceMagicCard),
        sourcePlayerId: sourceMagicCard.controllerPlayerId,
        status: "DAMAGE_IMMUNITY",
        label: effect.value ?? effect.actionText ?? "Cannot be damaged",
        flags: { canReceiveDamage: false },
        durationType: isWhileEquipped ? "PERMANENT_UNTIL_SOURCE_REMOVED" : "TARGET_PLAYER_TURN_STARTS",
        appliedTurnNumber: state.turn.turnNumber,
        appliedTurnCycle: state.turn.turnCycleNumber,
        expiresOnPlayerId: expiration?.expiresOnPlayerId,
        expiresAtPlayerTurnStartCount: expiration?.expiresAtPlayerTurnStartCount
      };

      const addResult = addActiveStatusIfAbsent(targetCreature, status);
      if (!addResult.applied) {
        addEvent(state, "AUTO_EQUIP_DAMAGE_IMMUNITY_ALREADY_ACTIVE", sourceMagicCard.controllerPlayerId, {
          sourceCardName: getCardName(state, sourceMagicCard),
          sourceCardInstanceId: sourceMagicCard.instanceId,
          targetCreatureInstanceId: targetCreature.instanceId,
          targetCreatureName: getCardName(state, targetCreature),
          effectId: effect.id,
          actionType: effect.actionType,
          status: addResult.activeStatus.status,
          label: addResult.activeStatus.label,
          reason: "A matching status from this source/effect is already active; not refreshing or stacking it."
        });
        continue;
      }

      resolvedCount += 1;

      addEvent(state, "AUTO_EQUIP_DAMAGE_IMMUNITY_APPLIED", sourceMagicCard.controllerPlayerId, {
        sourceCardName: getCardName(state, sourceMagicCard),
        sourceCardInstanceId: sourceMagicCard.instanceId,
        targetCreatureInstanceId: targetCreature.instanceId,
        targetCreatureName: getCardName(state, targetCreature),
        effectId: effect.id,
        actionType: effect.actionType,
        status: status.status,
        label: status.label,
        flags: status.flags,
        expiresOnPlayerId: status.expiresOnPlayerId,
        expiresAtPlayerTurnStartCount: status.expiresAtPlayerTurnStartCount,
        boardEvents: [
          {
            type: "STATUS_APPLIED",
            ...effectBoardEventBase({
              playerId: sourceMagicCard.controllerPlayerId,
              sourceCardInstanceId: sourceMagicCard.instanceId,
              sourceCardId: sourceMagicCard.cardId,
              sourceEffectId: effect.id,
              actionType: effect.actionType,
              reason: isWhileEquipped ? "WHILE_EQUIPPED_DAMAGE_IMMUNITY" : "ON_EQUIP_DAMAGE_IMMUNITY"
            }),
            cardInstanceId: targetCreature.instanceId,
            targetCardInstanceId: targetCreature.instanceId,
            status: status.status,
            statusLabel: status.label
          } satisfies BoardEventPayload
        ]
      });

      continue;
    }

    if (!isOnEquipHeal) {
      continue;
    }

    const maxHp = targetCreature.baseHp ?? targetDefinition.hp;
    const currentHp = targetCreature.currentHp ?? maxHp;
    const healAmount = actionType === "HEAL_TO_FULL"
      ? Math.max(0, maxHp - currentHp)
      : Math.min(maxHp - currentHp, parseFirstPositiveNumberFromEffect(effect) ?? 0);

    targetCreature.currentHp = actionType === "HEAL_TO_FULL"
      ? maxHp
      : Math.min(maxHp, currentHp + Math.max(0, healAmount));

    resolvedCount += 1;

    addEvent(state, "AUTO_EQUIP_ON_EQUIP_HEAL_RESOLVED", sourceMagicCard.controllerPlayerId, {
      sourceCardName: getCardName(state, sourceMagicCard),
      sourceCardInstanceId: sourceMagicCard.instanceId,
      targetCreatureInstanceId: targetCreature.instanceId,
      targetCreatureName: getCardName(state, targetCreature),
      effectId: effect.id,
      actionType: effect.actionType,
      healAmount,
      remainingHp: targetCreature.currentHp,
      maxHp,
      boardEvents: [
        {
          type: "CARD_HEALED",
          ...effectBoardEventBase({
            playerId: sourceMagicCard.controllerPlayerId,
            sourceCardInstanceId: sourceMagicCard.instanceId,
            sourceCardId: sourceMagicCard.cardId,
            sourceEffectId: effect.id,
            actionType: effect.actionType,
            reason: "ON_EQUIP_HEAL"
          }),
          cardInstanceId: targetCreature.instanceId,
          targetCardInstanceId: targetCreature.instanceId,
          amount: healAmount,
          healType: effect.actionType
        } satisfies BoardEventPayload
      ]
    });
  }

  return resolvedCount;
}
