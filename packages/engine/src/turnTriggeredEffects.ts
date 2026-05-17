import { v4 as uuidv4 } from "uuid";
import type {
  CardDefinition,
  CardInstance,
  EffectTargetOption,
  MatchState,
  PlayerState,
  StatModifierKey,
  WardEngineEffect
} from "@ward/shared";
import { areCreatureEffectsSuppressed } from "./creatureEffectSuppression.js";
import { moveAttachedMagicCardsToCemeteryForCreature } from "./attachments.js";
import {
  applyDamageToCreatureTarget,
  healCreatureTarget,
  moveMagicSlotCardToCemetery
} from "./cardMovement.js";
import { moveFieldCreatureToCemetery } from "./fieldRemoval.js";
import { getCardEngineEffects } from "./effectResolver.js";
import { getCardDefinition, getPlayer, type AddEventFn } from "./engineRuntime.js";
import { rollD6WithDev } from "./devRolls.js";

type ActiveTurnEffectSource = {
  player: PlayerState;
  card: CardInstance;
  definition: CardDefinition;
  zone: "PRIMARY_CREATURE" | "LIMITED_SUMMON" | "MAGIC_SLOT";
};

type CreatureLocation = {
  player: PlayerState;
  card: CardInstance;
  definition: Extract<CardDefinition, { cardType: "CREATURE" }>;
  targetKind: "PRIMARY_CREATURE" | "LIMITED_SUMMON";
};

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function effectText(effect: WardEngineEffect): string {
  return [
    effect.trigger,
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

function sourceTurnOwnerPlayerId(source: ActiveTurnEffectSource): string {
  // Stone Golem's text is explicitly tied to the original caster, even after
  // the card is placed on the opponent's field.
  if (source.definition.id === "gen1_088_stone_golem") {
    return source.card.ownerPlayerId;
  }

  return source.card.controllerPlayerId;
}

function collectActiveTurnEffectSources(state: MatchState): ActiveTurnEffectSource[] {
  const sources: ActiveTurnEffectSource[] = [];

  for (const player of state.players) {
    const add = (card: CardInstance | undefined, zone: ActiveTurnEffectSource["zone"]) => {
      if (!card) return;
      const definition = state.cardCatalog[card.cardId];
      if (!definition) return;
      if (definition.cardType === "CREATURE" && areCreatureEffectsSuppressed(state, card)) return;
      sources.push({ player, card, definition, zone });
    };

    add(player.field.primaryCreature, "PRIMARY_CREATURE");
    for (const limited of player.field.limitedSummons) add(limited, "LIMITED_SUMMON");
    for (const magic of player.field.magicSlots) add(magic, "MAGIC_SLOT");
  }

  return sources;
}

function collectCreatureLocations(state: MatchState): CreatureLocation[] {
  const locations: CreatureLocation[] = [];

  for (const player of state.players) {
    const primary = player.field.primaryCreature;
    if (primary) {
      const definition = state.cardCatalog[primary.cardId];
      if (definition?.cardType === "CREATURE") {
        locations.push({ player, card: primary, definition, targetKind: "PRIMARY_CREATURE" });
      }
    }

    for (const limited of player.field.limitedSummons) {
      const definition = state.cardCatalog[limited.cardId];
      if (definition?.cardType === "CREATURE") {
        locations.push({ player, card: limited, definition, targetKind: "LIMITED_SUMMON" });
      }
    }
  }

  return locations;
}

function findCreatureLocationByInstanceId(state: MatchState, cardInstanceId: string): CreatureLocation | undefined {
  return collectCreatureLocations(state).find(location => location.card.instanceId === cardInstanceId);
}

function targetOptionFromLocation(location: CreatureLocation): EffectTargetOption {
  return {
    id: `${location.player.id}:${location.targetKind}:${location.card.instanceId}`,
    label: `${location.player.displayName}: ${location.definition.name}`,
    targetKind: location.targetKind,
    playerId: location.player.id,
    cardInstanceId: location.card.instanceId,
    cardId: location.card.cardId,
    cardName: location.definition.name,
    zone: location.targetKind
  };
}

function primaryCreatureLocation(player: PlayerState, state: MatchState): CreatureLocation | undefined {
  const primary = player.field.primaryCreature;
  if (!primary) return undefined;
  const definition = state.cardCatalog[primary.cardId];
  if (definition?.cardType !== "CREATURE") return undefined;
  return { player, card: primary, definition, targetKind: "PRIMARY_CREATURE" };
}

function sourceController(state: MatchState, source: ActiveTurnEffectSource): PlayerState {
  return getPlayer(state, source.card.controllerPlayerId);
}

function opponentOf(state: MatchState, playerId: string): PlayerState | undefined {
  return state.players.find(player => player.id !== playerId);
}

function normalizeStatKey(rawStat: string): StatModifierKey | undefined {
  const stat = rawStat.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (stat === "AL" || stat === "ARMOR" || stat === "ARMOR_LEVEL") return "armorLevel";
  if (stat === "SPD" || stat === "SPEED") return "speed";
  if (stat === "ATK_DICE" || stat === "ATK_DICE_ROLLS" || stat === "ATTACK_DICE" || stat === "ATTACK_DICE_ROLLS") return "attackDice";
  if (stat === "MOD" || stat === "MODIFIER") return "modifier";
  return undefined;
}

function statDeltaFromChange(change: { operation?: string; value?: number }): number | undefined {
  const value = Number(change.value);
  if (!Number.isFinite(value)) return undefined;

  const operation = String(change.operation ?? "ADD").trim().toUpperCase();
  if (operation === "ADD") return value;
  if (operation === "SUBTRACT") return -value;
  return undefined;
}

function sourceAttachedCreature(state: MatchState, source: ActiveTurnEffectSource): CreatureLocation | undefined {
  return source.card.attachedToInstanceId
    ? findCreatureLocationByInstanceId(state, source.card.attachedToInstanceId)
    : undefined;
}

function creatureHasWings(definition: Extract<CardDefinition, { cardType: "CREATURE" }>): boolean {
  const tags = ((definition as { artworkTags?: unknown }).artworkTags ?? []) as unknown[];
  return tags.some(tag => String(tag).trim().toUpperCase() === "WINGS") ||
    definition.name.toLowerCase().includes("dragon") ||
    definition.name.toLowerCase().includes("griffin");
}

function lowestHpPrimaryCreature(state: MatchState): CreatureLocation | undefined {
  return state.players
    .map(player => primaryCreatureLocation(player, state))
    .filter((location): location is CreatureLocation => Boolean(location))
    .sort((left, right) =>
      (left.card.currentHp ?? left.card.baseHp ?? left.definition.hp) -
      (right.card.currentHp ?? right.card.baseHp ?? right.definition.hp)
    )[0];
}

function targetLocationsForEffect(
  state: MatchState,
  source: ActiveTurnEffectSource,
  effect: WardEngineEffect,
  triggerPlayerId: string
): CreatureLocation[] {
  const text = effectText(effect);
  const actionType = normalize(effect.actionType);
  const controller = sourceController(state, source);

  if (text.includes("all creatures")) {
    const all = collectCreatureLocations(state);
    if (text.includes("do not have wings") || text.includes("without wings")) {
      return all.filter(location => !creatureHasWings(location.definition));
    }
    return all;
  }

  if (text.includes("lowest hp")) {
    const lowest = lowestHpPrimaryCreature(state);
    return lowest ? [lowest] : [];
  }

  if (text.includes("equipped creature")) {
    const attached = sourceAttachedCreature(state, source);
    return attached ? [attached] : [];
  }

  if (actionType === "DEAL_DAMAGE_ON_DRAW") {
    const drawingPlayer = getPlayer(state, triggerPlayerId);
    const primary = primaryCreatureLocation(drawingPlayer, state);
    return primary ? [primary] : [];
  }

  if (text.includes("opponent")) {
    const triggerPlayer = triggerPlayerId !== controller.id ? getPlayer(state, triggerPlayerId) : opponentOf(state, controller.id);
    const primary = triggerPlayer ? primaryCreatureLocation(triggerPlayer, state) : undefined;
    return primary ? [primary] : [];
  }

  if (text.includes("your creature") || text.includes("your primary")) {
    const primary = primaryCreatureLocation(controller, state);
    return primary ? [primary] : [];
  }

  if (text.includes("this card") || text.includes("this creature")) {
    const self = findCreatureLocationByInstanceId(state, source.card.instanceId);
    return self ? [self] : [];
  }

  const attached = sourceAttachedCreature(state, source);
  if (attached) return [attached];

  const primary = primaryCreatureLocation(controller, state);
  return primary ? [primary] : [];
}

function firstPositiveNumber(effect: WardEngineEffect): number | undefined {
  const explicit = Number(effect.params?.amount ?? effect.params?.damageAmount ?? effect.params?.healAmount);
  if (Number.isFinite(explicit) && explicit > 0) return Math.trunc(explicit);

  const match = effectText(effect).match(/(\d+)/);
  const value = Number(match?.[1]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;
}

function sourceManualEffectRequest(
  source: ActiveTurnEffectSource,
  effect: WardEngineEffect,
  controllerPlayerId: string,
  reason: string
) {
  const magicType = source.definition.cardType === "MAGIC" ? source.definition.magicType : "STANDARD";
  const magicSubType = source.definition.cardType === "MAGIC" ? source.definition.magicSubType : "NONE";

  return {
    id: uuidv4(),
    sourceCardInstanceId: source.card.instanceId,
    sourceCardId: source.card.cardId,
    sourceCardName: source.definition.name,
    magicType,
    magicSubType,
    effectId: effect.id,
    actionType: effect.actionType,
    effectGroup: effect.effectGroup,
    actionText: effect.actionText,
    effectValue: effect.value,
    durationText: effect.duration?.text,
    controllerPlayerId,
    text: `${reason}\n\n${effect.actionText ?? effect.actionType}: ${effect.value ?? effect.params?.valueText ?? ""}`,
    completed: false
  };
}

function queueManualTurnEffect(
  state: MatchState,
  source: ActiveTurnEffectSource,
  effect: WardEngineEffect,
  controllerPlayerId: string,
  reason: string,
  addEvent: AddEventFn
): void {
  const request = sourceManualEffectRequest(source, effect, controllerPlayerId, reason);
  state.manualEffectQueue.push(request);

  addEvent(state, "TURN_TRIGGER_MANUAL_EFFECT_QUEUED", controllerPlayerId, {
    requestId: request.id,
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: source.definition.name,
    sourceEffectId: effect.id,
    actionType: effect.actionType,
    trigger: effect.trigger,
    reason
  });
}

function applyDamageEffect(
  state: MatchState,
  source: ActiveTurnEffectSource,
  effect: WardEngineEffect,
  triggerPlayerId: string,
  multiplier: number,
  addEvent: AddEventFn
): boolean {
  const amount = firstPositiveNumber(effect);
  if (!amount) return false;

  const targetLocations = targetLocationsForEffect(state, source, effect, triggerPlayerId);
  if (targetLocations.length === 0) return false;

  const results = [];
  for (const location of targetLocations) {
    const current = findCreatureLocationByInstanceId(state, location.card.instanceId);
    if (!current) continue;
    const result = applyDamageToCreatureTarget(state, targetOptionFromLocation(current), amount * multiplier);
    results.push({
      playerId: result.playerId,
      creatureName: result.creatureName,
      creatureInstanceId: result.creature.instanceId,
      damageAmount: result.damageAmount,
      remainingHp: result.remainingHp,
      killed: result.killed
    });
  }

  if (results.length === 0) return false;

  addEvent(state, "TURN_TRIGGER_DAMAGE_RESOLVED", source.card.controllerPlayerId, {
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: source.definition.name,
    sourceEffectId: effect.id,
    actionType: effect.actionType,
    trigger: effect.trigger,
    triggerPlayerId,
    amountPerTrigger: amount,
    multiplier,
    results,
    boardEvents: results.map(result => ({
      type: "CARD_DAMAGED",
      playerId: source.card.controllerPlayerId,
      sourceCardInstanceId: source.card.instanceId,
      sourceCardId: source.card.cardId,
      sourceEffectId: effect.id,
      actionType: effect.actionType,
      reason: "TURN_TRIGGER_DAMAGE",
      cardInstanceId: result.creatureInstanceId,
      targetCardInstanceId: result.creatureInstanceId,
      amount: result.damageAmount,
      damageType: effect.params?.damageType ?? effect.actionType
    }))
  });

  return true;
}

function applyHealEffect(
  state: MatchState,
  source: ActiveTurnEffectSource,
  effect: WardEngineEffect,
  triggerPlayerId: string,
  multiplier: number,
  addEvent: AddEventFn
): boolean {
  const amount = firstPositiveNumber(effect);
  if (!amount) return false;

  const targetLocations = targetLocationsForEffect(state, source, effect, triggerPlayerId);
  if (targetLocations.length === 0) return false;

  const results = [];
  for (const location of targetLocations) {
    const current = findCreatureLocationByInstanceId(state, location.card.instanceId);
    if (!current) continue;
    const result = healCreatureTarget(state, targetOptionFromLocation(current), amount * multiplier);
    results.push({
      playerId: result.playerId,
      creatureName: result.creatureName,
      creatureInstanceId: result.creature.instanceId,
      healAmount: result.healAmount,
      remainingHp: result.remainingHp,
      maxHp: result.maxHp
    });
  }

  if (results.length === 0) return false;

  addEvent(state, "TURN_TRIGGER_HEAL_RESOLVED", source.card.controllerPlayerId, {
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: source.definition.name,
    sourceEffectId: effect.id,
    actionType: effect.actionType,
    trigger: effect.trigger,
    triggerPlayerId,
    amountPerTrigger: amount,
    multiplier,
    results,
    boardEvents: results.map(result => ({
      type: "CARD_HEALED",
      playerId: source.card.controllerPlayerId,
      sourceCardInstanceId: source.card.instanceId,
      sourceCardId: source.card.cardId,
      sourceEffectId: effect.id,
      actionType: effect.actionType,
      reason: "TURN_TRIGGER_HEAL",
      cardInstanceId: result.creatureInstanceId,
      targetCardInstanceId: result.creatureInstanceId,
      amount: result.healAmount,
      healType: effect.actionType
    }))
  });

  return true;
}

function returnLinkedLimitedSummonsToHand(
  state: MatchState,
  source: ActiveTurnEffectSource,
  effect: WardEngineEffect,
  addEvent: AddEventFn
): boolean {
  const returned = [];

  for (const player of state.players) {
    for (let index = player.field.limitedSummons.length - 1; index >= 0; index -= 1) {
      const card = player.field.limitedSummons[index];
      if (card.anchorSourceInstanceId !== source.card.instanceId) continue;

      player.field.limitedSummons.splice(index, 1);
      moveAttachedMagicCardsToCemeteryForCreature(state, card.instanceId, addEvent);
      const definition = getCardDefinition(state, card);
      const owner = getPlayer(state, card.ownerPlayerId);

      card.zone = "HAND";
      card.controllerPlayerId = owner.id;
      card.isLimitedSummon = false;
      card.effectsSuppressed = false;
      card.anchorSourceInstanceId = undefined;
      card.attachedToInstanceId = undefined;
      if (definition.cardType === "CREATURE") {
        card.baseHp = definition.hp;
        card.currentHp = definition.hp;
      }
      card.activeStatModifiers = [];
      card.activeStatuses = [];
      card.activeRecurringEffects = [];
      card.activeEffectInstances = [];

      owner.hand.push(card);
      returned.push({
        cardInstanceId: card.instanceId,
        cardName: definition.name,
        fieldOwnerPlayerId: player.id,
        ownerPlayerId: owner.id
      });
    }
  }

  if (returned.length === 0) return false;

  addEvent(state, "TURN_TRIGGER_LINKED_LIMITED_SUMMON_RETURNED", source.card.controllerPlayerId, {
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: source.definition.name,
    sourceEffectId: effect.id,
    actionType: effect.actionType,
    returned,
    boardEvents: returned.map(item => ({
      type: "CARD_RETURNED_TO_HAND",
      playerId: source.card.controllerPlayerId,
      sourceCardInstanceId: source.card.instanceId,
      sourceCardId: source.card.cardId,
      sourceEffectId: effect.id,
      actionType: effect.actionType,
      reason: "SOURCE_LINKED_RETURN_TO_HAND",
      cardInstanceId: item.cardInstanceId,
      fromZoneRef: { playerId: item.fieldOwnerPlayerId, zone: "LIMITED_SUMMON" },
      toZoneRef: { playerId: item.ownerPlayerId, zone: "HAND" }
    }))
  });

  return true;
}

function sourceMagicSlotFieldOwner(state: MatchState, source: ActiveTurnEffectSource): string | undefined {
  return state.players.find(player =>
    player.field.magicSlots.some(card => card.instanceId === source.card.instanceId)
  )?.id;
}

function destroySourceMagic(
  state: MatchState,
  source: ActiveTurnEffectSource,
  effect: WardEngineEffect,
  reason: string,
  addEvent: AddEventFn
): boolean {
  const fieldOwnerPlayerId = sourceMagicSlotFieldOwner(state, source);
  if (!fieldOwnerPlayerId) return false;

  const result = moveMagicSlotCardToCemetery(state, fieldOwnerPlayerId, source.card.instanceId, addEvent, reason);

  addEvent(state, "TURN_TRIGGER_SOURCE_MAGIC_DESTROYED", source.card.controllerPlayerId, {
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: source.definition.name,
    sourceEffectId: effect.id,
    actionType: effect.actionType,
    reason,
    destroyedCardInstanceId: result.magicCard.instanceId,
    destroyedCardName: result.destroyedCardName,
    fieldOwnerPlayerId: result.fieldOwnerPlayerId,
    cardOwnerPlayerId: result.cardOwnerPlayerId
  });

  return true;
}

function attachedCreatureDealtDamageThisTurn(state: MatchState, source: ActiveTurnEffectSource): boolean {
  const attachedToInstanceId = source.card.attachedToInstanceId;
  if (!attachedToInstanceId) return false;

  const turnOwnerPlayerId = sourceTurnOwnerPlayerId(source);
  const turnStartSequence = [...state.eventLog].reverse().find(event =>
    event.type === "TURN_STARTED" && event.playerId === turnOwnerPlayerId
  )?.sequenceNumber ?? 0;

  return state.eventLog.some(event => {
    if (event.sequenceNumber <= turnStartSequence) return false;
    if (event.type !== "BATTLE_DAMAGE_PIPELINE_RESOLVED") return false;
    const payload = event.payload as {
      attackerCreatureInstanceId?: unknown;
      finalDamage?: unknown;
    } | undefined;

    return payload?.attackerCreatureInstanceId === attachedToInstanceId &&
      Number(payload.finalDamage ?? 0) > 0;
  });
}

function resolveFieldRollOutcome(
  state: MatchState,
  source: ActiveTurnEffectSource,
  effect: WardEngineEffect,
  triggerPlayerId: string,
  addEvent: AddEventFn
): boolean {
  const opponent = opponentOf(state, triggerPlayerId);
  if (!opponent) return false;

  const roll = rollD6WithDev(state, {
    kind: "EFFECT_ROLL",
    count: 1,
    playerId: opponent.id,
    label: `${source.definition.name} ${effect.id} field roll`,
    addEvent,
    context: {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: source.definition.name,
      effectId: effect.id,
      actionType: effect.actionType
    }
  })[0];

  if (roll <= 3) {
    const target = primaryCreatureLocation(opponent, state);
    if (!target) return false;
    const result = applyDamageToCreatureTarget(state, targetOptionFromLocation(target), 10);
    addEvent(state, "TURN_TRIGGER_FIELD_ROLL_DAMAGE_RESOLVED", source.card.controllerPlayerId, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: source.definition.name,
      sourceEffectId: effect.id,
      actionType: effect.actionType,
      roll,
      targetPlayerId: opponent.id,
      targetCreatureInstanceId: result.creature.instanceId,
      targetCreatureName: result.creatureName,
      damageAmount: result.damageAmount,
      remainingHp: result.remainingHp,
      killed: result.killed
    });
    return true;
  }

  return destroySourceMagic(state, source, effect, "FIELD_ROLL_DESTROY_SELF", addEvent);
}

function sendAttachedCreatureAndSourceToCemetery(
  state: MatchState,
  source: ActiveTurnEffectSource,
  effect: WardEngineEffect,
  addEvent: AddEventFn
): boolean {
  const attached = sourceAttachedCreature(state, source);
  if (!attached) return false;

  const result = moveFieldCreatureToCemetery(state, {
    fieldOwnerPlayerId: attached.player.id,
    creatureInstanceId: attached.card.instanceId,
    removedFromZone: attached.targetKind,
    causedByPlayerId: source.card.controllerPlayerId,
    reason: "TURN_TRIGGER_ATTACHED_CREATURE_TO_CEMETERY",
    requirePrimaryReplacement: attached.targetKind === "PRIMARY_CREATURE",
    autoPromoteSingleLimitedSummon: true,
    addEvent
  });

  addEvent(state, "TURN_TRIGGER_ATTACHED_CREATURE_SENT_TO_CEMETERY", source.card.controllerPlayerId, {
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: source.definition.name,
    sourceEffectId: effect.id,
    actionType: effect.actionType,
    targetCreatureInstanceId: result.creature.instanceId,
    targetCreatureName: result.creatureName,
    removedFromZone: result.removedFromZone
  });

  return true;
}

function applyNoBattleNextTurnModifiers(
  state: MatchState,
  source: ActiveTurnEffectSource,
  effect: WardEngineEffect,
  endingPlayerId: string,
  addEvent: AddEventFn
): boolean {
  if (source.card.controllerPlayerId !== endingPlayerId) return false;

  const usedCreatureIds = source.player.turnFlags.battleUsedCreatureInstanceIds ?? [];
  if (usedCreatureIds.includes(source.card.instanceId)) {
    addEvent(state, "NO_BATTLE_DELAYED_MODIFIER_NOT_APPLIED", endingPlayerId, {
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: source.definition.name,
      sourceEffectId: effect.id,
      actionType: effect.actionType,
      reason: "Source creature battled this turn."
    });
    return true;
  }

  const statChanges = effect.params?.statChanges ?? [];
  if (statChanges.length === 0) return false;

  const expiresAtPlayerTurnStartCount = (state.turn.turnStartCountsByPlayer[endingPlayerId] ?? 0) + 2;
  source.card.activeStatModifiers ??= [];
  source.card.activeStatModifiers = source.card.activeStatModifiers.filter(modifier =>
    !(modifier.sourceCardInstanceId === source.card.instanceId && modifier.sourceEffectId === effect.id)
  );

  let appliedCount = 0;
  const applied = [];
  for (const change of statChanges) {
    const stat = normalizeStatKey(change.stat);
    const delta = statDeltaFromChange(change);
    if (!stat || delta === undefined) continue;

    const modifierId = uuidv4();
    source.card.activeStatModifiers.push({
      id: modifierId,
      sourceEffectId: effect.id,
      sourceCardInstanceId: source.card.instanceId,
      sourceCardName: source.definition.name,
      stat,
      delta,
      durationType: "TARGET_PLAYER_TURN_STARTS",
      appliedTurnNumber: state.turn.turnNumber,
      appliedTurnCycle: state.turn.turnCycleNumber,
      expiresOnPlayerId: endingPlayerId,
      expiresAtPlayerTurnStartCount
    });
    appliedCount++;
    applied.push({ modifierId, stat, delta });
  }

  addEvent(state, "NO_BATTLE_DELAYED_MODIFIER_APPLIED", endingPlayerId, {
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: source.definition.name,
    sourceEffectId: effect.id,
    actionType: effect.actionType,
    appliedCount,
    expiresOnPlayerId: endingPlayerId,
    expiresAtPlayerTurnStartCount,
    applied,
    note: "Creature did not battle this turn; next-turn dice/stat modifier is now visible in effective stats."
  });

  return appliedCount > 0;
}

function resolveTurnEffect(
  state: MatchState,
  source: ActiveTurnEffectSource,
  effect: WardEngineEffect,
  triggerPlayerId: string,
  multiplier: number,
  addEvent: AddEventFn
): void {
  const actionType = normalize(effect.actionType);

  if (
    actionType === "DEAL_DAMAGE_ON_DRAW" ||
    actionType === "APPLY_START_TURN_HP_LOSS" ||
    actionType === "DAMAGE" ||
    actionType === "DEAL_INSTANT_DAMAGE" ||
    actionType === "DAMAGE_CREATURE"
  ) {
    if (!applyDamageEffect(state, source, effect, triggerPlayerId, multiplier, addEvent)) {
      queueManualTurnEffect(state, source, effect, source.card.controllerPlayerId, "No automated damage target was available for this turn trigger.", addEvent);
    }
    return;
  }

  if (actionType === "HEAL" || actionType === "HEAL_CREATURE") {
    if (!applyHealEffect(state, source, effect, triggerPlayerId, multiplier, addEvent)) {
      queueManualTurnEffect(state, source, effect, source.card.controllerPlayerId, "No automated heal target was available for this turn trigger.", addEvent);
    }
    return;
  }

  if (actionType === "SCHEDULE_RETURN_TO_HAND") {
    if (!returnLinkedLimitedSummonsToHand(state, source, effect, addEvent)) {
      addEvent(state, "TURN_TRIGGER_NO_LINKED_SUMMONS_TO_RETURN", source.card.controllerPlayerId, {
        sourceCardInstanceId: source.card.instanceId,
        sourceCardName: source.definition.name,
        sourceEffectId: effect.id,
        actionType: effect.actionType
      });
    }
    return;
  }

  if (actionType === "DESTROY_IF_NO_DAMAGE_THIS_TURN") {
    if (!attachedCreatureDealtDamageThisTurn(state, source)) {
      destroySourceMagic(state, source, effect, "DESTROY_IF_NO_DAMAGE_THIS_TURN", addEvent);
    }
    return;
  }

  if (actionType === "RESOLVE_FIELD_ROLL_OUTCOME") {
    if (!resolveFieldRollOutcome(state, source, effect, triggerPlayerId, addEvent)) {
      queueManualTurnEffect(state, source, effect, source.card.controllerPlayerId, "Field roll outcome could not be fully automated.", addEvent);
    }
    return;
  }

  if (actionType === "SEND_TO_CEMETERY") {
    if (!sendAttachedCreatureAndSourceToCemetery(state, source, effect, addEvent)) {
      destroySourceMagic(state, source, effect, "TURN_TRIGGER_SEND_SOURCE_TO_CEMETERY", addEvent);
    }
    return;
  }

  if (actionType === "ROLL_TABLE" || actionType === "ROLL_DAMAGE_TABLE" || actionType === "MANUAL_FALLBACK") {
    queueManualTurnEffect(state, source, effect, source.card.controllerPlayerId, "Resolve this turn-triggered effect manually.", addEvent);
    return;
  }

  addEvent(state, "TURN_TRIGGER_EFFECT_NOT_AUTOMATED", source.card.controllerPlayerId, {
    sourceCardInstanceId: source.card.instanceId,
    sourceCardName: source.definition.name,
    sourceEffectId: effect.id,
    actionType: effect.actionType,
    trigger: effect.trigger,
    note: "The trigger fired, but this action type needs a dedicated resolver."
  });
}

export function processDrawTriggeredEffects(
  state: MatchState,
  args: {
    drawingPlayerId: string;
    drawnCount: number;
    addEvent: AddEventFn;
  }
): void {
  if (args.drawnCount <= 0) return;

  for (const source of collectActiveTurnEffectSources(state)) {
    if (source.card.controllerPlayerId === args.drawingPlayerId) continue;

    for (const effect of getCardEngineEffects(source.definition)) {
      const trigger = normalize(effect.trigger);
      if (trigger !== "ON_OPPONENT_DRAW_CARD" && trigger !== "WHEN_OPPONENT_DRAWS_CARD") continue;

      resolveTurnEffect(state, source, effect, args.drawingPlayerId, args.drawnCount, args.addEvent);
    }
  }
}

export function processTurnStartTriggeredEffects(
  state: MatchState,
  activePlayerId: string,
  addEvent: AddEventFn
): void {
  for (const source of collectActiveTurnEffectSources(state)) {
    const turnOwnerPlayerId = sourceTurnOwnerPlayerId(source);

    for (const effect of getCardEngineEffects(source.definition)) {
      const trigger = normalize(effect.trigger);
      if (
        trigger !== "BEGINNING_OF_EACH_PLAYER_TURN" &&
        trigger !== "BEGINNING_OF_YOUR_TURN" &&
        trigger !== "AT_BEGINNING_OF_YOUR_TURN" &&
        trigger !== "AT_BEGINNING_OF_AFFECTED_PLAYER_TURN"
      ) {
        continue;
      }

      if (
        trigger !== "BEGINNING_OF_EACH_PLAYER_TURN" &&
        trigger !== "AT_BEGINNING_OF_AFFECTED_PLAYER_TURN" &&
        turnOwnerPlayerId !== activePlayerId
      ) {
        continue;
      }

      if (trigger === "AT_BEGINNING_OF_AFFECTED_PLAYER_TURN") {
        const attached = sourceAttachedCreature(state, source);
        if (!attached || attached.player.id !== activePlayerId) continue;
      }

      resolveTurnEffect(state, source, effect, activePlayerId, 1, addEvent);
    }
  }
}

export function processTurnEndTriggeredEffects(
  state: MatchState,
  endingPlayerId: string,
  addEvent: AddEventFn
): void {
  for (const source of collectActiveTurnEffectSources(state)) {
    const turnOwnerPlayerId = sourceTurnOwnerPlayerId(source);
    if (turnOwnerPlayerId !== endingPlayerId) continue;

    for (const effect of getCardEngineEffects(source.definition)) {
      const trigger = normalize(effect.trigger);
      if (
        trigger !== "END_OF_YOUR_TURN" &&
        trigger !== "AT_END_OF_YOUR_TURN" &&
        trigger !== "AT_END_OF_YOUR_TURN_FIELD" &&
        trigger !== "IF_NO_BATTLE_DURING_YOUR_TURN"
      ) {
        continue;
      }

      if (trigger === "IF_NO_BATTLE_DURING_YOUR_TURN") {
        applyNoBattleNextTurnModifiers(state, source, effect, endingPlayerId, addEvent);
        continue;
      }

      resolveTurnEffect(state, source, effect, endingPlayerId, 1, addEvent);
    }
  }
}
