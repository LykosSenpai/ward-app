import { areCreatureEffectsSuppressed } from "./creatureEffectSuppression.js";
import type {
  BoardEventType,
  CardDefinition,
  CardInstance,
  MatchState,
  PlayerState,
  StatModifierKey,
  WardEngineEffect,
  WardEffectStatChange
} from "@ward/shared";
import { getCardEngineEffects } from "./effectResolver.js";
import { addEvent } from "./engineRuntime.js";
import { applyBaseStatModifierLayers, collectRuntimeModifierLayers } from "./modifierLayers.js";

export type EffectiveCreatureStats = {
  name: string;
  armorLevel: number;
  speed: number;
  hp: number;
  attackDice: number;
  modifier: number;
};

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
  sourceEffectId?: string;
  actionType?: string;
  reason?: string;
  targetCardInstanceId?: string;
  phase?: MatchState["turn"]["phase"];
  turnNumber?: number;
  turnCycleNumber?: number;
  status?: string;
  statusLabel?: string;
  stat?: string;
  delta?: number;
  modifierId?: string;
};

function timingBoardEventFields(state: MatchState): {
  phase: MatchState["turn"]["phase"];
  turnNumber: number;
  turnCycleNumber: number;
} {
  return {
    phase: state.turn.phase,
    turnNumber: state.turn.turnNumber,
    turnCycleNumber: state.turn.turnCycleNumber
  };
}

type CreatureDefinition = Extract<CardDefinition, { cardType: "CREATURE" }>;
type FieldSource = {
  player: PlayerState;
  card: CardInstance;
  definition: CardDefinition;
  zone: "PRIMARY_CREATURE" | "LIMITED_SUMMON" | "MAGIC_SLOT";
};

type CreatureLocation = {
  player: PlayerState;
  card: CardInstance;
  definition: CreatureDefinition;
  zone: "PRIMARY_CREATURE" | "LIMITED_SUMMON";
};

function getCreatureDefinition(
  state: MatchState,
  card: CardInstance
): CreatureDefinition {
  const definition = state.cardCatalog[card.cardId];

  if (!definition) {
    throw new Error(`Card definition not found: ${card.cardId}`);
  }

  if (definition.cardType !== "CREATURE") {
    throw new Error(`${definition.name} is not a creature.`);
  }

  return definition;
}

function normalizeStatName(stat: string): StatModifierKey | "hitFlat" | "attackFlat" | "hitDice" | undefined {
  const value = stat.trim().toUpperCase().replace(/[\s-]+/g, "_");

  if (["AL", "ARMOR", "ARMOR_LEVEL"].includes(value)) return "armorLevel";
  if (["SPD", "SPEED"].includes(value)) return "speed";
  if (["ATK_DICE_ROLLS", "ATTACK_DICE_ROLLS", "ATK_DICE", "ATTACK_DICE"].includes(value)) return "attackDice";
  if (["MOD", "MODIFIER"].includes(value)) return "modifier";
  if (["HIT", "HIT_BONUS"].includes(value)) return "hitFlat";
  if (["ATK", "ATK_BONUS", "ATTACK", "ATTACK_BONUS", "ATK_DAMAGE", "ATTACK_DAMAGE", "ATK_DAMAGE_BONUS", "ATTACK_DAMAGE_BONUS", "DAMAGE_BONUS"].includes(value)) return "attackFlat";
  if (["HIT_DICE", "HIT_DICE_ROLLS"].includes(value)) return "hitDice";

  return undefined;
}

function getDeltaFromChange(change: WardEffectStatChange): number | undefined {
  if (!Number.isFinite(change.value)) return undefined;
  const operation = change.operation.trim().toUpperCase();
  if (operation === "ADD") return Number(change.value);
  if (operation === "SUBTRACT") return -Number(change.value);
  return undefined;
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
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isStaticStatEffect(effect: WardEngineEffect): boolean {
  const trigger = (effect.trigger ?? "").trim().toUpperCase();
  const actionType = effect.actionType.trim().toUpperCase();

  if (effect.params?.statChanges?.length) {
    return [
      "WHILE_EQUIPPED",
      "STATIC_WHILE_EQUIPPED",
      "WHILE_FIELD_ACTIVE",
      "STATIC_WHILE_ON_FIELD",
      "WHILE_ON_FIELD",
      "ON_SUMMON",
      "ON_EQUIP",
      "ON_EQUIP_OR_PLAY",
      "DURING_DAMAGE_CALC_OR_STATIC",
      "DURING_DAMAGE_CALC_OR_WHILE_IN_HAND_COUNT"
    ].includes(trigger);
  }

  return actionType === "APPLY_STAT_SET_AURA" ||
    actionType === "APPLY_STAT_MODIFIER" ||
    actionType === "APPLY_DYNAMIC_STAT_MODIFIER" ||
    actionType === "APPLY_SCALING_MODIFIER_FROM_ZONE_COUNT";
}

function collectSources(state: MatchState): FieldSource[] {
  const sources: FieldSource[] = [];

  for (const player of state.players) {
    const add = (card: CardInstance | undefined, zone: FieldSource["zone"]) => {
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

function getCreatureLocation(state: MatchState, card: CardInstance): CreatureLocation | undefined {
  for (const player of state.players) {
    if (player.field.primaryCreature?.instanceId === card.instanceId) {
      return { player, card: player.field.primaryCreature, definition: getCreatureDefinition(state, card), zone: "PRIMARY_CREATURE" };
    }

    for (const limited of player.field.limitedSummons) {
      if (limited.instanceId === card.instanceId) {
        return { player, card: limited, definition: getCreatureDefinition(state, card), zone: "LIMITED_SUMMON" };
      }
    }
  }

  return undefined;
}

function isNonEffectCreature(definition: CreatureDefinition): boolean {
  return !definition.effects || definition.effects.length === 0;
}

function effectAppliesToCreature(source: FieldSource, effect: WardEngineEffect, target: CreatureLocation): boolean {
  const text = effectText(effect);
  const actionType = effect.actionType.trim().toUpperCase();

  if (source.card.attachedToInstanceId) {
    return source.card.attachedToInstanceId === target.card.instanceId;
  }

  if (text.includes("equipped creature")) {
    return source.card.attachedToInstanceId === target.card.instanceId;
  }

  if (
    actionType === "APPLY_SOURCE_LINKED_STAT_SET_AURA" &&
    (text.includes("opponent") || text.includes("opposing"))
  ) {
    return source.player.id !== target.player.id;
  }

  if (text.includes("opponents' creatures") || text.includes("opponent's creatures")) {
    return source.player.id !== target.player.id;
  }

  if (text.includes("this creature") || text.includes("this card")) {
    return source.card.instanceId === target.card.instanceId;
  }

  if (text.includes("your primary creature")) {
    return source.player.id === target.player.id && target.zone === "PRIMARY_CREATURE";
  }

  if (text.includes("your creature") || text.includes("you control")) {
    return source.player.id === target.player.id;
  }

  if (text.includes("opponent") || text.includes("opposing")) {
    return source.player.id !== target.player.id;
  }

  if (text.includes("all creatures") || text.includes("each creature") || text.includes("both creatures")) {
    return true;
  }

  if (text.includes("non-effect creature") || text.includes("non effect creature")) {
    return isNonEffectCreature(target.definition);
  }

  if (source.card.instanceId === target.card.instanceId) {
    return true;
  }

  return false;
}

function applyStaticStatChanges(
  state: MatchState,
  target: CreatureLocation,
  totals: Record<StatModifierKey, number>
): void {
  for (const source of collectSources(state)) {
    const effects = getCardEngineEffects(source.definition).filter(isStaticStatEffect);

    for (const effect of effects) {
      if (!effectAppliesToCreature(source, effect, target)) continue;

      for (const change of effect.params?.statChanges ?? []) {
        const stat = normalizeStatName(change.stat);
        const delta = getDeltaFromChange(change);
        if (!stat || delta === undefined) continue;

        // Hit and Atk flat bonuses are battle-roll modifiers, not base creature stats.
        if (stat === "hitFlat" || stat === "attackFlat" || stat === "hitDice") continue;

        totals[stat] += delta;
      }
    }
  }
}

function staticSetOverride(
  state: MatchState,
  target: CreatureLocation,
  stat: StatModifierKey,
  currentValue: number
): number {
  let result = currentValue;

  for (const source of collectSources(state)) {
    const effects = getCardEngineEffects(source.definition);

    for (const effect of effects) {
      if (!effectAppliesToCreature(source, effect, target)) continue;
      const text = effectText(effect);
      const actionType = effect.actionType.trim().toUpperCase();

      if (
        (actionType === "APPLY_STAT_SET_AURA" || text.includes("reduced to 1")) &&
        (stat === "armorLevel" || stat === "speed") &&
        (text.includes("al") || text.includes("armor") || text.includes("spd") || text.includes("speed"))
      ) {
        result = Math.min(result, 1);
      }

      if (
        (actionType === "APPLY_STAT_SET_AURA" || text.includes("to 0")) &&
        stat === "modifier" &&
        text.includes("modifier")
      ) {
        result = 0;
      }
    }
  }

  return result;
}

export function getEffectiveCreatureStats(
  state: MatchState,
  card: CardInstance
): EffectiveCreatureStats {
  const definition = getCreatureDefinition(state, card);
  const location = getCreatureLocation(state, card);

  const modifiers = card.activeStatModifiers ?? [];

  const totals: Record<StatModifierKey, number> = {
    armorLevel: 0,
    speed: 0,
    attackDice: 0,
    modifier: 0
  };

  const countedPermanentModifiers = new Set<string>();

  for (const modifier of modifiers) {
    if (modifier.durationType === "PERMANENT_UNTIL_SOURCE_REMOVED") {
      const key = [
        modifier.sourceCardInstanceId,
        modifier.sourceEffectId,
        modifier.stat
      ].join(":");

      if (countedPermanentModifiers.has(key)) {
        continue;
      }

      countedPermanentModifiers.add(key);
    }

    totals[modifier.stat] += modifier.delta;
  }

  let armorLevel = definition.armorLevel + totals.armorLevel;
  let speed = definition.speed + totals.speed;
  let attackDice = definition.attackDice + totals.attackDice;
  let modifier = definition.modifier + totals.modifier;

  if (location) {
    const layers = collectRuntimeModifierLayers(state, location);
    armorLevel = applyBaseStatModifierLayers(armorLevel, "armorLevel", layers);
    speed = applyBaseStatModifierLayers(speed, "speed", layers);
    attackDice = applyBaseStatModifierLayers(attackDice, "attackDice", layers);
    modifier = applyBaseStatModifierLayers(modifier, "modifier", layers);
  }

  return {
    name: definition.name,
    armorLevel: Math.min(12, Math.max(1, armorLevel)),
    speed: Math.max(0, speed),
    hp: definition.hp,
    attackDice: Math.max(1, attackDice),
    modifier
  };
}

function moveDurationExpiredSourceMagicToCemetery(
  state: MatchState,
  targetCard: CardInstance,
  instance: NonNullable<CardInstance["activeEffectInstances"]>[number],
  expiredOnPlayerId: string
): boolean {
  if (!instance.sourceCardInstanceId) return false;

  for (const fieldOwner of state.players) {
    const magicSlotIndex = fieldOwner.field.magicSlots.findIndex(card => card.instanceId === instance.sourceCardInstanceId);
    if (magicSlotIndex === -1) continue;

    const sourceMagic = fieldOwner.field.magicSlots[magicSlotIndex];
    const sourceDefinition = state.cardCatalog[sourceMagic.cardId];

    if (sourceDefinition?.cardType !== "MAGIC") return false;
    if (sourceMagic.attachedToInstanceId && sourceMagic.attachedToInstanceId !== targetCard.instanceId) return false;

    fieldOwner.field.magicSlots.splice(magicSlotIndex, 1);
    sourceMagic.zone = "CEMETERY";
    sourceMagic.attachedToInstanceId = undefined;

    const ownerPlayer = state.players.find(player => player.id === sourceMagic.ownerPlayerId) ?? fieldOwner;
    ownerPlayer.cemetery.push(sourceMagic);

    removeStatModifiersFromSourceCard(state, sourceMagic.instanceId);

    addEvent(state, "DURATION_LIMITED_MAGIC_EXPIRED", instance.sourcePlayerId, {
      sourceCardInstanceId: sourceMagic.instanceId,
      sourceCardName: sourceDefinition.name,
      sourceEffectId: instance.sourceEffectId,
      targetCardInstanceId: targetCard.instanceId,
      targetCardName: instance.targetCardName,
      expiredOnPlayerId,
      expiresAtPlayerTurnStartCount: instance.expiresAtPlayerTurnStartCount,
      phase: state.turn.phase,
      turnNumber: state.turn.turnNumber,
      turnCycleNumber: state.turn.turnCycleNumber,
      boardEvents: [
        {
          type: "SCHEDULED_EFFECT_RESOLVED",
          playerId: instance.sourcePlayerId,
          sourceCardInstanceId: sourceMagic.instanceId,
          sourceEffectId: instance.sourceEffectId,
          actionType: instance.actionType,
          reason: "DURATION_EXPIRED",
          cardInstanceId: targetCard.instanceId,
          targetCardInstanceId: targetCard.instanceId,
          statusLabel: instance.label,
          ...timingBoardEventFields(state)
        } satisfies BoardEventPayload,
        {
          type: "CARD_SENT_TO_CEMETERY",
          playerId: instance.sourcePlayerId,
          sourceCardInstanceId: sourceMagic.instanceId,
          sourceEffectId: instance.sourceEffectId,
          actionType: instance.actionType,
          reason: "DURATION_EXPIRED",
          cardInstanceId: sourceMagic.instanceId,
          targetCardInstanceId: targetCard.instanceId,
          ...timingBoardEventFields(state)
        } satisfies BoardEventPayload
      ]
    });

    return true;
  }

  return false;
}

function pruneOrphanStatusActiveEffectInstances(card: CardInstance): void {
  if (!card.activeEffectInstances) return;

  const activeStatusIds = new Set((card.activeStatuses ?? []).map(status => status.id));
  card.activeEffectInstances = card.activeEffectInstances.filter(instance =>
    instance.kind !== "STATUS" || activeStatusIds.has(instance.id)
  );
}

function removeExpiredFromCard(state: MatchState, card: CardInstance, playerId: string, currentTurnStartCount: number, addBoardEvent?: AddEventFn): void {
  if (card.activeStatModifiers) {
    const removed = card.activeStatModifiers.filter(modifier => {
      if (modifier.durationType !== "TARGET_PLAYER_TURN_STARTS") return false;
      if (modifier.expiresOnPlayerId !== playerId) return false;
      return (modifier.expiresAtPlayerTurnStartCount ?? Number.POSITIVE_INFINITY) <= currentTurnStartCount;
    });
    card.activeStatModifiers = card.activeStatModifiers.filter(modifier => !removed.includes(modifier));
    for (const modifier of removed) {
      addBoardEvent?.(state, "STAT_MODIFIER_EXPIRED", modifier.sourceCardInstanceId, {
        sourceCardInstanceId: modifier.sourceCardInstanceId,
        sourceCardName: modifier.sourceCardName,
        sourceEffectId: modifier.sourceEffectId,
        targetCardInstanceId: card.instanceId,
        stat: modifier.stat,
        delta: modifier.delta,
        modifierId: modifier.id,
        expiredOnPlayerId: playerId,
        phase: state.turn.phase,
        turnNumber: state.turn.turnNumber,
        turnCycleNumber: state.turn.turnCycleNumber,
        boardEvents: [
          {
            type: "SCHEDULED_EFFECT_RESOLVED",
            playerId,
            sourceCardInstanceId: modifier.sourceCardInstanceId,
            sourceEffectId: modifier.sourceEffectId,
            actionType: "APPLY_STAT_MODIFIER",
            reason: "DURATION_EXPIRED",
            cardInstanceId: card.instanceId,
            targetCardInstanceId: card.instanceId,
            stat: modifier.stat,
            delta: modifier.delta,
            modifierId: modifier.id,
            ...timingBoardEventFields(state)
          } satisfies BoardEventPayload,
          {
            type: "STAT_MODIFIER_REMOVED",
            playerId,
            sourceCardInstanceId: modifier.sourceCardInstanceId,
            sourceEffectId: modifier.sourceEffectId,
            actionType: "APPLY_STAT_MODIFIER",
            reason: "DURATION_EXPIRED",
            cardInstanceId: card.instanceId,
            targetCardInstanceId: card.instanceId,
            stat: modifier.stat,
            delta: modifier.delta,
            modifierId: modifier.id,
            ...timingBoardEventFields(state)
          } satisfies BoardEventPayload
        ]
      });
    }
  }

  if (card.activeStatuses) {
    const removed = card.activeStatuses.filter(status => {
      if (status.durationType !== "TARGET_PLAYER_TURN_STARTS") return false;
      if (status.expiresOnPlayerId !== playerId) return false;
      return (status.expiresAtPlayerTurnStartCount ?? Number.POSITIVE_INFINITY) <= currentTurnStartCount;
    });
    card.activeStatuses = card.activeStatuses.filter(status => {
      if (status.durationType !== "TARGET_PLAYER_TURN_STARTS") return true;
      if (status.expiresOnPlayerId !== playerId) return true;
      return (status.expiresAtPlayerTurnStartCount ?? Number.POSITIVE_INFINITY) > currentTurnStartCount;
    });
    for (const status of removed) {
      addBoardEvent?.(state, "STATUS_EXPIRED", status.sourcePlayerId, {
        sourceCardInstanceId: status.sourceCardInstanceId,
        sourceCardName: status.sourceCardName,
        sourceEffectId: status.sourceEffectId,
        targetCardInstanceId: card.instanceId,
        status: status.status,
        label: status.label,
        expiredOnPlayerId: playerId,
        phase: state.turn.phase,
        turnNumber: state.turn.turnNumber,
        turnCycleNumber: state.turn.turnCycleNumber,
        boardEvents: [
          {
            type: "SCHEDULED_EFFECT_RESOLVED",
            playerId: status.sourcePlayerId,
            sourceCardInstanceId: status.sourceCardInstanceId,
            sourceEffectId: status.sourceEffectId,
            actionType: "APPLY_STATUS",
            reason: "DURATION_EXPIRED",
            cardInstanceId: card.instanceId,
            targetCardInstanceId: card.instanceId,
            status: status.status,
            statusLabel: status.label,
            ...timingBoardEventFields(state)
          } satisfies BoardEventPayload,
          {
            type: "STATUS_REMOVED",
            playerId: status.sourcePlayerId,
            sourceCardInstanceId: status.sourceCardInstanceId,
            sourceEffectId: status.sourceEffectId,
            actionType: "APPLY_STATUS",
            reason: "DURATION_EXPIRED",
            cardInstanceId: card.instanceId,
            targetCardInstanceId: card.instanceId,
            status: status.status,
            statusLabel: status.label,
            ...timingBoardEventFields(state)
          } satisfies BoardEventPayload
        ]
      });
    }
  }

  if (card.activeRecurringEffects) {
    // DOT/HOT-style recurring effects are controlled by remainingTicks and tick
    // at the start of the source player's Combat Phase. Do not remove them at
    // turn start before the Combat Phase tick gets a chance to resolve.
    card.activeRecurringEffects = card.activeRecurringEffects.filter(effect => effect.remainingTicks > 0);
  }

  if (card.activeEffectInstances) {
    card.activeEffectInstances = card.activeEffectInstances.filter(instance => {
      if (instance.ticksRemaining !== undefined) {
        return instance.ticksRemaining > 0;
      }
      if (instance.durationType !== "TARGET_PLAYER_TURN_STARTS") return true;
      if (instance.expiresOnPlayerId !== playerId) return true;

      const stillActive = (instance.expiresAtPlayerTurnStartCount ?? Number.POSITIVE_INFINITY) > currentTurnStartCount;
      if (!stillActive) {
        const movedSourceMagic = moveDurationExpiredSourceMagicToCemetery(state, card, instance, playerId);
        if (!movedSourceMagic) {
          addBoardEvent?.(state, "ACTIVE_EFFECT_INSTANCE_EXPIRED", instance.sourcePlayerId, {
            playerId: instance.sourcePlayerId,
            sourceCardInstanceId: instance.sourceCardInstanceId,
            sourceCardName: instance.sourceCardName,
            sourceEffectId: instance.sourceEffectId,
            actionType: instance.actionType,
            targetCardInstanceId: card.instanceId,
            targetCardName: instance.targetCardName,
            expiredOnPlayerId: playerId,
            expiresAtPlayerTurnStartCount: instance.expiresAtPlayerTurnStartCount,
            phase: state.turn.phase,
            turnNumber: state.turn.turnNumber,
            turnCycleNumber: state.turn.turnCycleNumber,
            boardEvents: [
              {
                type: "SCHEDULED_EFFECT_RESOLVED",
                playerId: instance.sourcePlayerId,
                sourceCardInstanceId: instance.sourceCardInstanceId,
                sourceEffectId: instance.sourceEffectId,
                actionType: instance.actionType,
                reason: "DURATION_EXPIRED",
                cardInstanceId: card.instanceId,
                targetCardInstanceId: card.instanceId,
                status: instance.status ?? instance.effectType,
                statusLabel: instance.label,
                ...timingBoardEventFields(state)
              } satisfies BoardEventPayload
            ]
          });
        }
      }

      return stillActive;
    });
  }

  pruneOrphanStatusActiveEffectInstances(card);
}

export function removeExpiredStatModifiersForPlayerTurnStart(
  state: MatchState,
  playerId: string,
  addBoardEvent?: AddEventFn
): MatchState {
  const currentTurnStartCount = state.turn.turnStartCountsByPlayer[playerId] ?? 0;

  for (const player of state.players) {
    if (player.field.primaryCreature) {
      removeExpiredFromCard(state, player.field.primaryCreature, playerId, currentTurnStartCount, addBoardEvent);
    }

    for (const limited of player.field.limitedSummons) {
      removeExpiredFromCard(state, limited, playerId, currentTurnStartCount, addBoardEvent);
    }
  }

  return state;
}

function removeRuntimeEffectsFromCard(card: CardInstance, sourceCardInstanceId: string): void {
  if (card.activeStatModifiers) {
    card.activeStatModifiers = card.activeStatModifiers.filter(
      modifier => modifier.sourceCardInstanceId !== sourceCardInstanceId
    );
  }

  if (card.activeStatuses) {
    card.activeStatuses = card.activeStatuses.filter(
      status => status.sourceCardInstanceId !== sourceCardInstanceId
    );
  }

  if (card.activeRecurringEffects) {
    card.activeRecurringEffects = card.activeRecurringEffects.filter(
      effect => effect.sourceCardInstanceId !== sourceCardInstanceId
    );
  }

  if (card.activeEffectInstances) {
    card.activeEffectInstances = card.activeEffectInstances.filter(
      effect => effect.sourceCardInstanceId !== sourceCardInstanceId
    );
  }
}

export function removeStatModifiersFromSourceCard(
  state: MatchState,
  sourceCardInstanceId: string
): MatchState {
  for (const player of state.players) {
    if (player.field.primaryCreature) {
      removeRuntimeEffectsFromCard(player.field.primaryCreature, sourceCardInstanceId);
    }

    for (const limited of player.field.limitedSummons) {
      removeRuntimeEffectsFromCard(limited, sourceCardInstanceId);
    }
  }

  return state;
}
