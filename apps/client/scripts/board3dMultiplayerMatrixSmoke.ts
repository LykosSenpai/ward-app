import assert from "node:assert/strict";
import type { AppMatchState } from "../src/clientTypes";
import {
  buildBattleAffordances,
  buildHandPlacementAffordances,
  buildMagicChainAffordances
} from "../src/components/boardAffordances";
import { buildBoardInteractionContext } from "../src/components/boardRenderAdapter";

function createMatch(activePlayerId: "player_1" | "player_2"): AppMatchState {
  return {
    matchId: "multiplayer-smoke",
    turn: { activePlayerId, phase: "COMBAT", turnNumber: 2, turnCycleNumber: 2, firstTurnCycleComplete: true },
    status: "IN_PROGRESS",
    players: [
      {
        id: "player_1",
        displayName: "P1",
        hand: [{ instanceId: "p1-magic-1", cardId: "magic-playable", ownerPlayerId: "player_1" }],
        deck: [],
        cemetery: [],
        removedFromGame: [],
        field: {
          primaryCreature: { instanceId: "p1-primary", cardId: "creature-a", ownerPlayerId: "player_1", activeEffectInstances: [] },
          limitedSummons: [],
          magicSlots: []
        },
        turnFlags: { drawnThisTurn: false, battleUsedCreatureInstanceIds: [], normalSummonUsed: false }
      },
      {
        id: "player_2",
        displayName: "P2",
        hand: [{ instanceId: "p2-magic-1", cardId: "magic-playable", ownerPlayerId: "player_2" }, { instanceId: "p2-lightning-1", cardId: "lightning-counter", ownerPlayerId: "player_2" }],
        deck: [],
        cemetery: [],
        removedFromGame: [],
        field: {
          primaryCreature: { instanceId: "p2-primary", cardId: "creature-b", ownerPlayerId: "player_2", activeEffectInstances: [] },
          limitedSummons: [],
          magicSlots: []
        },
        turnFlags: { drawnThisTurn: false, battleUsedCreatureInstanceIds: [], normalSummonUsed: false }
      }
    ],
    cardCatalog: {
      "creature-a": { id: "creature-a", name: "A", cardType: "CREATURE", stats: { hp: 10, al: 1, spd: 5, atkDice: 1, mod: 0 } },
      "creature-b": { id: "creature-b", name: "B", cardType: "CREATURE", stats: { hp: 10, al: 1, spd: 4, atkDice: 1, mod: 0 } },
      "magic-playable": { id: "magic-playable", name: "Spark", cardType: "MAGIC", magicType: "NORMAL", magicSubType: "NONE", effects: [] },
      "lightning-counter": {
        id: "lightning-counter",
        name: "Counter Flash",
        cardType: "MAGIC",
        magicType: "LIGHTNING",
        magicSubType: "NONE",
        effects: [{ id: "e1", trigger: "OPPONENT_PLAYS_MAGIC", actionType: "NEGATE_MAGIC" }]
      }
    },
    settings: { cannotInflictAttackDamageBattlePolicy: "SKIP_BATTLE" },
    setup: { handDiscardRequiredForPlayerId: null, primaryReplacementRequiredForPlayerId: null },
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

const p1Turn = buildBoardInteractionContext(createMatch("player_1"));
assert.equal(p1Turn.activePlayerId, "player_1");
assert.equal(p1Turn.actions.find(a => a.kind === "DRAW")?.playerId, "player_1");

const p2Turn = buildBoardInteractionContext(createMatch("player_2"));
assert.equal(p2Turn.activePlayerId, "player_2");
assert.equal(p2Turn.actions.find(a => a.kind === "DRAW")?.playerId, "player_2");

const p1ControlledMatch = createMatch("player_1");
p1ControlledMatch.turn.phase = "SECOND_MAGIC";
const p1Affordances = buildHandPlacementAffordances({ match: p1ControlledMatch, playerId: "player_1", controlledPlayerId: "player_1" });
assert.equal(p1Affordances.some(a => a.kind === "PLAYABLE_CARD" && a.playerId === "player_1"), true);
const p2AsSeenByP1 = buildHandPlacementAffordances({ match: p1ControlledMatch, playerId: "player_2", controlledPlayerId: "player_1" });
assert.equal(p2AsSeenByP1.some(a => a.kind === "PLAYABLE_CARD"), false);
assert.equal(p2AsSeenByP1.some(a => a.kind === "DISABLED_ACTION" && (a.disabledReason ?? "").includes("cannot control".toLowerCase())), true);

const spectatorAffordances = buildHandPlacementAffordances({ match: p1ControlledMatch, playerId: "player_1", controlledPlayerId: null });
assert.equal(spectatorAffordances.some(a => a.kind === "PLAYABLE_CARD" && a.playerId === "player_1"), true);

const discardRequiredMatch = createMatch("player_1");
discardRequiredMatch.setup.handDiscardRequiredForPlayerId = "player_1";
discardRequiredMatch.players[0].hand = Array.from({ length: 9 }, (_, index) => ({
  instanceId: `p1-discard-${index + 1}`,
  cardId: "magic-playable",
  ownerPlayerId: "player_1",
  controllerPlayerId: "player_1",
  zone: "HAND"
}));
const discardAffordances = buildHandPlacementAffordances({ match: discardRequiredMatch, playerId: "player_1", controlledPlayerId: "player_1" });
assert.equal(discardAffordances.filter(a => a.kind === "VALID_DISCARD_CARD").length, 9);
assert.equal(discardAffordances.some(a => a.kind === "PLAYABLE_CARD"), false);
assert.equal(discardAffordances.every(a => a.targetZoneRef?.zone === "CEMETERY"), true);

const opponentDiscardAffordances = buildHandPlacementAffordances({ match: discardRequiredMatch, playerId: "player_1", controlledPlayerId: "player_2" });
assert.equal(opponentDiscardAffordances.some(a => a.kind === "VALID_DISCARD_CARD"), false);
assert.equal(opponentDiscardAffordances.some(a => a.kind === "DISABLED_ACTION" && (a.disabledReason ?? "").includes("cannot control")), true);

const battleP1 = buildBattleAffordances(createMatch("player_1"), "player_1");
assert.equal(battleP1.some(a => a.kind === "VALID_BATTLE_ATTACKER" && a.playerId === "player_1"), true);
assert.equal(battleP1.some(a => a.kind === "VALID_BATTLE_ATTACKER" && a.playerId === "player_2"), false);
assert.equal(battleP1.some(a => a.kind === "VALID_BATTLE_DEFENDER" && a.targetCardInstanceId === "p2-primary"), true);

const illegalBattle = createMatch("player_1");
illegalBattle.pendingPrompt = { playerId: "player_1" } as any;
const blockedBattleAffordances = buildBattleAffordances(illegalBattle, "player_1");
assert.equal(blockedBattleAffordances.some(a => a.kind === "VALID_BATTLE_ATTACKER"), false);
assert.equal(blockedBattleAffordances.some(a => a.kind === "VALID_BATTLE_DEFENDER"), false);

const chainMatch = createMatch("player_1");
chainMatch.pendingChain = {
  id: "chain-1",
  priorityPlayerId: "player_2",
  links: [{ id: "link-1", playerId: "player_1", magicType: "NORMAL", isLightningResponse: false }]
} as any;
const p2ChainAffordances = buildMagicChainAffordances(chainMatch, "player_2");
assert.equal(p2ChainAffordances.some(a => a.kind === "VALID_CHAIN_RESPONSE" && a.actionId === "PASS_MAGIC_CHAIN_PRIORITY" && a.playerId === "player_2"), true);
assert.equal(p2ChainAffordances.some(a => a.kind === "VALID_CHAIN_RESPONSE" && a.actionId === "PLAY_LIGHTNING_RESPONSE" && a.playerId === "player_2"), true);

const selfResponseBlocked = createMatch("player_1");
selfResponseBlocked.pendingChain = {
  id: "chain-2",
  priorityPlayerId: "player_2",
  links: [{ id: "link-1", playerId: "player_2", magicType: "NORMAL", isLightningResponse: false }]
} as any;
const selfBlockedAffordances = buildMagicChainAffordances(selfResponseBlocked, "player_2");
assert.equal(
  selfBlockedAffordances.some(a => a.kind === "DISABLED_ACTION" && a.sourceCardInstanceId === "p2-lightning-1" && (a.disabledReason ?? "").includes("own chain link")),
  true
);

const promptBlocked = createMatch("player_1");
promptBlocked.pendingPrompt = { playerId: "player_1" } as any;
const blocked = buildBoardInteractionContext(promptBlocked);
assert.equal(blocked.blocked, true);
assert.equal(blocked.actions.find(a => a.kind === "DRAW")?.enabled, false);
assert.equal(blocked.actions.find(a => a.kind === "DECLARE_BATTLE")?.enabled, false);

console.log("board 3d multiplayer matrix smoke checks passed");
