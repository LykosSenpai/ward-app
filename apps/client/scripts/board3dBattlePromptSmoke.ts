import assert from "node:assert/strict";
import type { AppMatchState } from "../src/clientTypes";
import { buildBattleAffordances } from "../src/components/boardAffordances";
import { buildBoardInteractionContext, translateGameEventsToBoardRenderEvents } from "../src/components/boardRenderAdapter";

function buildMatch(): AppMatchState {
  return {
    matchId: "battle-smoke",
    turn: { activePlayerId: "player_1", phase: "COMBAT", turnNumber: 3, turnCycleNumber: 2, firstTurnCycleComplete: true },
    players: [
      {
        id: "player_1",
        displayName: "P1",
        hand: [],
        deck: [],
        cemetery: [],
        removedFromGame: [],
        field: { primaryCreature: { instanceId: "p1-primary", cardId: "c1", ownerPlayerId: "player_1", activeEffectInstances: [] } as any, limitedSummons: [], magicSlots: [null, null, null, null, null] },
        turnFlags: { drawnThisTurn: true, battleUsedCreatureInstanceIds: [] }
      },
      {
        id: "player_2",
        displayName: "P2",
        hand: [],
        deck: [],
        cemetery: [],
        removedFromGame: [],
        field: { primaryCreature: { instanceId: "p2-primary", cardId: "c2", ownerPlayerId: "player_2", activeEffectInstances: [] } as any, limitedSummons: [], magicSlots: [null, null, null, null, null] },
        turnFlags: { drawnThisTurn: true, battleUsedCreatureInstanceIds: [] }
      }
    ],
    cardCatalog: {
      c1: { id: "c1", cardType: "CREATURE", name: "Attacker", stats: { hp: 10, al: 5, spd: 5, atkDice: 1, mod: 0 } },
      c2: { id: "c2", cardType: "CREATURE", name: "Defender", stats: { hp: 10, al: 5, spd: 4, atkDice: 1, mod: 0 } },
      bodyguard: {
        id: "bodyguard",
        cardType: "MAGIC",
        magicType: "BATTLE_LIGHTNING",
        magicSubType: "NONE",
        name: "Battle Shield",
        effects: [{ id: "bodyguard-e1", trigger: "DURING_BATTLE_FROM_HAND", actionType: "NEGATE_ATTACK_DAMAGE" }]
      }
    },
    settings: { cannotInflictAttackDamageBattlePolicy: "SKIP_BATTLE" },
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

const battleAffordances = buildBattleAffordances(buildMatch(), "player_1");
assert.equal(battleAffordances.some(a => a.kind === "VALID_BATTLE_ATTACKER" && a.sourceCardInstanceId === "p1-primary"), true);
assert.equal(battleAffordances.some(a => a.kind === "VALID_BATTLE_DEFENDER" && a.targetCardInstanceId === "p2-primary"), true);

const responseWindow = buildMatch();
responseWindow.players[1].hand = [{ instanceId: "bodyguard-1", cardId: "bodyguard", ownerPlayerId: "player_2" } as any];
responseWindow.pendingBattle = {
  id: "battle-1",
  status: "AWAITING_DAMAGE_ROLL",
  attackingPlayerId: "player_1",
  defendingPlayerId: "player_2",
  declaredAttacker: { playerId: "player_1", creatureInstanceId: "p1-primary", creatureKind: "PRIMARY_CREATURE", creatureName: "Attacker", armorLevel: 5, speed: 5, attackDice: 1, modifier: 0, currentHp: 10, baseHp: 10 },
  declaredDefender: { playerId: "player_2", creatureInstanceId: "p2-primary", creatureKind: "PRIMARY_CREATURE", creatureName: "Defender", armorLevel: 5, speed: 4, attackDice: 1, modifier: 0, currentHp: 10, baseHp: 10 },
  strikes: [{
    id: "strike-1",
    role: "FIRST_STRIKE",
    status: "AWAITING_DAMAGE_ROLL",
    attacker: { playerId: "player_1", creatureInstanceId: "p1-primary", creatureKind: "PRIMARY_CREATURE", creatureName: "Attacker", armorLevel: 5, speed: 5, attackDice: 1, modifier: 0, currentHp: 10, baseHp: 10 },
    defender: { playerId: "player_2", creatureInstanceId: "p2-primary", creatureKind: "PRIMARY_CREATURE", creatureName: "Defender", armorLevel: 5, speed: 4, attackDice: 1, modifier: 0, currentHp: 10, baseHp: 10 },
    modifiers: { hitDiceDelta: 0, hitFlatBonus: 0, hitRollMultiplier: 1, forceHitResult: "AUTO", damageDiceDelta: 0, damageFlatBonus: 0, damageMultiplier: 1, preventAttackDamage: false },
    damageTarget: "DEFENDER"
  }],
  currentStrikeIndex: 0
} as any;
const responseAffordances = buildBattleAffordances(responseWindow, "player_2");
assert.equal(responseAffordances.some(a => a.kind === "VALID_BATTLE_RESPONSE" && a.sourceCardInstanceId === "bodyguard-1"), true);

const disabledResponse = buildMatch();
disabledResponse.players[1].hand = responseWindow.players[1].hand;
const disabledAffordances = buildBattleAffordances(disabledResponse, "player_2");
assert.equal(disabledAffordances.some(a => a.kind === "DISABLED_ACTION" && a.sourceCardInstanceId === "bodyguard-1" && Boolean(a.disabledReason)), true);

const movedEvents = translateGameEventsToBoardRenderEvents({
  ...buildMatch(),
  eventLog: [{
    id: "event-1",
    sequenceNumber: 1,
    type: "BATTLE_RESPONSE_FROM_HAND_PLAYED",
    playerId: "player_2",
    payload: {
      boardEvents: [{
        type: "CARD_MOVED",
        playerId: "player_2",
        cardInstanceId: "bodyguard-1",
        reason: "BATTLE_RESPONSE",
        fromZoneRef: { playerId: "player_2", zone: "HAND" },
        toZoneRef: { playerId: "player_2", zone: "CEMETERY" }
      }]
    }
  } as any]
});
assert.equal(movedEvents.some(event => event.type === "CARD_MOVED" && event.reason === "BATTLE_RESPONSE"), true);

console.log("board 3d battle/prompt smoke checks passed");
