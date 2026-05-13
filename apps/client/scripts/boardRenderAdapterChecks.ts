import assert from "node:assert/strict";
import type { AppMatchState } from "../src/clientTypes";
import { buildBoardInteractionContext, buildBoardRenderModel, translateGameEventsToBoardRenderEvents } from "../src/components/boardRenderAdapter";
import { createBoardAnimationQueueState, enqueueBoardRenderEvents, settleActiveBoardAnimation, startNextBoardAnimation } from "../src/components/boardAnimationQueue";
import { resetBoardAnimationQueueToSequence } from "../src/components/boardAnimationQueue";
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
assert.equal(events[0].type, "CARD_MOVED_ZONE");
assert.equal(events[0].visualTargets.slotIds[0], "player_1-magic-1");
assert.equal(events[0].visualTargets.cardInstanceIds[0], "c-7");
assert.deepEqual(translateGameEventsToBoardRenderEvents(mockMatch), events);

const interaction = buildBoardInteractionContext(mockMatch);
assert.equal(interaction.activePlayerId, "player_1");
assert.equal(interaction.actions.some(action => action.kind === "DRAW" && action.enabled), true);

let queueState = createBoardAnimationQueueState();
queueState = enqueueBoardRenderEvents(queueState, events);
queueState = startNextBoardAnimation(queueState);
assert.equal(queueState.activeEvent?.eventId, events[0].eventId);
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
