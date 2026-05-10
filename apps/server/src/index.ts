import "./env/loadEnvFile.js";
console.log("BOOTING WARD SERVER...");

import express from "express";
import cors from "cors";
import http from "http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import rateLimit from "express-rate-limit";

import type { CardDefinition, CardInstance, CannotInflictAttackDamageBattlePolicy, DeckListDefinition, DevRollKind, MatchState, TurnPhase, WardEngineEffect } from "@ward/shared";

import {
  advancePhase,
  endTurn,
  applyManualDamageToPrimaryCreature,
  applyManualHealToPrimaryCreature,
  applyManualMagicDamageToPrimaryCreature,
  applyManualMagicDrawCards,
  applyManualMagicHealToPrimaryCreature,
  applyManualMagicStatModifierToPrimaryCreature,
  approveNoCreatureRedrawReveal,
  activateCardEffect,
  attachEquipMagicToCreature,
  attachEquipMagicToPrimaryCreature,
  applyManualBattleDamage,
  applyPendingEffectRoll,
  battlePrimaryCreatures,
  battleWithCreature,
  cancelManualBattleSession,
  callCemeteryHpLoss,
  completeManualMagicEffect,
  concedeMatch,
  create1v1MatchFromDeckCardIds,
  destroyMagicSlotCard,
  destroyMagicSlotCardFromManualEffect,
  discardCardFromHand,
  drawForActivePlayer,
  killOwnPrimaryCreature,
  playCreatureFromHandAsPrimary,
  playBattleResponseFromHand,
  playLightningResponseFromHand,
  playMagicFromHand,
  passMagicChainPriority,
  finishManualBattleSession,
  forceNextDevRolls,
  clearForcedDevRolls,
  createEffectTestScenarioMatch,
  getEffectRuntimeSupport,
  promoteLimitedSummonToPrimary,
  requestNoCreatureRedrawReveal,
  rollOpeningTurnOrder,
  rollPendingEffectRoll,
  rollManualBattleDamage,
  rollManualBattleHit,
  runManualBattleSpeedCheck,
  skipPendingEffectRoll,
  resolveMagicChain,
  resolvePendingEffectTargetPrompt,
  rollAndApplyManualBattleDamage,
  sendPrimaryCreatureToCemetery,
  shuffleAllDecks,
  startManualBattleSession,
  updateManualBattleSpeedModifiers,
  updateManualBattleStrikeModifiers,
  shuffleDeckForPlayer,
  validateDeckCardIds
} from "@ward/engine";

import {
  deckFileExists,
  userDeckFileExists,
  deleteUserDeckFromDisk,
  deleteDeckFromDisk,
  deleteMatchFromDisk,
  listCardLibraryForPacks,
  listDefaultCardLibrary,
  loadEffectRuntimeTestStatusMap,
  saveEffectRuntimeTestStatusRecord,
  saveEffectRuntimeTestStatusRecords,
  getUserDeckProofPhotoPath,
  listSavedMatches,
  listSetupOptions,
  listTournamentDeckSubmissions,
  listUserDecks,
  loadCardCatalog,
  loadCardLimitMap,
  loadDeckList,
  loadUserDeckList,
  loadMatchFromDisk,
  saveDeckListToDisk,
  saveUserDeckProofPhoto,
  saveUserDeckListToDisk,
  updateCardEffectsInPack,
  updateCardLimitRule,
  reviewTournamentDeckSubmission,
  saveMatchToDisk,
  validateDataFileId
} from "./dataStore.js";
import type { SetupOptions } from "./dataStore.js";

import {
  generateEffectTestPlan,
  generateEffectTestPlanBatch,
  reviewEffectTestResult
} from "./llm/effectTestPlanner.js";
import { getLlmServiceStatus } from "./llm/llmClient.js";
import {
  listLlmRegressionScenarios,
  saveLlmRegressionScenario
} from "./llm/regressionScenarios.js";
import { saveLlmPhase4VerificationReport } from "./llm/phase4Reports.js";
import { runLlmHeadlessEffectTest } from "./llm/headlessEffectRunner.js";
import type { EffectRuntimeTestStatusRecord } from "./dataStore.js";
import type { LlmDirectEffectSmokeTestResult, LlmEffectResultReview, LlmEffectTestPlan } from "./llm/types.js";
import { sessionMiddleware } from "./auth/session.js";
import type { AuthUser } from "./auth/session.js";
import { changeUserPassword, createUser, getUserProfile, listUsersForTournamentDeckReview, updateUserProfile, verifyUserLogin } from "./auth/userStore.js";
import { loadUserCardOwnershipMap, setUserCardOwnershipCount } from "./collection/ownershipStore.js";
import { checkDbConnection } from "./db/pool.js";

const PORT = Number(process.env.PORT ?? 3001);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../../..");
const CLIENT_DIST_DIR = path.join(ROOT_DIR, "apps", "client", "dist");
const isProduction = process.env.NODE_ENV === "production";
const ENABLE_DEV_TOOLS = process.env.ENABLE_DEV_TOOLS === "true" || (!isProduction && process.env.ENABLE_DEV_TOOLS !== "false");
const DEV_SOCKET_EVENTS = new Set([
  "match:devForceRolls",
  "match:devClearForcedRolls",
  "lobby:cleanupStale"
]);

const app = express();

if (isProduction) {
  app.set("trust proxy", 1);
}

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const LOCAL_CLIENT_ORIGIN_PATTERN = /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/;

function isAllowedClientOrigin(origin?: string): boolean {
  if (!origin) return true;
  if (origin === CLIENT_ORIGIN) return true;
  return process.env.NODE_ENV !== "production" && LOCAL_CLIENT_ORIGIN_PATTERN.test(origin);
}

function isDevToolSocketEvent(eventName: string): boolean {
  return eventName.startsWith("dev:") ||
    eventName.startsWith("llm:") ||
    DEV_SOCKET_EVENTS.has(eventName);
}

function canSocketUseDevTools(socket: { request: unknown }): boolean {
  return ENABLE_DEV_TOOLS || !!getSocketUser(socket)?.devToolsEnabled;
}

function canUserReviewTournamentDecks(user: AuthUser | null | undefined): boolean {
  return user?.role === "ADMIN" || user?.role === "HOST";
}

const ALLOWED_PROOF_PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const PROOF_PHOTO_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};
const MAX_PROOF_PHOTO_BYTES = 8 * 1024 * 1024;

function decodeProofPhotoDataUrl(dataUrl: string): { mimeType: string; bytes: Buffer } {
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl.trim());

  if (!match) {
    throw new Error("Proof photo must be a JPEG, PNG, WebP, or GIF data URL.");
  }

  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_PROOF_PHOTO_MIME_TYPES.has(mimeType)) {
    throw new Error("Unsupported proof photo type.");
  }

  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_PROOF_PHOTO_BYTES) {
    throw new Error("Proof photo must be between 1 byte and 8 MB.");
  }

  return { mimeType, bytes };
}

app.use(cors({
  origin(origin, callback) {
    callback(null, isAllowedClientOrigin(origin));
  },
  credentials: true
}));
app.use(express.json({ limit: "20mb" }));
app.use(sessionMiddleware);

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isProduction ? 40 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many auth attempts. Try again shortly." }
});

const passwordRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isProduction ? 10 : 80,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many password attempts. Try again shortly." }
});

const activeMatches = new Map<string, MatchState>();
const matchUndoHistory = new Map<string, MatchState[]>();
const matchLobbies = new Map<string, MatchLobbyRecord>();
const matchPlayerOwners = new Map<string, Map<string, string>>();

const MAX_UNDO_STEPS = 25;
const OPEN_LOBBY_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const IN_MATCH_LOBBY_IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const LOBBY_CLEANUP_INTERVAL_MS = 60 * 1000;
const EMBED_ALLOWED_ORIGINS = (process.env.EMBED_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);

type EmbedSessionRecord = {
  token: string;
  user: AuthUser;
  matchId?: string;
  view?: string;
  parentOrigin: string;
  expiresAt: number;
};

const embedSessions = new Map<string, EmbedSessionRecord>();

type MatchLobbyStatus = "OPEN" | "IN_MATCH" | "CLOSED";
type MatchLobbyCloseReason = "EMPTY" | "MATCH_COMPLETE" | "IDLE_TIMEOUT";
type MatchLobbyFormat = "FREE_PLAY" | "TOURNAMENT";

type MatchLobbyPlayerRecord = {
  userId: string;
  displayName: string;
  seat: number;
  selectedDeckId?: string;
  ready: boolean;
};

type MatchLobbyRecord = {
  id: string;
  name: string;
  status: MatchLobbyStatus;
  format: MatchLobbyFormat;
  hostUserId: string;
  selectedPackIds: string[];
  matchId?: string;
  players: MatchLobbyPlayerRecord[];
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  closedAt?: string;
  closeReason?: MatchLobbyCloseReason;
};

function getSocketUser(socket: { request: unknown }): AuthUser | null {
  const request = socket.request as { session?: { user?: AuthUser } };
  return request.session?.user ?? null;
}

function getSocketEmbedContext(socket: { request: unknown }): {
  parentOrigin: string;
  matchId?: string;
  view?: string;
  expiresAt: number;
} | null {
  const request = socket.request as { session?: { embedContext?: { parentOrigin: string; matchId?: string; view?: string; expiresAt: number } } };
  return request.session?.embedContext ?? null;
}

function requireSocketUser(socket: { request: unknown }): AuthUser {
  const user = getSocketUser(socket);

  if (!user) {
    throw new Error("Login required.");
  }

  return user;
}



type EffectCoverageRow = {
  packId: string;
  cardId: string;
  cardName: string;
  cardType: string;
  generation?: string;
  cardNumber?: string;
  effectId: string;
  trigger?: string;
  actionType: string;
  reusableFunction?: string;
  effectGroup?: string;
  supportLevel: string;
  runtimeRoute: string;
  supportNotes: string;
  needsReview?: boolean;
  effectNotes?: string;
  testStatus?: string;
  testIssueType?: string;
  testNotes?: string;
  lastTestedAt?: string;
  testedBy?: string;
};

function buildEffectCoverageRows(packIds: string[]): EffectCoverageRow[] {
  const cards = listCardLibraryForPacks(packIds, loadCardLimitMap());
  const testStatusMap = loadEffectRuntimeTestStatusMap();
  const rows: EffectCoverageRow[] = [];

  for (const card of cards) {
    for (const effect of card.effects ?? []) {
      const support = getEffectRuntimeSupport(effect);
      const key = `${card.packId}:${card.id}:${effect.id}`;
      const testRecord = testStatusMap[key];
      const isQaVerified = testRecord?.status === "WORKING" && (testRecord.issueType ?? "NONE") === "NONE";

      rows.push({
        packId: card.packId,
        cardId: card.id,
        cardName: card.name,
        cardType: card.cardType,
        generation: card.generation,
        cardNumber: card.cardNumber,
        effectId: effect.id,
        trigger: effect.trigger,
        actionType: effect.actionType,
        reusableFunction: effect.reusableFunction,
        effectGroup: effect.effectGroup,
        supportLevel: isQaVerified ? "SUPPORTED" : support.level,
        runtimeRoute: isQaVerified ? `${support.route} / Headless Engine QA` : support.route,
        supportNotes: isQaVerified
          ? `Verified by saved Headless Engine QA status. ${support.notes}`
          : support.notes,
        needsReview: isQaVerified ? false : effect.needsReview,
        effectNotes: effect.notes,
        testStatus: testRecord?.status ?? "UNTESTED",
        testIssueType: testRecord?.issueType ?? "NONE",
        testNotes: testRecord?.notes ?? "",
        lastTestedAt: testRecord?.lastTestedAt,
        testedBy: testRecord?.testedBy
      });
    }
  }

  return rows.sort((a, b) =>
    String(a.generation ?? "").localeCompare(String(b.generation ?? ""), undefined, { numeric: true }) ||
    String(a.cardNumber ?? "").localeCompare(String(b.cardNumber ?? ""), undefined, { numeric: true }) ||
    a.cardName.localeCompare(b.cardName) ||
    a.effectId.localeCompare(b.effectId)
  );
}


function findCardForLlmRequest(args: {
  packId?: string;
  packIds?: string[];
  cardId: string;
}): { packId: string; card: CardDefinition; catalog: Record<string, CardDefinition> } {
  const requestedPackIds = args.packId
    ? [args.packId]
    : args.packIds?.length
      ? args.packIds
      : listSetupOptions().cardPacks.map(pack => pack.id);

  if (requestedPackIds.length === 0) {
    throw new Error("Select at least one card pack for LLM effect testing.");
  }

  for (const packId of requestedPackIds) {
    const catalog = loadCardCatalog([packId]);
    const card = catalog[args.cardId];

    if (card) {
      return { packId, card, catalog };
    }
  }

  throw new Error(`Card not found for LLM request: ${args.cardId}`);
}

function applyLlmPlanToScenarioMatch(match: MatchState, plan: LlmEffectTestPlan): MatchState {
  const requestedPhase = plan.setup.phase;
  const validPhases = new Set<TurnPhase>(["DRAW", "SUMMON_MAGIC", "COMBAT", "SECOND_MAGIC", "END"]);

  if (requestedPhase && validPhases.has(requestedPhase)) {
    match.turn.phase = requestedPhase;
  }

  if (plan.setup.activePlayerId && match.players.some(player => player.id === plan.setup.activePlayerId)) {
    match.turn.activePlayerId = plan.setup.activePlayerId;
    match.turn.currentTurnIndex = match.turn.currentTurnOrder.indexOf(plan.setup.activePlayerId);
  }

  for (const roll of plan.setup.forcedRolls ?? []) {
    forceNextDevRolls(match, {
      kind: roll.kind,
      dice: roll.dice,
      label: roll.label ?? `LLM plan: ${plan.title}`
    });
  }

  match.eventLog.push({
    id: `llm-scenario-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sequenceNumber: match.eventLog.length + 1,
    timestamp: new Date().toISOString(),
    type: "LLM_EFFECT_TEST_SCENARIO_CREATED",
    payload: {
      title: plan.title,
      cardId: plan.card.cardId,
      effectId: plan.effect?.effectId,
      phase: match.turn.phase,
      forcedRollCount: plan.setup.forcedRolls?.length ?? 0
    }
  });

  return match;
}

function normalizeBulkDeckCardIds(cardIds: string[], label: string): string[] {
  const normalized = cardIds.map(cardId => String(cardId ?? "").trim()).filter(Boolean);

  if (normalized.length !== 10) {
    throw new Error(`${label} must contain exactly 10 card(s). Current size: ${normalized.length}.`);
  }

  for (const cardId of normalized) {
    validateDataFileId(cardId);
  }

  return normalized;
}

function normalizeDeckCardArtKeys(cardArtKeys: string[] | undefined, cardCount: number): string[] | undefined {
  if (!Array.isArray(cardArtKeys)) {
    return undefined;
  }

  const normalized = Array.from({ length: cardCount }, (_, index) => {
    const artKey = String(cardArtKeys[index] ?? "default").trim();
    return artKey === "holo" || artKey === "zero-art" || artKey === "zero-art-holo" ? artKey : "default";
  });

  return normalized.some(artKey => artKey !== "default") ? normalized : undefined;
}

function normalizeDeckFormat(value: unknown): "FREE_PLAY" | "TOURNAMENT" {
  return value === "TOURNAMENT" ? "TOURNAMENT" : "FREE_PLAY";
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getUserSetupOptions(user: AuthUser | null): SetupOptions {
  const options = listSetupOptions();

  return {
    ...options,
    decks: user ? listUserDecks(user.id) : []
  };
}

function loadDeckForUser(userId: string, deckId: string): DeckListDefinition {
  return loadUserDeckList(userId, deckId);
}

function getFirstDeckForUser(userId: string): DeckListDefinition {
  const [deck] = listUserDecks(userId);

  if (!deck) {
    throw new Error("Each player needs at least one saved deck before starting a match.");
  }

  return loadDeckForUser(userId, deck.id);
}

function getDeckDetailsForUser(user: AuthUser | null) {
  if (!user) {
    return [];
  }

  return listUserDecks(user.id).map(deckSummary => {
    const deck = loadUserDeckList(user.id, deckSummary.id);

    return serializeDeckDetail(deck, user.id, user.displayName);
  });
}

function serializeDeckDetail(deck: DeckListDefinition, ownerUserId: string, ownerDisplayName: string) {
  return {
    id: deck.id,
    name: deck.name,
    cardIds: deck.cardIds,
    cardArtKeys: deck.cardArtKeys,
    format: normalizeDeckFormat(deck.format),
    ownerUserId,
    ownerDisplayName,
    tournamentProofPhotos: (deck.tournamentProofPhotos ?? []).map(photo => ({
      ...photo,
      url: `/api/decks/${encodeURIComponent(ownerUserId)}/${encodeURIComponent(deck.id)}/proof-photos/${encodeURIComponent(photo.id)}`
    })),
    tournamentVerification: deck.tournamentVerification ?? { status: "UNSUBMITTED" as const }
  };
}

function getLobbyIdleTimeoutMs(lobby: MatchLobbyRecord): number {
  return lobby.status === "IN_MATCH" ? IN_MATCH_LOBBY_IDLE_TIMEOUT_MS : OPEN_LOBBY_IDLE_TIMEOUT_MS;
}

function getLobbyActivityTime(lobby: MatchLobbyRecord): number {
  const activityTime = Date.parse(lobby.lastActivityAt || lobby.updatedAt || lobby.createdAt);
  return Number.isFinite(activityTime) ? activityTime : Date.parse(lobby.createdAt);
}

function getLobbyCreatedTime(lobby: MatchLobbyRecord): number {
  const createdTime = Date.parse(lobby.createdAt);
  return Number.isFinite(createdTime) ? createdTime : 0;
}

function touchLobbyActivity(lobby: MatchLobbyRecord, now = new Date().toISOString()): void {
  lobby.updatedAt = now;
  lobby.lastActivityAt = now;
}

function closeLobby(
  lobby: MatchLobbyRecord,
  reason: MatchLobbyCloseReason,
  now = new Date().toISOString()
): void {
  lobby.status = "CLOSED";
  lobby.updatedAt = now;
  lobby.lastActivityAt = now;
  lobby.closedAt = now;
  lobby.closeReason = reason;
}

function closeStaleLobbies(nowMs = Date.now()): number {
  let closedCount = 0;
  const now = new Date(nowMs).toISOString();

  for (const lobby of matchLobbies.values()) {
    if (lobby.status === "CLOSED") {
      continue;
    }

    const idleMs = nowMs - getLobbyActivityTime(lobby);
    if (idleMs >= getLobbyIdleTimeoutMs(lobby)) {
      closeLobby(lobby, "IDLE_TIMEOUT", now);
      closedCount += 1;
    }
  }

  return closedCount;
}

function getLobbySnapshot(lobby: MatchLobbyRecord) {
  const nowMs = Date.now();
  const createdAtMs = getLobbyCreatedTime(lobby);
  const lastActivityAtMs = getLobbyActivityTime(lobby);
  const staleAfterMs = getLobbyIdleTimeoutMs(lobby);

  return {
    ...lobby,
    players: [...lobby.players].sort((a, b) => a.seat - b.seat),
    ageMs: Math.max(0, nowMs - createdAtMs),
    idleMs: Math.max(0, nowMs - lastActivityAtMs),
    staleAfterMs,
    autoCloseAt: new Date(lastActivityAtMs + staleAfterMs).toISOString()
  };
}

function listLobbySnapshots() {
  closeStaleLobbies();

  return Array.from(matchLobbies.values())
    .filter(lobby => lobby.status !== "CLOSED")
    .map(getLobbySnapshot)
    .sort((a, b) => getLobbyCreatedTime(b) - getLobbyCreatedTime(a));
}

function emitLobbyList(): void {
  io.emit("lobby:list", listLobbySnapshots());
}

function emitLobbyUpdated(lobby: MatchLobbyRecord): void {
  io.to(lobby.id).emit("lobby:updated", getLobbySnapshot(lobby));
  emitLobbyList();
}

function closeLobbyForMatch(matchId: string): void {
  const lobby = Array.from(matchLobbies.values()).find(item => item.matchId === matchId);

  if (!lobby || lobby.status === "CLOSED") {
    return;
  }

  closeLobby(lobby, "MATCH_COMPLETE");
  emitLobbyUpdated(lobby);
}

function touchLobbyActivityForMatch(matchId: string): void {
  const lobby = Array.from(matchLobbies.values()).find(item => item.matchId === matchId);

  if (!lobby || lobby.status === "CLOSED") {
    return;
  }

  touchLobbyActivity(lobby);
  emitLobbyUpdated(lobby);
}

function getLobbyOrThrow(lobbyId: string): MatchLobbyRecord {
  const lobby = matchLobbies.get(lobbyId);

  if (!lobby || lobby.status === "CLOSED") {
    throw new Error("Lobby not found.");
  }

  return lobby;
}

function getLobbyPlayerOrThrow(lobby: MatchLobbyRecord, userId: string): MatchLobbyPlayerRecord {
  const player = lobby.players.find(item => item.userId === userId);

  if (!player) {
    throw new Error("Join this lobby before changing your deck.");
  }

  return player;
}

function getSocketOwnedPlayerId(socket: { request: unknown }, matchId: string): string | undefined {
  const user = getSocketUser(socket);
  if (!user) {
    return undefined;
  }

  return matchPlayerOwners.get(matchId)?.get(user.id);
}

function requireSocketCanControlPlayer(socket: { request: unknown }, matchId: string, playerId: string): void {
  const owners = matchPlayerOwners.get(matchId);

  if (!owners) {
    return;
  }

  const ownedPlayerId = getSocketOwnedPlayerId(socket, matchId);

  if (ownedPlayerId !== playerId) {
    throw new Error("You can only control your own seat in this match.");
  }
}

function requireSocketCanControlActivePlayer(socket: { request: unknown }, match: MatchState): void {
  requireSocketCanControlPlayer(socket, match.matchId, match.turn.activePlayerId);
}

function getManualBattleStepControllerPlayerId(match: MatchState): string {
  const battle = match.pendingBattle;
  if (!battle || battle.status === "AWAITING_SPEED_CHECK") {
    return match.turn.activePlayerId;
  }

  const currentStrike = battle.strikes[battle.currentStrikeIndex];
  return currentStrike?.attacker.playerId ?? match.turn.activePlayerId;
}

function requireSocketCanControlManualBattleStep(socket: { request: unknown }, match: MatchState): void {
  requireSocketCanControlPlayer(socket, match.matchId, getManualBattleStepControllerPlayerId(match));
}

function requireSocketCanControlEffectRollStep(socket: { request: unknown }, match: MatchState): void {
  const effectRoll = match.pendingEffectRoll;
  if (
    effectRoll?.linkedBattleSessionId &&
    match.pendingBattle?.id === effectRoll.linkedBattleSessionId
  ) {
    requireSocketCanControlManualBattleStep(socket, match);
    return;
  }

  requireSocketCanControlActivePlayer(socket, match);
}

function requireSocketCanControlEffectTargetPrompt(socket: { request: unknown }, match: MatchState): void {
  const prompt = match.pendingEffectTargetPrompt;
  if (!prompt) {
    requireSocketCanControlActivePlayer(socket, match);
    return;
  }

  requireSocketCanControlPlayer(socket, match.matchId, prompt.controllerPlayerId);
}

function requireSocketCanUndoMatch(socket: { request: unknown }, match: MatchState): void {
  const owners = matchPlayerOwners.get(match.matchId);

  if (!owners) {
    return;
  }

  const ownedPlayerId = getSocketOwnedPlayerId(socket, match.matchId);

  if (!ownedPlayerId) {
    throw new Error("You can only undo actions for your own seat in this match.");
  }

  const undoPlayerIds = new Set<string>([match.turn.activePlayerId]);

  if (match.pendingChain?.lastLinkPlayerId) {
    undoPlayerIds.add(match.pendingChain.lastLinkPlayerId);
  }

  if (match.pendingChain?.priorityPlayerId) {
    undoPlayerIds.add(match.pendingChain.priorityPlayerId);
  }

  if (!undoPlayerIds.has(ownedPlayerId)) {
    throw new Error("You can only undo the current step when it belongs to your seat.");
  }
}

function prepareLlmBulkDeckPlayer(match: MatchState, playerId: string): void {
  const player = match.players.find(item => item.id === playerId);
  if (!player) return;

  const primaryIndex = player.deck.findIndex(card => match.cardCatalog[card.cardId]?.cardType === "CREATURE");

  if (primaryIndex >= 0) {
    const [primary] = player.deck.splice(primaryIndex, 1);
    const definition = match.cardCatalog[primary.cardId];
    primary.zone = "PRIMARY_CREATURE";
    primary.controllerPlayerId = player.id;
    primary.ownerPlayerId = primary.ownerPlayerId || player.id;

    if (definition?.cardType === "CREATURE") {
      primary.baseHp = definition.hp;
      primary.currentHp = definition.hp;
    }

    player.field.primaryCreature = primary;
  }

  // Keep the dev hand at 7 cards so the next normal draw reaches 8 instead of
  // forcing discard-to-8. The remaining cards stay in deck so Bulk Tester 2 can
  // enter Draw Phase cleanly after Player 1 ends the turn.
  const targetFastHandSize = 7;

  while (player.hand.length < targetFastHandSize && player.deck.length > 0) {
    const card = player.deck.shift()!;
    card.zone = "HAND";
    card.controllerPlayerId = player.id;
    card.ownerPlayerId = card.ownerPlayerId || player.id;
    player.hand.push(card);
  }

  for (const card of player.deck) {
    card.zone = "DECK";
    card.controllerPlayerId = player.id;
    card.ownerPlayerId = card.ownerPlayerId || player.id;
  }

  player.turnFlags.hasTakenFirstTurn = true;
  player.turnFlags.drawnThisTurn = true;
  player.turnFlags.playedCreatureThisTurn = false;
  player.turnFlags.normalSummonUsed = false;
  player.turnFlags.killedOwnCreatureThisTurn = false;
  player.turnFlags.hasBattledThisCombat = false;
  player.turnFlags.battleUsedCreatureInstanceIds = [];
  match.setup.firstTurnDrawsByPlayer[player.id] = true;
}

function createLlmBulkDeckTestMatch(args: {
  cardCatalog: Record<string, CardDefinition>;
  player1CardIds: string[];
  player2CardIds: string[];
}): MatchState {
  const player1DeckCardIds = normalizeBulkDeckCardIds(args.player1CardIds, "Player 1 bulk test deck");
  const player2DeckCardIds = normalizeBulkDeckCardIds(args.player2CardIds, "Player 2 bulk test deck");

  const match = create1v1MatchFromDeckCardIds({
    cardCatalog: args.cardCatalog,
    player1DeckCardIds,
    player2DeckCardIds,
    player1Name: "LLM Bulk Tester 1",
    player2Name: "LLM Bulk Tester 2",
    exactDeckSize: 10,
    defaultCopyLimit: 10,
    allowNoCreatures: true
  });

  match.turn.activePlayerId = "player_1";
  match.turn.currentTurnIndex = 0;
  match.turn.phase = "SUMMON_MAGIC";
  match.turn.firstTurnCycleComplete = true;
  match.setup.openingRoll = {
    status: "COMPLETE",
    round: 1,
    rolls: {},
    winnerPlayerId: "player_1"
  };
  match.setup.decksShuffled = true;
  match.setup.primaryReplacementRequiredForPlayerId = undefined;
  match.setup.handDiscardRequiredForPlayerId = undefined;

  prepareLlmBulkDeckPlayer(match, "player_1");
  prepareLlmBulkDeckPlayer(match, "player_2");

  match.eventLog.push({
    id: `llm-bulk-deck-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sequenceNumber: match.eventLog.length + 1,
    timestamp: new Date().toISOString(),
    type: "LLM_BULK_DECK_TEST_MATCH_CREATED",
    payload: {
      player1CardIds: player1DeckCardIds,
      player2CardIds: player2DeckCardIds,
      message: "Created relaxed 10-card-vs-10-card LLM bulk test match. First creature on each side was placed as primary when available; up to 7 cards were moved to hand, and remaining cards stay in deck so both bulk testers can draw without discard blocking."
    }
  });

  return match;
}


function getLlmPlanKey(plan: LlmEffectTestPlan): string {
  return `${plan.card.packId}:${plan.card.cardId}:${plan.effect?.effectId ?? "NO_EFFECT"}`;
}

function findLlmTestSource(match: MatchState, cardId: string): { playerId: string; card: CardInstance; zone: string } | undefined {
  for (const player of match.players) {
    const primary = player.field.primaryCreature;
    if (primary?.cardId === cardId) return { playerId: player.id, card: primary, zone: "PRIMARY_CREATURE" };

    for (const card of player.field.magicSlots ?? []) {
      if (card.cardId === cardId) return { playerId: player.id, card, zone: "MAGIC_SLOT" };
    }

    for (const card of player.field.limitedSummons ?? []) {
      if (card.cardId === cardId) return { playerId: player.id, card, zone: "LIMITED_SUMMON" };
    }

    for (const card of player.hand ?? []) {
      if (card.cardId === cardId) return { playerId: player.id, card, zone: "HAND" };
    }

    for (const card of player.deck ?? []) {
      if (card.cardId === cardId) return { playerId: player.id, card, zone: "DECK" };
    }

    for (const card of player.cemetery ?? []) {
      if (card.cardId === cardId) return { playerId: player.id, card, zone: "CEMETERY" };
    }
  }

  return undefined;
}

function getPendingTargetPromptSummary(match: MatchState): string | undefined {
  const prompt = match.pendingEffectTargetPrompt;
  if (!prompt) return undefined;

  return [
    prompt.effectId,
    prompt.promptText,
    `${prompt.options?.length ?? 0} option(s)`
  ].filter(Boolean).join(" Â· ");
}

function getPendingPromptSummary(match: MatchState): string | undefined {
  const prompt = match.pendingPrompt;
  if (!prompt) return undefined;
  return String((prompt as { type?: string; message?: string }).message ?? (prompt as { type?: string }).type ?? "Pending prompt");
}

function classifyDirectSmokeTest(args: {
  match: MatchState;
  plan: LlmEffectTestPlan;
  cardName: string;
  startEventCount: number;
  startManualQueueCount: number;
  error?: unknown;
}): LlmDirectEffectSmokeTestResult {
  const eventTypes = args.match.eventLog.slice(args.startEventCount).map(event => event.type);
  const pendingTargetPrompt = getPendingTargetPromptSummary(args.match);
  const pendingPrompt = getPendingPromptSummary(args.match);
  const manualEffectQueueCount = args.match.manualEffectQueue?.length ?? 0;
  const newManualQueueCount = Math.max(0, manualEffectQueueCount - args.startManualQueueCount);
  const evidence: string[] = [];

  if (eventTypes.length) {
    evidence.push(`Runtime emitted ${eventTypes.length} event(s): ${eventTypes.join(", ")}.`);
  } else {
    evidence.push("Runtime did not emit a new effect event before classification.");
  }

  if (pendingTargetPrompt) {
    evidence.push(`A target/card prompt was created: ${pendingTargetPrompt}.`);
  }

  if (pendingPrompt) {
    evidence.push(`A general prompt is pending: ${pendingPrompt}.`);
  }

  if (newManualQueueCount > 0) {
    evidence.push(`${newManualQueueCount} manual fallback request(s) were queued.`);
  }

  if (args.error) {
    const message = args.error instanceof Error ? args.error.message : String(args.error);
    const unsupported = /unsupported|no runtime route|not supported/i.test(message);

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      key: getLlmPlanKey(args.plan),
      matchId: args.match.matchId,
      cardId: args.plan.card.cardId,
      cardName: args.cardName,
      effectId: args.plan.effect?.effectId,
      status: unsupported ? "BLOCKED_RUNTIME" : "BROKEN",
      issueType: unsupported ? "UNSUPPORTED_ACTION_TYPE" : "NONE",
      summary: `Direct smoke test stopped: ${message}`,
      evidence: [...evidence, message],
      eventTypes,
      pendingPrompt,
      pendingEffectTargetPrompt: pendingTargetPrompt,
      manualEffectQueueCount
    };
  }

  if (pendingTargetPrompt) {
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      key: getLlmPlanKey(args.plan),
      matchId: args.match.matchId,
      cardId: args.plan.card.cardId,
      cardName: args.cardName,
      effectId: args.plan.effect?.effectId,
      status: "PARTIAL",
      issueType: "NONE",
      summary: "Direct smoke test reached the correct runtime prompt. Resolve the prompt on the Play Table to finish verification.",
      evidence,
      eventTypes,
      pendingPrompt,
      pendingEffectTargetPrompt: pendingTargetPrompt,
      manualEffectQueueCount
    };
  }

  if (newManualQueueCount > 0 || eventTypes.includes("MANUAL_MAGIC_EFFECT_QUEUED")) {
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      key: getLlmPlanKey(args.plan),
      matchId: args.match.matchId,
      cardId: args.plan.card.cardId,
      cardName: args.cardName,
      effectId: args.plan.effect?.effectId,
      status: "BLOCKED_RUNTIME",
      issueType: "UNSUPPORTED_ACTION_TYPE",
      summary: "Direct smoke test routed to manual fallback. This effect needs a reusable runtime handler or manual verification.",
      evidence,
      eventTypes,
      pendingPrompt,
      pendingEffectTargetPrompt: pendingTargetPrompt,
      manualEffectQueueCount
    };
  }

  if (pendingPrompt) {
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      key: getLlmPlanKey(args.plan),
      matchId: args.match.matchId,
      cardId: args.plan.card.cardId,
      cardName: args.cardName,
      effectId: args.plan.effect?.effectId,
      status: "PARTIAL",
      issueType: "NONE",
      summary: "Direct smoke test reached a pending game prompt. Finish the prompt on the Play Table before marking Working.",
      evidence,
      eventTypes,
      pendingPrompt,
      pendingEffectTargetPrompt: pendingTargetPrompt,
      manualEffectQueueCount
    };
  }

  if (eventTypes.length > 0) {
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      key: getLlmPlanKey(args.plan),
      matchId: args.match.matchId,
      cardId: args.plan.card.cardId,
      cardName: args.cardName,
      effectId: args.plan.effect?.effectId,
      status: "WORKING",
      issueType: "NONE",
      summary: "Direct smoke test executed without an error, manual fallback, or unresolved prompt.",
      evidence,
      eventTypes,
      pendingPrompt,
      pendingEffectTargetPrompt: pendingTargetPrompt,
      manualEffectQueueCount
    };
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    key: getLlmPlanKey(args.plan),
    matchId: args.match.matchId,
    cardId: args.plan.card.cardId,
    cardName: args.cardName,
    effectId: args.plan.effect?.effectId,
    status: "PARTIAL",
    issueType: "NONE",
    summary: "Direct smoke test created the scenario, but no executable runtime step was detected.",
    evidence,
    eventTypes,
    pendingPrompt,
    pendingEffectTargetPrompt: pendingTargetPrompt,
    manualEffectQueueCount
  };
}

function runLlmDirectEffectSmokeTest(args: {
  packIds?: string[];
  plan: LlmEffectTestPlan;
}): { match: MatchState; result: LlmDirectEffectSmokeTestResult } {
  const packIds = args.packIds?.length ? args.packIds : [args.plan.card.packId];
  const cardCatalog = loadCardCatalog(packIds);

  return runLlmHeadlessEffectTest({
    cardCatalog,
    plan: args.plan
  });
}

function runLlmHeadlessEffectTestBatch(args: {
  packIds?: string[];
  plans: LlmEffectTestPlan[];
}): Array<{ match: MatchState; result: LlmDirectEffectSmokeTestResult }> {
  const packIds = args.packIds?.length
    ? args.packIds
    : Array.from(new Set(args.plans.map(plan => plan.card.packId).filter(Boolean)));
  const cardCatalog = loadCardCatalog(packIds);

  return args.plans.map(plan => runLlmHeadlessEffectTest({
    cardCatalog,
    plan
  }));
}

function moveCardsFromDeckToOpeningHand(match: MatchState, playerId: string, requestedHandSize?: number): void {
  const handSize = Math.max(0, Math.floor(Number(requestedHandSize ?? 0)));
  if (handSize === 0) return;

  const player = match.players.find(item => item.id === playerId);
  if (!player) return;

  if (handSize > player.deck.length) {
    throw new Error(`${player.displayName} cannot draw ${handSize} opening hand card(s); deck only has ${player.deck.length}.`);
  }

  const drawnCards = player.deck.splice(0, handSize);
  for (const card of drawnCards) {
    card.zone = "HAND";
    card.controllerPlayerId = player.id;
    player.hand.push(card);
  }

  match.setup.firstTurnDrawsByPlayer[player.id] = true;
  match.eventLog.push({
    id: `dev-hand-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sequenceNumber: match.eventLog.length + 1,
    timestamp: new Date().toISOString(),
    type: "DEV_TEST_HAND_CREATED",
    playerId: player.id,
    payload: {
      message: `${player.displayName} starts with ${handSize} test hand card(s).`,
      handSize
    }
  });
}

function prepareEffectTestMatchAfterOpeningHands(match: MatchState): void {
  const hasPreparedOpeningHands = match.players.some(player => player.hand.length > 0);
  if (!hasPreparedOpeningHands) return;

  match.setup.openingRoll = {
    status: "COMPLETE",
    round: 1,
    rolls: {},
    winnerPlayerId: match.turn.activePlayerId
  };
  match.setup.decksShuffled = true;
  match.turn.phase = "SUMMON_MAGIC";

  const activePlayer = match.players.find(player => player.id === match.turn.activePlayerId);
  if (activePlayer) {
    activePlayer.turnFlags.drawnThisTurn = true;
    match.setup.firstTurnDrawsByPlayer[activePlayer.id] = true;
  }

  match.eventLog.push({
    id: `dev-test-start-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sequenceNumber: match.eventLog.length + 1,
    timestamp: new Date().toISOString(),
    type: "DEV_TEST_MATCH_READY",
    playerId: match.turn.activePlayerId,
    payload: {
      message: "Flexible effect test match starts in Summoning/Magic Phase with prepared hands.",
      phase: match.turn.phase,
      activePlayerId: match.turn.activePlayerId
    }
  });
}

function cloneMatchState(match: MatchState): MatchState {
  return JSON.parse(JSON.stringify(match)) as MatchState;
}

function pushUndoSnapshot(match: MatchState): void {
  const history = matchUndoHistory.get(match.matchId) ?? [];

  history.push(cloneMatchState(match));

  if (history.length > MAX_UNDO_STEPS) {
    history.shift();
  }

  matchUndoHistory.set(match.matchId, history);
}

function getUndoCount(matchId: string): number {
  return matchUndoHistory.get(matchId)?.length ?? 0;
}

function emitMatchState(match: MatchState): void {
  saveMatchToDisk(match);
  io.to(match.matchId).emit("match:state", match);

  if ((match.status ?? "ACTIVE") === "COMPLETE") {
    closeLobbyForMatch(match.matchId);
  } else {
    touchLobbyActivityForMatch(match.matchId);
  }
}

function getMatchOrThrow(matchId: string): MatchState {
  const match = activeMatches.get(matchId);

  if (!match) {
    throw new Error(`Match not found: ${matchId}`);
  }

  return match;
}

function getPlayableMatchOrThrow(
  matchId: string,
  options?: {
    snapshotBeforeAction?: boolean;
    allowPendingEffectTarget?: boolean;
    allowPendingEffectRoll?: boolean;
    allowPendingBattle?: boolean;
  }
): MatchState {
  const match = getMatchOrThrow(matchId);

  if ((match.status ?? "ACTIVE") === "COMPLETE") {
    throw new Error(
      `Match ${matchId} is complete. Gameplay actions are locked.`
    );
  }

  const matchWithTargetPrompt = match as MatchState & {
    pendingEffectTargetPrompt?: unknown;
  };

  if (
    matchWithTargetPrompt.pendingEffectTargetPrompt &&
    !options?.allowPendingEffectTarget
  ) {
    throw new Error(
      "Resolve the pending effect target selection before continuing."
    );
  }

  if (match.pendingEffectRoll && !options?.allowPendingEffectRoll) {
    throw new Error("Resolve the pending effect roll before continuing.");
  }

  if (match.pendingBattle && match.pendingBattle.status !== "COMPLETE" && !options?.allowPendingBattle) {
    throw new Error("Finish the pending battle before continuing.");
  }

  if (options?.snapshotBeforeAction ?? true) {
    pushUndoSnapshot(match);
  }

  return match;
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "ward-server",
    message: "WARD server is running"
  });
});

app.get("/ready", async (_req, res) => {
  try {
    await checkDbConnection();

    res.json({
      ok: true,
      service: "ward-server",
      database: "ok",
      sessions: "postgres",
      production: isProduction,
      clientOrigin: CLIENT_ORIGIN
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      service: "ward-server",
      database: "error",
      message: error instanceof Error ? error.message : "Readiness check failed."
    });
  }
});

app.get("/api/auth/me", (req, res) => {
  res.json({
    user: req.session.user ?? null
  });
});

app.post("/api/auth/register", authRateLimit, async (req, res) => {
  try {
    const user = await createUser({
      username: String(req.body?.username ?? ""),
      email: String(req.body?.email ?? ""),
      password: String(req.body?.password ?? ""),
      displayName: String(req.body?.displayName ?? "")
    });

    req.session.user = user;
    res.status(201).json({ user });
  } catch (error) {
    res.status(400).json({
      message: error instanceof Error ? error.message : "Unable to register."
    });
  }
});

app.post("/api/auth/login", authRateLimit, async (req, res) => {
  try {
    const user = await verifyUserLogin({
      login: String(req.body?.login ?? req.body?.username ?? ""),
      password: String(req.body?.password ?? "")
    });

    req.session.user = user;
    res.json({ user });
  } catch (error) {
    res.status(401).json({
      message: error instanceof Error ? error.message : "Unable to login."
    });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(error => {
    if (error) {
      res.status(500).json({ message: "Unable to logout." });
      return;
    }

    res.clearCookie("ward.sid");
    res.json({ ok: true });
  });
});

app.get("/api/profile", async (req, res) => {
  try {
    if (!req.session.user) {
      res.status(401).json({ message: "Login required." });
      return;
    }

    res.json({ profile: await getUserProfile(req.session.user.id) });
  } catch (error) {
    res.status(400).json({
      message: error instanceof Error ? error.message : "Unable to load profile."
    });
  }
});

app.patch("/api/profile", async (req, res) => {
  try {
    if (!req.session.user) {
      res.status(401).json({ message: "Login required." });
      return;
    }

    const profile = await updateUserProfile(req.session.user.id, {
      email: String(req.body?.email ?? ""),
      displayName: String(req.body?.displayName ?? ""),
      devToolsEnabled: Boolean(req.body?.devToolsEnabled)
    });

    req.session.user = profile;

    res.json({ profile, user: req.session.user });
  } catch (error) {
    res.status(400).json({
      message: error instanceof Error ? error.message : "Unable to update profile."
    });
  }
});

app.post("/api/profile/change-password", passwordRateLimit, async (req, res) => {
  try {
    if (!req.session.user) {
      res.status(401).json({ message: "Login required." });
      return;
    }

    await changeUserPassword(req.session.user.id, {
      currentPassword: String(req.body?.currentPassword ?? ""),
      newPassword: String(req.body?.newPassword ?? "")
    });

    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({
      message: error instanceof Error ? error.message : "Unable to change password."
    });
  }
});

app.post("/api/decks/:deckId/proof-photos", (req, res) => {
  try {
    const user = req.session.user;
    if (!user) {
      res.status(401).json({ message: "Login required." });
      return;
    }

    const deckId = String(req.params.deckId ?? "");
    validateDataFileId(deckId);
    const rawPhotos = Array.isArray(req.body?.photos) ? req.body.photos : [];

    if (rawPhotos.length === 0) {
      throw new Error("Select at least one proof photo.");
    }

    if (rawPhotos.length > 6) {
      throw new Error("Upload at most 6 proof photos at a time.");
    }

    let deck: DeckListDefinition | null = null;
    for (const rawPhoto of rawPhotos) {
      const decoded = decodeProofPhotoDataUrl(String(rawPhoto?.dataUrl ?? ""));
      const extension = PROOF_PHOTO_EXTENSION_BY_MIME_TYPE[decoded.mimeType] ?? "jpg";
      deck = saveUserDeckProofPhoto({
        userId: user.id,
        deckId,
        photo: {
          id: `${Date.now()}-${randomUUID()}`,
          fileName: String(rawPhoto?.fileName ?? `proof.${extension}`).slice(0, 140),
          mimeType: decoded.mimeType,
          bytes: decoded.bytes
        }
      });
    }

    res.json({
      deck: deck ? serializeDeckDetail(deck, user.id, user.displayName) : undefined
    });
  } catch (error) {
    res.status(400).json({
      message: error instanceof Error ? error.message : "Unable to upload proof photos."
    });
  }
});

app.get("/api/decks/:ownerUserId/:deckId/proof-photos/:photoId", (req, res) => {
  try {
    const user = req.session.user;
    if (!user) {
      res.status(401).json({ message: "Login required." });
      return;
    }

    const ownerUserId = String(req.params.ownerUserId ?? "");
    const deckId = String(req.params.deckId ?? "");
    const photoId = String(req.params.photoId ?? "");
    validateDataFileId(ownerUserId);
    validateDataFileId(deckId);
    validateDataFileId(photoId);

    if (ownerUserId !== user.id && !canUserReviewTournamentDecks(user)) {
      res.status(403).json({ message: "Only the deck owner, hosts, or admins can view proof photos." });
      return;
    }

    const deck = loadUserDeckList(ownerUserId, deckId);
    const photo = deck.tournamentProofPhotos?.find(item => item.id === photoId);
    if (!photo) {
      res.status(404).json({ message: "Proof photo not found." });
      return;
    }

    const photoPath = getUserDeckProofPhotoPath(ownerUserId, deckId, photoId);
    if (!fs.existsSync(photoPath)) {
      res.status(404).json({ message: "Proof photo file not found." });
      return;
    }

    res.type(photo.mimeType);
    res.sendFile(photoPath);
  } catch (error) {
    res.status(400).json({
      message: error instanceof Error ? error.message : "Unable to load proof photo."
    });
  }
});

app.post("/api/embed/session", (req, res) => {
  if (!req.session.user) {
    res.status(401).json({ message: "Login required." });
    return;
  }

  const parentOrigin = String(req.body?.parentOrigin ?? "");
  if (!parentOrigin) {
    res.status(400).json({ message: "parentOrigin is required." });
    return;
  }

  const isAllowedOrigin = EMBED_ALLOWED_ORIGINS.length === 0
    ? isAllowedClientOrigin(parentOrigin)
    : EMBED_ALLOWED_ORIGINS.includes(parentOrigin);
  if (!isAllowedOrigin) {
    res.status(403).json({ message: "Origin not allowed for embed session." });
    return;
  }

  const ttlSecondsInput = Number(req.body?.expiresInSeconds ?? 300);
  const ttlSeconds = Number.isFinite(ttlSecondsInput)
    ? Math.max(60, Math.min(ttlSecondsInput, 600))
    : 300;
  const token = randomUUID();
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const session: EmbedSessionRecord = {
    token,
    user: req.session.user,
    matchId: typeof req.body?.matchId === "string" ? req.body.matchId : undefined,
    view: typeof req.body?.view === "string" ? req.body.view : undefined,
    parentOrigin,
    expiresAt
  };
  embedSessions.set(token, session);

  res.status(201).json({
    token,
    expiresAt: new Date(expiresAt).toISOString(),
    parentOrigin: session.parentOrigin,
    matchId: session.matchId,
    view: session.view
  });
});

app.post("/api/embed/consume", (req, res) => {
  const token = String(req.body?.token ?? "");
  const parentOrigin = String(req.body?.parentOrigin ?? "");
  if (!token || !parentOrigin) {
    res.status(400).json({ message: "token and parentOrigin are required." });
    return;
  }

  const session = embedSessions.get(token);
  if (!session) {
    res.status(401).json({ message: "Invalid embed token." });
    return;
  }
  if (session.expiresAt <= Date.now()) {
    embedSessions.delete(token);
    res.status(401).json({ message: "Embed token expired." });
    return;
  }
  if (session.parentOrigin !== parentOrigin) {
    res.status(403).json({ message: "Embed token origin mismatch." });
    return;
  }

  embedSessions.delete(token);
  req.session.user = session.user;
  req.session.embedContext = {
    parentOrigin: session.parentOrigin,
    matchId: session.matchId,
    view: session.view,
    expiresAt: session.expiresAt
  };
  res.json({
    user: session.user,
    matchId: session.matchId,
    view: session.view
  });
});

if (isProduction) {
  app.use(express.static(CLIENT_DIST_DIR));

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path === "/health" || req.path === "/ready") {
      next();
      return;
    }

    res.sendFile(path.join(CLIENT_DIST_DIR, "index.html"));
  });
}

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin(origin, callback) {
      callback(null, isAllowedClientOrigin(origin));
    },
    credentials: true,
    methods: ["GET", "POST"]
  }
});

io.engine.use(sessionMiddleware);

setInterval(() => {
  if (closeStaleLobbies() > 0) {
    emitLobbyList();
  }
}, LOBBY_CLEANUP_INTERVAL_MS).unref();

io.on("connection", async socket => {
  console.log(`Client connected: ${socket.id}`);
  const connectedUser = getSocketUser(socket);
  const embedContext = getSocketEmbedContext(socket);
  if (embedContext && embedContext.expiresAt <= Date.now()) {
    const request = socket.request as { session?: { user?: AuthUser; embedContext?: unknown } };
    if (request.session) {
      delete request.session.user;
      delete request.session.embedContext;
    }
    socket.emit("match:error", { message: "Embed session expired. Reload host to refresh token." });
    socket.disconnect(true);
    return;
  }

  socket.use((packet, next) => {
    const runtimeEmbedContext = getSocketEmbedContext(socket);
    if (runtimeEmbedContext && runtimeEmbedContext.expiresAt <= Date.now()) {
      next(new Error("Embed session expired."));
      return;
    }
    const [eventName] = packet;

    if (!canSocketUseDevTools(socket) && typeof eventName === "string" && isDevToolSocketEvent(eventName)) {
      socket.emit("match:error", {
        message: "Developer tools are disabled on this server."
      });
      return;
    }

    next();
  });

  socket.emit("server:welcome", {
    message: "Connected to WARD server",
    socketId: socket.id
  });

  socket.emit("match:savedList", listSavedMatches());
  socket.emit("setup:options", getUserSetupOptions(connectedUser));
  socket.emit("cards:library", listDefaultCardLibrary());
  socket.emit("collection:ownership", connectedUser ? await loadUserCardOwnershipMap(connectedUser.id) : {});
  socket.emit("deck:details", getDeckDetailsForUser(connectedUser));
  socket.emit("lobby:list", listLobbySnapshots());

  socket.on(
    "match:create1v1",
    () => {
      try {
        const cardCatalog = loadCardCatalog(["demo-core"]);
        const cardLimits = loadCardLimitMap();
        const demoDeck = loadDeckList("demo-30-card");

        const match = create1v1MatchFromDeckCardIds({
          cardCatalog,
          cardLimits,
          player1DeckCardIds: demoDeck.cardIds,
          player2DeckCardIds: demoDeck.cardIds,
          player1Name: "Player 1",
          player2Name: "Player 2"
        });

        activeMatches.set(match.matchId, match);
        matchUndoHistory.set(match.matchId, []);

        socket.join(match.matchId);
        emitMatchState(match);

        socket.emit("match:savedList", listSavedMatches());

        console.log(`Created demo 1v1 match: ${match.matchId}`);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:create1v1WithSetup",
    (data: {
      packIds: string[];
      player1DeckId: string;
      player2DeckId: string;
    }) => {
      try {
        const user = requireSocketUser(socket);

        if (!data.packIds || data.packIds.length === 0) {
          throw new Error("Select at least one card pack before creating a match.");
        }

        if (!data.player1DeckId) {
          throw new Error("Select a Player 1 deck.");
        }

        if (!data.player2DeckId) {
          throw new Error("Select a Player 2 deck.");
        }

        const cardCatalog = loadCardCatalog(data.packIds);
        const cardLimits = loadCardLimitMap();
        const player1Deck = loadDeckForUser(user.id, data.player1DeckId);
        const player2Deck = loadDeckForUser(user.id, data.player2DeckId);

        const match = create1v1MatchFromDeckCardIds({
          cardCatalog,
          cardLimits,
          player1DeckCardIds: player1Deck.cardIds,
          player2DeckCardIds: player2Deck.cardIds,
          player1Name: "Player 1",
          player2Name: "Player 2"
        });

        activeMatches.set(match.matchId, match);
        matchUndoHistory.set(match.matchId, []);

        socket.join(match.matchId);
        emitMatchState(match);

        socket.emit("match:savedList", listSavedMatches());

        console.log(
          `Created configured 1v1 match: ${match.matchId} | Packs: ${data.packIds.join(
            ", "
          )} | P1 Deck: ${data.player1DeckId} | P2 Deck: ${data.player2DeckId}`
        );
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on("match:advancePhase", (matchId: string) => {
    try {
      const match = getPlayableMatchOrThrow(matchId);
      requireSocketCanControlActivePlayer(socket, match);
      const updatedMatch = advancePhase(match);

      activeMatches.set(matchId, updatedMatch);
      emitMatchState(updatedMatch);
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on("match:endTurn", (matchId: string) => {
    try {
      const match = getPlayableMatchOrThrow(matchId);
      requireSocketCanControlActivePlayer(socket, match);
      const updatedMatch = endTurn(match);

      activeMatches.set(matchId, updatedMatch);
      emitMatchState(updatedMatch);
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on("match:shuffleAllDecks", (matchId: string) => {
    try {
      const match = getPlayableMatchOrThrow(matchId);
      requireSocketCanControlActivePlayer(socket, match);
      const updatedMatch = shuffleAllDecks(match);

      activeMatches.set(matchId, updatedMatch);
      emitMatchState(updatedMatch);
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on(
    "match:rollOpeningTurnOrder",
    (data: { matchId: string; playerId: string }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlPlayer(socket, data.matchId, data.playerId);
        const updatedMatch = rollOpeningTurnOrder(match, data.playerId);

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:shuffleDeck",
    (data: { matchId: string; playerId: string }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlPlayer(socket, data.matchId, data.playerId);
        const updatedMatch = shuffleDeckForPlayer(match, data.playerId);

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on("match:drawActivePlayer", (matchId: string) => {
    try {
      const match = getPlayableMatchOrThrow(matchId);
      requireSocketCanControlActivePlayer(socket, match);
      const updatedMatch = drawForActivePlayer(match);

      activeMatches.set(matchId, updatedMatch);
      emitMatchState(updatedMatch);
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on("match:drawActivePlayerAndAdvance", (matchId: string) => {
    try {
      const match = getPlayableMatchOrThrow(matchId);
      requireSocketCanControlActivePlayer(socket, match);
      const drawnMatch = drawForActivePlayer(match);
      const updatedMatch =
        drawnMatch.turn.phase === "DRAW" &&
        !drawnMatch.setup.handDiscardRequiredForPlayerId
          ? advancePhase(drawnMatch)
          : drawnMatch;

      activeMatches.set(matchId, updatedMatch);
      emitMatchState(updatedMatch);
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on(
    "match:playPrimaryCreature",
    (data: {
      matchId: string;
      playerId: string;
      cardInstanceId: string;
      sacrificeCardInstanceIds?: string[];
    }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlPlayer(socket, data.matchId, data.playerId);
        const updatedMatch = playCreatureFromHandAsPrimary(
          match,
          data.playerId,
          data.cardInstanceId,
          data.sacrificeCardInstanceIds ?? []
        );

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:promoteLimitedSummonToPrimary",
    (data: { matchId: string; playerId: string; cardInstanceId: string }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlPlayer(socket, data.matchId, data.playerId);
        const updatedMatch = promoteLimitedSummonToPrimary(
          match,
          data.playerId,
          data.cardInstanceId
        );

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:primaryToCemetery",
    (data: { matchId: string; playerId: string }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlPlayer(socket, data.matchId, data.playerId);
        const updatedMatch = sendPrimaryCreatureToCemetery(
          match,
          data.playerId
        );

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:killOwnPrimaryCreature",
    (data: { matchId: string; playerId: string }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlPlayer(socket, data.matchId, data.playerId);
        const updatedMatch = killOwnPrimaryCreature(match, data.playerId);

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:playMagic",
    (data: { matchId: string; playerId: string; cardInstanceId: string }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlPlayer(socket, data.matchId, data.playerId);
        const updatedMatch = playMagicFromHand(
          match,
          data.playerId,
          data.cardInstanceId
        );

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:setHandRevealed",
    (data: { matchId: string; playerId: string; revealed: boolean }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId, { snapshotBeforeAction: false });
        requireSocketCanControlPlayer(socket, data.matchId, data.playerId);
        const revealedIds = new Set(match.setup.revealedHandPlayerIds ?? []);

        if (data.revealed) {
          revealedIds.add(data.playerId);
        } else {
          revealedIds.delete(data.playerId);
        }

        match.setup.revealedHandPlayerIds = [...revealedIds];

        activeMatches.set(data.matchId, match);
        emitMatchState(match);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );


  socket.on(
    "match:updateCannotInflictAttackDamageBattlePolicy",
    (data: {
      matchId: string;
      policy: CannotInflictAttackDamageBattlePolicy;
    }) => {
      try {
        if (data.policy !== "DAMAGE_ONLY" && data.policy !== "SKIP_BATTLE") {
          throw new Error("Invalid battle status policy.");
        }

        const match = getMatchOrThrow(data.matchId);
        pushUndoSnapshot(match);

        match.settings.cannotInflictAttackDamageBattlePolicy = data.policy;
        match.eventLog.push({
          id: `battle-policy-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          sequenceNumber: match.eventLog.length + 1,
          timestamp: new Date().toISOString(),
          type: "BATTLE_STATUS_POLICY_CHANGED",
          payload: {
            cannotInflictAttackDamageBattlePolicy: data.policy,
            message: data.policy === "SKIP_BATTLE"
              ? "Creatures that cannot inflict attack damage are treated as unable to enter battle."
              : "Creatures that cannot inflict attack damage may enter battle, but their attack damage resolves as 0."
          }
        });

        activeMatches.set(data.matchId, match);
        emitMatchState(match);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:startManualBattle",
    (data: { matchId: string; playerId: string; attackerCreatureInstanceId: string; defenderCreatureInstanceId?: string }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlPlayer(socket, data.matchId, data.playerId);
        pushUndoSnapshot(match);
        const updatedMatch = startManualBattleSession(
          match,
          data.playerId,
          data.attackerCreatureInstanceId,
          data.defenderCreatureInstanceId
        );

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:updateBattleSpeedModifiers",
    (data: {
      matchId: string;
      battleSessionId: string;
      modifiers: {
        attackingSpeedDelta?: number;
        defendingSpeedDelta?: number;
        override?: "AUTO" | "ATTACKER_FIRST" | "DEFENDER_FIRST";
        note?: string;
      };
    }) => {
      try {
        const match = getMatchOrThrow(data.matchId);
        requireSocketCanControlActivePlayer(socket, match);
        pushUndoSnapshot(match);
        const updatedMatch = updateManualBattleSpeedModifiers(
          match,
          data.battleSessionId,
          data.modifiers
        );

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:updateBattleStrikeModifiers",
    (data: {
      matchId: string;
      battleSessionId: string;
      strikeId: string;
      modifiers: {
        hitDiceDelta?: number;
        hitFlatBonus?: number;
        forceHitResult?: "AUTO" | "FORCE_HIT" | "FORCE_MISS";
        damageDiceDelta?: number;
        damageFlatBonus?: number;
        damageMultiplier?: number;
        preventAttackDamage?: boolean;
        note?: string;
      };
    }) => {
      try {
        const match = getMatchOrThrow(data.matchId);
        requireSocketCanControlActivePlayer(socket, match);
        pushUndoSnapshot(match);
        const updatedMatch = updateManualBattleStrikeModifiers(
          match,
          data.battleSessionId,
          data.strikeId,
          data.modifiers
        );

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:runBattleSpeedCheck",
    (data: { matchId: string; battleSessionId: string }) => {
      try {
        const match = getMatchOrThrow(data.matchId);
        requireSocketCanControlManualBattleStep(socket, match);
        pushUndoSnapshot(match);
        const updatedMatch = runManualBattleSpeedCheck(match, data.battleSessionId);

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:rollBattleHit",
    (data: { matchId: string; battleSessionId: string }) => {
      try {
        const match = getMatchOrThrow(data.matchId);
        requireSocketCanControlManualBattleStep(socket, match);
        pushUndoSnapshot(match);
        const updatedMatch = rollManualBattleHit(match, data.battleSessionId);

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:rollBattleDamage",
    (data: { matchId: string; battleSessionId: string }) => {
      try {
        const match = getMatchOrThrow(data.matchId);
        requireSocketCanControlManualBattleStep(socket, match);
        pushUndoSnapshot(match);
        const updatedMatch = rollManualBattleDamage(match, data.battleSessionId);

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:playBattleResponseFromHand",
    (data: { matchId: string; playerId: string; cardInstanceId: string; battleSessionId: string; strikeId?: string }) => {
      try {
        const match = getMatchOrThrow(data.matchId);
        requireSocketCanControlPlayer(socket, data.matchId, data.playerId);
        pushUndoSnapshot(match);
        const updatedMatch = playBattleResponseFromHand(match, {
          playerId: data.playerId,
          cardInstanceId: data.cardInstanceId,
          battleSessionId: data.battleSessionId,
          strikeId: data.strikeId
        });

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:applyBattleDamage",
    (data: { matchId: string; battleSessionId: string }) => {
      try {
        const match = getMatchOrThrow(data.matchId);
        requireSocketCanControlManualBattleStep(socket, match);
        pushUndoSnapshot(match);
        const updatedMatch = applyManualBattleDamage(match, data.battleSessionId);

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:rollEffectRoll",
    (data: { matchId: string; effectRollSessionId: string }) => {
      try {
        const match = getMatchOrThrow(data.matchId);
        requireSocketCanControlEffectRollStep(socket, match);
        pushUndoSnapshot(match);
        const updatedMatch = rollPendingEffectRoll(match, data.effectRollSessionId);

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:applyEffectRoll",
    (data: { matchId: string; effectRollSessionId: string }) => {
      try {
        const match = getMatchOrThrow(data.matchId);
        requireSocketCanControlEffectRollStep(socket, match);
        pushUndoSnapshot(match);
        const updatedMatch = applyPendingEffectRoll(match, data.effectRollSessionId);

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:skipEffectRoll",
    (data: { matchId: string; effectRollSessionId: string }) => {
      try {
        const match = getMatchOrThrow(data.matchId);
        requireSocketCanControlEffectRollStep(socket, match);
        pushUndoSnapshot(match);
        const updatedMatch = skipPendingEffectRoll(match, data.effectRollSessionId);

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:finishManualBattle",
    (data: { matchId: string; battleSessionId: string }) => {
      try {
        const match = getMatchOrThrow(data.matchId);
        requireSocketCanControlActivePlayer(socket, match);
        pushUndoSnapshot(match);
        const updatedMatch = finishManualBattleSession(match, data.battleSessionId);

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:cancelManualBattle",
    (data: { matchId: string; battleSessionId: string }) => {
      try {
        const match = getMatchOrThrow(data.matchId);
        requireSocketCanControlActivePlayer(socket, match);
        pushUndoSnapshot(match);
        const updatedMatch = cancelManualBattleSession(match, data.battleSessionId);

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:battlePrimaryCreatures",
    (data: { matchId: string; playerId: string }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlPlayer(socket, data.matchId, data.playerId);
        const updatedMatch = battlePrimaryCreatures(match, data.playerId);

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:battleWithCreature",
    (data: { matchId: string; playerId: string; attackerCreatureInstanceId: string }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlPlayer(socket, data.matchId, data.playerId);
        pushUndoSnapshot(match);
        const updatedMatch = battleWithCreature(
          match,
          data.playerId,
          data.attackerCreatureInstanceId
        );

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:requestNoCreatureRedrawReveal",
    (data: { matchId: string; playerId: string }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlPlayer(socket, data.matchId, data.playerId);
        const updatedMatch = requestNoCreatureRedrawReveal(
          match,
          data.playerId
        );

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:approveNoCreatureRedrawReveal",
    (data: { matchId: string; approvingPlayerId: string }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlPlayer(socket, data.matchId, data.approvingPlayerId);
        const updatedMatch = approveNoCreatureRedrawReveal(
          match,
          data.approvingPlayerId
        );

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:discardFromHand",
    (data: { matchId: string; playerId: string; cardInstanceId: string }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlPlayer(socket, data.matchId, data.playerId);
        const updatedMatch = discardCardFromHand(
          match,
          data.playerId,
          data.cardInstanceId
        );

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:manualDamagePrimary",
    (data: { matchId: string; playerId: string; amount: number }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlPlayer(socket, data.matchId, data.playerId);
        const updatedMatch = applyManualDamageToPrimaryCreature(
          match,
          data.playerId,
          data.amount
        );

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:manualHealPrimary",
    (data: { matchId: string; playerId: string; amount: number }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlPlayer(socket, data.matchId, data.playerId);
        const updatedMatch = applyManualHealToPrimaryCreature(
          match,
          data.playerId,
          data.amount
        );

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:destroyMagicSlotCard",
    (data: {
      matchId: string;
      fieldOwnerPlayerId: string;
      cardInstanceId: string;
    }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        const updatedMatch = destroyMagicSlotCard(
          match,
          data.fieldOwnerPlayerId,
          data.cardInstanceId
        );

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:playLightningResponse",
    (data: { matchId: string; playerId: string; cardInstanceId: string }) => {
      try {
        const match = getMatchOrThrow(data.matchId);
        requireSocketCanControlPlayer(socket, data.matchId, data.playerId);
        pushUndoSnapshot(match);
        const updatedMatch = playLightningResponseFromHand(
          match,
          data.playerId,
          data.cardInstanceId
        );

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:activateCardEffect",
    (data: { matchId: string; playerId: string; sourceInstanceId: string; effectId: string }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlPlayer(socket, data.matchId, data.playerId);
        const updatedMatch = activateCardEffect(match, {
          playerId: data.playerId,
          sourceInstanceId: data.sourceInstanceId,
          effectId: data.effectId
        });

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:devForceRolls",
    (data: { matchId: string; kind: DevRollKind; dice: number[]; label?: string }) => {
      try {
        const match = getMatchOrThrow(data.matchId);
        forceNextDevRolls(match, { kind: data.kind, dice: data.dice, label: data.label });
        activeMatches.set(data.matchId, match);
        emitMatchState(match);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:devClearForcedRolls",
    (data: { matchId: string; kind?: DevRollKind }) => {
      try {
        const match = getMatchOrThrow(data.matchId);
        clearForcedDevRolls(match, data.kind);
        activeMatches.set(data.matchId, match);
        emitMatchState(match);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:passMagicChainPriority",
    (data: { matchId: string; playerId: string }) => {
      try {
        const match = getMatchOrThrow(data.matchId);
        requireSocketCanControlPlayer(socket, data.matchId, data.playerId);
        pushUndoSnapshot(match);
        const updatedMatch = passMagicChainPriority(match, data.playerId);

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on("match:resolveMagicChain", (matchId: string) => {
    try {
      const match = getMatchOrThrow(matchId);
      if (match.pendingChain?.priorityPlayerId) {
        requireSocketCanControlPlayer(socket, matchId, match.pendingChain.priorityPlayerId);
      } else {
        requireSocketCanControlActivePlayer(socket, match);
      }
      pushUndoSnapshot(match);
      const updatedMatch = resolveMagicChain(match);

      activeMatches.set(matchId, updatedMatch);
      emitMatchState(updatedMatch);
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on(
    "match:completeManualMagicEffect",
    (data: { matchId: string; effectId: string }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlActivePlayer(socket, match);
        const updatedMatch = completeManualMagicEffect(match, data.effectId);

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:manualMagicDamagePrimary",
    (data: {
      matchId: string;
      effectId: string;
      targetPlayerId: string;
      amount: number;
    }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlActivePlayer(socket, match);
        const updatedMatch = applyManualMagicDamageToPrimaryCreature(
          match,
          data.effectId,
          data.targetPlayerId,
          data.amount
        );

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:manualMagicHealPrimary",
    (data: {
      matchId: string;
      effectId: string;
      targetPlayerId: string;
      amount: number;
    }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlActivePlayer(socket, match);
        const updatedMatch = applyManualMagicHealToPrimaryCreature(
          match,
          data.effectId,
          data.targetPlayerId,
          data.amount
        );

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:manualMagicDestroySlotCard",
    (data: {
      matchId: string;
      effectId: string;
      fieldOwnerPlayerId: string;
      cardInstanceId: string;
    }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlActivePlayer(socket, match);
        const updatedMatch = destroyMagicSlotCardFromManualEffect(
          match,
          data.effectId,
          data.fieldOwnerPlayerId,
          data.cardInstanceId
        );

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:manualMagicStatModifier",
    (data: {
      matchId: string;
      effectId: string;
      targetPlayerId: string;
      stat: "armorLevel" | "speed" | "attackDice" | "modifier";
      delta: number;
      durationType:
        | "TARGET_PLAYER_TURN_STARTS"
        | "PERMANENT_UNTIL_SOURCE_REMOVED";
      durationTargetPlayerTurnStarts?: number;
    }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlActivePlayer(socket, match);
        const updatedMatch = applyManualMagicStatModifierToPrimaryCreature(
          match,
          data.effectId,
          data.targetPlayerId,
          data.stat,
          data.delta,
          data.durationType,
          data.durationTargetPlayerTurnStarts
        );

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:attachEquipMagic",
    (data: {
      matchId: string;
      fieldOwnerPlayerId: string;
      magicCardInstanceId: string;
      targetPlayerId: string;
    }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlPlayer(socket, data.matchId, data.fieldOwnerPlayerId);
        const updatedMatch = attachEquipMagicToPrimaryCreature(
          match,
          data.fieldOwnerPlayerId,
          data.magicCardInstanceId,
          data.targetPlayerId
        );

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );



  socket.on(
    "match:attachEquipMagicToCreature",
    (data: {
      matchId: string;
      fieldOwnerPlayerId: string;
      magicCardInstanceId: string;
      targetPlayerId: string;
      targetCreatureInstanceId: string;
      targetKind: "PRIMARY_CREATURE" | "LIMITED_SUMMON";
    }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlPlayer(socket, data.matchId, data.fieldOwnerPlayerId);
        const updatedMatch = attachEquipMagicToCreature(
          match,
          data.fieldOwnerPlayerId,
          data.magicCardInstanceId,
          data.targetPlayerId,
          data.targetCreatureInstanceId,
          data.targetKind
        );

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );
  socket.on("setup:listOptions", async () => {
    try {
      const user = getSocketUser(socket);
      socket.emit("setup:options", getUserSetupOptions(user));
      socket.emit("cards:library", listDefaultCardLibrary());
      socket.emit("collection:ownership", user ? await loadUserCardOwnershipMap(user.id) : {});
      socket.emit("deck:details", getDeckDetailsForUser(user));
      socket.emit("lobby:list", listLobbySnapshots());
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on("deck:listDetails", () => {
    try {
      const user = getSocketUser(socket);
      const deckDetails = getDeckDetailsForUser(user);

      socket.emit("deck:details", deckDetails);
      if (canUserReviewTournamentDecks(user)) {
        void listUsersForTournamentDeckReview().then(users => {
          socket.emit(
            "deck:tournamentSubmissions",
            listTournamentDeckSubmissions(users).map(deck => serializeDeckDetail(deck, deck.ownerUserId, deck.ownerDisplayName))
          );
        });
      }
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on("deck:listTournamentSubmissions", async () => {
    try {
      const user = requireSocketUser(socket);
      if (!canUserReviewTournamentDecks(user)) {
        throw new Error("Only hosts and admins can review tournament deck submissions.");
      }

      const users = await listUsersForTournamentDeckReview();
      socket.emit(
        "deck:tournamentSubmissions",
        listTournamentDeckSubmissions(users).map(deck => serializeDeckDetail(deck, deck.ownerUserId, deck.ownerDisplayName))
      );
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on(
    "deck:reviewTournamentSubmission",
    (data: {
      ownerUserId: string;
      deckId: string;
      status: "VERIFIED" | "REJECTED";
      notes?: string;
    }) => {
      try {
        const user = requireSocketUser(socket);
        if (!canUserReviewTournamentDecks(user)) {
          throw new Error("Only hosts and admins can review tournament deck submissions.");
        }

        reviewTournamentDeckSubmission({
          ownerUserId: data.ownerUserId,
          deckId: data.deckId,
          reviewerUserId: user.id,
          reviewerDisplayName: user.displayName,
          status: data.status === "VERIFIED" ? "VERIFIED" : "REJECTED",
          notes: data.notes
        });

        socket.emit("deck:tournamentSubmissionReviewed", {
          message: `Tournament deck ${data.status === "VERIFIED" ? "verified" : "rejected"}.`,
          deckId: data.deckId
        });

        void listUsersForTournamentDeckReview().then(users => {
          io.emit(
            "deck:tournamentSubmissions",
            listTournamentDeckSubmissions(users).map(deck => serializeDeckDetail(deck, deck.ownerUserId, deck.ownerDisplayName))
          );
        });
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on("cards:listForPacks", (data: { packIds: string[] }) => {
    try {
      socket.emit(
        "cards:library",
        listCardLibraryForPacks(data.packIds, loadCardLimitMap())
      );
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on("collection:listOwnership", async () => {
    try {
      const user = getSocketUser(socket);
      socket.emit("collection:ownership", user ? await loadUserCardOwnershipMap(user.id) : {});
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on(
    "collection:setCardOwnership",
    async (data: { cardId: string; ownedCount: number }) => {
      try {
        const user = requireSocketUser(socket);
        const ownershipMap = await setUserCardOwnershipCount({
          userId: user.id,
          ownershipKey: data.cardId,
          ownedCount: data.ownedCount
        });
        socket.emit("collection:ownership", ownershipMap);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );


  socket.on(
    "dev:listEffectCoverage",
    (data?: { packIds?: string[] }) => {
      try {
        const requestedPackIds = data?.packIds?.length
          ? data.packIds
          : listSetupOptions().cardPacks.map(pack => pack.id);

        socket.emit("dev:effectCoverage", buildEffectCoverageRows(requestedPackIds));
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );
  socket.on("dev:getEffectRuntimeTestStatus", () => {
    try {
      socket.emit("dev:effectRuntimeTestStatus", loadEffectRuntimeTestStatusMap());
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on(
    "dev:saveEffectRuntimeTestStatus",
    (data: {
      packIds?: string[];
      record: {
        packId: string;
        cardId: string;
        cardName: string;
        effectId: string;
        trigger?: string;
        actionType: string;
        status: string;
        issueType: string;
        notes: string;
        testedBy?: string;
      };
    }) => {
      try {
        const statusMap = saveEffectRuntimeTestStatusRecord(data.record);
        const requestedPackIds = data.packIds?.length
          ? data.packIds
          : listSetupOptions().cardPacks.map(pack => pack.id);

        socket.emit("dev:effectRuntimeTestStatus", statusMap);
        socket.emit("dev:effectCoverage", buildEffectCoverageRows(requestedPackIds));
        socket.emit("dev:effectRuntimeTestStatusSaved", {
          message: `Saved test status for ${data.record.cardName} ${data.record.effectId}.`
        });
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "dev:bulkSaveEffectRuntimeTestStatus",
    (data: {
      packIds?: string[];
      records: Array<{
        packId: string;
        cardId: string;
        cardName: string;
        effectId: string;
        trigger?: string;
        actionType: string;
        status: string;
        issueType: string;
        notes: string;
        testedBy?: string;
      }>;
    }) => {
      try {
        const statusMap = saveEffectRuntimeTestStatusRecords(data.records);
        const requestedPackIds = data.packIds?.length
          ? data.packIds
          : listSetupOptions().cardPacks.map(pack => pack.id);

        socket.emit("dev:effectRuntimeTestStatus", statusMap);
        socket.emit("dev:effectCoverage", buildEffectCoverageRows(requestedPackIds));
        socket.emit("dev:effectRuntimeTestStatusSaved", {
          message: `Saved ${data.records.length} effect test status record(s).`
        });
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );


  socket.on(
    "dev:saveCardEffects",
    (data: {
      packId: string;
      cardId: string;
      text: string;
      effects: WardEngineEffect[];
      metadata?: {
        rarity?: string;
        creatureType?: string;
        artworkEffect?: string;
        artworkTags?: string[];
      };
    }) => {
      try {
        if (!Array.isArray(data.effects)) {
          throw new Error("Effects must be an array.");
        }

        const updatedCard = updateCardEffectsInPack({
          packId: data.packId,
          cardId: data.cardId,
          text: data.text ?? "",
          effects: data.effects,
          metadata: data.metadata
        });

        socket.emit("dev:cardEffectsSaved", {
          message: `Saved ${updatedCard.name} effects to ${data.packId}.json`,
          packId: data.packId,
          cardId: data.cardId,
          card: updatedCard
        });

        io.emit("setup:options", listSetupOptions());
        io.emit("cards:library", listDefaultCardLibrary());
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:rollAndApplyBattleDamage",
    (data: { matchId: string; battleSessionId: string }) => {
      try {
        const match = getMatchOrThrow(data.matchId);
        requireSocketCanControlManualBattleStep(socket, match);
        pushUndoSnapshot(match);
        const updatedMatch = rollAndApplyManualBattleDamage(match, data.battleSessionId);

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:manualMagicDrawCards",
    (data: { matchId: string; effectId: string; targetPlayerId: string }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlPlayer(socket, data.matchId, data.targetPlayerId);
        const updatedMatch = applyManualMagicDrawCards(
          match,
          data.effectId,
          data.targetPlayerId
        );

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "dev:saveCardLimit",
    (data: {
      packIds?: string[];
      cardId: string;
      limit: number;
      reason?: string;
    }) => {
      try {
        updateCardLimitRule({
          cardId: data.cardId,
          limit: data.limit,
          reason: data.reason
        });

        const requestedPackIds = data.packIds?.length
          ? data.packIds
          : listSetupOptions().cardPacks.map(pack => pack.id);

        socket.emit(
          "cards:library",
          listCardLibraryForPacks(requestedPackIds, loadCardLimitMap())
        );
        socket.emit("dev:cardLimitSaved", {
          message: `Saved tournament limit for ${data.cardId}.`,
          cardId: data.cardId,
          limit: Math.min(3, Math.max(0, Math.floor(data.limit)))
        });
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "dev:createEffectTestMatch",
    (data: {
      packIds: string[];
      player1CardIds: string[];
      player2CardIds: string[];
      player1StartingHandSize?: number;
      player2StartingHandSize?: number;
    }) => {
      try {
        if (!data.packIds || data.packIds.length === 0) {
          throw new Error("Select at least one card pack for the effect test match.");
        }

        if (!data.player1CardIds || data.player1CardIds.length === 0) {
          throw new Error("Player 1 test deck must contain at least one card.");
        }

        if (!data.player2CardIds || data.player2CardIds.length === 0) {
          throw new Error("Player 2 test deck must contain at least one card.");
        }

        const cardCatalog = loadCardCatalog(data.packIds);
        const match = create1v1MatchFromDeckCardIds({
          cardCatalog,
          player1DeckCardIds: data.player1CardIds,
          player2DeckCardIds: data.player2CardIds,
          player1Name: "Effect Test Player 1",
          player2Name: "Effect Test Player 2",
          exactDeckSize: null,
          defaultCopyLimit: Math.max(data.player1CardIds.length, data.player2CardIds.length, 1),
          allowNoCreatures: true
        });

        moveCardsFromDeckToOpeningHand(match, "player_1", data.player1StartingHandSize);
        moveCardsFromDeckToOpeningHand(match, "player_2", data.player2StartingHandSize);
        prepareEffectTestMatchAfterOpeningHands(match);

        activeMatches.set(match.matchId, match);
        matchUndoHistory.set(match.matchId, []);

        socket.join(match.matchId);
        emitMatchState(match);

        socket.emit("dev:testMatchCreated", {
          message: `Created flexible effect test match: ${match.matchId}`,
          matchId: match.matchId
        });
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "dev:createEffectScenarioMatch",
    (data: { packIds: string[]; cardId: string; effectId?: string }) => {
      try {
        if (!data.packIds || data.packIds.length === 0) {
          throw new Error("Select at least one card pack for the effect scenario.");
        }

        const cardCatalog = loadCardCatalog(data.packIds);
        const match = createEffectTestScenarioMatch({
          cardCatalog,
          cardId: data.cardId,
          effectId: data.effectId
        });

        activeMatches.set(match.matchId, match);
        matchUndoHistory.set(match.matchId, []);
        socket.join(match.matchId);
        emitMatchState(match);

        socket.emit("dev:testMatchCreated", {
          message: `Created effect scenario for ${data.cardId}: ${match.matchId}`,
          matchId: match.matchId
        });
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );


  socket.on("llm:getStatus", () => {
    try {
      socket.emit("llm:status", getLlmServiceStatus());
      socket.emit("llm:regressionScenarios", listLlmRegressionScenarios());
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on("llm:listRegressionScenarios", () => {
    try {
      socket.emit("llm:regressionScenarios", listLlmRegressionScenarios());
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on(
    "llm:generateEffectTestPlan",
    async (data: { packId?: string; packIds?: string[]; cardId: string; effectId?: string }) => {
      try {
        const { packId, card } = findCardForLlmRequest(data);
        const effect = data.effectId
          ? card.effects?.find(item => item.id === data.effectId)
          : card.effects?.[0];
        const runtimeSupport = effect ? getEffectRuntimeSupport(effect) : undefined;

        const plan = await generateEffectTestPlan({
          packId,
          card,
          effectId: data.effectId,
          runtimeSupport
        });

        socket.emit("llm:effectTestPlan", plan);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "llm:generateEffectTestPlanBatch",
    async (data: {
      packIds?: string[];
      requests: Array<{ packId?: string; cardId: string; effectId?: string }>;
    }) => {
      try {
        const requests = Array.isArray(data.requests) ? data.requests : [];

        if (requests.length === 0) {
          throw new Error("Add at least one effect request before generating a batch plan.");
        }

        if (requests.length > 75) {
          throw new Error("Batch LLM plan generation is limited to 75 effects at a time.");
        }

        socket.emit("llm:batchProgress", {
          stage: "started",
          completed: 0,
          total: requests.length,
          message: `Queued ${requests.length} effect request${requests.length === 1 ? "" : "s"} for optimized LLM batch planning.`
        });

        const items = requests.map(request => {
          const { packId, card } = findCardForLlmRequest({
            packId: request.packId,
            packIds: data.packIds,
            cardId: request.cardId
          });
          const effect = request.effectId
            ? card.effects?.find(item => item.id === request.effectId)
            : card.effects?.[0];
          const runtimeSupport = effect ? getEffectRuntimeSupport(effect) : undefined;

          return {
            packId,
            card,
            effectId: request.effectId,
            runtimeSupport
          };
        });

        const plans = await generateEffectTestPlanBatch({
          items,
          onProgress: progress => socket.emit("llm:batchProgress", progress)
        });

        socket.emit("llm:effectTestPlanBatch", plans);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "llm:createBulkDeckTestMatch",
    (data: { packIds?: string[]; player1CardIds: string[]; player2CardIds: string[] }) => {
      try {
        const packIds = data.packIds?.length
          ? data.packIds
          : listSetupOptions().cardPacks.map(pack => pack.id);

        if (packIds.length === 0) {
          throw new Error("Select at least one card pack before creating a bulk LLM test match.");
        }

        const cardCatalog = loadCardCatalog(packIds);
        const match = createLlmBulkDeckTestMatch({
          cardCatalog,
          player1CardIds: data.player1CardIds,
          player2CardIds: data.player2CardIds
        });

        activeMatches.set(match.matchId, match);
        matchUndoHistory.set(match.matchId, []);
        socket.join(match.matchId);
        emitMatchState(match);

        socket.emit("dev:testMatchCreated", {
          message: `Created LLM bulk 10-vs-10 test match: ${match.matchId}`,
          matchId: match.matchId
        });
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "llm:createScenarioMatchFromPlan",
    (data: { packIds?: string[]; plan: LlmEffectTestPlan }) => {
      try {
        const packIds = data.packIds?.length ? data.packIds : [data.plan.card.packId];
        const cardCatalog = loadCardCatalog(packIds);
        let match = createEffectTestScenarioMatch({
          cardCatalog,
          cardId: data.plan.card.cardId,
          effectId: data.plan.effect?.effectId
        });

        match.setup.openingRoll = {
          status: "COMPLETE",
          round: 1,
          rolls: {},
          winnerPlayerId: match.turn.activePlayerId
        };
        match.setup.decksShuffled = true;
        match = applyLlmPlanToScenarioMatch(match, data.plan);

        activeMatches.set(match.matchId, match);
        matchUndoHistory.set(match.matchId, []);
        socket.join(match.matchId);
        emitMatchState(match);

        socket.emit("dev:testMatchCreated", {
          message: `Created LLM effect scenario: ${match.matchId}`,
          matchId: match.matchId
        });
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "llm:runDirectEffectSmokeTest",
    (data: { packIds?: string[]; plan: LlmEffectTestPlan }) => {
      try {
        const { match, result } = runLlmDirectEffectSmokeTest({
          packIds: data.packIds?.length ? data.packIds : [data.plan.card.packId],
          plan: data.plan
        });

        activeMatches.set(match.matchId, match);
        matchUndoHistory.set(match.matchId, []);
        socket.join(match.matchId);
        emitMatchState(match);

        socket.emit("llm:directEffectSmokeTestResult", result);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "llm:autoRunIncludedDrafts",
    (data: { packIds?: string[]; plans: LlmEffectTestPlan[] }) => {
      try {
        const plans = Array.isArray(data.plans) ? data.plans : [];

        if (plans.length === 0) {
          throw new Error("No included LLM coverage drafts were selected for auto-run.");
        }

        if (plans.length > 40) {
          throw new Error("Headless auto-run is limited to 40 effects at a time. Run a smaller batch for easier review.");
        }

        socket.emit("llm:batchProgress", {
          stage: "started",
          completed: 0,
          total: plans.length,
          message: `Starting headless engine auto-run for ${plans.length} included draft${plans.length === 1 ? "" : "s"}.`
        });

        const runs = runLlmHeadlessEffectTestBatch({
          packIds: data.packIds,
          plans
        });

        const results: LlmDirectEffectSmokeTestResult[] = [];
        for (let index = 0; index < runs.length; index += 1) {
          const { match, result } = runs[index];
          activeMatches.set(match.matchId, match);
          matchUndoHistory.set(match.matchId, []);
          socket.join(match.matchId);
          saveMatchToDisk(match);
          results.push(result);
          socket.emit("llm:batchProgress", {
            stage: "chunk",
            completed: index + 1,
            total: runs.length,
            message: `Auto-ran ${index + 1}/${runs.length}: ${result.cardName} ${result.effectId ?? "NO_EFFECT"} â†’ ${result.status}.`
          });
        }

        const representative = runs[runs.length - 1]?.match;
        if (representative) {
          emitMatchState(representative);
        }

        socket.emit("llm:directEffectSmokeTestBatchResult", results);
        socket.emit("llm:batchProgress", {
          stage: "done",
          completed: results.length,
          total: results.length,
          message: `Headless auto-run finished for ${results.length} included draft${results.length === 1 ? "" : "s"}.`
        });
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "llm:reviewEffectTestResult",
    async (data: { matchId: string; plan: LlmEffectTestPlan }) => {
      try {
        const match = getMatchOrThrow(data.matchId);
        const review = await reviewEffectTestResult({
          plan: data.plan,
          match
        });

        socket.emit("llm:effectResultReview", review);
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "llm:saveRegressionScenario",
    (data: { plan: LlmEffectTestPlan; review?: LlmEffectResultReview }) => {
      try {
        const saved = saveLlmRegressionScenario({
          plan: data.plan,
          review: data.review
        });

        socket.emit("llm:regressionScenarioSaved", saved);
        socket.emit("llm:regressionScenarios", listLlmRegressionScenarios());
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "llm:saveRegressionScenarioBatch",
    (data: { plans: LlmEffectTestPlan[]; coverageRecords?: EffectRuntimeTestStatusRecord[] }) => {
      try {
        if (!data.plans.length) {
          throw new Error("No LLM regression plans were provided to save.");
        }

        if (data.plans.length > 75) {
          throw new Error("Batch regression fixture saving is limited to 75 plans at a time.");
        }

        const saved = data.plans.map(plan =>
          saveLlmRegressionScenario({
            plan
          })
        );

        const report = saveLlmPhase4VerificationReport({
          plans: data.plans,
          coverageRecords: data.coverageRecords ?? [],
          savedRegressionFileNames: saved.map(item => item.fileName)
        });

        socket.emit("llm:regressionScenarioBatchSaved", {
          count: saved.length,
          saved,
          report
        });
        socket.emit("llm:phase4OutputReportSaved", report);
        socket.emit("llm:regressionScenarios", listLlmRegressionScenarios());
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on("match:listSaved", () => {
    try {
      socket.emit("match:savedList", listSavedMatches());
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on("match:saveCurrent", (matchId: string) => {
    try {
      const match = getMatchOrThrow(matchId);
      saveMatchToDisk(match);

      socket.emit("match:saved", {
        message: `Match saved: ${matchId}`,
        matchId
      });

      socket.emit("match:savedList", listSavedMatches());
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on("match:loadSaved", (matchId: string) => {
    try {
      const match = loadMatchFromDisk(matchId);

      activeMatches.set(match.matchId, match);
      matchUndoHistory.set(match.matchId, []);
      matchPlayerOwners.delete(match.matchId);
      socket.join(match.matchId);

      socket.emit("match:state", match);
      socket.emit("match:saved", {
        message: `Loaded match: ${matchId}`,
        matchId
      });

      socket.emit("match:savedList", listSavedMatches());
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on("match:deleteSaved", (matchId: string) => {
    try {
      deleteMatchFromDisk(matchId);

      activeMatches.delete(matchId);
      matchUndoHistory.delete(matchId);
      matchPlayerOwners.delete(matchId);

      socket.emit("match:deleted", {
        message: `Deleted saved match: ${matchId}`,
        matchId
      });

      io.emit("match:savedList", listSavedMatches());
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on("match:deleteSavedBulk", (data: { matchIds: string[] }) => {
    try {
      const matchIds = [...new Set(data.matchIds ?? [])].filter(Boolean);

      if (matchIds.length === 0) {
        throw new Error("No saved matches were selected for deletion.");
      }

      const deletedMatchIds: string[] = [];
      const failedMatchIds: string[] = [];

      for (const matchId of matchIds) {
        try {
          deleteMatchFromDisk(matchId);
          activeMatches.delete(matchId);
          matchUndoHistory.delete(matchId);
          matchPlayerOwners.delete(matchId);
          deletedMatchIds.push(matchId);
        } catch {
          failedMatchIds.push(matchId);
        }
      }

      if (deletedMatchIds.length > 0) {
        socket.emit("match:bulkDeleted", {
          message: `Deleted ${deletedMatchIds.length} saved match${deletedMatchIds.length === 1 ? "" : "es"}.`,
          matchIds: deletedMatchIds
        });
      }

      if (failedMatchIds.length > 0) {
        socket.emit("match:error", {
          message: `Could not delete ${failedMatchIds.length} saved match${failedMatchIds.length === 1 ? "" : "es"}: ${failedMatchIds.join(", ")}`
        });
      }

      io.emit("match:savedList", listSavedMatches());
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on(
    "match:concede",
    (data: { matchId: string; concedingPlayerId: string }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlPlayer(socket, data.matchId, data.concedingPlayerId);
        const updatedMatch = concedeMatch(match, data.concedingPlayerId);

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
        socket.emit("match:savedList", listSavedMatches());
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on(
    "match:callCemeteryHpLoss",
    (data: {
      matchId: string;
      losingPlayerId: string;
      callingPlayerId: string;
    }) => {
      try {
        const match = getPlayableMatchOrThrow(data.matchId);
        requireSocketCanControlPlayer(socket, data.matchId, data.callingPlayerId);
        const updatedMatch = callCemeteryHpLoss(
          match,
          data.losingPlayerId,
          data.callingPlayerId
        );

        activeMatches.set(data.matchId, updatedMatch);
        emitMatchState(updatedMatch);
        socket.emit("match:savedList", listSavedMatches());
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on("match:undoLastAction", (matchId: string) => {
    try {
      const currentMatch = getMatchOrThrow(matchId);

      if ((currentMatch.status ?? "ACTIVE") === "COMPLETE") {
        throw new Error("Cannot undo after the match is complete.");
      }

      requireSocketCanUndoMatch(socket, currentMatch);

      const history = matchUndoHistory.get(matchId) ?? [];

      if (history.length === 0) {
        throw new Error("No undo history is available for this match.");
      }

      const restoredMatch = history.pop();

      if (!restoredMatch) {
        throw new Error("Unable to restore previous match state.");
      }

      activeMatches.set(matchId, restoredMatch);
      matchUndoHistory.set(matchId, history);

      saveMatchToDisk(restoredMatch);

      socket.join(matchId);
      io.to(matchId).emit("match:state", restoredMatch);
      touchLobbyActivityForMatch(matchId);

      socket.emit("match:saved", {
        message: `Undid last action. Undo steps remaining: ${getUndoCount(matchId)}`,
        matchId
      });

      socket.emit("match:savedList", listSavedMatches());
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on("lobby:list", () => {
    socket.emit("lobby:list", listLobbySnapshots());
  });

  socket.on("lobby:cleanupStale", () => {
    try {
      const closedCount = closeStaleLobbies();
      emitLobbyList();
      socket.emit("lobby:cleanupComplete", {
        message: `Closed ${closedCount} stale ${closedCount === 1 ? "lobby" : "lobbies"}.`,
        closedCount
      });
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on("lobby:view", (lobbyId: string) => {
    try {
      validateDataFileId(lobbyId);
      const lobby = getLobbyOrThrow(lobbyId);
      socket.join(lobby.id);
      socket.emit("lobby:updated", getLobbySnapshot(lobby));

      if (lobby.matchId) {
        const lobbyMatch = activeMatches.get(lobby.matchId);
        if (lobbyMatch) {
          socket.join(lobbyMatch.matchId);
          socket.emit("match:state", lobbyMatch);
        }
      }
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on(
    "lobby:create",
    (data: { name?: string; format?: MatchLobbyFormat; selectedPackIds?: string[]; selectedDeckId?: string }) => {
      try {
        const user = requireSocketUser(socket);
        const selectedPackIds = (data.selectedPackIds?.length ? data.selectedPackIds : listSetupOptions().cardPacks.map(pack => pack.id))
          .map(packId => String(packId ?? "").trim())
          .filter(Boolean);

        if (selectedPackIds.length === 0) {
          throw new Error("Select at least one card pack before creating a lobby.");
        }

        if (data.selectedDeckId) {
          loadDeckForUser(user.id, data.selectedDeckId);
        }

        const now = new Date().toISOString();
        const lobby: MatchLobbyRecord = {
          id: createId("lobby"),
          name: String(data.name ?? `${user.displayName}'s Match`).trim() || `${user.displayName}'s Match`,
          status: "OPEN",
          format: normalizeDeckFormat(data.format),
          hostUserId: user.id,
          selectedPackIds,
          players: [{
            userId: user.id,
            displayName: user.displayName,
            seat: 1,
            selectedDeckId: data.selectedDeckId || undefined,
            ready: Boolean(data.selectedDeckId)
          }],
          createdAt: now,
          updatedAt: now,
          lastActivityAt: now
        };

        matchLobbies.set(lobby.id, lobby);
        socket.join(lobby.id);
        socket.emit("lobby:updated", getLobbySnapshot(lobby));
        emitLobbyList();
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on("lobby:join", (lobbyId: string) => {
    try {
      const user = requireSocketUser(socket);
      validateDataFileId(lobbyId);
      const lobby = getLobbyOrThrow(lobbyId);

      if (lobby.status !== "OPEN") {
        throw new Error("This lobby is no longer open.");
      }

      const existingPlayer = lobby.players.find(player => player.userId === user.id);
      if (!existingPlayer) {
        if (lobby.players.length >= 2) {
          throw new Error("This lobby is full.");
        }

        const takenSeats = new Set(lobby.players.map(player => player.seat));
        const seat = takenSeats.has(1) ? 2 : 1;
        lobby.players.push({
          userId: user.id,
          displayName: user.displayName,
          seat,
          ready: false
        });
      }

      touchLobbyActivity(lobby);
      socket.join(lobby.id);
      emitLobbyUpdated(lobby);
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on("lobby:leave", (lobbyId: string) => {
    try {
      const user = requireSocketUser(socket);
      validateDataFileId(lobbyId);
      const lobby = getLobbyOrThrow(lobbyId);
      lobby.players = lobby.players.filter(player => player.userId !== user.id);
      socket.leave(lobby.id);

      if (lobby.players.length === 0) {
        closeLobby(lobby, "EMPTY");
      } else if (lobby.hostUserId === user.id) {
        lobby.players.sort((a, b) => a.seat - b.seat);
        lobby.hostUserId = lobby.players[0]?.userId ?? lobby.hostUserId;
        touchLobbyActivity(lobby);
      } else {
        touchLobbyActivity(lobby);
      }

      emitLobbyUpdated(lobby);
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on("lobby:selectDeck", (data: { lobbyId: string; deckId: string }) => {
    try {
      const user = requireSocketUser(socket);
      validateDataFileId(data.lobbyId);
      validateDataFileId(data.deckId);
      const lobby = getLobbyOrThrow(data.lobbyId);
      const player = getLobbyPlayerOrThrow(lobby, user.id);
      loadDeckForUser(user.id, data.deckId);

      player.selectedDeckId = data.deckId;
      player.ready = true;
      touchLobbyActivity(lobby);
      emitLobbyUpdated(lobby);
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on("lobby:startMatch", (lobbyId: string) => {
    try {
      const user = requireSocketUser(socket);
      validateDataFileId(lobbyId);
      const lobby = getLobbyOrThrow(lobbyId);

      if (lobby.hostUserId !== user.id) {
        throw new Error("Only the lobby host can start the match.");
      }

      if (lobby.players.length !== 2) {
        throw new Error("Both seats need to be filled before starting the match.");
      }

      const sortedPlayers = [...lobby.players].sort((a, b) => a.seat - b.seat);
      if (!sortedPlayers[0].selectedDeckId || !sortedPlayers[1].selectedDeckId) {
        throw new Error("Both players must choose a deck before the match can start.");
      }

      const player1Deck = loadDeckForUser(sortedPlayers[0].userId, sortedPlayers[0].selectedDeckId);
      const player2Deck = loadDeckForUser(sortedPlayers[1].userId, sortedPlayers[1].selectedDeckId);
      const cardCatalog = loadCardCatalog(lobby.selectedPackIds);
      const isTournamentLobby = lobby.format === "TOURNAMENT";
      const match = create1v1MatchFromDeckCardIds({
        cardCatalog,
        cardLimits: isTournamentLobby ? loadCardLimitMap() : undefined,
        tournamentMode: isTournamentLobby,
        player1DeckCardIds: player1Deck.cardIds,
        player2DeckCardIds: player2Deck.cardIds,
        player1Name: sortedPlayers[0].displayName,
        player2Name: sortedPlayers[1].displayName
      });

      lobby.status = "IN_MATCH";
      lobby.matchId = match.matchId;
      touchLobbyActivity(lobby);
      activeMatches.set(match.matchId, match);
      matchUndoHistory.set(match.matchId, []);
      matchPlayerOwners.set(match.matchId, new Map([
        [sortedPlayers[0].userId, "player_1"],
        [sortedPlayers[1].userId, "player_2"]
      ]));
      saveMatchToDisk(match);

      io.in(lobby.id).socketsJoin(match.matchId);
      io.to(lobby.id).emit("lobby:updated", getLobbySnapshot(lobby));
      io.to(lobby.id).emit("match:state", match);
      io.to(lobby.id).emit("match:savedList", listSavedMatches());
      emitLobbyList();
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  socket.on(
    "deck:load",
    (data: { deckId: string; mode?: "edit" | "clone" }) => {
      try {
        const user = requireSocketUser(socket);
        validateDataFileId(data.deckId);

        const deck = loadUserDeckList(user.id, data.deckId);

        socket.emit("deck:loaded", {
          id: deck.id,
          name: deck.name,
          cardIds: deck.cardIds,
          cardArtKeys: deck.cardArtKeys,
          format: normalizeDeckFormat(deck.format),
          mode: data.mode === "clone" ? "clone" : "edit"
        });
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );
  socket.on(
    "deck:save",
    (data: {
      deckId: string;
      name: string;
      packIds: string[];
      cardIds: string[];
      cardArtKeys?: string[];
      format?: "FREE_PLAY" | "TOURNAMENT";
      overwrite?: boolean;
    }) => {
      try {
        const user = requireSocketUser(socket);
        validateDataFileId(data.deckId);

        if (userDeckFileExists(user.id, data.deckId) && !data.overwrite) {
            socket.emit("deck:overwriteRequired", {
              message: `Deck ID "${data.deckId}" already exists. Confirm overwrite to replace it.`,
              deckId: data.deckId,
              name: data.name,
              packIds: data.packIds,
              cardIds: data.cardIds,
              cardArtKeys: data.cardArtKeys,
              format: normalizeDeckFormat(data.format)
            });

            return;
          }

        if (!data.name.trim()) {
          throw new Error("Deck name is required.");
          }

        if (!data.packIds || data.packIds.length === 0) {
          throw new Error("At least one card pack must be selected.");
        }

        const cardCatalog = loadCardCatalog(data.packIds);
        const deckFormat = normalizeDeckFormat(data.format);
        const cardLimits = deckFormat === "TOURNAMENT" ? loadCardLimitMap() : {};

        const validation = validateDeckCardIds({
          cardIds: data.cardIds,
          cardCatalog,
          cardLimits
        });

        if (!validation.isLegal) {
          const errors = validation.issues
            .filter((issue: { severity: string; message: string }) => issue.severity === "ERROR")
            .map((issue: { severity: string; message: string }) => issue.message);

          throw new Error(errors.join(" | "));
        }

        const existingDeck = userDeckFileExists(user.id, data.deckId)
          ? loadUserDeckList(user.id, data.deckId)
          : null;
        const normalizedCardArtKeys = normalizeDeckCardArtKeys(data.cardArtKeys, data.cardIds.length);
        const existingComparable = existingDeck
          ? JSON.stringify({
              name: existingDeck.name,
              cardIds: existingDeck.cardIds,
              cardArtKeys: existingDeck.cardArtKeys,
              format: normalizeDeckFormat(existingDeck.format)
            })
          : "";
        const nextComparable = JSON.stringify({
          name: data.name.trim(),
          cardIds: data.cardIds,
          cardArtKeys: normalizedCardArtKeys,
          format: deckFormat
        });
        const deckChanged = existingComparable !== nextComparable;
        const existingProofPhotos = existingDeck?.tournamentProofPhotos ?? [];

        const deck: DeckListDefinition = {
          id: data.deckId,
          name: data.name.trim(),
          cardIds: data.cardIds,
          cardArtKeys: normalizedCardArtKeys,
          format: deckFormat,
          tournamentProofPhotos: deckFormat === "TOURNAMENT" ? existingProofPhotos : undefined,
          tournamentVerification: deckFormat === "TOURNAMENT" && existingProofPhotos.length > 0
            ? deckChanged
              ? { status: "PENDING", submittedAt: new Date().toISOString(), notes: "Deck changed after proof upload. Re-review required." }
              : existingDeck?.tournamentVerification
            : undefined
        };

        saveUserDeckListToDisk(user.id, deck);

        socket.emit("deck:saved", {
          message: `Deck saved: ${deck.name}`,
          deckId: deck.id
        });

        socket.emit("setup:options", getUserSetupOptions(user));
        socket.emit("cards:library", listDefaultCardLibrary());
        socket.emit("deck:details", getDeckDetailsForUser(user));
      } catch (error) {
        socket.emit("match:error", {
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  );

  socket.on("deck:delete", (deckId: string) => {
  try {
    const user = requireSocketUser(socket);
    validateDataFileId(deckId);

    if (deckId === "demo-30-card") {
      throw new Error("The default demo deck cannot be deleted.");
    }

    deleteUserDeckFromDisk(user.id, deckId);

    socket.emit("deck:deleted", {
      message: `Deleted deck: ${deckId}`,
      deckId
    });

    socket.emit("setup:options", getUserSetupOptions(user));
    socket.emit("cards:library", listDefaultCardLibrary());
    socket.emit("deck:details", getDeckDetailsForUser(user));
  } catch (error) {
    socket.emit("match:error", {
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

socket.on(
  "match:resolveEffectTarget",
  (data: {
    matchId: string;
    promptId: string;
    selectedOptionId: string;
  }) => {
    try {
      const match = getPlayableMatchOrThrow(data.matchId, {
        allowPendingEffectTarget: true,
        allowPendingBattle: true,
        snapshotBeforeAction: false
      });
      requireSocketCanControlEffectTargetPrompt(socket, match);
      pushUndoSnapshot(match);

      const updatedMatch = resolvePendingEffectTargetPrompt(
        match,
        data.promptId,
        data.selectedOptionId
      );

      activeMatches.set(data.matchId, updatedMatch);
      emitMatchState(updatedMatch);
    } catch (error) {
      socket.emit("match:error", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
);

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`WARD server running at http://localhost:${PORT}`);
});
