import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyManualBattleDamage,
  create1v1MatchFromDeckCardIds,
  drawCards,
  finishManualBattleSession,
  forceNextDevRolls,
  normalizeMatch,
  playCreatureFromHandAsPrimary,
  rollManualBattleDamage,
  rollManualBattleHit,
  runManualBattleSpeedCheck,
  startManualBattleSession
} from "@ward/engine";
import type {
  CardDefinition,
  CardInstance,
  MatchState,
  PlayerState
} from "@ward/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const QA_GENERATION = process.env.WARD_QA_GENERATION?.trim() || "1";
const QA_LABEL = `Gen${QA_GENERATION}`;
const PACK_ID = `ward-gen${QA_GENERATION}`;
const PACK_PATH = path.join(ROOT_DIR, `data/cards/packs/${PACK_ID}.json`);
const STATUS_PATH = path.join(ROOT_DIR, "data/dev/effect-runtime-test-status.json");

type CardPack = {
  id: string;
  cards: CardDefinition[];
};

type StatusRecord = {
  packId: string;
  cardId: string;
  effectId: string;
  status: string;
  issueType?: string;
};

type StatusFile = {
  records: StatusRecord[];
};

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function getPlayer(state: MatchState, playerId: string): PlayerState {
  const player = state.players.find(candidate => candidate.id === playerId);
  if (!player) {
    throw new Error(`Missing player ${playerId}.`);
  }
  return player;
}

function getDefinition(
  catalog: Record<string, CardDefinition>,
  card: CardInstance
): CardDefinition {
  const definition = catalog[card.cardId];
  if (!definition) {
    throw new Error(`Missing definition for ${card.cardId}.`);
  }
  return definition;
}

function getCreatureFromHand(
  state: MatchState,
  playerId: string,
  maxArmorLevel: number
): CardInstance {
  const player = getPlayer(state, playerId);
  const creature = player.hand.find(card => {
    const definition = getDefinition(state.cardCatalog, card);
    return definition.cardType === "CREATURE" && definition.armorLevel <= maxArmorLevel;
  });

  if (!creature) {
    throw new Error(`No AL ${maxArmorLevel} or lower creature found in ${playerId} hand.`);
  }

  return creature;
}

function chooseStarterCreatureId(cards: CardDefinition[]): string {
  const creatures = cards.filter(
    (card): card is Extract<CardDefinition, { cardType: "CREATURE" }> =>
      card.cardType === "CREATURE"
  );
  const simpleStarter = creatures.find(card =>
    card.armorLevel <= 6 && (card.effects?.length ?? 0) === 0
  );
  const starter = simpleStarter ?? creatures.find(card => card.armorLevel <= 6);

  if (!starter) {
    throw new Error(`${QA_LABEL} pack has no AL 6 or lower creature available for starter draw.`);
  }

  return starter.id;
}

function buildFullDeckWithStarterFirst(cards: CardDefinition[]): string[] {
  const allCardIds = cards.map(card => card.id);
  const starterId = chooseStarterCreatureId(cards);
  return [
    starterId,
    ...allCardIds.filter(cardId => cardId !== starterId)
  ];
}

function setSummonPhase(state: MatchState, playerId: string, turnIndex: number): MatchState {
  const nextState = normalizeMatch(state);
  nextState.turn.activePlayerId = playerId;
  nextState.turn.currentTurnIndex = turnIndex;
  nextState.turn.phase = "SUMMON_MAGIC";
  nextState.turn.firstTurnCycleComplete = true;
  getPlayer(nextState, playerId).turnFlags.drawnThisTurn = true;
  return nextState;
}

function summonStarterPrimary(
  state: MatchState,
  playerId: string,
  turnIndex: number
): MatchState {
  let nextState = setSummonPhase(state, playerId, turnIndex);
  const creature = getCreatureFromHand(nextState, playerId, 6);
  nextState = playCreatureFromHandAsPrimary(nextState, playerId, creature.instanceId);
  nextState.setup.summonResponseWindow = undefined;
  return normalizeMatch(nextState);
}

function runBattleSmoke(state: MatchState): MatchState {
  let nextState = normalizeMatch(state);
  const player1 = getPlayer(nextState, "player_1");
  const player2 = getPlayer(nextState, "player_2");
  const attacker = player1.field.primaryCreature;
  const defender = player2.field.primaryCreature;

  if (!attacker || !defender) {
    throw new Error("Both players need a primary creature before battle sweep.");
  }

  nextState.turn.activePlayerId = "player_1";
  nextState.turn.currentTurnIndex = 0;
  nextState.turn.phase = "COMBAT";
  nextState.turn.firstTurnCycleComplete = true;
  player1.turnFlags.hasBattledThisCombat = false;
  player1.turnFlags.battleUsedCreatureInstanceIds = [];
  nextState.setup.primaryReplacementRequiredForPlayerId = undefined;
  nextState.setup.handDiscardRequiredForPlayerId = undefined;

  nextState = forceNextDevRolls(nextState, {
    kind: "SPEED_TIE_ROLL",
    dice: [6, 1],
    label: `${QA_LABEL} full deck sweep speed tie`
  });
  nextState = forceNextDevRolls(nextState, {
    kind: "HIT_ROLL",
    dice: [6, 6],
    label: `${QA_LABEL} full deck sweep hit`
  });
  nextState = forceNextDevRolls(nextState, {
    kind: "ATTACK_DAMAGE_ROLL",
    dice: [3, 3, 3, 3, 3, 3],
    label: `${QA_LABEL} full deck sweep damage`
  });

  nextState = startManualBattleSession(
    nextState,
    "player_1",
    attacker.instanceId,
    defender.instanceId
  );

  while (nextState.pendingBattle) {
    const battleId = nextState.pendingBattle.id;
    const status = nextState.pendingBattle.status;

    if (status === "AWAITING_SPEED_CHECK") {
      nextState = runManualBattleSpeedCheck(nextState, battleId);
    } else if (status === "AWAITING_HIT_ROLL") {
      nextState = rollManualBattleHit(nextState, battleId);
    } else if (status === "AWAITING_DAMAGE_ROLL") {
      nextState = rollManualBattleDamage(nextState, battleId);
    } else if (status === "AWAITING_DAMAGE_APPLICATION") {
      nextState = applyManualBattleDamage(nextState, battleId);
    } else if (status === "COMPLETE") {
      nextState = finishManualBattleSession(nextState, battleId);
    } else {
      throw new Error(`Battle sweep stopped at unsupported battle status ${status}.`);
    }
  }

  return normalizeMatch(nextState);
}

const pack = readJson<CardPack>(PACK_PATH);
const statusFile = readJson<StatusFile>(STATUS_PATH);
const catalog = Object.fromEntries(pack.cards.map(card => [card.id, card]));
const fullDeck = buildFullDeckWithStarterFirst(pack.cards);

const effectRows = pack.cards.flatMap(card =>
  (card.effects ?? []).map(effect => ({
    key: `${pack.id}:${card.id}:${effect.id}`,
    cardId: card.id,
    effectId: effect.id
  }))
);
const statusMap = new Map(
  statusFile.records.map(record => [
    `${record.packId}:${record.cardId}:${record.effectId}`,
    record
  ])
);
const unverifiedEffects = effectRows.filter(row => {
  const record = statusMap.get(row.key);
  return !record || record.status !== "WORKING" || (record.issueType ?? "NONE") !== "NONE";
});

if (unverifiedEffects.length > 0) {
  throw new Error(
    `${QA_LABEL} still has ${unverifiedEffects.length} unverified effect(s): ${unverifiedEffects
      .slice(0, 10)
      .map(row => `${row.cardId}/${row.effectId}`)
      .join(", ")}`
  );
}

let match = create1v1MatchFromDeckCardIds({
  cardCatalog: catalog,
  player1DeckCardIds: fullDeck,
  player2DeckCardIds: fullDeck,
  player1Name: `${QA_LABEL} Sweep A`,
  player2Name: `${QA_LABEL} Sweep B`,
  exactDeckSize: null,
  defaultCopyLimit: 999
});

const initialDeckSize = fullDeck.length;
match = drawCards(match, "player_1", 5);
match = drawCards(match, "player_2", 5);
match = summonStarterPrimary(match, "player_1", 0);
match = summonStarterPrimary(match, "player_2", 1);
match = runBattleSmoke(match);

const player1 = getPlayer(match, "player_1");
const player2 = getPlayer(match, "player_2");
const player1Primary = player1.field.primaryCreature;
const player2Primary = player2.field.primaryCreature;

if (!player1Primary || !player2Primary) {
  throw new Error("Full deck sweep finished without both primary creatures on the field.");
}

const summary = {
  packId: pack.id,
  cardCount: pack.cards.length,
  effectCount: effectRows.length,
  verifiedWorkingEffects: effectRows.length - unverifiedEffects.length,
  fullDeckSizePerPlayer: initialDeckSize,
  player1RemainingDeck: player1.deck.length,
  player2RemainingDeck: player2.deck.length,
  player1Primary: getDefinition(catalog, player1Primary).name,
  player2Primary: getDefinition(catalog, player2Primary).name,
  eventCount: match.eventLog.length,
  finalPhase: match.turn.phase,
  pendingBattle: Boolean(match.pendingBattle),
  pendingChain: Boolean(match.pendingChain),
  pendingManualEffects: match.manualEffectQueue.length
};

console.log(JSON.stringify(summary, null, 2));
