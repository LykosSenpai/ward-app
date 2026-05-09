import assert from "node:assert/strict";
import type { AppMatchState } from "../src/clientTypes";
import { buildBoardInteractionContext } from "../src/components/boardRenderAdapter";

function createMatch(activePlayerId: "player_1" | "player_2"): AppMatchState {
  return {
    matchId: "multiplayer-smoke",
    turn: { activePlayerId, phase: "DRAW", turnNumber: 2, turnCycleNumber: 1 },
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

const p1Turn = buildBoardInteractionContext(createMatch("player_1"));
assert.equal(p1Turn.activePlayerId, "player_1");
assert.equal(p1Turn.actions.find(a => a.kind === "DRAW")?.playerId, "player_1");

const p2Turn = buildBoardInteractionContext(createMatch("player_2"));
assert.equal(p2Turn.activePlayerId, "player_2");
assert.equal(p2Turn.actions.find(a => a.kind === "DRAW")?.playerId, "player_2");

const conflictPrompt = createMatch("player_1");
conflictPrompt.pendingEffectTargetPrompt = { playerId: "player_1" } as any;
const blocked = buildBoardInteractionContext(conflictPrompt);
assert.equal(blocked.blocked, true);
assert.equal(blocked.actions.find(a => a.kind === "DRAW")?.enabled, false);

console.log("board 3d multiplayer matrix smoke checks passed");
