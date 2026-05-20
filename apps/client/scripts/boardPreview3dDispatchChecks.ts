import assert from "node:assert/strict";
import { canDispatchBattle, canDispatchMagic, canDispatchSummon } from "../src/components/boardPreview3dAdapter";

assert.equal(
  canDispatchSummon({
    focusedSlotId: "player_1-primary",
    focusedSlotOwner: "player_1",
    summonPlayerId: "player_1",
    cardInstanceId: "c1",
    isSummonableCard: true
  }),
  true
);

assert.equal(
  canDispatchSummon({
    focusedSlotId: "player_1-magic-1",
    focusedSlotOwner: "player_1",
    summonPlayerId: "player_1",
    cardInstanceId: "c1",
    isSummonableCard: true
  }),
  false
);

assert.equal(
  canDispatchMagic({
    focusedSlotId: "player_1-magic-1",
    focusedSlotOwner: "player_1",
    summonPlayerId: "player_1",
    cardInstanceId: "m1",
    isPlayableMagicCard: true
  }),
  true
);

assert.equal(
  canDispatchMagic({
    focusedSlotId: null,
    focusedSlotOwner: undefined,
    summonPlayerId: "player_1",
    cardInstanceId: "m1",
    isPlayableMagicCard: true
  }),
  true
);

assert.equal(
  canDispatchBattle({
    attackerInstanceId: "att-1",
    defenderInstanceId: "def-1",
    canStartBattleNow: true,
    hasDefenderPrimary: true,
    hasValidAttacker: true
  }),
  true
);

assert.equal(
  canDispatchBattle({
    attackerInstanceId: "",
    defenderInstanceId: "def-1",
    canStartBattleNow: true,
    hasDefenderPrimary: true,
    hasValidAttacker: true
  }),
  false
);

assert.equal(
  canDispatchBattle({
    attackerInstanceId: "att-1",
    defenderInstanceId: "",
    canStartBattleNow: true,
    hasDefenderPrimary: true,
    hasValidAttacker: true
  }),
  false
);

console.log("boardPreview3d dispatch guard checks passed");
