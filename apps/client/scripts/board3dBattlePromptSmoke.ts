import assert from "node:assert/strict";
import type { AppMatchState } from "../src/clientTypes";
import { buildBoardInteractionContext } from "../src/components/boardRenderAdapter";

function buildMatch(): AppMatchState {
  return {
    matchId: "battle-smoke",
    turn: { activePlayerId: "player_1", phase: "BATTLE", turnNumber: 3, turnCycleNumber: 2 },
    players: [
      {
        id: "player_1",
        field: { primaryCreature: { instanceId: "p1-primary", cardId: "c1", ownerPlayerId: "player_1" } as any, limitedSummons: [], magicSlots: [null, null, null, null, null] },
        turnFlags: { drawnThisTurn: true, battleUsedCreatureInstanceIds: [] }
      },
      {
        id: "player_2",
        field: { primaryCreature: { instanceId: "p2-primary", cardId: "c2", ownerPlayerId: "player_2" } as any, limitedSummons: [], magicSlots: [null, null, null, null, null] },
        turnFlags: { drawnThisTurn: true, battleUsedCreatureInstanceIds: [] }
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

const baseline = buildBoardInteractionContext(buildMatch());
assert.equal(typeof baseline.actions.find(a => a.kind === "DECLARE_BATTLE")?.enabled, "boolean");

const withPrompt = buildMatch();
withPrompt.pendingPrompt = { playerId: "player_1" } as any;
const blockedPrompt = buildBoardInteractionContext(withPrompt);
assert.equal(blockedPrompt.blocked, true);
assert.equal(blockedPrompt.actions.find(a => a.kind === "DRAW")?.enabled, false);

const missingDefender = buildMatch();
missingDefender.players[1].field.primaryCreature = null;
const noDefender = buildBoardInteractionContext(missingDefender);
assert.equal(noDefender.actions.find(a => a.kind === "DECLARE_BATTLE")?.enabled, false);

console.log("board 3d battle/prompt smoke checks passed");
