import assert from "node:assert/strict";
import type { AppMatchState } from "../src/clientTypes";
import { buildBoardInteractionContext, buildBoardRenderModel, translateGameEventsToBoardRenderEvents } from "../src/components/boardRenderAdapter";
import { createBoardAnimationQueueState, enqueueBoardRenderEvents, settleActiveBoardAnimation, startNextBoardAnimation } from "../src/components/boardAnimationQueue";
import { resetBoardAnimationQueueToSequence } from "../src/components/boardAnimationQueue";
import { planBoardAnimationSteps } from "../src/components/boardAnimationPlanner";
import { getBoardAnimationProfile } from "../src/components/boardAnimationProfiles";
import { decideBoardReconciliation } from "../src/components/boardRenderReconciliation";
import { resolveBoardRuntimeMode } from "../src/components/boardRuntimeHealth";
import { mapPointerGestureToIntent } from "../src/components/boardInteractionIntents";
import { resolveBoardIntentCommand } from "../src/components/boardIntentCommands";
import { buildHandPlacementAffordances, buildPendingEffectTargetAffordances } from "../src/components/boardAffordances";

const mockMatch = {
  matchId: "m1",
  turn: { activePlayerId: "player_1", phase: "DRAW", turnNumber: 1, turnCycleNumber: 1 },
  players: [
    {
      id: "player_1",
      field: { primaryCreature: null, limitedSummons: [], magicSlots: [null, null, null, null, null] },
      turnFlags: { drawnThisTurn: false, battleUsedCreatureInstanceIds: [] }
    },
    {
      id: "player_2",
      field: { primaryCreature: null, limitedSummons: [], magicSlots: [null, null, null, null, null] },
      turnFlags: { drawnThisTurn: false, battleUsedCreatureInstanceIds: [] }
    }
  ],
  setup: { handDiscardRequiredForPlayerId: null },
  pendingPrompt: null,
  pendingChain: null,
  pendingEffectTargetPrompt: null,
  pendingBattle: null,
  manualEffectQueue: [],
  eventLog: [{ sequenceNumber: 7, type: "DRAW_CARD", payload: { playerId: "player_1", cardInstanceId: "c-7", toSlotId: "player_1-magic-1" } }]
} as unknown as AppMatchState;

const model = buildBoardRenderModel(mockMatch);
assert.equal(model.matchId, "m1");
assert.equal(model.sequenceNumber, 7);

const events = translateGameEventsToBoardRenderEvents(mockMatch);
assert.equal(events.length, 1);
assert.equal(events[0].type, "CARD_DRAWN");
assert.equal(events[0].cardInstanceId, "c-7");
assert.deepEqual(events[0].fromZoneRef, { playerId: "player_1", zone: "DECK" });
assert.deepEqual(events[0].toZoneRef, { playerId: "player_1", zone: "HAND" });
assert.equal(events[0].visualTargets.slotIds[0], "player_1-magic-1");
assert.equal(events[0].visualTargets.cardInstanceIds[0], "c-7");
assert.deepEqual(translateGameEventsToBoardRenderEvents(mockMatch), events);

const semanticEventMatch = {
  ...mockMatch,
  eventLog: [
    {
      sequenceNumber: 8,
      type: "AUTO_EFFECT_DESTROY_MAGIC_CARD_RESOLVED",
      playerId: "player_1",
      payload: {
        promptId: "prompt-destroy",
        effectId: "effect-destroy",
        actionType: "DESTROY_MAGIC",
        destroyedCardInstanceId: "magic-destroyed",
        fieldOwnerPlayerId: "player_2",
        cardOwnerPlayerId: "player_2"
      }
    },
    {
      sequenceNumber: 9,
      type: "AUTO_EFFECT_LIMITED_SUMMON_RESOLVED",
      playerId: "player_1",
      payload: {
        promptId: "prompt-summon",
        effectId: "effect-summon",
        actionType: "SUMMON_LIMITED_CREATURE_FROM_CEMETERY",
        summonedCardInstanceId: "limited-1",
        sourcePlayerId: "player_1",
        sourceZone: "CEMETERY",
        controllerPlayerId: "player_1"
      }
    },
    {
      sequenceNumber: 10,
      type: "EQUIP_MAGIC_ATTACHED",
      playerId: "player_1",
      payload: {
        magicCardInstanceId: "equip-1",
        targetPlayerId: "player_1",
        targetCreatureInstanceId: "creature-1"
      }
    },
    {
      sequenceNumber: 11,
      type: "EFFECT_PROGRAM_TARGET_PROMPT_RESOLVED",
      playerId: "player_1",
      payload: {
        promptId: "prompt-resolved",
        effectId: "effect-resolved",
        actionType: "DAMAGE",
        targetCreatureInstanceId: "target-1"
      }
    },
    {
      sequenceNumber: 12,
      type: "MAGIC_CHAIN_RESOLVED",
      playerId: "player_1",
      payload: { chainId: "chain-1" }
    }
  ]
} as unknown as AppMatchState;

const semanticEvents = translateGameEventsToBoardRenderEvents(semanticEventMatch);
assert.equal(semanticEvents[0].type, "CARD_DESTROYED");
assert.equal(semanticEvents[0].cardInstanceId, "magic-destroyed");
assert.deepEqual(semanticEvents[0].fromZoneRef, { playerId: "player_2", zone: "MAGIC_SLOT" });
assert.deepEqual(semanticEvents[0].toZoneRef, { playerId: "player_2", zone: "CEMETERY" });
assert.equal(semanticEvents[1].type, "CREATURE_SUMMONED_LIMITED");
assert.deepEqual(semanticEvents[1].fromZoneRef, { playerId: "player_1", zone: "CEMETERY" });
assert.deepEqual(semanticEvents[1].toZoneRef, { playerId: "player_1", zone: "LIMITED_SUMMON" });
assert.equal(semanticEvents[2].type, "MAGIC_ATTACHED");
assert.equal(semanticEvents[2].cardInstanceId, "equip-1");
assert.equal(semanticEvents[2].targetCardInstanceId, "creature-1");
assert.equal(semanticEvents[3].type, "PROMPT_RESOLVED");
assert.equal(semanticEvents[3].promptId, "prompt-resolved");
assert.equal(semanticEvents[4].type, "CHAIN_RESOLVED");

const structuredBoardEventMatch = {
  ...mockMatch,
  eventLog: [
    {
      sequenceNumber: 16,
      type: "AUTO_EFFECT_LIMITED_SUMMON_AND_EQUIP_RESOLVED",
      playerId: "player_1",
      payload: {
        promptId: "prompt-equip",
        sourceCardInstanceId: "helping-hand",
        sourceEffectId: "effect-equip",
        actionType: "SUMMON_LIMITED_CREATURE_AND_EQUIP",
        boardEvents: [
          {
            type: "CREATURE_SUMMONED_LIMITED",
            cardInstanceId: "limited-helped",
            sourceCardInstanceId: "helping-hand",
            sourceEffectId: "effect-equip",
            actionType: "SUMMON_LIMITED_CREATURE_AND_EQUIP",
            reason: "LIMITED_SUMMON_AND_EQUIP",
            fromZoneRef: { playerId: "player_1", zone: "CEMETERY" },
            toZoneRef: { playerId: "player_1", zone: "LIMITED_SUMMON" }
          },
          {
            type: "MAGIC_ATTACHED",
            cardInstanceId: "helping-hand",
            sourceCardInstanceId: "helping-hand",
            sourceEffectId: "effect-equip",
            actionType: "SUMMON_LIMITED_CREATURE_AND_EQUIP",
            reason: "SOURCE_MAGIC_ATTACHED",
            fromZoneRef: { playerId: "player_1", zone: "CHAIN" },
            toZoneRef: { playerId: "player_1", zone: "ATTACHED_UNDER" },
            targetCardInstanceId: "limited-helped"
          },
          {
            type: "ANCHOR_LINK_CREATED",
            cardInstanceId: "limited-helped",
            sourceCardInstanceId: "helping-hand",
            sourceEffectId: "effect-equip",
            actionType: "SUMMON_LIMITED_CREATURE_AND_EQUIP",
            reason: "SOURCE_LINK_CREATED",
            targetCardInstanceId: "limited-helped"
          }
        ]
      }
    },
    {
      sequenceNumber: 17,
      type: "SOURCE_LINKED_SUMMONS_RETURNED_TO_CEMETERY",
      playerId: "player_1",
      payload: {
        sourceCardInstanceId: "helping-hand",
        actionType: "APPLY_SOURCE_LINKED_CLEANUP",
        reason: "ANCHOR_CLEANUP",
        boardEvents: [
          {
            type: "SOURCE_LINK_CLEANUP_TRIGGERED",
            cardInstanceId: "limited-helped",
            targetCardInstanceId: "limited-helped",
            sourceCardInstanceId: "helping-hand",
            actionType: "APPLY_SOURCE_LINKED_CLEANUP",
            reason: "ANCHOR_CLEANUP"
          },
          {
            type: "CARD_DESTROYED",
            cardInstanceId: "limited-helped",
            sourceCardInstanceId: "helping-hand",
            actionType: "DESTROY_LINKED_SUMMONED_CREATURE",
            reason: "ANCHOR_CLEANUP",
            fromZoneRef: { playerId: "player_1", zone: "LIMITED_SUMMON" },
            toZoneRef: { playerId: "player_1", zone: "CEMETERY" }
          }
        ]
      }
    },
    {
      sequenceNumber: 18,
      type: "AUTO_EFFECT_SEARCH_DECK_TO_HAND_RESOLVED",
      playerId: "player_1",
      payload: {
        boardEvents: [
          {
            type: "CARD_MOVED",
            cardInstanceId: "dragon-found",
            sourceCardInstanceId: "dragon-tamer",
            sourceEffectId: "effect-search",
            actionType: "SEARCH_DECK_TO_HAND",
            reason: "SEARCH_DECK_TO_HAND",
            fromZoneRef: { playerId: "player_1", zone: "DECK" },
            toZoneRef: { playerId: "player_1", zone: "HAND" }
          }
        ]
      }
    }
  ]
} as unknown as AppMatchState;

const structuredBoardEvents = translateGameEventsToBoardRenderEvents(structuredBoardEventMatch);
assert.equal(structuredBoardEvents.length, 6);
assert.equal(structuredBoardEvents[0].type, "CREATURE_SUMMONED_LIMITED");
assert.equal(structuredBoardEvents[1].type, "MAGIC_ATTACHED");
assert.equal(structuredBoardEvents[2].type, "ANCHOR_LINK_CREATED");
assert.equal(structuredBoardEvents[3].type, "SOURCE_LINK_CLEANUP_TRIGGERED");
assert.equal(structuredBoardEvents[4].type, "CARD_DESTROYED");
assert.equal(structuredBoardEvents[5].type, "CARD_MOVED");
assert.deepEqual(structuredBoardEvents[5].fromZoneRef, { playerId: "player_1", zone: "DECK" });
assert.deepEqual(structuredBoardEvents[5].toZoneRef, { playerId: "player_1", zone: "HAND" });

const anchorSteps = planBoardAnimationSteps(structuredBoardEvents[2]);
assert.equal(anchorSteps.some(step => step.type === "GLOW_CARD" && step.cardInstanceId === "helping-hand"), true);
assert.equal(anchorSteps.some(step => step.type === "GLOW_CARD" && step.cardInstanceId === "limited-helped"), true);

const cleanupSteps = planBoardAnimationSteps(structuredBoardEvents[3]);
assert.equal(cleanupSteps.some(step => step.type === "GLOW_CARD" && step.cardInstanceId === "limited-helped" && step.glowKind === "DAMAGE"), true);
assert.equal(cleanupSteps.some(step => step.type === "SHOW_STATUS_CHIP" && step.label === "Source cleanup"), true);

const destroySteps = planBoardAnimationSteps(semanticEvents[0]);
assert.equal(destroySteps.some(step => step.type === "GLOW_CARD" && step.cardInstanceId === "magic-destroyed" && step.glowKind === "DAMAGE"), true);
assert.equal(destroySteps.some(step => step.type === "DESTROY_CARD" && step.cardInstanceId === "magic-destroyed"), true);
assert.equal(destroySteps.some(step => step.type === "MOVE_CARD" && step.cardInstanceId === "magic-destroyed" && step.toZoneRef.zone === "CEMETERY"), true);

const summonSteps = planBoardAnimationSteps(semanticEvents[1]);
assert.deepEqual(
  summonSteps.find(step => step.type === "MOVE_CARD"),
  {
    type: "MOVE_CARD",
    cardInstanceId: "limited-1",
    toZoneRef: { playerId: "player_1", zone: "LIMITED_SUMMON" },
    durationMs: getBoardAnimationProfile("CREATURE_SUMMONED_LIMITED").durationMs
  }
);
assert.equal(summonSteps.some(step => step.type === "GLOW_ZONE" && step.zoneRef.zone === "LIMITED_SUMMON" && step.glowKind === "VALID_DROP"), true);

const attachSteps = planBoardAnimationSteps(semanticEvents[2]);
assert.deepEqual(
  attachSteps.find(step => step.type === "ATTACH_CARD"),
  {
    type: "ATTACH_CARD",
    attachmentInstanceId: "equip-1",
    targetInstanceId: "creature-1",
    durationMs: getBoardAnimationProfile("MAGIC_ATTACHED").durationMs
  }
);
assert.equal(attachSteps.some(step => step.type === "GLOW_CARD" && step.cardInstanceId === "creature-1"), true);

const damagePromptSteps = planBoardAnimationSteps(semanticEvents[3]);
assert.equal(damagePromptSteps.some(step => step.type === "GLOW_CARD" && step.cardInstanceId === "target-1" && step.glowKind === "DAMAGE"), true);

const chainSteps = planBoardAnimationSteps(semanticEvents[4]);
assert.deepEqual(chainSteps, [{ type: "SHOW_STATUS_CHIP", playerId: "player_1", label: "Chain resolved", durationMs: getBoardAnimationProfile("CHAIN_RESOLVED").durationMs }]);

const battleDamageEvent = translateGameEventsToBoardRenderEvents({
  ...mockMatch,
  eventLog: [
    {
      sequenceNumber: 13,
      type: "BATTLE_DAMAGE_APPLIED",
      playerId: "player_1",
      payload: {
        attackerCreatureInstanceId: "attacker-1",
        targetCreatureInstanceId: "defender-1",
        damageAmount: 12,
        damageRollDice: [4, 8],
        killed: true
      }
    }
  ]
} as unknown as AppMatchState)[0];
const battleDamageSteps = planBoardAnimationSteps(battleDamageEvent);
assert.deepEqual(battleDamageSteps.find(step => step.type === "ROLL_DICE"), {
  type: "ROLL_DICE",
  values: [4, 8],
  rollKind: "BATTLE_DAMAGE",
  durationMs: 700
});
assert.equal(battleDamageSteps.some(step => step.type === "DAMAGE_NUMBER" && step.cardInstanceId === "defender-1" && step.amount === 12), true);
assert.equal(battleDamageSteps.some(step => step.type === "DESTROY_CARD" && step.cardInstanceId === "defender-1"), true);

const healPromptEvent = translateGameEventsToBoardRenderEvents({
  ...mockMatch,
  eventLog: [
    {
      sequenceNumber: 14,
      type: "EFFECT_PROGRAM_TARGET_PROMPT_RESOLVED",
      playerId: "player_1",
      payload: {
        promptId: "prompt-heal",
        actionType: "HEAL_CREATURE",
        targetCreatureInstanceId: "target-heal",
        healAmount: 7
      }
    }
  ]
} as unknown as AppMatchState)[0];
const healPromptSteps = planBoardAnimationSteps(healPromptEvent);
assert.equal(healPromptSteps.some(step => step.type === "GLOW_CARD" && step.cardInstanceId === "target-heal" && step.glowKind === "HEAL"), true);
assert.equal(healPromptSteps.some(step => step.type === "HEAL_NUMBER" && step.cardInstanceId === "target-heal" && step.amount === 7), true);

const promptOpenedEvent = translateGameEventsToBoardRenderEvents({
  ...mockMatch,
  eventLog: [
    {
      sequenceNumber: 15,
      type: "EFFECT_PROGRAM_TARGET_PROMPT_CREATED",
      playerId: "player_1",
      payload: {
        promptId: "prompt-open",
        sourceCardInstanceId: "source-open",
        actionType: "DESTROY_CARD"
      }
    }
  ]
} as unknown as AppMatchState)[0];
const promptOpenedSteps = planBoardAnimationSteps(promptOpenedEvent);
assert.equal(promptOpenedSteps.some(step => step.type === "GLOW_CARD" && step.cardInstanceId === "source-open" && step.glowKind === "TARGET"), true);
assert.equal(promptOpenedSteps.some(step => step.type === "SHOW_STATUS_CHIP" && step.cardInstanceId === "source-open" && step.label === "Prompt"), true);

const interaction = buildBoardInteractionContext(mockMatch);
assert.equal(interaction.activePlayerId, "player_1");
assert.equal(interaction.actions.some(action => action.kind === "DRAW" && action.enabled), true);

let queueState = createBoardAnimationQueueState();
queueState = enqueueBoardRenderEvents(queueState, events);
queueState = startNextBoardAnimation(queueState);
assert.equal(queueState.activeEvent?.eventId, events[0].eventId);
assert.equal(queueState.activeEvent?.usesPlannerOutput, true);
assert.equal(queueState.activeEvent?.animationSteps.some(step => step.type === "MOVE_CARD" && step.cardInstanceId === "c-7"), true);
queueState = settleActiveBoardAnimation(queueState);
assert.equal(queueState.activeEvent, null);
assert.equal(queueState.cursor, events[0].sequenceNumber);
queueState = resetBoardAnimationQueueToSequence(queueState, 0);
assert.equal(queueState.cursor, 0);
assert.equal(queueState.queue.length, 0);

assert.equal(getBoardAnimationProfile("BATTLE_STARTED").durationMs > getBoardAnimationProfile("EFFECT_PROMPT_OPENED").durationMs, true);

const reconciliationA = decideBoardReconciliation({
  previousModel: model,
  nextModel: { ...model, sequenceNumber: model.sequenceNumber + 1 },
  queueCursor: model.sequenceNumber
});
assert.equal(reconciliationA.shouldResetQueue, false);

const reconciliationB = decideBoardReconciliation({
  previousModel: model,
  nextModel: model,
  queueCursor: model.sequenceNumber + 2
});
assert.equal(reconciliationB.shouldResetQueue, true);

assert.equal(resolveBoardRuntimeMode({ queue: queueState, isDocumentHidden: false }), "ANIMATED");
assert.equal(resolveBoardRuntimeMode({ queue: { ...queueState, queue: new Array(20).fill(events[0]) }, isDocumentHidden: false }), "FAST_FORWARD");

const intent = mapPointerGestureToIntent({
  interaction,
  slotId: "player_1-magic-1"
});
assert.equal(intent.kind, "SELECT_SLOT");
const command = resolveBoardIntentCommand(intent, model.boardObjects);
assert.equal(command.kind, "FOCUS_SLOT");

const targetAffordances = buildPendingEffectTargetAffordances({
  id: "prompt-1",
  sourceCardInstanceId: "source-1",
  sourceCardId: "magic-1",
  sourceCardName: "Targeting Magic",
  controllerPlayerId: "player_1",
  effectId: "effect-1",
  actionType: "DESTROY_CARD",
  promptText: "Choose a target.",
  targetKind: "MAGIC_SLOT_CARD",
  options: [
    {
      id: "option-card",
      label: "Opponent magic",
      targetKind: "MAGIC_SLOT_CARD",
      playerId: "player_2",
      cardInstanceId: "target-1",
      cardId: "magic-2",
      cardName: "Opponent Magic",
      zone: "MAGIC_SLOT"
    },
    {
      id: "option-zone",
      label: "Opponent cemetery",
      targetKind: "CARD_IN_CEMETERY",
      playerId: "player_2",
      zone: "CEMETERY"
    }
  ]
});
assert.equal(targetAffordances.length, 2);
assert.equal(targetAffordances[0].kind, "VALID_TARGET_CARD");
assert.equal(targetAffordances[0].highlightStyle, "TARGET");
assert.equal(targetAffordances[0].promptId, "prompt-1");
assert.equal(targetAffordances[0].sourceCardInstanceId, "source-1");
assert.equal(targetAffordances[0].targetCardInstanceId, "target-1");
assert.deepEqual(targetAffordances[0].targetZoneRef, { playerId: "player_2", zone: "MAGIC_SLOT" });
assert.equal(targetAffordances[1].kind, "VALID_TARGET_ZONE");
assert.deepEqual(targetAffordances[1].targetZoneRef, { playerId: "player_2", zone: "CEMETERY" });

const placementMatch = {
  matchId: "m-placement",
  status: "ACTIVE",
  turn: { activePlayerId: "player_1", phase: "SUMMON_MAGIC", turnNumber: 1, turnCycleNumber: 1 },
  players: [
    {
      id: "player_1",
      displayName: "Alice",
      hand: [
        { instanceId: "creature-1", cardId: "creature-low", ownerPlayerId: "player_1", controllerPlayerId: "player_1", zone: "HAND" },
        { instanceId: "magic-1", cardId: "magic-standard", ownerPlayerId: "player_1", controllerPlayerId: "player_1", zone: "HAND" },
        { instanceId: "big-creature-1", cardId: "creature-high", ownerPlayerId: "player_1", controllerPlayerId: "player_1", zone: "HAND" }
      ],
      deck: [],
      cemetery: [],
      cemeteryCreatureHpTotal: 0,
      field: { primaryCreature: null, limitedSummons: [], magicSlots: [] },
      turnFlags: { drawnThisTurn: true, normalSummonUsed: false, battleUsedCreatureInstanceIds: [] }
    },
    {
      id: "player_2",
      displayName: "Bob",
      hand: [],
      deck: [],
      cemetery: [],
      cemeteryCreatureHpTotal: 0,
      field: { primaryCreature: null, limitedSummons: [], magicSlots: [] },
      turnFlags: { drawnThisTurn: true, normalSummonUsed: false, battleUsedCreatureInstanceIds: [] }
    }
  ],
  setup: { handDiscardRequiredForPlayerId: undefined, primaryReplacementRequiredForPlayerId: undefined },
  pendingPrompt: null,
  pendingChain: null,
  pendingEffectTargetPrompt: null,
  pendingBattle: null,
  manualEffectQueue: [],
  eventLog: [],
  cardCatalog: {
    "creature-low": { id: "creature-low", name: "Low Creature", cardType: "CREATURE", armorLevel: 4, speed: 3, attackDice: 1, modifier: 0, hp: 20 },
    "creature-high": { id: "creature-high", name: "High Creature", cardType: "CREATURE", armorLevel: 9, speed: 3, attackDice: 1, modifier: 0, hp: 30 },
    "magic-standard": { id: "magic-standard", name: "Standard Magic", cardType: "MAGIC", magicType: "STANDARD", magicSubType: "SINGLE_USE" }
  }
} as unknown as AppMatchState;

const placementAffordances = buildHandPlacementAffordances({
  match: placementMatch,
  playerId: "player_1",
  selectedHandCardId: "magic-1",
  occupiedMagicSlotIndexes: [0, 2]
});
assert.equal(placementAffordances.some(affordance => affordance.kind === "PLAYABLE_CARD" && affordance.sourceCardInstanceId === "creature-1"), true);
assert.equal(placementAffordances.some(affordance => affordance.kind === "PLAYABLE_CARD" && affordance.sourceCardInstanceId === "magic-1"), true);
assert.equal(placementAffordances.some(affordance => affordance.kind === "VALID_DROP_ZONE" && affordance.sourceCardInstanceId === "creature-1" && affordance.targetZoneRef?.zone === "PRIMARY_CREATURE"), true);
assert.deepEqual(
  placementAffordances
    .filter(affordance => affordance.kind === "VALID_DROP_ZONE" && affordance.sourceCardInstanceId === "magic-1")
    .map(affordance => affordance.targetZoneRef)
    .sort((left, right) => (left?.slotIndex ?? 0) - (right?.slotIndex ?? 0)),
  [
    { playerId: "player_1", zone: "MAGIC_SLOT", slotIndex: 1 },
    { playerId: "player_1", zone: "MAGIC_SLOT", slotIndex: 3 },
    { playerId: "player_1", zone: "MAGIC_SLOT", slotIndex: 4 }
  ]
);
assert.equal(
  placementAffordances.some(affordance =>
    affordance.kind === "DISABLED_ACTION" &&
    affordance.sourceCardInstanceId === "magic-1" &&
    affordance.targetZoneRef?.zone === "MAGIC_SLOT" &&
    affordance.targetZoneRef.slotIndex === 0 &&
    affordance.disabledReason === "That Magic slot is already occupied."
  ),
  true
);

const blockedPlacementAffordances = buildHandPlacementAffordances({
  match: {
    ...placementMatch,
    pendingChain: { id: "chain-1" }
  } as unknown as AppMatchState,
  playerId: "player_1",
  selectedHandCardId: "creature-1"
});
assert.equal(blockedPlacementAffordances.some(affordance =>
  affordance.kind === "DISABLED_ACTION" &&
  affordance.sourceCardInstanceId === "creature-1" &&
  affordance.disabledReason === "Resolve the pending Magic Chain before playing cards."
), true);

console.log("board render adapter checks passed");


function eventTemplate(sequenceNumber: number, type: string, payload: Record<string, unknown>) {
  return { id: `evt-${sequenceNumber}`, sequenceNumber, type, playerId: "player_1", payload } as any;
}

const translationCoverageMatch = {
  ...mockMatch,
  eventLog: [
    eventTemplate(101, "CARD_MOVED", { cardInstanceId: "c1", fromZoneRef: { playerId: "player_1", zone: "HAND" }, toZoneRef: { playerId: "player_1", zone: "MAGIC_SLOT", slotIndex: 0 } }),
    eventTemplate(102, "DRAW_CARD", { cardInstanceId: "c2" }),
    eventTemplate(103, "PRIMARY_CREATURE_PLAYED", { summonedCardInstanceId: "c3", sourcePlayerId: "player_1", cardOwnerPlayerId: "player_1" }),
    eventTemplate(104, "LIMITED_SUMMON_CREATED", { summonedCardInstanceId: "c4", sourcePlayerId: "player_1", cardOwnerPlayerId: "player_1" }),
    eventTemplate(105, "MAGIC_PLAYED_TO_CHAIN", { cardInstanceId: "c5", sourcePlayerId: "player_1", cardOwnerPlayerId: "player_1" }),
    eventTemplate(106, "MAGIC_CHAIN_STARTED", { cardInstanceId: "c6", sourcePlayerId: "player_1", cardOwnerPlayerId: "player_1" }),
    eventTemplate(107, "CHAIN_LINK_RESOLVED", { cardInstanceId: "c7", sourcePlayerId: "player_1", cardOwnerPlayerId: "player_1" }),
    eventTemplate(108, "EQUIP_MAGIC_ATTACHED", { magicCardInstanceId: "c8", targetCreatureInstanceId: "c3", targetPlayerId: "player_1" }),
    eventTemplate(109, "AUTO_EFFECT_DESTROY_MAGIC_CARD_RESOLVED", { destroyedCardInstanceId: "c9", fieldOwnerPlayerId: "player_2", cardOwnerPlayerId: "player_2" }),
    eventTemplate(110, "MANUAL_BATTLE_DECLARED", { attackerCreatureInstanceId: "c3", targetCreatureInstanceId: "d1" }),
    eventTemplate(111, "BATTLE_HIT_ROLLED", { targetCreatureInstanceId: "d1", values: [6], hit: true }),
    eventTemplate(112, "BATTLE_DAMAGE_ROLLED", { targetCreatureInstanceId: "d1", values: [4, 5] }),
    eventTemplate(113, "BATTLE_DAMAGE_APPLIED", { targetCreatureInstanceId: "d1", damageAmount: 9, damageRollDice: [4, 5] }),
    eventTemplate(114, "STATUS_APPLIED", { cardInstanceId: "c3", statusLabel: "Shielded" }),
    eventTemplate(115, "STATUS_REMOVED", { cardInstanceId: "c3", statusLabel: "Shielded", reason: "DURATION_EXPIRED" }),
    eventTemplate(116, "TURN_PHASE_CHANGED", { phase: "COMBAT" })
  ]
} as unknown as AppMatchState;

const translatedCoverage = translateGameEventsToBoardRenderEvents(translationCoverageMatch);
assert.equal(translatedCoverage.length, 16);
const expectedTypes = [
  "CARD_MOVED","CARD_DRAWN","CREATURE_SUMMONED_PRIMARY","CREATURE_SUMMONED_LIMITED","MAGIC_PLAYED_TO_CHAIN","CHAIN_LINK_ADDED","CHAIN_LINK_RESOLVED","MAGIC_ATTACHED","CARD_DESTROYED","BATTLE_STARTED","BATTLE_HIT_ROLLED","BATTLE_DAMAGE_ROLLED","BATTLE_DAMAGE_APPLIED","STATUS_APPLIED","STATUS_REMOVED","TURN_PHASE_CHANGED"
];
for (const t of expectedTypes) {
  const ev = translatedCoverage.find(e => e.type === t);
  assert.ok(ev, `missing translated event type ${t}`);
  const steps = planBoardAnimationSteps(ev!);
  assert.ok(Array.isArray(steps), `planner failed for ${t}`);
}
assert.equal(planBoardAnimationSteps(translatedCoverage.find(e => e.type === "CARD_MOVED")!).some(step => step.type === "MOVE_CARD"), true);
assert.equal(planBoardAnimationSteps(translatedCoverage.find(e => e.type === "MAGIC_PLAYED_TO_CHAIN")!).some(step => step.type === "GLOW_CARD"), true);
assert.equal(planBoardAnimationSteps(translatedCoverage.find(e => e.type === "CHAIN_LINK_RESOLVED")!).some(step => step.type === "SHOW_STATUS_CHIP"), true);
assert.equal(planBoardAnimationSteps(translatedCoverage.find(e => e.type === "MAGIC_ATTACHED")!).some(step => step.type === "ATTACH_CARD"), true);
assert.equal(planBoardAnimationSteps(translatedCoverage.find(e => e.type === "BATTLE_HIT_ROLLED")!).some(step => step.type === "ROLL_DICE"), true);
assert.equal(planBoardAnimationSteps(translatedCoverage.find(e => e.type === "BATTLE_DAMAGE_APPLIED")!).some(step => step.type === "DAMAGE_NUMBER"), true);

let queueRegression = createBoardAnimationQueueState();
const queueEvents = translatedCoverage.slice(0, 3);
queueRegression = enqueueBoardRenderEvents(queueRegression, queueEvents);
const qLen = queueRegression.queue.length;
queueRegression = enqueueBoardRenderEvents(queueRegression, queueEvents);
assert.equal(queueRegression.queue.length, qLen);
queueRegression = startNextBoardAnimation(queueRegression);
queueRegression = settleActiveBoardAnimation(queueRegression);
assert.equal(queueRegression.cursor >= queueEvents[0].sequenceNumber, true);
queueRegression = resetBoardAnimationQueueToSequence(queueRegression, 50);
assert.equal(queueRegression.cursor, 50);
assert.equal(queueRegression.queue.length, 0);
assert.equal(queueRegression.activeEvent, null);

const battlePriorityEvents = translatedCoverage.filter(e => e.type === "BATTLE_DAMAGE_APPLIED" || e.type === "CARD_MOVED");
let priorityState = createBoardAnimationQueueState();
priorityState = enqueueBoardRenderEvents(priorityState, battlePriorityEvents);
assert.equal(priorityState.queue[0].type, "BATTLE_DAMAGE_APPLIED");
