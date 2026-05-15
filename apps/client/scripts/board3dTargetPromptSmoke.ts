import assert from "node:assert/strict";
import type { AppMatchState } from "../src/clientTypes";
import { buildPendingEffectTargetAffordances } from "../src/components/boardAffordances";
import { buildBoardObjects } from "../src/components/boardPreview3dAdapter";
import { buildEffectTargetBoardOptions } from "../src/components/boardTargetPromptMapping";

function createMatch(): AppMatchState {
  return {
    matchId: "target-prompt-smoke",
    status: "IN_PROGRESS",
    turn: { activePlayerId: "player_1", phase: "SUMMON_MAGIC", turnNumber: 2, turnCycleNumber: 2, firstTurnCycleComplete: true },
    players: [
      {
        id: "player_1",
        displayName: "P1",
        hand: [{ instanceId: "p1-hand-1", cardId: "magic-1", ownerPlayerId: "player_1" }],
        deck: [{ instanceId: "p1-deck-1", cardId: "magic-1", ownerPlayerId: "player_1" }],
        cemetery: [{ instanceId: "p1-cem-1", cardId: "magic-1", ownerPlayerId: "player_1" }],
        removedFromGame: [],
        field: {
          primaryCreature: { instanceId: "p1-primary", cardId: "creature-1", ownerPlayerId: "player_1", activeEffectInstances: [] },
          limitedSummons: [{ instanceId: "p1-limited-1", cardId: "creature-1", ownerPlayerId: "player_1", activeEffectInstances: [] }],
          magicSlots: [{ instanceId: "p1-magic-1", cardId: "magic-1", ownerPlayerId: "player_1", activeEffectInstances: [] }, null, null, null, null]
        },
        turnFlags: { drawnThisTurn: true, battleUsedCreatureInstanceIds: [], normalSummonUsed: false }
      },
      {
        id: "player_2",
        displayName: "P2",
        hand: [], deck: [], cemetery: [], removedFromGame: [],
        field: { primaryCreature: null, limitedSummons: [], magicSlots: [null, null, null, null, null] },
        turnFlags: { drawnThisTurn: false, battleUsedCreatureInstanceIds: [], normalSummonUsed: false }
      }
    ],
    cardCatalog: {
      "creature-1": { id: "creature-1", name: "Creature", cardType: "CREATURE", stats: { hp: 10, al: 1, spd: 1, atkDice: 1, mod: 0 } },
      "magic-1": { id: "magic-1", name: "Magic", cardType: "MAGIC", magicType: "NORMAL", magicSubType: "NONE", effects: [] }
    },
    setup: { handDiscardRequiredForPlayerId: null, primaryReplacementRequiredForPlayerId: null },
    settings: { cannotInflictAttackDamageBattlePolicy: "SKIP_BATTLE" },
    pendingPrompt: null,
    pendingChain: null,
    pendingEffectTargetPrompt: null,
    pendingBattle: null,
    pendingEffectRoll: null,
    chainZone: [],
    manualEffectQueue: [],
    devTools: { rolls: { forcedRollQueue: [] } },
    eventLog: []
  } as unknown as AppMatchState;
}

function prompt(kind: any, option: any) {
  return {
    id: `prompt-${kind}`,
    controllerPlayerId: "player_1",
    sourceCardInstanceId: "p1-magic-1",
    sourceCardName: "Magic",
    actionType: "TARGET_CARD",
    targetKind: kind,
    options: [option]
  } as any;
}

const match = createMatch();
const boardObjects = buildBoardObjects(match, { revealHandsForPlayerId: "all" });

const primaryPrompt = prompt("PRIMARY_CREATURE", { id: "o1", label: "Primary", zone: "PRIMARY_CREATURE", playerId: "player_1", cardInstanceId: "p1-primary", targetKind: "PRIMARY_CREATURE" });
const primaryAff = buildPendingEffectTargetAffordances(primaryPrompt, "player_1");
const primaryOptions = buildEffectTargetBoardOptions({ pendingEffectTargetAffordances: primaryAff, boardObjects, prompt: primaryPrompt, controlledPlayerId: "player_1" });
assert.equal(primaryOptions.some(o => o.pieceId && o.slotId === "player_1-primary"), true);

const limitedPrompt = prompt("LIMITED_SUMMON", { id: "o2", label: "Limited", zone: "LIMITED_SUMMON", playerId: "player_1", cardInstanceId: "p1-limited-1", targetKind: "LIMITED_SUMMON" });
const limitedOptions = buildEffectTargetBoardOptions({ pendingEffectTargetAffordances: buildPendingEffectTargetAffordances(limitedPrompt, "player_1"), boardObjects, prompt: limitedPrompt, controlledPlayerId: "player_1" });
assert.equal(limitedOptions.some(o => o.slotId === "player_1-limited-1"), true);

const magicPrompt = prompt("MAGIC_SLOT_CARD", { id: "o3", label: "Magic", zone: "MAGIC_SLOT", playerId: "player_1", cardInstanceId: "p1-magic-1", targetKind: "MAGIC_SLOT_CARD" });
const magicOptions = buildEffectTargetBoardOptions({ pendingEffectTargetAffordances: buildPendingEffectTargetAffordances(magicPrompt, "player_1"), boardObjects, prompt: magicPrompt, controlledPlayerId: "player_1" });
assert.equal(magicOptions.some(o => o.slotId === "player_1-magic-1"), true);

const cemeteryPrompt = prompt("CARD_IN_CEMETERY", { id: "o4", label: "Cemetery", zone: "CEMETERY", playerId: "player_1", cardInstanceId: "p1-cem-1", targetKind: "CARD_IN_CEMETERY" });
const cemeteryOptions = buildEffectTargetBoardOptions({ pendingEffectTargetAffordances: buildPendingEffectTargetAffordances(cemeteryPrompt, "player_1"), boardObjects, prompt: cemeteryPrompt, controlledPlayerId: "player_1" });
assert.equal(cemeteryOptions.some(o => o.slotId === "player_1-cemetery"), true);

const unsupportedPrompt = prompt("PLAYER", { id: "o5", label: "Player target", zone: "PLAYER", playerId: "player_2", targetKind: "PLAYER" });
const unsupportedOptions = buildEffectTargetBoardOptions({ pendingEffectTargetAffordances: buildPendingEffectTargetAffordances(unsupportedPrompt, "player_1"), boardObjects, prompt: unsupportedPrompt, controlledPlayerId: "player_1" });
assert.equal(unsupportedOptions.length, 0);

const restrictedOptions = buildEffectTargetBoardOptions({ pendingEffectTargetAffordances: buildPendingEffectTargetAffordances(primaryPrompt, "player_2"), boardObjects, prompt: primaryPrompt, controlledPlayerId: "player_2" });
assert.equal(restrictedOptions.length, 0);

console.log("board 3d target prompt smoke checks passed");
