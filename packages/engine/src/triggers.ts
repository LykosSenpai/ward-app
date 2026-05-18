import type { BoardZoneRef, CardInstance, ManualBattleStrike, MatchState, PendingBattleSession, WardEngineEffect } from "@ward/shared";
import { calculateCemeteryCreatureHp } from "./cemetery.js";
import { getCardDefinition, getPlayer, type AddEventFn } from "./engineRuntime.js";
import { getCardEngineEffects } from "./effectResolver.js";
import { areCreatureEffectsSuppressed } from "./creatureEffectSuppression.js";
import { moveAttachedMagicCardsToCemeteryForCreature } from "./attachments.js";
import { removeSourceLinkedRuntimeEffectsFromSource } from "./activeEffectInstances.js";
import { markPrimaryReplacementRequired } from "./replacementRequirements.js";

export type RemovedFromFieldTriggerResult = {
  linkedDestroyedCreatures: Array<{
    creature: CardInstance;
    creatureName: string;
    fieldOwnerPlayerId: string;
    ownerPlayerId: string;
  }>;
  sourceLinkedRuntimeEffectRemovalCount: number;
};

function boardZoneRef(playerId: string | undefined, zone: BoardZoneRef["zone"]): BoardZoneRef {
  return {
    ...(playerId ? { playerId } : {}),
    zone
  };
}

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

function destroyCreaturesAnchoredToCard(
  state: MatchState,
  sourceCardInstanceId: string,
  addEvent?: AddEventFn
): RemovedFromFieldTriggerResult["linkedDestroyedCreatures"] {
  const destroyed: RemovedFromFieldTriggerResult["linkedDestroyedCreatures"] = [];

  for (const fieldOwner of state.players) {
    for (let index = fieldOwner.field.limitedSummons.length - 1; index >= 0; index--) {
      const creature = fieldOwner.field.limitedSummons[index];

      if (creature.anchorSourceInstanceId !== sourceCardInstanceId) {
        continue;
      }

      fieldOwner.field.limitedSummons.splice(index, 1);

      const definition = getCardDefinition(state, creature);
      const ownerPlayer = getPlayer(state, creature.ownerPlayerId);

      creature.zone = "CEMETERY";
      creature.currentHp = 0;
      creature.anchorSourceInstanceId = undefined;

      ownerPlayer.cemetery.push(creature);
      ownerPlayer.cemeteryCreatureHpTotal = calculateCemeteryCreatureHp(ownerPlayer);

      moveAttachedMagicCardsToCemeteryForCreature(
        state,
        creature.instanceId,
        addEvent
      );

      const record = {
        creature,
        creatureName: definition.name,
        fieldOwnerPlayerId: fieldOwner.id,
        ownerPlayerId: ownerPlayer.id
      };

      destroyed.push(record);

      addEvent?.(state, "LINKED_LIMITED_SUMMON_DESTROYED", fieldOwner.id, {
        cardInstanceId: creature.instanceId,
        creatureInstanceId: creature.instanceId,
        creatureName: definition.name,
        sourceCardInstanceId,
        actionType: "DESTROY_LINKED_SUMMONED_CREATURE",
        reason: "ANCHOR_CLEANUP",
        fieldOwnerPlayerId: fieldOwner.id,
        ownerPlayerId: ownerPlayer.id,
        fromZoneRef: boardZoneRef(fieldOwner.id, "LIMITED_SUMMON"),
        toZoneRef: boardZoneRef(ownerPlayer.id, "CEMETERY"),
        phase: state.turn.phase,
        turnNumber: state.turn.turnNumber,
        turnCycleNumber: state.turn.turnCycleNumber,
        boardEvents: [
          {
            type: "SOURCE_LINK_CLEANUP_TRIGGERED",
            playerId: fieldOwner.id,
            sourceCardInstanceId,
            actionType: "APPLY_SOURCE_LINKED_CLEANUP",
            reason: "ANCHOR_CLEANUP",
            cardInstanceId: creature.instanceId,
            targetCardInstanceId: creature.instanceId,
            ...timingBoardEventFields(state)
          },
          {
            type: "CARD_DESTROYED",
            playerId: fieldOwner.id,
            sourceCardInstanceId,
            actionType: "DESTROY_LINKED_SUMMONED_CREATURE",
            reason: "ANCHOR_CLEANUP",
            cardInstanceId: creature.instanceId,
            fromZoneRef: boardZoneRef(fieldOwner.id, "LIMITED_SUMMON"),
            toZoneRef: boardZoneRef(ownerPlayer.id, "CEMETERY"),
            ...timingBoardEventFields(state)
          }
        ]
      });
    }
  }

  for (const fieldOwner of state.players) {
    const primary = fieldOwner.field.primaryCreature;

    if (!primary || primary.anchorSourceInstanceId !== sourceCardInstanceId) {
      continue;
    }

    fieldOwner.field.primaryCreature = undefined;

    const definition = getCardDefinition(state, primary);
    const ownerPlayer = getPlayer(state, primary.ownerPlayerId);

    primary.zone = "CEMETERY";
    primary.currentHp = 0;
    primary.anchorSourceInstanceId = undefined;
    primary.attachedToInstanceId = undefined;
    primary.isLimitedSummon = false;
    primary.effectsSuppressed = false;

    ownerPlayer.cemetery.push(primary);
    ownerPlayer.cemeteryCreatureHpTotal = calculateCemeteryCreatureHp(ownerPlayer);

    moveAttachedMagicCardsToCemeteryForCreature(
      state,
      primary.instanceId,
      addEvent
    );

    markPrimaryReplacementRequired(state, fieldOwner.id);

    const record = {
      creature: primary,
      creatureName: definition.name,
      fieldOwnerPlayerId: fieldOwner.id,
      ownerPlayerId: ownerPlayer.id
    };

    destroyed.push(record);

    addEvent?.(state, "LINKED_PRIMARY_ANCHORED_CREATURE_RETURNED_TO_CEMETERY", fieldOwner.id, {
      cardInstanceId: primary.instanceId,
      creatureInstanceId: primary.instanceId,
      creatureName: definition.name,
      sourceCardInstanceId,
      actionType: "DESTROY_LINKED_SUMMONED_CREATURE",
      reason: "ANCHOR_CLEANUP",
      fieldOwnerPlayerId: fieldOwner.id,
      ownerPlayerId: ownerPlayer.id,
      fromZoneRef: boardZoneRef(fieldOwner.id, "PRIMARY_CREATURE"),
      toZoneRef: boardZoneRef(ownerPlayer.id, "CEMETERY"),
      phase: state.turn.phase,
      turnNumber: state.turn.turnNumber,
      turnCycleNumber: state.turn.turnCycleNumber,
      boardEvents: [
        {
          type: "SOURCE_LINK_CLEANUP_TRIGGERED",
          playerId: fieldOwner.id,
          sourceCardInstanceId,
          actionType: "APPLY_SOURCE_LINKED_CLEANUP",
          reason: "ANCHOR_CLEANUP",
          cardInstanceId: primary.instanceId,
          targetCardInstanceId: primary.instanceId,
          ...timingBoardEventFields(state)
        },
        {
          type: "CARD_DESTROYED",
          playerId: fieldOwner.id,
          sourceCardInstanceId,
          actionType: "DESTROY_LINKED_SUMMONED_CREATURE",
          reason: "ANCHOR_CLEANUP",
          cardInstanceId: primary.instanceId,
          fromZoneRef: boardZoneRef(fieldOwner.id, "PRIMARY_CREATURE"),
          toZoneRef: boardZoneRef(ownerPlayer.id, "CEMETERY"),
          ...timingBoardEventFields(state)
        }
      ]
    });
  }

  return destroyed;
}

export function runCardRemovedFromFieldTriggers(
  state: MatchState,
  args: {
    removedCard: CardInstance;
    removedCardName: string;
    removedFromZone: "MAGIC_SLOT" | "PRIMARY_CREATURE" | "LIMITED_SUMMON";
    causedByPlayerId?: string;
    reason?: string;
    addEvent?: AddEventFn;
  }
): RemovedFromFieldTriggerResult {
  const sourceLinkedRuntimeEffectRemovalCount = removeSourceLinkedRuntimeEffectsFromSource(state, {
    sourceCardInstanceId: args.removedCard.instanceId,
    sourceCardId: args.removedCard.cardId,
    sourceCardName: args.removedCardName,
    sourceDefinition: state.cardCatalog[args.removedCard.cardId],
    causedByPlayerId: args.causedByPlayerId,
    reason: args.reason ?? "CARD_REMOVED_FROM_FIELD",
    addEvent: args.addEvent
  });

  const linkedDestroyedCreatures = destroyCreaturesAnchoredToCard(
    state,
    args.removedCard.instanceId,
    args.addEvent
  );

  if (linkedDestroyedCreatures.length > 0) {
    args.addEvent?.(state, "ON_CARD_REMOVED_FROM_FIELD_TRIGGER_RESOLVED", args.causedByPlayerId, {
      removedCardInstanceId: args.removedCard.instanceId,
      removedCardName: args.removedCardName,
      removedFromZone: args.removedFromZone,
      reason: args.reason,
      linkedDestroyedCreatures: linkedDestroyedCreatures.map(item => ({
        creatureInstanceId: item.creature.instanceId,
        creatureName: item.creatureName,
        fieldOwnerPlayerId: item.fieldOwnerPlayerId,
        ownerPlayerId: item.ownerPlayerId
      }))
    });
  }

  return { linkedDestroyedCreatures, sourceLinkedRuntimeEffectRemovalCount };
}

export function returnLinkedSummonsForInvalidatedSource(
  state: MatchState,
  args: {
    sourceCardInstanceId: string;
    sourceCardName: string;
    causedByPlayerId?: string;
    reason: string;
    addEvent?: AddEventFn;
  }
): RemovedFromFieldTriggerResult {
  const sourceLinkedRuntimeEffectRemovalCount = removeSourceLinkedRuntimeEffectsFromSource(state, {
    sourceCardInstanceId: args.sourceCardInstanceId,
    sourceCardName: args.sourceCardName,
    causedByPlayerId: args.causedByPlayerId,
    reason: args.reason,
    addEvent: args.addEvent
  });

  const linkedDestroyedCreatures = destroyCreaturesAnchoredToCard(
    state,
    args.sourceCardInstanceId,
    args.addEvent
  );

  if (linkedDestroyedCreatures.length > 0) {
    args.addEvent?.(state, "SOURCE_LINKED_SUMMONS_RETURNED_TO_CEMETERY", args.causedByPlayerId, {
      sourceCardInstanceId: args.sourceCardInstanceId,
      sourceCardName: args.sourceCardName,
      actionType: "APPLY_SOURCE_LINKED_CLEANUP",
      reason: args.reason,
      phase: state.turn.phase,
      turnNumber: state.turn.turnNumber,
      turnCycleNumber: state.turn.turnCycleNumber,
      linkedDestroyedCreatures: linkedDestroyedCreatures.map(item => ({
        creatureInstanceId: item.creature.instanceId,
        creatureName: item.creatureName,
        fieldOwnerPlayerId: item.fieldOwnerPlayerId,
        ownerPlayerId: item.ownerPlayerId
      })),
      boardEvents: linkedDestroyedCreatures.map(item => ({
        type: "SOURCE_LINK_CLEANUP_TRIGGERED",
        playerId: args.causedByPlayerId,
        sourceCardInstanceId: args.sourceCardInstanceId,
        actionType: "APPLY_SOURCE_LINKED_CLEANUP",
        reason: args.reason,
        cardInstanceId: item.creature.instanceId,
        targetCardInstanceId: item.creature.instanceId,
        ...timingBoardEventFields(state)
      }))
    });
  }

  return { linkedDestroyedCreatures, sourceLinkedRuntimeEffectRemovalCount };
}

export type BattleTimingTrigger =
  | "WHEN_BATTLE_DECLARED"
  | "BEFORE_SPEED_CHECK"
  | "BEFORE_HIT_ROLL"
  | "AFTER_HIT_ROLL"
  | "ON_HIT"
  | "ON_HIT_FIRST"
  | "ON_MISS"
  | "BEFORE_DAMAGE_ROLL"
  | "DURING_DAMAGE_CALC"
  | "AFTER_DAMAGE_APPLIED"
  | "WHEN_CREATURE_KILLED_IN_BATTLE"
  | "END_OF_COMBAT_PHASE";

type ActiveBattleTriggerSource = {
  card: CardInstance;
  cardName: string;
  playerId: string;
  zone: string;
};

const TRIGGER_ALIASES: Record<BattleTimingTrigger, string[]> = {
  WHEN_BATTLE_DECLARED: [
    "WHEN_BATTLE_DECLARED",
    "WHEN_OPPONENT_DECLARES_BATTLE",
    "PRIOR_TO_BATTLE",
    "DURING_BATTLE"
  ],
  BEFORE_SPEED_CHECK: [
    "BEFORE_SPEED_CHECK",
    "APPLY_ATTACK_PRIORITY_OVERRIDE",
    "CHANGE_BATTLE_ORDER",
    "PRIOR_TO_EACH_BATTLE",
    "PRIOR_TO_EACH_BATTLE_WITH_THIS_CREATURE"
  ],
  BEFORE_HIT_ROLL: ["BEFORE_HIT_ROLL", "DURING_HIT_ROLL"],
  AFTER_HIT_ROLL: ["AFTER_HIT_ROLL"],
  ON_HIT: ["ON_HIT", "WHEN_OPPONENT_LANDS_HIT", "ON_OPPONENT_LANDS_HIT", "ON_HIT_FROM_HAND"],
  ON_HIT_FIRST: ["ON_HIT_FIRST"],
  ON_MISS: ["ON_MISS"],
  BEFORE_DAMAGE_ROLL: ["BEFORE_DAMAGE_ROLL"],
  DURING_DAMAGE_CALC: [
    "DURING_DAMAGE_CALC",
    "DURING_DAMAGE_CALC_OR_STATIC",
    "DAMAGE_CALC_ON_THIS_CARD",
    "WHEN_CHOSEN_BATTLE_DAMAGE_WOULD_OCCUR"
  ],
  AFTER_DAMAGE_APPLIED: ["AFTER_DAMAGE_APPLIED", "ON_EQUIPPED_CREATURE_DAMAGED", "ON_EQUIPPED_CREATURE_DAMAGED_IN_BATTLE"],
  WHEN_CREATURE_KILLED_IN_BATTLE: [
    "WHEN_CREATURE_KILLED_IN_BATTLE",
    "WHEN_THIS_CREATURE_KILLED",
    "IF_KILLED_IN_BATTLE",
    "IF_EQUIPPED_CREATURE_KILLED"
  ],
  END_OF_COMBAT_PHASE: ["END_OF_COMBAT_PHASE", "AT_END_OF_BATTLE"]
};

function collectActiveBattleTriggerSources(state: MatchState): ActiveBattleTriggerSource[] {
  const sources: ActiveBattleTriggerSource[] = [];

  for (const player of state.players) {
    const add = (card: CardInstance | undefined, zone: string) => {
      if (!card) return;
      const definition = state.cardCatalog[card.cardId];
      if (!definition) return;
      if (definition.cardType === "CREATURE" && areCreatureEffectsSuppressed(state, card)) return;

      sources.push({
        card,
        cardName: definition.name,
        playerId: player.id,
        zone
      });
    };

    add(player.field.primaryCreature, "PRIMARY_CREATURE");

    for (const limited of player.field.limitedSummons) add(limited, "LIMITED_SUMMON");
    for (const magic of player.field.magicSlots) add(magic, "MAGIC_SLOT");
  }

  return sources;
}

function effectMatchesTiming(effect: WardEngineEffect, timing: BattleTimingTrigger): boolean {
  const trigger = (effect.trigger ?? "").trim().toUpperCase();
  const actionType = effect.actionType.trim().toUpperCase();
  const aliases = TRIGGER_ALIASES[timing];

  return aliases.includes(trigger) || aliases.includes(actionType);
}

function sourceIsInvolvedInStrike(
  source: ActiveBattleTriggerSource,
  strike?: ManualBattleStrike
): boolean {
  if (!strike) return true;

  if (
    source.card.instanceId === strike.attacker.creatureInstanceId ||
    source.card.instanceId === strike.defender.creatureInstanceId
  ) {
    return true;
  }

  if (
    source.card.attachedToInstanceId === strike.attacker.creatureInstanceId ||
    source.card.attachedToInstanceId === strike.defender.creatureInstanceId
  ) {
    return true;
  }

  // Field and static effects can still be relevant even when their source is not one of the two creatures.
  return source.zone === "MAGIC_SLOT" || source.playerId === strike.attacker.playerId || source.playerId === strike.defender.playerId;
}

export function runBattleTimingTriggers(
  state: MatchState,
  args: {
    timing: BattleTimingTrigger;
    battleSession: PendingBattleSession;
    strike?: ManualBattleStrike;
    addEvent?: AddEventFn;
  }
): void {
  const triggeredEffects: Array<{
    sourceCardInstanceId: string;
    sourceCardName: string;
    sourcePlayerId: string;
    sourceZone: string;
    effectId: string;
    trigger?: string;
    actionType: string;
    actionText?: string;
    value?: string;
  }> = [];

  for (const source of collectActiveBattleTriggerSources(state)) {
    if (!sourceIsInvolvedInStrike(source, args.strike)) continue;

    const definition = state.cardCatalog[source.card.cardId];
    const effects = getCardEngineEffects(definition);

    for (const effect of effects) {
      if (!effectMatchesTiming(effect, args.timing)) continue;

      triggeredEffects.push({
        sourceCardInstanceId: source.card.instanceId,
        sourceCardName: source.cardName,
        sourcePlayerId: source.playerId,
        sourceZone: source.zone,
        effectId: effect.id,
        trigger: effect.trigger,
        actionType: effect.actionType,
        actionText: effect.actionText,
        value: effect.value
      });
    }
  }

  if (triggeredEffects.length === 0) return;

  args.addEvent?.(state, "BATTLE_TIMING_TRIGGER_DETECTED", args.strike?.attacker.playerId ?? args.battleSession.attackingPlayerId, {
    battleSessionId: args.battleSession.id,
    timing: args.timing,
    strikeId: args.strike?.id,
    attackerCreatureName: args.strike?.attacker.creatureName,
    defenderCreatureName: args.strike?.defender.creatureName,
    effects: triggeredEffects
  });
}
