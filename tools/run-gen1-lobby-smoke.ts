import { io, type Socket } from "socket.io-client";

const API_BASE_URL = process.env.VITE_API_BASE_URL?.trim() || "http://localhost:3001";
const QA_GENERATION = process.env.WARD_QA_GENERATION?.trim() || "1";
const QA_LABEL = `Gen${QA_GENERATION}`;
const PACK_ID = `ward-gen${QA_GENERATION}`;
const QA_PASSWORD = process.env[`WARD_GEN${QA_GENERATION}_QA_PASSWORD`]?.trim() || `WardGen${QA_GENERATION}QA!2026`;
const WAIT_TIMEOUT_MS = 12_000;

const DECK_PAIRS = Array.from({ length: 5 }, (_item, index) => {
  const firstDeck = index * 2 + 1;
  return [
    `gen${QA_GENERATION}-qa-${String(firstDeck).padStart(2, "0")}`,
    `gen${QA_GENERATION}-qa-${String(firstDeck + 1).padStart(2, "0")}`
  ] as const;
});

const BATTLE_ROLL_PLANS = [
  { speed: [6, 1], hit: [6, 6], damage: [3, 3, 3, 3], label: "critical hit" },
  { speed: [1, 6], hit: [1, 1], damage: [2, 2, 2, 2], label: "critical miss" },
  { speed: [5, 2], hit: [1, 2], damage: [1, 1, 1, 1], label: "miss lane" },
  { speed: [3, 6], hit: [5, 5], damage: [4, 2, 2, 1], label: "normal hit" },
  { speed: [6, 5], hit: [6, 1], damage: [6, 1, 1, 1], label: "mixed high roll" }
] as const;

type AuthUser = {
  username: string;
};

type CardInstance = {
  instanceId: string;
  cardId: string;
};

type CardDefinition = {
  id: string;
  name: string;
  creatureType?: string;
  text?: string;
  cardType: "CREATURE" | "MAGIC";
  armorLevel?: number;
  effects?: Array<{
    actionText?: string;
    value?: string;
    notes?: string;
    params?: {
      valueText?: string;
    };
  }>;
};

type PlayerState = {
  id: string;
  hand: CardInstance[];
  deck: CardInstance[];
  cemetery: CardInstance[];
  turnFlags: {
    drawnThisTurn: boolean;
  };
  field: {
    primaryCreature?: CardInstance;
  };
};

type MatchState = {
  matchId: string;
  cardCatalog: Record<string, CardDefinition>;
  players: PlayerState[];
  turn: {
    activePlayerId: string;
    phase: string;
  };
  setup: {
    decksShuffled: boolean;
  };
  pendingBattle?: {
    id: string;
    status: string;
  };
  pendingChain?: unknown;
  pendingEffectRoll?: {
    id: string;
  };
  pendingPrompt?: unknown;
  manualEffectQueue: Array<{ completed?: boolean }>;
  eventLog: unknown[];
};

type LobbyPlayer = {
  ready: boolean;
};

type LobbyState = {
  id: string;
  name: string;
  matchId?: string;
  players: LobbyPlayer[];
};

type DeckSummary = {
  id: string;
  cardIds?: string[];
};

type ClientState = {
  match?: MatchState;
  lobby?: LobbyState;
  decks?: DeckSummary[];
  errors: string[];
};

type SmokeClient = {
  label: string;
  socket: Socket;
  state: ClientState;
};

type GameSummary = {
  pair: number;
  alphaDeckId: string;
  bravoDeckId: string;
  lobbyId: string;
  matchId: string;
  battlePlan: string;
  player1Primary: string;
  player2Primary: string;
  eventCount: number;
  undoChecks: number;
  coveredCardIds: string[];
};

function getSessionCookies(headers: Headers): string {
  const setCookieHeaders = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers.get("set-cookie")].filter((value): value is string => Boolean(value));

  return setCookieHeaders
    .map(header => header.split(";")[0])
    .join("; ");
}

async function login(username: string): Promise<{ user: AuthUser; cookie: string }> {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      login: username,
      password: QA_PASSWORD
    })
  });
  const body = await response.json() as { user?: AuthUser; message?: string };

  if (!response.ok || !body.user) {
    throw new Error(`${username} login failed: ${body.message ?? response.status}`);
  }

  const cookie = getSessionCookies(response.headers);
  if (!cookie) {
    throw new Error(`${username} login did not return a session cookie.`);
  }

  return { user: body.user, cookie };
}

function connectClient(label: string, cookie: string): SmokeClient {
  const headers = { Cookie: cookie, cookie };
  const socket = io(API_BASE_URL, {
    withCredentials: true,
    extraHeaders: headers,
    transportOptions: {
      polling: { extraHeaders: headers },
      websocket: { extraHeaders: headers }
    }
  });
  const state: ClientState = { errors: [] };

  socket.on("connect", () => console.log(`${label} socket connected ${socket.id}`));
  socket.on("connect_error", error => state.errors.push(`connect_error:${error.message}`));
  socket.on("match:error", error => state.errors.push(String(error?.message ?? error)));
  socket.on("match:state", match => {
    state.match = match as MatchState;
  });
  socket.on("lobby:updated", lobby => {
    state.lobby = lobby as LobbyState;
  });
  socket.on("deck:details", decks => {
    state.decks = decks as DeckSummary[];
  });

  return { label, socket, state };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor<T>(
  label: string,
  predicate: () => T | undefined | false,
  timeoutMs = WAIT_TIMEOUT_MS
): Promise<T> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const result = predicate();
    if (result) return result;
    await delay(100);
  }

  throw new Error(`Timed out waiting for ${label}.`);
}

function throwClientErrors(...clients: SmokeClient[]): void {
  const errors = clients.flatMap(client =>
    client.state.errors.splice(0).map(error => `${client.label}: ${error}`)
  );

  if (errors.length > 0) {
    throw new Error(errors.join(" | "));
  }
}

function getPlayer(match: MatchState, playerId: string): PlayerState {
  const player = match.players.find(candidate => candidate.id === playerId);
  if (!player) {
    throw new Error(`Missing player ${playerId}.`);
  }
  return player;
}

function getCardName(match: MatchState, card?: CardInstance): string {
  if (!card) return "None";
  return match.cardCatalog[card.cardId]?.name ?? card.cardId;
}

function getRequiredSacrifices(definition: CardDefinition): number {
  if (definition.cardType !== "CREATURE") {
    return 0;
  }

  const text = [
    definition.text,
    ...(definition.effects ?? []).flatMap(effect => [
      effect.actionText,
      effect.value,
      effect.params?.valueText,
      effect.notes
    ])
  ].filter(Boolean).join(" ").toLowerCase();

  const numeric = text.match(/requires?\s+(\d+)\s+sacrifices?/);
  if (numeric) return Number(numeric[1]);

  if ((definition.armorLevel ?? 0) >= 1 && (definition.armorLevel ?? 0) <= 6) return 0;
  if ((definition.armorLevel ?? 0) >= 7 && (definition.armorLevel ?? 0) <= 11) return 1;
  if (definition.armorLevel === 12) return 2;

  return 0;
}

function requiresDragonSacrifices(definition: CardDefinition): boolean {
  const text = [
    definition.text,
    ...(definition.effects ?? []).flatMap(effect => [
      effect.actionText,
      effect.value,
      effect.params?.valueText,
      effect.notes
    ])
  ].filter(Boolean).join(" ").toLowerCase();

  return text.includes("dragon-named") || text.includes("dragon-type") || text.includes("dragon named");
}

function isDragonQualifiedSacrifice(match: MatchState, card: CardInstance): boolean {
  const definition = match.cardCatalog[card.cardId];
  if (!definition) return false;
  return `${definition.name} ${definition.creatureType ?? ""}`.toLowerCase().includes("dragon");
}

function getSummonPlan(
  match: MatchState,
  playerId: string
): { creature: CardInstance; sacrificeCardInstanceIds: string[] } | undefined {
  const player = getPlayer(match, playerId);
  const creatures = player.hand.filter(card => {
    const definition = match.cardCatalog[card.cardId];
    return definition?.cardType === "CREATURE";
  });

  for (const creature of creatures) {
    const definition = match.cardCatalog[creature.cardId];
    if (!definition) continue;

    const requiredSacrifices = getRequiredSacrifices(definition);
    const possibleSacrifices = creatures.filter(candidate => {
      if (candidate.instanceId === creature.instanceId) return false;
      if (!requiresDragonSacrifices(definition)) return true;
      return isDragonQualifiedSacrifice(match, candidate);
    });

    if (possibleSacrifices.length >= requiredSacrifices) {
      return {
        creature,
        sacrificeCardInstanceIds: possibleSacrifices
          .slice(0, requiredSacrifices)
          .map(card => card.instanceId)
      };
    }
  }

  return undefined;
}

function collectDeckCardIds(client: SmokeClient, deckId: string): string[] {
  const deck = client.state.decks?.find(candidate => candidate.id === deckId);
  if (!deck?.cardIds?.length) {
    throw new Error(`${client.label} did not receive deck details for ${deckId}.`);
  }
  return deck.cardIds;
}

async function emitAndWait<T>(
  client: SmokeClient,
  eventName: string,
  payload: unknown,
  predicate: () => T | undefined | false,
  label: string,
  timeoutMs = WAIT_TIMEOUT_MS
): Promise<T> {
  client.socket.emit(eventName, payload);
  const result = await waitFor(label, predicate, timeoutMs);
  throwClientErrors(client);
  return result;
}

async function undoAndWait(
  client: SmokeClient,
  matchId: string,
  predicate: () => MatchState | undefined | false,
  label: string
): Promise<MatchState> {
  client.socket.emit("match:undoLastAction", matchId);
  const match = await waitFor(label, predicate);
  throwClientErrors(client);
  return match;
}

async function drawAndEnsureCreature(
  activeClient: SmokeClient,
  approvingClient: SmokeClient,
  match: MatchState,
  playerId: "player_1" | "player_2"
): Promise<MatchState> {
  let nextMatch = await emitAndWait(
    activeClient,
    "match:drawActivePlayer",
    match.matchId,
    () => getPlayer(activeClient.state.match!, playerId)?.hand.length === 5 && activeClient.state.match,
    `${playerId} opening draw`
  );

  for (let attempt = 0; attempt < 3 && !getSummonPlan(nextMatch, playerId); attempt += 1) {
    const player = getPlayer(nextMatch, playerId);
    const hasCreature = player.hand.some(card => nextMatch.cardCatalog[card.cardId]?.cardType === "CREATURE");
    if (hasCreature) {
      break;
    }

    activeClient.socket.emit("match:requestNoCreatureRedrawReveal", {
      matchId: nextMatch.matchId,
      playerId
    });
    await waitFor(`${playerId} redraw reveal`, () => activeClient.state.match?.pendingPrompt && activeClient.state.match);

    approvingClient.socket.emit("match:approveNoCreatureRedrawReveal", {
      matchId: nextMatch.matchId,
      approvingPlayerId: playerId === "player_1" ? "player_2" : "player_1"
    });

    nextMatch = await waitFor(
      `${playerId} redraw approved`,
      () => !activeClient.state.match?.pendingPrompt && activeClient.state.match
    );
    throwClientErrors(activeClient, approvingClient);
  }

  if (!getSummonPlan(nextMatch, playerId)) {
    throw new Error(`${playerId} has no summonable creature after redraw handling.`);
  }

  return nextMatch;
}

async function advanceThroughPhases(
  client: SmokeClient,
  match: MatchState,
  phases: string[]
): Promise<MatchState> {
  let nextMatch = match;

  for (const phase of phases) {
    nextMatch = await emitAndWait(
      client,
      "match:advancePhase",
      nextMatch.matchId,
      () => client.state.match?.turn.phase === phase && client.state.match,
      `advance to ${phase}`
    );
  }

  return nextMatch;
}

async function playPrimaryWithUndoCheck(
  client: SmokeClient,
  match: MatchState,
  playerId: "player_1" | "player_2"
): Promise<{ match: MatchState; undoChecks: number }> {
  const firstPlan = getSummonPlan(match, playerId);
  if (!firstPlan) {
    throw new Error(`${playerId} has no summonable creature.`);
  }

  let nextMatch = await emitAndWait(
    client,
    "match:playPrimaryCreature",
    {
      matchId: match.matchId,
      playerId,
      cardInstanceId: firstPlan.creature.instanceId,
      sacrificeCardInstanceIds: firstPlan.sacrificeCardInstanceIds
    },
    () => getPlayer(client.state.match!, playerId).field.primaryCreature && client.state.match,
    `${playerId} primary summon`
  );

  nextMatch = await undoAndWait(
    client,
    nextMatch.matchId,
    () => !getPlayer(client.state.match!, playerId).field.primaryCreature && client.state.match,
    `${playerId} undo primary summon`
  );

  const replayPlan = getSummonPlan(nextMatch, playerId);
  if (!replayPlan) {
    throw new Error(`${playerId} has no summonable creature after undo.`);
  }

  nextMatch = await emitAndWait(
    client,
    "match:playPrimaryCreature",
    {
      matchId: nextMatch.matchId,
      playerId,
      cardInstanceId: replayPlan.creature.instanceId,
      sacrificeCardInstanceIds: replayPlan.sacrificeCardInstanceIds
    },
    () => getPlayer(client.state.match!, playerId).field.primaryCreature && client.state.match,
    `${playerId} replay primary summon`
  );

  return { match: nextMatch, undoChecks: 1 };
}

async function runBattleWithUndoCheck(
  client: SmokeClient,
  match: MatchState,
  rollPlan: typeof BATTLE_ROLL_PLANS[number]
): Promise<{ match: MatchState; undoChecks: number }> {
  for (const roll of [
    { kind: "SPEED_TIE_ROLL", dice: rollPlan.speed },
    { kind: "HIT_ROLL", dice: rollPlan.hit },
    { kind: "ATTACK_DAMAGE_ROLL", dice: rollPlan.damage }
  ]) {
    client.socket.emit("match:devForceRolls", {
      matchId: match.matchId,
      ...roll,
      label: `${QA_LABEL} live lobby sweep: ${rollPlan.label}`
    });
  }
  await delay(300);
  throwClientErrors(client);

  const attacker = getPlayer(match, "player_1").field.primaryCreature;
  const defender = getPlayer(match, "player_2").field.primaryCreature;
  if (!attacker || !defender) {
    throw new Error("Both players need primary creatures before battle.");
  }

  let nextMatch = await emitAndWait(
    client,
    "match:startManualBattle",
    {
      matchId: match.matchId,
      playerId: "player_1",
      attackerCreatureInstanceId: attacker.instanceId,
      defenderCreatureInstanceId: defender.instanceId
    },
    () => client.state.match?.pendingBattle?.status === "AWAITING_SPEED_CHECK" && client.state.match,
    "battle declared"
  );

  nextMatch = await undoAndWait(
    client,
    nextMatch.matchId,
    () => !client.state.match?.pendingBattle && client.state.match,
    "undo battle declaration"
  );

  nextMatch = await emitAndWait(
    client,
    "match:startManualBattle",
    {
      matchId: nextMatch.matchId,
      playerId: "player_1",
      attackerCreatureInstanceId: attacker.instanceId,
      defenderCreatureInstanceId: defender.instanceId
    },
    () => client.state.match?.pendingBattle?.status === "AWAITING_SPEED_CHECK" && client.state.match,
    "battle redeclared"
  );

  const battleId = nextMatch.pendingBattle?.id;
  if (!battleId) {
    throw new Error("Battle session did not open.");
  }

  const battleSteps: Record<string, string> = {
    AWAITING_SPEED_CHECK: "match:runBattleSpeedCheck",
    AWAITING_HIT_ROLL: "match:rollBattleHit",
    AWAITING_DAMAGE_ROLL: "match:rollBattleDamage",
    AWAITING_DAMAGE_APPLICATION: "match:applyBattleDamage"
  };

  while (nextMatch.pendingBattle && nextMatch.pendingBattle.status !== "COMPLETE") {
    if (nextMatch.pendingEffectRoll) {
      nextMatch = await emitAndWait(
        client,
        "match:rollEffectRoll",
        { matchId: nextMatch.matchId, effectRollSessionId: nextMatch.pendingEffectRoll.id },
        () => client.state.match,
        "effect roll"
      );

      if (nextMatch.pendingEffectRoll) {
        nextMatch = await emitAndWait(
          client,
          "match:applyEffectRoll",
          { matchId: nextMatch.matchId, effectRollSessionId: nextMatch.pendingEffectRoll.id },
          () => !client.state.match?.pendingEffectRoll && client.state.match,
          "effect roll apply"
        );
      }
      continue;
    }

    const eventName = battleSteps[nextMatch.pendingBattle.status];
    if (!eventName) {
      throw new Error(`Unsupported battle status ${nextMatch.pendingBattle.status}.`);
    }

    const previousStatus = nextMatch.pendingBattle.status;
    nextMatch = await emitAndWait(
      client,
      eventName,
      { matchId: nextMatch.matchId, battleSessionId: battleId },
      () => client.state.match?.pendingBattle?.status !== previousStatus && client.state.match,
      eventName
    );
  }

  if (nextMatch.pendingBattle?.status === "COMPLETE") {
    nextMatch = await emitAndWait(
      client,
      "match:finishManualBattle",
      { matchId: nextMatch.matchId, battleSessionId: battleId },
      () => !client.state.match?.pendingBattle && client.state.match,
      "battle finished"
    );
  }

  return { match: nextMatch, undoChecks: 1 };
}

async function runDeckPairGame(
  pairIndex: number,
  alpha: SmokeClient,
  bravo: SmokeClient,
  alphaDeckId: string,
  bravoDeckId: string
): Promise<GameSummary> {
  const lobbyName = `${QA_LABEL} QA Sweep ${pairIndex + 1}`;
  const rollPlan = BATTLE_ROLL_PLANS[pairIndex % BATTLE_ROLL_PLANS.length]!;
  let undoChecks = 0;

  alpha.socket.emit("lobby:create", {
    name: lobbyName,
    selectedPackIds: [PACK_ID],
    selectedDeckId: alphaDeckId
  });
  const lobby = await waitFor(
    `created lobby ${lobbyName}`,
    () => alpha.state.lobby?.name === lobbyName && alpha.state.lobby
  );
  throwClientErrors(alpha, bravo);

  bravo.socket.emit("lobby:view", lobby.id);
  bravo.socket.emit("lobby:join", lobby.id);
  await waitFor(
    `bravo joined ${lobbyName}`,
    () => alpha.state.lobby?.id === lobby.id &&
      alpha.state.lobby.players.length === 2 &&
      bravo.state.lobby?.id === lobby.id &&
      bravo.state.lobby.players.length === 2
  );

  bravo.socket.emit("lobby:selectDeck", {
    lobbyId: lobby.id,
    deckId: bravoDeckId
  });
  await waitFor(
    `both ready ${lobbyName}`,
    () => alpha.state.lobby?.id === lobby.id &&
      alpha.state.lobby.players.length === 2 &&
      alpha.state.lobby.players.every(player => player.ready)
  );
  throwClientErrors(alpha, bravo);

  alpha.socket.emit("lobby:startMatch", lobby.id);
  let match = await waitFor(
    `match started ${lobbyName}`,
    () => alpha.state.lobby?.id === lobby.id &&
      alpha.state.lobby.matchId &&
      alpha.state.match?.matchId === alpha.state.lobby.matchId &&
      bravo.state.match?.matchId === alpha.state.lobby.matchId &&
      alpha.state.match
  );
  throwClientErrors(alpha, bravo);

  match = await emitAndWait(
    alpha,
    "match:shuffleAllDecks",
    match.matchId,
    () => alpha.state.match?.setup.decksShuffled && alpha.state.match,
    "decks shuffled"
  );

  match = await drawAndEnsureCreature(alpha, bravo, match, "player_1");
  match = await emitAndWait(
    alpha,
    "match:advancePhase",
    match.matchId,
    () => alpha.state.match?.turn.phase === "SUMMON_MAGIC" && alpha.state.match,
    "player 1 summon phase"
  );
  const p1Summon = await playPrimaryWithUndoCheck(alpha, match, "player_1");
  match = p1Summon.match;
  undoChecks += p1Summon.undoChecks;
  console.log(`Pair ${pairIndex + 1} P1 primary: ${getCardName(match, getPlayer(match, "player_1").field.primaryCreature)}`);

  match = await advanceThroughPhases(alpha, match, ["SECOND_MAGIC", "END", "DRAW"]);

  match = await drawAndEnsureCreature(bravo, alpha, match, "player_2");
  match = await emitAndWait(
    bravo,
    "match:advancePhase",
    match.matchId,
    () => bravo.state.match?.turn.phase === "SUMMON_MAGIC" && bravo.state.match,
    "player 2 summon phase"
  );
  const p2Summon = await playPrimaryWithUndoCheck(bravo, match, "player_2");
  match = p2Summon.match;
  undoChecks += p2Summon.undoChecks;
  console.log(`Pair ${pairIndex + 1} P2 primary: ${getCardName(match, getPlayer(match, "player_2").field.primaryCreature)}`);

  match = await advanceThroughPhases(bravo, match, ["SECOND_MAGIC", "END", "DRAW"]);
  match = await emitAndWait(
    alpha,
    "match:drawActivePlayer",
    match.matchId,
    () => getPlayer(alpha.state.match!, "player_1").turnFlags.drawnThisTurn && alpha.state.match,
    "player 1 turn 2 draw"
  );
  match = await advanceThroughPhases(alpha, match, ["SUMMON_MAGIC", "COMBAT"]);

  const battleRun = await runBattleWithUndoCheck(alpha, match, rollPlan);
  match = battleRun.match;
  undoChecks += battleRun.undoChecks;
  throwClientErrors(alpha, bravo);

  const player1 = getPlayer(match, "player_1");
  const player2 = getPlayer(match, "player_2");
  const coveredCardIds = [
    ...collectDeckCardIds(alpha, alphaDeckId),
    ...collectDeckCardIds(bravo, bravoDeckId)
  ];

  return {
    pair: pairIndex + 1,
    alphaDeckId,
    bravoDeckId,
    lobbyId: lobby.id,
    matchId: match.matchId,
    battlePlan: rollPlan.label,
    player1Primary: getCardName(match, player1.field.primaryCreature),
    player2Primary: getCardName(match, player2.field.primaryCreature),
    eventCount: match.eventLog.length,
    undoChecks,
    coveredCardIds
  };
}

async function main(): Promise<void> {
  const alphaLogin = await login(`gen${QA_GENERATION}_qa_alpha`);
  const bravoLogin = await login(`gen${QA_GENERATION}_qa_bravo`);
  console.log(`Logged in ${alphaLogin.user.username} and ${bravoLogin.user.username}`);

  const alpha = connectClient("alpha", alphaLogin.cookie);
  const bravo = connectClient("bravo", bravoLogin.cookie);

  try {
    await waitFor("both sockets", () => alpha.socket.connected && bravo.socket.connected);
    await waitFor(
      "all QA deck details",
      () => DECK_PAIRS.flat().every((deckId, index) => {
        const client = index % 2 === 0 ? alpha : bravo;
        return client.state.decks?.some(deck => deck.id === deckId);
      })
    );
    throwClientErrors(alpha, bravo);
    console.log(`All ${QA_LABEL} QA decks are visible over authenticated sockets.`);

    const summaries: GameSummary[] = [];
    const coveredCardIds = new Set<string>();

    for (let index = 0; index < DECK_PAIRS.length; index += 1) {
      const [alphaDeckId, bravoDeckId] = DECK_PAIRS[index]!;
      const summary = await runDeckPairGame(index, alpha, bravo, alphaDeckId, bravoDeckId);
      summaries.push(summary);
      summary.coveredCardIds.forEach(cardId => coveredCardIds.add(cardId));
      console.log(
        `Pair ${summary.pair} complete: ${summary.alphaDeckId} vs ${summary.bravoDeckId}, ` +
        `${summary.battlePlan}, undo checks ${summary.undoChecks}`
      );
    }

    const expectedCoveredCards = Number(process.env.WARD_QA_EXPECTED_CARD_COUNT?.trim() || (QA_GENERATION === "1" ? "151" : "150"));
    if (coveredCardIds.size !== expectedCoveredCards) {
      throw new Error(`Expected live deck sweep to cover ${expectedCoveredCards} ${QA_LABEL} cards, covered ${coveredCardIds.size}.`);
    }

    const totalUndoChecks = summaries.reduce((sum, summary) => sum + summary.undoChecks, 0);
    console.log(JSON.stringify({
      games: summaries.map(summary => ({
        pair: summary.pair,
        alphaDeckId: summary.alphaDeckId,
        bravoDeckId: summary.bravoDeckId,
        matchId: summary.matchId,
        battlePlan: summary.battlePlan,
        player1Primary: summary.player1Primary,
        player2Primary: summary.player2Primary,
        eventCount: summary.eventCount,
        undoChecks: summary.undoChecks
      })),
      packId: PACK_ID,
      coveredCards: coveredCardIds.size,
      totalUndoChecks
    }, null, 2));
  } finally {
    alpha.socket.close();
    bravo.socket.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
