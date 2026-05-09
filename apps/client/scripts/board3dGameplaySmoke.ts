import assert from "node:assert/strict";
import type { AppMatchState } from "../src/clientTypes";
import { buildBoardInteractionContext } from "../src/components/boardRenderAdapter";

function createBaseMatch(): AppMatchState {
  return {
    matchId: "smoke-match",
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
    pendingEffectRoll: null,
    manualEffectQueue: [],
    devTools: { rolls: { forcedRollQueue: [] } },
    eventLog: []
  } as unknown as AppMatchState;
}

const baseline = buildBoardInteractionContext(createBaseMatch());
assert.equal(baseline.actions.find(a => a.kind === "DRAW")?.enabled, true);
assert.equal(baseline.actions.find(a => a.kind === "ADVANCE_PHASE")?.enabled, false);
assert.equal(baseline.actions.find(a => a.kind === "DECLARE_BATTLE")?.enabled, false);

const drawLockedMatch = createBaseMatch();
drawLockedMatch.players[0].turnFlags.drawnThisTurn = true;
const drawLocked = buildBoardInteractionContext(drawLockedMatch);
assert.equal(drawLocked.actions.find(a => a.kind === "DRAW")?.enabled, false);

const promptBlockedMatch = createBaseMatch();
promptBlockedMatch.pendingPrompt = { playerId: "player_1" } as any;
const promptBlocked = buildBoardInteractionContext(promptBlockedMatch);
assert.equal(promptBlocked.blocked, true);
assert.equal(promptBlocked.actions.find(a => a.kind === "DRAW")?.enabled, false);

const manualEffectMatch = createBaseMatch();
manualEffectMatch.manualEffectQueue = [{ id: "eff-1", completed: false } as any];
const manualEffects = buildBoardInteractionContext(manualEffectMatch);
assert.equal(manualEffects.actions.find(a => a.kind === "OPEN_MANUAL_EFFECTS")?.enabled, true);

console.log("board 3d gameplay smoke checks passed");
