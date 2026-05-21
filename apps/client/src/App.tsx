import { useEffect, useMemo, useState } from "react";
import { BattleResolverModal } from "./components/BattleResolverModal";
import { useRef } from "react";
import { BattleResultCard } from "./components/BattleResultCard";
import { DiceRollerPanel } from "./components/DiceRollerPanel";
import { EffectCoveragePage } from "./components/EffectCoveragePage";
import { EffectDebugPanel } from "./components/EffectDebugPanel";
import { EffectDevToolPage } from "./components/EffectDevToolPage";
import { EmailVerificationGate } from "./components/EmailVerificationGate";
import { DeckLibraryPage, type DeckLibraryImportSaveRequest, type DeckLibraryImportSaveResult } from "./components/DeckLibraryPage";
import { EventLogCard } from "./components/EventLogCard";
import { EffectRollModal } from "./components/EffectRollModal";
import { LibraryDecksPage } from "./components/LibraryDecksPage";
import { LlmEffectTestLabPage } from "./components/LlmEffectTestLabPage";
import { LoginPage } from "./components/LoginPage";
import { HandRevealPromptCard } from "./components/HandRevealPromptCard";
import { ForcedAlSummonPromptCard } from "./components/ForcedAlSummonPromptCard";
import { MagicChainCard } from "./components/MagicChainCard";
import { ManualEffectQueueCard } from "./components/ManualEffectQueueCard";
import { MatchCompleteCard } from "./components/MatchCompleteCard";
import { MatchLobbyPanel } from "./components/MatchLobbyPanel";
import { CompactMatchControlPanel } from "./components/CompactMatchControlPanel";
import { GameplayKeybindingLabel } from "./components/GameplayKeybindingHint";
import { MatchStatePanel } from "./components/MatchStatePanel";
import { MarketplaceTransactionPanel } from "./components/MarketplaceTransactionPanel";
import { MarketplacePage } from "./components/MarketplacePage";
import { BoardPreviewPage } from "./components/BoardPreviewPage";
import { BoardPreview3D } from "./components/BoardPreview3D";
import { BoardReportPanel, type QueuedBoardReport } from "./components/BoardReportPanel";
import { QATicketsPage, type QATicketRecord } from "./components/QATicketsPage";
import type { PointerGestureIntent } from "./components/boardInteractionIntents";
import type { BoardIntentCommand } from "./components/boardIntentCommands";
import { ProfilePage } from "./components/ProfilePage";
import { AdminControlsPage } from "./components/AdminControlsPage";
import { SaveLoadPanel } from "./components/SaveLoadPanel";
import { SiteReportPanel } from "./components/SiteReportPanel";
import { TargetPromptCard } from "./components/TargetPromptCard";
import { ModalPanel } from "./components/ui/ModalPanel";
import type { CardArtKey } from "./components/CardImagePreview";
import { socket } from "./socket";
import { API_BASE_URL } from "./config";
import { hasCompletedEmailVerification, needsEmailVerification } from "./authVerification";
import { applyMatchDelta } from "./matchDelta";
import {
  parseEmbedMode,
  parseEmbedParentOrigin,
  parseReferrerOrigin
} from "./embed/embedProtocol";
import type { EmbedPage, EmbedView } from "./embed/embedTypes";
import { canApplyEmbedPage, canApplyEmbedView, parseRequestedEmbedView, type PlayViewMode } from "./embed/embedGuards";
import { useEmbedBridge } from "./embed/useEmbedBridge";
import type { DevRollKind, WardEngineEffect } from "@ward/shared";
import type {
  AppMatchState,
  AuthUser,
  CardLibraryCardSummary,
  CardOwnershipMap,
  CardPackSummary,
  DeckFormat,
  DeckDetail,
  DeckSummary,
  EffectCoverageRow,
  EffectRuntimeIssueType,
  EffectRuntimeTestStatus,
  EffectRuntimeTestStatusRecord,
  LlmBatchProgress,
  LlmDirectEffectSmokeTestResult,
  LlmEffectTestPlan,
  LlmPhase4ReportSummary,
  LlmRegressionScenarioSummary,
  LlmServiceStatus,
  MatchDeltaPayload,
  MatchLobby,
  MarketplaceTransaction,
  ManualEffectDurationType,
  ManualEffectStatKey,
  SavedMatchSummary,
  ServerWelcome,
  SupportTicketSummary,
  SupportTicketDetail,
  SetupOptions
  ,ServerFeatureFlag
} from "./clientTypes";
import { getAdvanceBlockReason, getMatchStatus } from "./gameViewHelpers";
import {
  GAMEPLAY_KEYBINDINGS_CHANGED_EVENT,
  getGameplayKeybindingActionByCode,
  isEditableKeybindingTarget,
  readGameplayKeybindings,
  type GameplayKeybindingAction,
  type GameplayKeybindings
} from "./keybindings";
import "./App.css";

type AppPage = "play" | "card-library" | "deck-library" | "marketplace" | "saved-matches" | "profile" | "qa-tickets" | "effect-dev" | "effect-coverage" | "llm-tests" | "board-preview" | "admin-controls";
const DEFAULT_APP_PAGE: AppPage = "card-library";
const SOCKET_SESSION_ERROR_PREFIX = "The live server connection did not receive your login session.";
const SERVER_BOOT_STORAGE_KEY = "ward-nexus-server-boot-id";
const AUTH_SESSION_SEEN_STORAGE_KEY = "ward-nexus-auth-session-seen";
const SERVER_RESTART_NOTICE = "Ward Nexus was just restarted. Please log in again. If sign-in keeps looping, fully close and reopen your browser before signing in again.";

function buildCardLibraryRequestKey(packIds: string[], cardPacks: CardPackSummary[]): string {
  const packsById = new Map(cardPacks.map(pack => [pack.id, pack]));

  return [...packIds]
    .sort((a, b) => a.localeCompare(b))
    .map(packId => {
      const pack = packsById.get(packId);
      return [
        packId,
        pack?.version ?? "",
        pack?.cardCount ?? "",
        pack?.updatedAt ?? ""
      ].join(":");
    })
    .join("|");
}

function shouldAutoIncludeNewCardPacks(currentPackIds: string[], validPackIds: string[]): boolean {
  if (currentPackIds.length === 0 || currentPackIds.length >= validPackIds.length) return false;

  const baseGenerationPackIds = validPackIds.filter(packId => /^ward-gen\d+$/i.test(packId));
  if (baseGenerationPackIds.length === 0) return false;

  return baseGenerationPackIds.every(packId => currentPackIds.includes(packId)) &&
    currentPackIds.every(packId => baseGenerationPackIds.includes(packId));
}

type ServerIdentityPayload = {
  serverBootId?: string;
  serverStartedAt?: string;
};

function readClientStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeClientStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures; the live socket check still works for this tab.
  }
}

function removeClientStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}


const BOARD_REPORT_QUEUE_STORAGE_KEY = "ward-board-report-queue";
const BOARD_REPORT_BACKGROUND_FLUSH_MS = 90_000;
const QA_TICKET_STORAGE_KEY = "ward-qa-tickets-local";
const QA_MATCH_SNAPSHOT_STORAGE_KEY = "ward-qa-match-snapshots-local";

function readQueuedBoardReports(): Record<string, QueuedBoardReport[]> {
  const raw = readClientStorage(BOARD_REPORT_QUEUE_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, QueuedBoardReport[]>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeQueuedBoardReports(queue: Record<string, QueuedBoardReport[]>): void {
  writeClientStorage(BOARD_REPORT_QUEUE_STORAGE_KEY, JSON.stringify(queue));
}

function queueBoardReport(report: QueuedBoardReport): void {
  const queue = readQueuedBoardReports();
  queue[report.matchId] = [...(queue[report.matchId] ?? []), report].slice(-20);
  writeQueuedBoardReports(queue);
}

async function flushQueuedBoardReports(matchId: string, matchSnapshot?: AppMatchState): Promise<number> {
  const queue = readQueuedBoardReports();
  const reports = queue[matchId] ?? [];
  if (reports.length === 0) return 0;

  const payload: { matchId: string; reports: QueuedBoardReport[]; matchSnapshot?: AppMatchState } = {
    matchId,
    reports
  };
  if (matchSnapshot) {
    payload.matchSnapshot = matchSnapshot;
  }

  const response = await fetch(`${API_BASE_URL}/api/support-tickets/board-report/batch`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(payload.message ?? "Unable to flush queued board reports.");
  }

  delete queue[matchId];
  writeQueuedBoardReports(queue);
  return reports.length;
}

function getBoardReportFlushErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to send queued board reports.";
}

function readLocalQaTickets(): QATicketRecord[] {
  const raw = readClientStorage(QA_TICKET_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as QATicketRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalQaTickets(tickets: QATicketRecord[]): void {
  writeClientStorage(QA_TICKET_STORAGE_KEY, JSON.stringify(tickets));
}

function readLocalQaMatchSnapshots(): Record<string, AppMatchState> {
  const raw = readClientStorage(QA_MATCH_SNAPSHOT_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, AppMatchState>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalQaMatchSnapshots(snapshots: Record<string, AppMatchState>): void {
  writeClientStorage(QA_MATCH_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshots));
}

function mapSupportTicketToReport(ticket: SupportTicketSummary | SupportTicketDetail): QATicketRecord {
  const context = "clientContext" in ticket ? ticket.clientContext : {};
  const reportStatus = typeof context.reportStatus === "string" ? context.reportStatus : undefined;
  return {
    id: ticket.id,
    title: ticket.subject,
    details: ticket.description,
    severity: ticket.severity,
    status: reportStatus === "IN_PROGRESS" || reportStatus === "READY_FOR_RETEST" || reportStatus === "VERIFIED" || reportStatus === "REOPENED"
      ? reportStatus
      : "OPEN",
    createdBy: ticket.reporterDisplayName ?? ticket.reporterUsername ?? ticket.reporterUserId ?? "Unknown",
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    matchId: ticket.matchId,
    resolutionNotes: typeof context.resolutionNotes === "string" ? context.resolutionNotes : "",
    relatedCardId: typeof context.relatedCardId === "string" ? context.relatedCardId : undefined,
    relatedCardName: typeof context.relatedCardName === "string" ? context.relatedCardName : undefined,
    relatedMatchIds: Array.isArray(context.relatedMatchIds) ? context.relatedMatchIds.filter(item => typeof item === "string") : [],
    addendums: Array.isArray(context.addendums) ? context.addendums as QATicketRecord["addendums"] : [],
    intent: context.intent === "SUGGESTION" ? "SUGGESTION" : "BUG"
  };
}
const APP_PAGES = new Set<AppPage>([
  "play",
  "card-library",
  "deck-library",
  "marketplace",
  "saved-matches",
  "qa-tickets",
  "profile",
  "effect-dev",
  "effect-coverage",
  "llm-tests",
  "board-preview",
  "admin-controls"
]);
const DEV_TOOL_PAGES = new Set<AppPage>(["effect-dev", "effect-coverage", "llm-tests", "board-preview"]);

function isDevToolPage(page: AppPage): boolean {
  return DEV_TOOL_PAGES.has(page);
}

function normalizeMarketplaceQuantity(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Math.max(1, Number.isFinite(parsed) ? Math.floor(parsed) : 1);
}

function getMarketplacePayloadItems(data: Record<string, unknown>, cardLibrary: CardLibraryCardSummary[]) {
  const rawItems = Array.isArray(data.cardItems)
    ? data.cardItems
    : data.cardId
      ? [data]
      : [];

  return rawItems
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map(item => {
      const cardId = String(item.cardId ?? "");
      const card = cardLibrary.find(candidate => candidate.id === cardId);
      return {
        cardId,
        name: card?.name ?? String(item.cardName ?? item.name ?? cardId),
        variant: String(item.variant ?? "default"),
        quantity: normalizeMarketplaceQuantity(item.quantity ?? item.missing ?? 1),
        trade: item.trade !== false,
        sale: item.sale === true,
        price: typeof item.price === "string" ? item.price : undefined
      };
    })
    .filter(item => item.cardId);
}

function getLobbyCreatedTime(lobby: MatchLobby): number {
  const createdAt = Date.parse(lobby.createdAt);
  return Number.isFinite(createdAt) ? createdAt : 0;
}

function sortLobbiesByCreatedAt(lobbies: MatchLobby[]): MatchLobby[] {
  return [...lobbies].sort((a, b) =>
    getLobbyCreatedTime(b) - getLobbyCreatedTime(a) ||
    b.id.localeCompare(a.id)
  );
}

function parseRequestedPage(search: string): AppPage | null {
  const params = new URLSearchParams(search);
  const requestedPage = params.get("page");
  if (requestedPage === "profile" && !params.has("discord") && !params.has("message")) {
    return null;
  }
  return APP_PAGES.has(requestedPage as AppPage) ? requestedPage as AppPage : null;
}

function parseBoardWindowMode(search: string): boolean {
  return new URLSearchParams(search).get("boardWindow") === "1";
}

function parseEmbedToken(search: string): string | null {
  const token = new URLSearchParams(search).get("embedToken");
  return token && token.trim().length > 0 ? token.trim() : null;
}

function isManualDrawEffect(effect: AppMatchState["manualEffectQueue"][number]): boolean {
  const actionType = String(effect.actionType ?? "").trim().toUpperCase();
  return actionType === "DRAW_CARDS" || actionType === "DRAW_CARDS_VARIABLE";
}

function getOpeningRollState(match: AppMatchState): NonNullable<AppMatchState["setup"]["openingRoll"]> | null {
  if (match.setup.openingRoll) return match.setup.openingRoll;

  const noOpeningCardsDrawn =
    match.players.every(player => player.hand.length === 0) &&
    match.players.every(player => !match.setup.firstTurnDrawsByPlayer[player.id]);
  const appearsToBeFreshOpening =
    getMatchStatus(match) !== "COMPLETE" &&
    noOpeningCardsDrawn &&
    match.turn.turnNumber === 1 &&
    match.turn.phase === "DRAW";

  if (!appearsToBeFreshOpening) return null;

  return {
    status: "AWAITING_ROLL",
    round: 1,
    rolls: {}
  };
}

function isOpeningRollCompleteForDraw(match: AppMatchState): boolean {
  const openingRoll = getOpeningRollState(match);
  return !openingRoll || openingRoll.status === "COMPLETE";
}

function canDrawForCurrentTurn(match: AppMatchState, controlledPlayerId?: string): boolean {
  const activePlayer = match.players.find(player => player.id === match.turn.activePlayerId);
  return (
    getMatchStatus(match) !== "COMPLETE" &&
    (!controlledPlayerId || controlledPlayerId === match.turn.activePlayerId) &&
    isOpeningRollCompleteForDraw(match) &&
    match.setup.decksShuffled &&
    !match.pendingPrompt &&
    !match.pendingBattle &&
    !match.pendingChain &&
    !match.pendingEffectTargetPrompt &&
    !match.manualEffectQueue.some(effect => !effect.completed) &&
    !match.setup.handDiscardRequiredForPlayerId &&
    !activePlayer?.turnFlags.drawnThisTurn
  );
}

function targetPromptCanResolveOnBoard(match: AppMatchState): boolean {
  const prompt = match.pendingEffectTargetPrompt;
  if (!prompt) return false;

  return prompt.options.some(option =>
    !!option.cardInstanceId &&
    (
      option.targetKind === "PRIMARY_CREATURE" ||
      option.targetKind === "LIMITED_SUMMON" ||
      option.targetKind === "MAGIC_SLOT_CARD" ||
      option.targetKind === "CARD_IN_CEMETERY"
    )
  );
}

function getPendingManualDrawEffectForPlayer(match: AppMatchState, playerId: string) {
  const targetPlayerExists = match.players.some(player => player.id === playerId);
  if (!targetPlayerExists) return undefined;

  return match.manualEffectQueue.find(effect =>
    !effect.completed &&
    isManualDrawEffect(effect)
  );
}

function getPendingPromptControllerId(prompt: AppMatchState["pendingPrompt"]): string | undefined {
  if (!prompt) return undefined;
  return prompt.type === "NO_CREATURE_REDRAW_REVEAL"
    ? prompt.approvingPlayerId
    : prompt.controllerPlayerId;
}

type DashboardModal =
  | "save-load"
  | "manual-effects"
  | "battle-result"
  | "dice-roller"
  | "event-log"
  | "match-details"
  | "effect-debug"
  | "board-report"
  | "site-report"
  | null;

type OwnershipSaveStatus = "idle" | "saving" | "saved" | "error";
type SocketAckResponse = { ok: boolean; error?: string; message?: string };
type AccountSaveEvent = "collection:updateOwnership" | "deck:save";

export default function App() {
  const [locationSearch, setLocationSearch] = useState(() => window.location.search);
  const embedModeEnabled = useMemo(() => parseEmbedMode(locationSearch), [locationSearch]);
  const requestedPage = useMemo(() => parseRequestedPage(locationSearch), [locationSearch]);
  const requestedView = useMemo(() => parseRequestedEmbedView(locationSearch), [locationSearch]);
  const boardWindowMode = useMemo(() => parseBoardWindowMode(locationSearch), [locationSearch]);
  const embedToken = useMemo(() => parseEmbedToken(locationSearch), [locationSearch]);
  const embedParentOrigin = useMemo(() => parseEmbedParentOrigin(locationSearch), [locationSearch]);
  const referrerOrigin = useMemo(() => parseReferrerOrigin(document.referrer), []);
  const messagingOrigin = embedParentOrigin ?? referrerOrigin;
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [socketAuthenticated, setSocketAuthenticated] = useState<boolean | null>(null);
  const [featureFlagsLoaded, setFeatureFlagsLoaded] = useState(false);
  const [profileRefreshKey, setProfileRefreshKey] = useState(0);
  const [gameplayKeybindings, setGameplayKeybindings] = useState<GameplayKeybindings>(() => readGameplayKeybindings());
  const [serverMessage, setServerMessage] = useState("Connecting...");
  const [serverRestartNotice, setServerRestartNotice] = useState("");
  const [match, setMatch] = useState<AppMatchState | null>(null);
  const [controlledPlayersByMatchId, setControlledPlayersByMatchId] = useState<Record<string, "player_1" | "player_2">>({});
  const [, setMatchViewModeByMatchId] = useState<Record<string, "participant" | "spectator">>({});
  const [, setWatchPolicy] = useState<"PUBLIC" | "LOBBY_MEMBERS" | "PARTICIPANTS_ONLY">("PUBLIC");
  const [error, setError] = useState("");
  const [savedMatches, setSavedMatches] = useState<SavedMatchSummary[]>([]);
  const [saveMessage, setSaveMessage] = useState("");
  const [supportTicketRefreshKey, setSupportTicketRefreshKey] = useState(0);
  const [cardPacks, setCardPacks] = useState<CardPackSummary[]>([]);
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [deckDetails, setDeckDetails] = useState<DeckDetail[]>([]);
  const [tournamentDeckSubmissions, setTournamentDeckSubmissions] = useState<DeckDetail[]>([]);
  const [matchLobbies, setMatchLobbies] = useState<MatchLobby[]>([]);
  const [activeLobby, setActiveLobby] = useState<MatchLobby | undefined>();
  const [selectedPackIds, setSelectedPackIds] = useState<string[]>([]);
  const [cardLibrary, setCardLibrary] = useState<CardLibraryCardSummary[]>([]);
  const [marketplaceTransactions, setMarketplaceTransactions] = useState<MarketplaceTransaction[]>([]);
  const [effectCoverageRows, setEffectCoverageRows] = useState<EffectCoverageRow[]>([]);
  const [cardOwnershipCounts, setCardOwnershipCounts] = useState<CardOwnershipMap>({});
  const [ownershipSaveStatus, setOwnershipSaveStatus] = useState<OwnershipSaveStatus>("idle");
  const [deckBuilderName, setDeckBuilderName] = useState("New Test Deck");
  const [deckBuilderId, setDeckBuilderId] = useState("new-test-deck");
  const [deckBuilderCardIds, setDeckBuilderCardIds] = useState<string[]>([]);
  const [deckBuilderCardArtKeys, setDeckBuilderCardArtKeys] = useState<CardArtKey[]>([]);
  const [deckBuilderFormat, setDeckBuilderFormat] = useState<DeckFormat>("FREE_PLAY");
  const [manualEffectAmounts, setManualEffectAmounts] = useState<Record<string, string>>({});
  const [manualEffectStats, setManualEffectStats] = useState<Record<string, ManualEffectStatKey>>({});
  const [manualEffectDurations, setManualEffectDurations] = useState<Record<string, string>>({});
  const [manualEffectDurationTypes, setManualEffectDurationTypes] = useState<
    Record<string, ManualEffectDurationType>
  >({});
  const [dashboardModal, setDashboardModal] = useState<DashboardModal>(null);
  const [activePage, setActivePage] = useState<AppPage>(() => parseRequestedPage(window.location.search) ?? DEFAULT_APP_PAGE);
  const [qaTickets, setQaTickets] = useState<QATicketRecord[]>(() => readLocalQaTickets());
  const [qaMatchSnapshots, setQaMatchSnapshots] = useState<Record<string, AppMatchState>>(() => readLocalQaMatchSnapshots());
  const [playViewMode, setPlayViewMode] = useState<PlayViewMode>("board3d");
  const [lastBoardIntentLabel, setLastBoardIntentLabel] = useState("");
  const [lastBoardCommandLabel, setLastBoardCommandLabel] = useState("");
  const [effectDevFocusedCardKey, setEffectDevFocusedCardKey] = useState("");
  const [effectCoverageFocusedCardKey, setEffectCoverageFocusedCardKey] = useState("");
  const [llmStatus, setLlmStatus] = useState<LlmServiceStatus | undefined>();
  const [llmBatchPlans, setLlmBatchPlans] = useState<LlmEffectTestPlan[]>([]);
  const [llmRegressionScenarios, setLlmRegressionScenarios] = useState<LlmRegressionScenarioSummary[]>([]);
  const [llmPhase4Report, setLlmPhase4Report] = useState<LlmPhase4ReportSummary | undefined>();
  const [llmBatchProgress, setLlmBatchProgress] = useState<LlmBatchProgress | undefined>();
  const [llmDirectTestResults, setLlmDirectTestResults] = useState<Record<string, LlmDirectEffectSmokeTestResult>>({});
  const [llmBusy, setLlmBusy] = useState(false);
  const [featureFlags, setFeatureFlags] = useState<ServerFeatureFlag[]>([]);
  const [dismissedRetestToastMatchId, setDismissedRetestToastMatchId] = useState("");
  const [qaInitialAddendumTicketId, setQaInitialAddendumTicketId] = useState<string | null>(null);
  const lastRequestedCardLibraryKeyRef = useMemo(() => ({ current: "" }), []);
  const socketAuthRefreshAttemptedRef = useRef(false);
  const socketAuthRefreshInFlightRef = useRef(false);
  const lastServerBootIdRef = useRef(readClientStorage(SERVER_BOOT_STORAGE_KEY));
  const canLoadAppDataRef = useRef(false);
  const socketAuthUserIdRef = useRef<string | null>(null);
  const boardReportFlushInFlightRef = useRef(false);
  const canUseDevTools = !!authUser?.devToolsEnabled;
  useEffect(() => {
    if (!authUser) return;
    void (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/reports?limit=100`, { credentials: "include" });
        const payload = await response.json().catch(() => ({})) as { reports?: SupportTicketDetail[] };
        if (!response.ok || !Array.isArray(payload.reports)) return;
        const reports = payload.reports.map(mapSupportTicketToReport);
        setQaTickets(reports);
        writeLocalQaTickets(reports);
      } catch {
        // Keep local fallback.
      }
    })();
  }, [authUser, supportTicketRefreshKey]);
  const createQaTicket = (ticket: Omit<QATicketRecord, "id" | "createdAt" | "updatedAt">): void => {
    void (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/reports`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            matchId: ticket.matchId,
            title: ticket.title,
            details: ticket.details,
            severity: ticket.severity,
            status: ticket.status,
            intent: ticket.intent ?? "BUG",
            relatedCardId: ticket.relatedCardId,
            relatedCardName: ticket.relatedCardName,
            relatedMatchIds: ticket.relatedMatchIds ?? [],
            resolutionNotes: ticket.resolutionNotes ?? "",
            addendums: ticket.addendums ?? []
          })
        });
        const payload = await response.json().catch(() => ({})) as { report?: SupportTicketDetail; message?: string };
        if (!response.ok || !payload.report) {
          throw new Error(payload.message ?? "Unable to create report.");
        }
        const serverTicket = mapSupportTicketToReport(payload.report);
        setQaTickets(previous => {
          const withoutLocalDuplicate = previous.filter(item => item.id !== serverTicket.id);
          const updated = [serverTicket, ...withoutLocalDuplicate].slice(0, 200);
          writeLocalQaTickets(updated);
          return updated;
        });
      } catch {
        const now = new Date().toISOString();
        const fallbackTicket: QATicketRecord = {
          ...ticket,
          id: `LOCAL-${Date.now().toString(36).toUpperCase()}`,
          createdAt: now,
          updatedAt: now
        };
        setQaTickets(previous => {
          const updated = [fallbackTicket, ...previous].slice(0, 200);
          writeLocalQaTickets(updated);
          return updated;
        });
      }
    })();
    if (match?.matchId && ticket.relatedMatchIds?.includes(match.matchId)) {
      setQaMatchSnapshots(previous => {
        const updated = { ...previous, [match.matchId]: match };
        writeLocalQaMatchSnapshots(updated);
        return updated;
      });
    }
  };
  const updateQaTicket = (ticketId: string, changes: Partial<QATicketRecord>): void => {
    const existingTicket = qaTickets.find(ticket => ticket.id === ticketId);
    if (!existingTicket) return;
    if (match?.matchId) {
      setQaMatchSnapshots(previous => {
        const updated = { ...previous, [match.matchId]: match };
        writeLocalQaMatchSnapshots(updated);
        return updated;
      });
    }
    void (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/reports/${encodeURIComponent(ticketId)}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: changes.status,
            severity: changes.severity,
            resolutionNotes: changes.resolutionNotes,
            relatedMatchIds: changes.relatedMatchIds,
            addendums: changes.addendums
          })
        });
        const payload = await response.json().catch(() => ({})) as { report?: SupportTicketDetail; message?: string };
        if (!response.ok || !payload.report) {
          throw new Error(payload.message ?? "Unable to update report.");
        }
        const serverTicket = mapSupportTicketToReport(payload.report);
        setQaTickets(previous => {
          const updated = previous.map(ticket => ticket.id === ticketId ? serverTicket : ticket);
          writeLocalQaTickets(updated);
          return updated;
        });
      } catch {
        setQaTickets(previous => {
          const updated = previous.map(ticket => ticket.id === ticketId
            ? { ...ticket, ...changes, updatedAt: new Date().toISOString() }
            : ticket);
          writeLocalQaTickets(updated);
          return updated;
        });
      }
    })();
  };
  const downloadQaTicketJson = (ticket: QATicketRecord): void => {
    const linkedMatchIds = Array.from(new Set([...(ticket.relatedMatchIds ?? []), ...(ticket.matchId ? [ticket.matchId] : [])]));
    const matchSnapshots = Object.fromEntries(linkedMatchIds.map(id => [id, qaMatchSnapshots[id] ?? null]));
    const missingMatchIds = linkedMatchIds.filter(id => !qaMatchSnapshots[id]);
    const payload = { exportedAt: new Date().toISOString(), ticket, linkedMatchIds, missingMatchIds, matchSnapshots };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${ticket.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const downloadAllQaTicketsJson = (): void => {
    const payload = {
      exportedAt: new Date().toISOString(),
      ticketCount: qaTickets.length,
      tickets: qaTickets,
      matchSnapshots: qaMatchSnapshots
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "reports-export.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const cardsNeedingRetest = useMemo(() => {
    const ids = new Set<string>();
    qaTickets.forEach(ticket => {
      if (ticket.status === "READY_FOR_RETEST" && ticket.relatedCardId) ids.add(ticket.relatedCardId);
    });
    return ids;
  }, [qaTickets]);
  const matchHasRetestCards = useMemo(() => {
    if (!match) return false;
    return match.players.some(player => {
      const pool = [...player.deck, ...player.hand, ...player.cemetery, ...player.removedFromGame, ...player.field.limitedSummons, ...player.field.magicSlots, ...(player.field.primaryCreature ? [player.field.primaryCreature] : [])];
      return pool.some(card => cardsNeedingRetest.has(card.cardId));
    });
  }, [cardsNeedingRetest, match]);
  const retestCardNamesInMatch = useMemo(() => {
    if (!match || cardsNeedingRetest.size === 0) return [];
    const presentIds = new Set<string>();
    match.players.forEach(player => {
      [...player.deck, ...player.hand, ...player.cemetery, ...player.removedFromGame, ...player.field.limitedSummons, ...player.field.magicSlots].forEach(card => presentIds.add(card.cardId));
      if (player.field.primaryCreature?.cardId) presentIds.add(player.field.primaryCreature.cardId);
    });
    return qaTickets
      .filter(ticket => ticket.status === "READY_FOR_RETEST" && ticket.relatedCardId && presentIds.has(ticket.relatedCardId))
      .map(ticket => ticket.relatedCardName ?? ticket.relatedCardId ?? "")
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index)
      .slice(0, 3);
  }, [cardsNeedingRetest.size, match, qaTickets]);
  const updateFeatureRollout = async (key: ServerFeatureFlag["key"], enabledForPlayers: boolean): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      socket.emit("admin:features:update", { key, enabledForPlayers }, (response: { ok: boolean; error?: string }) => {
        if (response.ok) {
          resolve();
          return;
        }
        reject(new Error(response.error ?? "Failed to update feature flag."));
      });
    });
  };
  const openQaTab = (): void => {
    setQaInitialAddendumTicketId(null);
    navigateToPage("qa-tickets");
  };
  const openQaTabForAddendum = (ticketId: string): void => {
    setQaInitialAddendumTicketId(ticketId);
    navigateToPage("qa-tickets");
    setDashboardModal(null);
  };

  useEffect(() => {
    const handlePopState = () => {
      setLocationSearch(window.location.search);
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  const isAdminUser = authUser?.role === "ADMIN";
  const featureFlagsByKey = useMemo(
    () => Object.fromEntries(featureFlags.map(flag => [flag.key, flag])),
    [featureFlags]
  );
  const discordAuthEnabled = featureFlagsByKey["discord-auth"]?.enabledForPlayers === true;

  useEffect(() => {
    if (!match?.matchId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (boardReportFlushInFlightRef.current) {
        return;
      }

      boardReportFlushInFlightRef.current = true;
      void flushQueuedBoardReports(match.matchId)
        .catch(() => undefined)
        .finally(() => {
          boardReportFlushInFlightRef.current = false;
        });
    }, BOARD_REPORT_BACKGROUND_FLUSH_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [match?.matchId]);

  function canSeePage(page: AppPage): boolean {
    if (page === "profile") return true;
    if (page === "admin-controls") return isAdminUser;
    if (isDevToolPage(page)) return canUseDevTools;
    if (isAdminUser) return true;
    if (page === "play") return featureFlagsByKey["play-table"]?.enabledForPlayers === true;
    if (page === "card-library") return featureFlagsByKey["card-library"]?.enabledForPlayers === true;
    if (page === "deck-library") return featureFlagsByKey["deck-builder"]?.enabledForPlayers === true;
    if (page === "marketplace") return featureFlagsByKey.marketplace?.enabledForPlayers === true;
    if (page === "saved-matches") return featureFlagsByKey["saved-matches"]?.enabledForPlayers === true;
    if (page === "qa-tickets") return true;
    return canUseDevTools;
  }

  function updatePageUrl(page: AppPage): void {
    if (embedModeEnabled) return;

    const params = new URLSearchParams(window.location.search);
    params.set("page", page);
    params.delete("discord");
    params.delete("message");
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;

    window.history.replaceState({}, "", nextUrl);
    setLocationSearch(window.location.search);
  }

  function navigateToPage(page: AppPage): void {
    if (!canSeePage(page)) {
      setActivePage("profile");
      updatePageUrl("profile");
      return;
    }

    setActivePage(page);
    updatePageUrl(page);
  }

  function showAccountSaveError(message: string, options: { ownership?: boolean } = {}): void {
    setError(message);
    setSaveMessage("");
    if (options.ownership) {
      setOwnershipSaveStatus("error");
    }
  }

  function recordAuthenticatedSession(): void {
    writeClientStorage(AUTH_SESSION_SEEN_STORAGE_KEY, "true");
  }

  function rememberServerIdentity(payload: ServerIdentityPayload): boolean {
    const serverBootId = typeof payload.serverBootId === "string" ? payload.serverBootId : "";
    if (!serverBootId) return false;

    const previousBootId = lastServerBootIdRef.current ?? readClientStorage(SERVER_BOOT_STORAGE_KEY);
    const hadKnownSession = readClientStorage(AUTH_SESSION_SEEN_STORAGE_KEY) === "true";
    const restarted = Boolean(previousBootId && previousBootId !== serverBootId && hadKnownSession);

    lastServerBootIdRef.current = serverBootId;
    writeClientStorage(SERVER_BOOT_STORAGE_KEY, serverBootId);

    return restarted;
  }

  function emitAccountSave(
    event: AccountSaveEvent,
    payload: unknown,
    options: { ownership?: boolean; onQueued?: () => void } = {}
  ): boolean {
    if (!socket.connected) {
      showAccountSaveError("The live server connection is offline. Refresh, log in again, then retry the save.", options);
      return false;
    }

    if (authUser && socketAuthenticated === false) {
      showAccountSaveError("Your page is logged in, but the live server connection needs to refresh before saving. I am checking your session now; retry the save once it reconnects.", options);
      void refreshLoginSessionForSocket({ manual: true });
      return false;
    }

    options.onQueued?.();

    socket.timeout(8000).emit(
      event,
      payload,
      (timeoutError: Error | null, response?: SocketAckResponse) => {
        if (timeoutError) {
          showAccountSaveError("The server did not confirm the save. Refresh and try again.", options);
          return;
        }

        if (response?.ok === false) {
          showAccountSaveError(response.error ?? "The server rejected the save.", options);
        }
      }
    );

    return true;
  }

  async function refreshLoginSessionForSocket(options: { manual?: boolean; serverRestarted?: boolean } = {}): Promise<boolean> {
    if (socketAuthRefreshInFlightRef.current) return false;

    socketAuthRefreshInFlightRef.current = true;
    if (options.manual) {
      setSaveMessage("Checking login session...");
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
        credentials: "include"
      });
      const data = await response.json().catch(() => ({})) as { user?: AuthUser | null } & ServerIdentityPayload;
      const restartDetected = Boolean(options.serverRestarted || rememberServerIdentity(data));

      if (response.ok && data.user) {
        recordAuthenticatedSession();
        setAuthUser(data.user);
        setSocketAuthenticated(null);
        setServerRestartNotice("");
        setError(current => current.startsWith(SOCKET_SESSION_ERROR_PREFIX) ? "" : current);
        setSaveMessage(options.manual ? "Login session refreshed. Reconnecting live server..." : "");
        if (hasCompletedEmailVerification(data.user)) {
          socket.disconnect();
          window.setTimeout(() => socket.connect(), 50);
        } else {
          socket.disconnect();
        }
        return true;
      }

      setSocketAuthenticated(false);
      if (restartDetected) {
        setAuthUser(null);
        setServerRestartNotice(SERVER_RESTART_NOTICE);
        setError("");
      } else {
        setError(`${SOCKET_SESSION_ERROR_PREFIX} Your page can stay open, but saves need a logged-in live connection. Use Reconnect Login Session or log in again if your session expired.`);
      }
      if (options.manual) {
        setSaveMessage("");
      }
      return false;
    } catch {
      setSocketAuthenticated(false);
      if (options.serverRestarted) {
        setServerRestartNotice(SERVER_RESTART_NOTICE);
        setError("");
      } else {
        setError(`${SOCKET_SESSION_ERROR_PREFIX} I could not re-check your login session. Use Reconnect Login Session, then retry the save.`);
      }
      if (options.manual) {
        setSaveMessage("");
      }
      return false;
    } finally {
      socketAuthRefreshInFlightRef.current = false;
    }
  }

  useEffect(() => {
    if (!featureFlagsLoaded) return;

    if (!canSeePage(activePage)) {
      navigateToPage(canSeePage(DEFAULT_APP_PAGE) ? DEFAULT_APP_PAGE : "profile");
    }
  }, [activePage, canUseDevTools, featureFlagsByKey, featureFlagsLoaded, isAdminUser]);

  useEffect(() => {
    if (requestedView) {
      setPlayViewMode(requestedView);
    }

    if (requestedPage && (!isDevToolPage(requestedPage) || canUseDevTools)) {
      setActivePage(requestedPage);
    }
  }, [canUseDevTools, requestedPage, requestedView]);

  useEmbedBridge({
    embedModeEnabled,
    messagingOrigin,
    activePage,
    playViewMode,
    canApplyEmbedPage,
    canApplyEmbedView,
    onSetPage: (page: EmbedPage) => navigateToPage(canSeePage(page) ? page : "profile"),
    onSetView: (_view: EmbedView) => setPlayViewMode("board3d")
  });

  useEffect(() => {
    function handleKeybindingsChanged(event: Event) {
      const nextKeybindings = (event as CustomEvent<GameplayKeybindings>).detail;
      setGameplayKeybindings(nextKeybindings ?? readGameplayKeybindings());
    }

    window.addEventListener(GAMEPLAY_KEYBINDINGS_CHANGED_EVENT, handleKeybindingsChanged);
    return () => window.removeEventListener(GAMEPLAY_KEYBINDINGS_CHANGED_EVENT, handleKeybindingsChanged);
  }, []);

  useEffect(() => {
    if (!canUseDevTools && isDevToolPage(activePage)) {
      navigateToPage(DEFAULT_APP_PAGE);
    }

    if (!canUseDevTools && dashboardModal === "effect-debug") {
      setDashboardModal(null);
    }
  }, [activePage, canUseDevTools, dashboardModal]);

  useEffect(() => {
    if (canUseDevTools) {
      socket.emit("llm:getStatus");
    }
  }, [canUseDevTools]);

  useEffect(() => {
    const resolveAuth = async () => {
      if (embedModeEnabled && embedToken && embedParentOrigin) {
        try {
          const consumeResponse = await fetch(`${API_BASE_URL}/api/embed/consume`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              token: embedToken,
              parentOrigin: embedParentOrigin
            })
          });
          if (consumeResponse.ok) {
            const consumeData = await consumeResponse.json() as { user?: AuthUser | null };
            setAuthUser(consumeData.user ?? null);
            return;
          }
        } catch {
          // Fallback to normal auth route below.
        }
      }

      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
          credentials: "include"
        });
        const data = await response.json() as { user?: AuthUser | null } & ServerIdentityPayload;
        const restartDetected = rememberServerIdentity(data);
        if (data.user) {
          recordAuthenticatedSession();
        } else if (restartDetected) {
          setServerRestartNotice(SERVER_RESTART_NOTICE);
        }
        setAuthUser(data.user ?? null);
      } catch {
        setAuthUser(null);
      }
    };

    resolveAuth().finally(() => {
      setAuthChecked(true);
    });
  }, [embedModeEnabled, embedParentOrigin, embedToken]);

  useEffect(() => {
    if (!authChecked || !authUser) return;

    const params = new URLSearchParams(window.location.search);
    const verifyEmailToken = params.get("verifyEmailToken");
    if (!verifyEmailToken) return;

    params.delete("verifyEmailToken");
    const nextSearch = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`);
    setLocationSearch(window.location.search);

    const verifyEmail = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/email/verify`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ token: verifyEmailToken })
        });
        const data = await response.json() as { user?: AuthUser; message?: string };

        if (!response.ok) {
          throw new Error(data.message ?? "Unable to verify email.");
        }

        if (data.user) {
          setAuthUser(data.user);
        }

        setActivePage(DEFAULT_APP_PAGE);
        setProfileRefreshKey(current => current + 1);
      } catch (verificationError) {
        setError(verificationError instanceof Error ? verificationError.message : "Unable to verify email.");
      }
    };

    void verifyEmail();
  }, [authChecked, authUser]);

  useEffect(() => {
    const canLoadAppData = Boolean(authUser && hasCompletedEmailVerification(authUser));
    canLoadAppDataRef.current = canLoadAppData;

    if (!authChecked) return;

    if (!authUser) {
      socketAuthUserIdRef.current = null;
      return;
    }

    if (canLoadAppData) {
      const needsFreshSocketSession = socketAuthUserIdRef.current !== authUser.id;
      socketAuthUserIdRef.current = authUser.id;

      if (needsFreshSocketSession || !socket.connected) {
        socket.disconnect();
        socket.connect();
      } else {
        requestInitialData();
      }
      return;
    }

    socketAuthUserIdRef.current = null;
    if (socket.connected) {
      socket.disconnect();
    }
  }, [authChecked, authUser?.email, authUser?.emailVerifiedAt, authUser?.id]);

  useEffect(() => {
    socket.on("server:welcome", (data: ServerWelcome) => {
      setServerMessage(data.message);
      setSocketAuthenticated(data.authenticated === true);
      const restartDetected = rememberServerIdentity(data);
      if (!data.authenticated) {
        if (!socketAuthRefreshAttemptedRef.current) {
          socketAuthRefreshAttemptedRef.current = true;
          setError(restartDetected ? "" : `${SOCKET_SESSION_ERROR_PREFIX} Checking your login session now...`);
          void refreshLoginSessionForSocket({ serverRestarted: restartDetected });
        } else {
          if (restartDetected) {
            setServerRestartNotice(SERVER_RESTART_NOTICE);
          }
          setError(restartDetected ? "" : `${SOCKET_SESSION_ERROR_PREFIX} Your page can stay open, but saves need a logged-in live connection. Use Reconnect Login Session or log in again if your session expired.`);
        }
      } else {
        recordAuthenticatedSession();
        socketAuthRefreshAttemptedRef.current = false;
        setError(current => current.startsWith(SOCKET_SESSION_ERROR_PREFIX) ? "" : current);
      }
    });

    socket.on("connect", () => {
      setSocketAuthenticated(null);
      socket.emit("collection:setCapabilities", { ownershipDeltaOnly: true });
      requestInitialData();
      socket.emit("admin:watchPolicy:get", (response: { ok: boolean; policy?: string }) => {
        if (!response?.ok) return;
        const policy = response.policy === "LOBBY_MEMBERS" || response.policy === "PARTICIPANTS_ONLY" ? response.policy : "PUBLIC";
        setWatchPolicy(policy);
      });
    });

    socket.on("match:state", (data: AppMatchState) => {
      setMatch(data);
      setError("");
    });

    socket.on("match:delta", (data: MatchDeltaPayload) => {
      setMatch(currentMatch => {
        if (!currentMatch || currentMatch.matchId !== data.matchId) {
          socket.emit("match:requestState", data.matchId);
          return currentMatch;
        }

        try {
          return applyMatchDelta(currentMatch, data);
        } catch {
          socket.emit("match:requestState", data.matchId);
          return currentMatch;
        }
      });
      setError("");
    });

    socket.on("match:error", (data: { message: string }) => {
      setError(data.message);
      setLlmBusy(false);
      setOwnershipSaveStatus(current => current === "saving" ? "error" : current);
    });

    socket.on("match:savedList", (data: SavedMatchSummary[]) => {
      setSavedMatches(data);
    });

    socket.on("match:saved", (data: { message: string; matchId: string }) => {
      setSaveMessage(data.message);
      void flushQueuedBoardReportsAndRefresh(data.matchId).catch(error => {
        setError(getBoardReportFlushErrorMessage(error));
      });
    });

    socket.on("match:closed", (data: { message: string; matchId: string; saved?: boolean }) => {
      setSaveMessage(data.message);
      void flushQueuedBoardReportsAndRefresh(data.matchId).catch(error => {
        setError(getBoardReportFlushErrorMessage(error));
      });
      clearClosedMatchState(data.matchId);
    });

    socket.on("match:deleted", (data: { message: string; matchId: string }) => {
      setSaveMessage(data.message);

      setSavedMatches(current =>
        current.filter(savedMatch => savedMatch.matchId !== data.matchId)
      );

      setMatch(currentMatch => {
        if (currentMatch?.matchId === data.matchId) {
          return null;
        }

        return currentMatch;
      });

      socket.emit("match:listSaved");
    });

    socket.on("match:bulkDeleted", (data: { message: string; matchIds: string[] }) => {
      const deletedIds = new Set(data.matchIds);

      setSaveMessage(data.message);

      setSavedMatches(current =>
        current.filter(savedMatch => !deletedIds.has(savedMatch.matchId))
      );

      setMatch(currentMatch => {
        if (currentMatch && deletedIds.has(currentMatch.matchId)) {
          return null;
        }

        return currentMatch;
      });

      socket.emit("match:listSaved");
    });

    socket.on("setup:options", (data: SetupOptions) => {
      setCardPacks(data.cardPacks);
      setDecks(data.decks);

      setSelectedPackIds(current => {
        const validPackIds = data.cardPacks.map(pack => pack.id);
        const stillValidCurrent = current.filter(packId =>
          validPackIds.includes(packId)
        );

        if (shouldAutoIncludeNewCardPacks(stillValidCurrent, validPackIds)) {
          return validPackIds;
        }

        if (stillValidCurrent.length > 0) {
          return stillValidCurrent;
        }

        return validPackIds;
      });

    });

    socket.on("cards:library", (data: CardLibraryCardSummary[]) => {
      setCardLibrary(data);
    });

    socket.on("deck:details", (data: DeckDetail[]) => {
      setDeckDetails(data);
    });
    socket.on("deck:tournamentSubmissions", (data: DeckDetail[]) => {
      setTournamentDeckSubmissions(data);
    });

    socket.on("lobby:list", (data: MatchLobby[]) => {
      const sortedLobbies = sortLobbiesByCreatedAt(data);
      setMatchLobbies(sortedLobbies);
      setActiveLobby(current => {
        if (!current) {
          return current;
        }

        return sortedLobbies.find(lobby => lobby.id === current.id);
      });
    });
    socket.on("features:list", (data: { ok?: boolean; features?: ServerFeatureFlag[] }) => {
      if (data.ok && data.features) {
        setFeatureFlags(data.features);
        setFeatureFlagsLoaded(true);
      }
    });
    socket.on("features:visibilityChanged", () => {
      socket.emit("features:list", (response: { ok: boolean; features?: ServerFeatureFlag[] }) => {
        if (response.ok && response.features) {
          setFeatureFlags(response.features);
          setFeatureFlagsLoaded(true);
        }
      });
    });

    socket.on("lobby:updated", (data: MatchLobby) => {
      setActiveLobby(data.status === "CLOSED" ? undefined : data);
      setMatchLobbies(current => {
        const withoutLobby = current.filter(lobby => lobby.id !== data.id);
        return data.status === "CLOSED"
          ? sortLobbiesByCreatedAt(withoutLobby)
          : sortLobbiesByCreatedAt([data, ...withoutLobby]);
      });
    });

    socket.on("lobby:cleanupComplete", (data: { message: string; closedCount: number }) => {
      setSaveMessage(data.message);
    });

    socket.on("match:viewMode", (data: { matchId: string; mode: "participant" | "spectator" }) => {
      setMatchViewModeByMatchId(current => ({ ...current, [data.matchId]: data.mode }));
    });

    socket.on("match:watchPolicy", (data: { policy?: string }) => {
      const policy = data.policy === "LOBBY_MEMBERS" || data.policy === "PARTICIPANTS_ONLY" ? data.policy : "PUBLIC";
      setWatchPolicy(policy);
    });

    socket.on("collection:ownership", (data: CardOwnershipMap) => {
      setCardOwnershipCounts(data);
      setOwnershipSaveStatus(current => current === "saving" ? "saved" : current);
    });

    socket.on("collection:ownershipDelta", (data: { changed?: Record<string, number> }) => {
      const changed = data?.changed ?? {};
      const entries = Object.entries(changed);
      if (entries.length === 0) {
        return;
      }

      setCardOwnershipCounts(current => {
        const next = { ...current };
        for (const [key, value] of entries) {
          const safeValue = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
          if (safeValue <= 0) {
            delete next[key];
          } else {
            next[key] = safeValue;
          }
        }
        return next;
      });
      setOwnershipSaveStatus(current => current === "saving" ? "saved" : current);
    });

    socket.on("collection:error", (data: { message: string }) => {
      setError(data.message);
      setOwnershipSaveStatus("error");
      socket.emit("collection:listOwnership");
    });

    socket.on("dev:effectCoverage", (data: EffectCoverageRow[]) => {
      setEffectCoverageRows(data);
    });

    socket.on("dev:effectRuntimeTestStatusSaved", (data: { message: string }) => {
      setSaveMessage(data.message);
      setLlmBusy(false);
    });

    socket.on("deck:saved", (data: { message: string; deckId: string }) => {
      setSaveMessage(data.message);
      socket.emit("setup:listOptions");
      socket.emit("deck:listDetails");
    });
    socket.on("deck:tournamentSubmissionReviewed", (data: { message: string }) => {
      setSaveMessage(data.message);
      socket.emit("deck:listDetails");
    });

    socket.on(
      "deck:loaded",
      (data: DeckDetail & { mode: "edit" | "clone" }) => {
        if (data.mode === "clone") {
          setDeckBuilderName(`${data.name} Copy`);
          setDeckBuilderId(normalizeId(`${data.id}-copy`));
        } else {
          setDeckBuilderName(data.name);
          setDeckBuilderId(data.id);
        }

        setDeckBuilderCardIds(data.cardIds);
        setDeckBuilderCardArtKeys(normalizeDeckArtKeys(data.cardArtKeys, data.cardIds.length));
        setDeckBuilderFormat(data.format === "TOURNAMENT" ? "TOURNAMENT" : "FREE_PLAY");
        setSaveMessage(
          data.mode === "clone"
            ? `Loaded clone source: ${data.name}`
            : `Loaded deck for editing: ${data.name}`
        );
      }
    );

    socket.on(
      "deck:overwriteRequired",
      (data: {
        message: string;
        deckId: string;
        name: string;
        packIds: string[];
        cardIds: string[];
        cardArtKeys?: CardArtKey[];
        format?: DeckFormat;
      }) => {
        const confirmed = window.confirm(
          `${data.message}\n\nOverwrite "${data.deckId}"?`
        );

        if (!confirmed) {
          setSaveMessage("Deck overwrite canceled.");
          return;
        }

        emitAccountSave("deck:save", {
          deckId: data.deckId,
          name: data.name,
          packIds: data.packIds,
          cardIds: data.cardIds,
          cardArtKeys: data.cardArtKeys,
          format: data.format,
          overwrite: true
        });
      }
    );

    socket.on("deck:deleted", (data: { message: string; deckId: string }) => {
      setSaveMessage(data.message);

      socket.emit("setup:listOptions");
      socket.emit("deck:listDetails");
    });

    socket.on(
      "dev:cardEffectsSaved",
      (data: {
        message: string;
        packId: string;
        cardId: string;
        card: CardLibraryCardSummary;
      }) => {
        setSaveMessage(data.message);
        setCardLibrary(current =>
          current.map(card =>
            card.packId === data.packId && card.id === data.cardId
              ? data.card
              : card
          )
        );
        socket.emit("setup:listOptions");
      }
    );

    socket.on("admin:cardZeroArtVariantSaved", (data: { message: string }) => {
      setSaveMessage(data.message);
    });

    socket.on("dev:testMatchCreated", (data: { message: string; matchId: string }) => {
      setSaveMessage(data.message);
      setLlmBusy(false);
      setActivePage("play");
      socket.emit("match:listSaved");
    });

    socket.on("llm:status", (data: LlmServiceStatus) => {
      setLlmStatus(data);
    });

    socket.on("llm:batchProgress", (data: LlmBatchProgress) => {
      setLlmBatchProgress(data);
      setSaveMessage(data.message);
    });

    socket.on("llm:effectTestPlan", (data: LlmEffectTestPlan) => {
      setLlmBatchPlans([data]);
      setLlmBatchProgress({
        stage: "done",
        completed: 1,
        total: 1,
        message: `Generated 1 LLM batch test plan.`
      });
      setLlmBusy(false);
      setSaveMessage(`Generated LLM test plan: ${data.title}`);
    });

    socket.on("llm:effectTestPlanBatch", (data: LlmEffectTestPlan[]) => {
      setLlmBatchProgress(current => current ? { ...current, stage: "done", completed: data.length, total: data.length, message: `Generated ${data.length} LLM batch test plan(s).` } : current);
      setLlmBatchPlans(data);
      setLlmBusy(false);
      setSaveMessage(`Generated ${data.length} LLM batch test plan(s).`);
    });

    socket.on("llm:regressionScenarios", (data: LlmRegressionScenarioSummary[]) => {
      setLlmRegressionScenarios(data);
    });

    socket.on("llm:regressionScenarioSaved", (data: LlmRegressionScenarioSummary) => {
      setLlmBusy(false);
      setSaveMessage(`Saved LLM regression fixture: ${data.fileName}`);
    });

    socket.on("llm:regressionScenarioBatchSaved", (data: { count: number; saved: LlmRegressionScenarioSummary[]; report?: LlmPhase4ReportSummary }) => {
      setLlmBusy(false);
      if (data.report) {
        setLlmPhase4Report(data.report);
        setSaveMessage(`Saved ${data.count} LLM regression fixture(s) and Phase 4 report: ${data.report.relativePath}`);
      } else {
        setSaveMessage(`Saved ${data.count} LLM regression fixture(s).`);
      }
    });

    socket.on("llm:phase4OutputReportSaved", (data: LlmPhase4ReportSummary) => {
      setLlmPhase4Report(data);
    });

    socket.on("llm:directEffectSmokeTestResult", (data: LlmDirectEffectSmokeTestResult) => {
      setLlmDirectTestResults(current => ({
        ...current,
        [data.key]: data
      }));
      setLlmBusy(false);
      setSaveMessage(`Headless test complete: ${data.cardName} ${data.effectId ?? "NO_EFFECT"} -> ${data.status}`);
    });

    socket.on("llm:directEffectSmokeTestBatchResult", (data: LlmDirectEffectSmokeTestResult[]) => {
      setLlmDirectTestResults(current => {
        const next = { ...current };
        for (const result of data) {
          next[result.key] = result;
        }
        return next;
      });
      setLlmBusy(false);
      setSaveMessage(`Headless auto-run complete for ${data.length} included draft${data.length === 1 ? "" : "s"}.`);
    });



    socket.on("marketplace:transactions", (data: MarketplaceTransaction[]) => {
      setMarketplaceTransactions(data);
    });
    socket.on("connect_error", () => {
      setServerMessage("Could not connect to Ward Nexus server.");
    });

    requestInitialData();

    return () => {
      socket.off("server:welcome");
      socket.off("connect");
      socket.off("match:state");
      socket.off("match:delta");
      socket.off("match:error");
      socket.off("match:savedList");
      socket.off("match:saved");
      socket.off("match:closed");
      socket.off("match:deleted");
      socket.off("match:bulkDeleted");
      socket.off("setup:options");
      socket.off("cards:library");
      socket.off("deck:details");
      socket.off("deck:tournamentSubmissions");
      socket.off("lobby:list");
      socket.off("lobby:updated");
      socket.off("features:list");
      socket.off("features:visibilityChanged");
      socket.off("lobby:cleanupComplete");
      socket.off("match:viewMode");
      socket.off("match:watchPolicy");
      socket.off("collection:ownership");
      socket.off("collection:ownershipDelta");
      socket.off("collection:error");
      socket.off("dev:effectCoverage");
      socket.off("dev:effectRuntimeTestStatusSaved");
      socket.off("deck:saved");
      socket.off("deck:tournamentSubmissionReviewed");
      socket.off("deck:loaded");
      socket.off("deck:overwriteRequired");
      socket.off("deck:deleted");
      socket.off("dev:cardEffectsSaved");
      socket.off("admin:cardZeroArtVariantSaved");
      socket.off("dev:testMatchCreated");
      socket.off("marketplace:transactions");
      socket.off("llm:status");
      socket.off("llm:batchProgress");
      socket.off("llm:effectTestPlan");
      socket.off("llm:effectTestPlanBatch");
      socket.off("llm:effectResultReview");
      socket.off("llm:regressionScenarios");
      socket.off("llm:regressionScenarioSaved");
      socket.off("llm:regressionScenarioBatchSaved");
      socket.off("llm:phase4OutputReportSaved");
      socket.off("llm:directEffectSmokeTestResult");
      socket.off("llm:directEffectSmokeTestBatchResult");
      socket.off("connect_error");
    };
  }, []);

  useEffect(() => {
    if (selectedPackIds.length === 0) {
      setCardLibrary([]);
      lastRequestedCardLibraryKeyRef.current = "";
      return;
    }

    const needsCardLibrary = Boolean(match) ||
      activePage === "card-library" ||
      activePage === "deck-library" ||
      activePage === "marketplace" ||
      (canUseDevTools && (activePage === "effect-dev" || activePage === "effect-coverage" || activePage === "llm-tests" || activePage === "board-preview"));

    if (!needsCardLibrary) {
      return;
    }

    const requestKey = buildCardLibraryRequestKey(selectedPackIds, cardPacks);
    if (lastRequestedCardLibraryKeyRef.current === requestKey && cardLibrary.length > 0) {
      return;
    }

    lastRequestedCardLibraryKeyRef.current = requestKey;
    socket.emit("cards:listForPacks", { packIds: selectedPackIds });
  }, [activePage, canUseDevTools, cardLibrary.length, cardPacks, match, selectedPackIds]);

  useEffect(() => {
    if (activePage === "deck-library") {
      socket.emit("deck:listDetails");
    }

    if (activePage === "card-library") {
      socket.emit("collection:listOwnership");
    }

    const watchSavedMatches = activePage === "saved-matches" || dashboardModal === "save-load";
    if (watchSavedMatches) {
      socket.emit("match:listSaved");
    } else {
      socket.emit("match:unwatchSaved");
    }
  }, [activePage, dashboardModal]);

  useEffect(() => {
    if (!canUseDevTools) {
      setEffectCoverageRows([]);
      return;
    }

    if (activePage !== "effect-coverage" && activePage !== "llm-tests") {
      return;
    }

    const packIds = selectedPackIds.length > 0
      ? selectedPackIds
      : cardPacks.map(pack => pack.id);

    if (packIds.length === 0) {
      setEffectCoverageRows([]);
      return;
    }

    socket.emit("dev:listEffectCoverage", { packIds });
  }, [activePage, canUseDevTools, cardPacks, selectedPackIds]);


  function requestInitialData() {
    if (!canLoadAppDataRef.current) {
      return;
    }

    socket.emit("setup:listOptions");
    socket.emit("lobby:list");
    if (canUseDevTools) {
      socket.emit("llm:getStatus");
    }
  }
  function refreshMarketplaceTransactions() { socket.emit("marketplace:listTransactions"); }
  function confirmMarketplaceTransaction(id: string) { socket.emit("marketplace:confirmTransaction", id); }
  function denyMarketplaceTransaction(id: string) { socket.emit("marketplace:denyTransaction", id); }
  function cancelMarketplaceTransaction(id: string) { socket.emit("marketplace:cancelTransaction", id); }

  function refreshEffectCoverage() {
    if (!canUseDevTools) {
      setEffectCoverageRows([]);
      return;
    }

    const packIds =
      selectedPackIds.length > 0
        ? selectedPackIds
        : cardPacks.map(pack => pack.id);

    socket.emit("dev:listEffectCoverage", { packIds });
  }

  function refreshCardLibrary() {
    const packIds =
      selectedPackIds.length > 0
        ? selectedPackIds
        : cardPacks.map(pack => pack.id);

    if (packIds.length === 0) {
      setCardLibrary([]);
      return;
    }

    socket.emit("cards:listForPacks", {
      packIds
    });
  }

  function saveCardTournamentLimit(cardId: string, status: "LEGAL" | "LIMITED" | "BANNED") {
    const packIds =
      selectedPackIds.length > 0
        ? selectedPackIds
        : cardPacks.map(pack => pack.id);
    const limit = status === "BANNED" ? 0 : status === "LIMITED" ? 1 : 3;

    socket.emit("dev:saveCardLimit", {
      packIds,
      cardId,
      limit
    });
  }

  function saveCardZeroArtVariant(cardId: string, hasZeroArtVariant: boolean) {
    const packIds =
      selectedPackIds.length > 0
        ? selectedPackIds
        : cardPacks.map(pack => pack.id);

    socket.emit("admin:saveCardZeroArtVariant", {
      packIds,
      cardId,
      hasZeroArtVariant
    });
  }

  function reportCardBroken(cardId: string) {
    const packIds = selectedPackIds.length > 0 ? selectedPackIds : cardPacks.map(pack => pack.id);
    socket.emit("cards:reportBroken", { packIds, cardId });
  }

  function setCardWorking(cardId: string) {
    const packIds = selectedPackIds.length > 0 ? selectedPackIds : cardPacks.map(pack => pack.id);
    socket.emit("admin:setCardWorking", { packIds, cardId });
  }

  function refreshSetupOptions() {
    socket.emit("setup:listOptions");
    socket.emit("deck:listDetails");
    refreshCardLibrary();
  }

  function toggleSelectedPack(packId: string) {
    setSelectedPackIds(current => {
      if (current.includes(packId)) {
        return current.filter(id => id !== packId);
      }

      return [...current, packId];
    });
  }

  function createLobby(data: { name: string; format: DeckFormat; solo?: boolean }) {
    setError("");
    setSaveMessage("");
    socket.emit("lobby:create", {
      name: data.name,
      format: data.format,
      selectedPackIds,
      solo: data.solo === true
    });
  }

  function joinLobby(lobbyId: string) {
    setError("");
    socket.emit("lobby:join", lobbyId);
  }

  function selectLobbyDeck(lobbyId: string, deckId: string) {
    setError("");
    socket.emit("lobby:selectDeck", { lobbyId, deckId });
  }

  function selectLobbyCloneDeck(lobbyId: string, deckId: string) {
    setError("");
    socket.emit("lobby:selectCloneDeck", { lobbyId, deckId });
  }

  function viewLobby(lobbyId: string) {
    setError("");
    const lobby = matchLobbies.find(item => item.id === lobbyId);
    if (lobby) {
      setActiveLobby(lobby);
    }
    socket.emit("lobby:view", lobbyId);
  }

  function leaveLobby(lobbyId: string) {
    setError("");
    setActiveLobby(current => current?.id === lobbyId ? undefined : current);
    socket.emit("lobby:leave", lobbyId);
  }

  function startLobbyMatch(lobbyId: string) {
    setError("");
    setSaveMessage("");
    socket.emit("lobby:startMatch", lobbyId);
  }

  function switchSoloControlledPlayer(playerId: "player_1" | "player_2") {
    if (!match) return;
    setError("");
    setControlledPlayersByMatchId(current => ({
      ...current,
      [match.matchId]: playerId
    }));
    socket.emit("match:switchControlledPlayer", { matchId: match.matchId, playerId });
  }

  function cleanupStaleLobbies() {
    setError("");
    setSaveMessage("");
    socket.emit("lobby:cleanupStale");
  }

  function normalizeId(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function normalizeDeckImportName(value: string): string {
    return value.trim().replace(/\s+/g, " ");
  }

  function getDeckImportNameKey(value: string): string {
    return normalizeDeckImportName(value).toLowerCase();
  }

  function makeUniqueDeckImportName(value: string, usedDeckNames: Set<string>, fallbackName: string): string {
    const baseName = normalizeDeckImportName(value) || fallbackName;
    let candidate = baseName;
    let suffix = 2;

    while (usedDeckNames.has(getDeckImportNameKey(candidate))) {
      candidate = `${baseName} (${suffix})`;
      suffix += 1;
    }

    usedDeckNames.add(getDeckImportNameKey(candidate));
    return candidate;
  }

  function makeUniqueDeckImportId(value: string, usedDeckIds: Set<string>, fallbackId: string): string {
    const baseId = normalizeId(value) || fallbackId;
    let candidate = baseId;
    let suffix = 2;

    while (usedDeckIds.has(candidate)) {
      candidate = `${baseId}-${suffix}`;
      suffix += 1;
    }

    usedDeckIds.add(candidate);
    return candidate;
  }

  function normalizeDeckArtKey(value: string | undefined): CardArtKey {
    return value === "holo" || value === "zero-art" || value === "zero-art-holo" ? value : "default";
  }

  function normalizeDeckArtKeys(values: string[] | undefined, cardCount: number): CardArtKey[] {
    return Array.from({ length: cardCount }, (_, index) => normalizeDeckArtKey(values?.[index]));
  }

  function getDeckBuilderCounts(): Record<string, number> {
    return deckBuilderCardIds.reduce<Record<string, number>>((counts, cardId) => {
      counts[cardId] = (counts[cardId] ?? 0) + 1;
      return counts;
    }, {});
  }

  function deleteDeck(deckId: string) {
    if (deckId === "demo-30-card") {
      setError("The default demo deck is protected and cannot be deleted.");
      return;
    }

    const deck = decks.find(item => item.id === deckId);
    const confirmed = window.confirm(
      `Delete deck "${deck?.name ?? deckId}"?\n\nThis permanently deletes data/decks/${deckId}.json.`
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setSaveMessage("");

    socket.emit("deck:delete", deckId);
  }

  function getDeckBuilderCardCount(cardId: string): number {
    return getDeckBuilderCounts()[cardId] ?? 0;
  }

  function getEffectiveDeckLimit(cardId: string): number {
    if (deckBuilderFormat !== "TOURNAMENT") return 3;
    const card = cardLibrary.find(item => item.id === cardId);
    return card?.deckLimit ?? 3;
  }

  function addCardToDeckBuilder(cardId: string, artKey: CardArtKey = "default") {
    const card = cardLibrary.find(item => item.id === cardId);
    const deckLimit = getEffectiveDeckLimit(cardId);
    const count = getDeckBuilderCardCount(cardId);

    if (deckLimit <= 0) {
      setError(`${card?.name ?? cardId} is banned and cannot be added.`);
      return;
    }

    if (count >= deckLimit) {
      setError(
        `${card?.name ?? cardId} is limited to ${deckLimit} copies in this format.`
      );
      return;
    }

    if (deckBuilderCardIds.length >= 30) {
      setError("Deck already has 30 cards.");
      return;
    }

    setError("");
    setDeckBuilderCardIds(current => [...current, cardId]);
    setDeckBuilderCardArtKeys(current => [...current, normalizeDeckArtKey(artKey)]);
  }

  function removeCardFromDeckBuilder(cardId: string, artKey?: CardArtKey) {
    setDeckBuilderCardIds(current => {
      const index = current.findIndex((currentCardId, currentIndex) =>
        currentCardId === cardId && (!artKey || normalizeDeckArtKey(deckBuilderCardArtKeys[currentIndex]) === artKey)
      );

      if (index === -1) {
        return current;
      }

      return [...current.slice(0, index), ...current.slice(index + 1)];
    });
    setDeckBuilderCardArtKeys(current => {
      const index = deckBuilderCardIds.findIndex((currentCardId, currentIndex) =>
        currentCardId === cardId && (!artKey || normalizeDeckArtKey(current[currentIndex]) === artKey)
      );

      if (index === -1) {
        return current;
      }

      return [...current.slice(0, index), ...current.slice(index + 1)];
    });
  }

  function clearDeckBuilder() {
    setDeckBuilderCardIds([]);
    setDeckBuilderCardArtKeys([]);
  }

  function startNewDeckBuilder() {
    setDeckBuilderName("New Test Deck");
    setDeckBuilderId("new-test-deck");
    setDeckBuilderCardIds([]);
    setDeckBuilderCardArtKeys([]);
    setDeckBuilderFormat("FREE_PLAY");
    setError("");
    setSaveMessage("Started a new deck.");
  }

  function setDeckBuilderCardCopies(cardId: string, requestedCopyCount: number, artKey: CardArtKey = "default") {
    const card = cardLibrary.find(item => item.id === cardId);
    const deckLimit = getEffectiveDeckLimit(cardId);
    const safeRequestedCount = Math.max(0, Math.floor(requestedCopyCount));
    const nextCopyCount = Math.min(safeRequestedCount, deckLimit, 30);

    if (deckLimit <= 0 && safeRequestedCount > 0) {
      setError(`${card?.name ?? cardId} is banned and cannot be added.`);
      return;
    }

    setError("");
    setDeckBuilderCardIds(current => {
      const normalizedArtKey = normalizeDeckArtKey(artKey);
      const withoutCard = current.filter((currentCardId, index) =>
        currentCardId !== cardId || normalizeDeckArtKey(deckBuilderCardArtKeys[index]) !== normalizedArtKey
      );
      const availableSlots = Math.max(0, 30 - withoutCard.length);
      const finalCopyCount = Math.min(nextCopyCount, availableSlots);

      return [...withoutCard, ...Array.from({ length: finalCopyCount }, () => cardId)];
    });
    setDeckBuilderCardArtKeys(current => {
      const normalizedArtKey = normalizeDeckArtKey(artKey);
      const withoutCard = current.filter((currentArtKey, index) =>
        deckBuilderCardIds[index] !== cardId || normalizeDeckArtKey(currentArtKey) !== normalizedArtKey
      );
      const availableSlots = Math.max(0, 30 - withoutCard.length);
      const finalCopyCount = Math.min(nextCopyCount, availableSlots);

      return [...withoutCard, ...Array.from({ length: finalCopyCount }, () => normalizedArtKey)];
    });
  }

  function setOwnedCardCopies(cardId: string, requestedOwnedCount: number) {
    const safeOwnedCount = Math.min(999, Math.max(0, Math.floor(requestedOwnedCount)));
    const artMarker = "__art_";
    const artMarkerIndex = cardId.indexOf(artMarker);
    const ownershipPayload = artMarkerIndex >= 0
      ? {
          cardId: cardId.slice(0, artMarkerIndex),
          variant: cardId.slice(artMarkerIndex + artMarker.length),
          ownedCount: safeOwnedCount
        }
      : {
          cardId,
          variant: "default",
          ownedCount: safeOwnedCount
        };

    emitAccountSave("collection:updateOwnership", ownershipPayload, {
      ownership: true,
      onQueued: () => {
        setOwnershipSaveStatus("saving");
        setCardOwnershipCounts(current => ({
          ...current,
          [cardId]: safeOwnedCount
        }));
      }
    });
  }

  function loadDeckIntoBuilder(deckId: string, mode: "edit" | "clone") {
    setError("");
    setSaveMessage("");
    socket.emit("deck:load", { deckId, mode });
  }

  function loadDeckIntoBuilderAndOpenCardLibrary(deckId: string, mode: "edit" | "clone") {
    loadDeckIntoBuilder(deckId, mode);
    setActivePage("card-library");
  }

  function importDeckCodeIntoBuilder(payload: {
    name?: string;
    deckId?: string;
    cardIds: string[];
    cardArtKeys?: string[];
    format?: DeckFormat;
  }) {
    const usedDeckNames = new Set(decks.map(deck => getDeckImportNameKey(deck.name)).filter(Boolean));
    const usedDeckIds = new Set(decks.map(deck => deck.id));
    const importedName = makeUniqueDeckImportName(payload.name ?? "Imported Deck", usedDeckNames, "Imported Deck");
    const importedDeckId = makeUniqueDeckImportId(payload.deckId || importedName, usedDeckIds, "imported-deck");

    setError("");
    setDeckBuilderName(importedName);
    setDeckBuilderId(importedDeckId);
    setDeckBuilderCardIds(payload.cardIds);
    setDeckBuilderCardArtKeys(normalizeDeckArtKeys(payload.cardArtKeys, payload.cardIds.length));
    setDeckBuilderFormat(payload.format === "TOURNAMENT" ? "TOURNAMENT" : "FREE_PLAY");
    setSaveMessage(`Imported ${payload.cardIds.length} cards into the deck editor.`);
    setActivePage("card-library");
  }

  async function saveImportedDecksToLibrary(
    importedDecks: DeckLibraryImportSaveRequest[]
  ): Promise<DeckLibraryImportSaveResult> {
    setError("");
    setSaveMessage("");

    const failAll = (message: string): DeckLibraryImportSaveResult => ({
      saved: [],
      failed: importedDecks.map(deck => ({
        deckId: deck.deckId,
        name: deck.name,
        message
      }))
    });

    if (!socket.connected) {
      const message = "The live server connection is offline. Refresh, log in again, then retry the save.";
      showAccountSaveError(message);
      return failAll(message);
    }

    if (authUser && socketAuthenticated === false) {
      const message = "Your live server connection needs to refresh before saving. Retry once it reconnects.";
      showAccountSaveError(message);
      void refreshLoginSessionForSocket({ manual: true });
      return failAll(message);
    }

    setSaveMessage(`Saving ${importedDecks.length} imported deck${importedDecks.length === 1 ? "" : "s"}...`);

    const saved: string[] = [];
    const failed: DeckLibraryImportSaveResult["failed"] = [];

    for (const deck of importedDecks) {
      const response = await new Promise<SocketAckResponse>(resolve => {
        socket.timeout(8000).emit(
          "deck:save",
          {
            deckId: deck.deckId,
            name: deck.name,
            packIds: deck.packIds,
            cardIds: deck.cardIds,
            cardArtKeys: deck.cardArtKeys,
            format: deck.format,
            overwrite: false
          },
          (timeoutError: Error | null, ackResponse?: SocketAckResponse) => {
            if (timeoutError) {
              resolve({ ok: false, error: "The server did not confirm the save. Refresh and try again." });
              return;
            }

            resolve(ackResponse ?? { ok: true });
          }
        );
      });

      if (response.ok === false || response.message === "Deck overwrite confirmation required.") {
        failed.push({
          deckId: deck.deckId,
          name: deck.name,
          message: response.error ?? "Deck ID already exists."
        });
        continue;
      }

      saved.push(deck.name);
    }

    socket.emit("setup:listOptions");
    socket.emit("deck:listDetails");

    setSaveMessage(
      failed.length === 0
        ? `Imported ${saved.length} deck${saved.length === 1 ? "" : "s"} to the Deck Library.`
        : `Imported ${saved.length} deck${saved.length === 1 ? "" : "s"}; ${failed.length} failed.`
    );

    return { saved, failed };
  }

  function saveBuiltDeck() {
    setError("");
    setSaveMessage("");

    const finalDeckId = normalizeId(deckBuilderId);

    if (!finalDeckId) {
      setError("Deck ID is required.");
      return;
    }

    if (!deckBuilderName.trim()) {
      setError("Deck name is required.");
      return;
    }

    if (selectedPackIds.length === 0) {
      setError("Select at least one card pack.");
      return;
    }

    if (deckBuilderCardIds.length !== 30) {
      setError(`Deck must contain exactly 30 cards. Current: ${deckBuilderCardIds.length}.`);
      return;
    }

    const counts = getDeckBuilderCounts();
    const overLimit = Object.entries(counts).filter(([cardId, count]) => {
      const deckLimit = getEffectiveDeckLimit(cardId);

      return count > deckLimit;
    });

    if (deckBuilderFormat === "TOURNAMENT" && overLimit.length > 0) {
      setError("Deck contains cards over their banned/limited restriction.");
      return;
    }

    emitAccountSave("deck:save", {
      deckId: finalDeckId,
      name: deckBuilderName.trim(),
      packIds: selectedPackIds,
      cardIds: deckBuilderCardIds,
      cardArtKeys: normalizeDeckArtKeys(deckBuilderCardArtKeys, deckBuilderCardIds.length),
      format: deckBuilderFormat,
      overwrite: false
    });
  }

  function saveCardEffects(data: {
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
  }) {
    setError("");
    setSaveMessage("");
    socket.emit("dev:saveCardEffects", data);
  }

  function createEffectTestMatch(data: {
    packIds: string[];
    player1CardIds: string[];
    player2CardIds: string[];
  }) {
    setError("");
    setSaveMessage("");
    setDashboardModal(null);
    setActivePage("play");
    socket.emit("dev:createEffectTestMatch", data);
  }

  function advancePhase() {
    if (!match) return;
    socket.emit("match:advancePhase", match.matchId);
  }

  function endTurn() {
    if (!match) return;
    socket.emit("match:endTurn", match.matchId);
  }

  function shuffleAllDecks() {
    if (!match) return;
    socket.emit("match:shuffleAllDecks", match.matchId);
  }

  function rollOpeningTurnOrder(playerId: string) {
    if (!match) return;
    socket.emit("match:rollOpeningTurnOrder", {
      matchId: match.matchId,
      playerId
    });
  }

  function refreshSavedMatches() {
    socket.emit("match:listSaved");
  }

  function clearClosedMatchState(matchId: string) {
    setDashboardModal(null);
    setActiveLobby(undefined);
    setMatch(currentMatch => currentMatch?.matchId === matchId ? null : currentMatch);
    socket.emit("match:listSaved");
    socket.emit("lobby:list");
  }

  async function flushQueuedBoardReportsAndRefresh(matchId: string, matchSnapshot?: AppMatchState): Promise<number> {
    const flushedCount = await flushQueuedBoardReports(matchId, matchSnapshot);
    if (flushedCount > 0) {
      setSupportTicketRefreshKey(current => current + 1);
    }
    return flushedCount;
  }

  function saveCurrentMatch() {
    if (!match) return;
    if (getMatchStatus(match) !== "COMPLETE") return;
    socket.emit("match:saveCurrent", match.matchId);
  }

  async function closeCurrentMatchWithoutSaving(options: { confirm: boolean; closeLocally?: boolean }) {
    if (!match) return;
    const matchId = match.matchId;

    if (options.confirm) {
      const confirmed = window.confirm("Close this match without saving? Unsaved match state will be lost.");
      if (!confirmed) return;
    }

    setError("");
    setSaveMessage("Sending queued board reports...");
    try {
      await flushQueuedBoardReportsAndRefresh(matchId, match);
    } catch (error) {
      setSaveMessage("");
      setError(getBoardReportFlushErrorMessage(error));
      return;
    }

    setDashboardModal(null);
    setSaveMessage("Closing match...");
    socket.emit("match:exit", matchId);
    if (options.closeLocally) {
      clearClosedMatchState(matchId);
    }
  }

  function closeActiveMatchWithoutSaving() {
    void closeCurrentMatchWithoutSaving({ confirm: true });
  }

  function closeCompletedMatchWithoutSaving() {
    void closeCurrentMatchWithoutSaving({ confirm: true, closeLocally: true });
  }

  async function saveCompletedMatchAndClose() {
    if (!match || getMatchStatus(match) !== "COMPLETE") return;
    const matchId = match.matchId;

    setError("");
    setSaveMessage("Sending queued board reports...");
    try {
      await flushQueuedBoardReportsAndRefresh(matchId, match);
    } catch (error) {
      setSaveMessage("");
      setError(getBoardReportFlushErrorMessage(error));
      return;
    }

    setDashboardModal(null);
    setSaveMessage("Saving and closing match...");
    socket.emit("match:saveAndQuit", matchId);
  }

  function undoLastAction() {
    if (!match) return;
    socket.emit("match:undoLastAction", match.matchId);
  }

  function loadSavedMatch(matchId: string) {
    setDashboardModal(null);
    socket.emit("match:loadSaved", matchId);
  }

  function deleteSavedMatch(matchId: string) {
    const confirmed = window.confirm(
      `Delete saved match ${matchId}? This will permanently delete the saved JSON file.`
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setSaveMessage("");

    setSavedMatches(current =>
      current.filter(savedMatch => savedMatch.matchId !== matchId)
    );

    socket.emit("match:deleteSaved", matchId);
  }

  function deleteSelectedSavedMatches(matchIds: string[]) {
    const uniqueMatchIds = [...new Set(matchIds)].filter(Boolean);

    if (uniqueMatchIds.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `Delete ${uniqueMatchIds.length} selected saved match${uniqueMatchIds.length === 1 ? "" : "es"}? This will permanently delete the saved JSON files.`
    );

    if (!confirmed) {
      return;
    }

    const idsToDelete = new Set(uniqueMatchIds);

    setError("");
    setSaveMessage("");

    setSavedMatches(current =>
      current.filter(savedMatch => !idsToDelete.has(savedMatch.matchId))
    );

    setMatch(currentMatch => {
      if (currentMatch && idsToDelete.has(currentMatch.matchId)) {
        return null;
      }

      return currentMatch;
    });

    socket.emit("match:deleteSavedBulk", { matchIds: uniqueMatchIds });
  }

  function drawActivePlayer() {
    if (!match) return;
    socket.emit("match:drawActivePlayer", match.matchId);
  }

  function drawActivePlayerAndAdvance() {
    if (!match) return;
    socket.emit("match:drawActivePlayerAndAdvance", match.matchId);
  }

  function resolveManualDrawEffect(effectId: string, targetPlayerId: string) {
    if (!match) return;
    socket.emit("match:manualMagicDrawCards", {
      matchId: match.matchId,
      effectId,
      targetPlayerId
    });
  }

  function handleDeckClick(slotId: string) {
    if (!match || !slotId.endsWith("-deck")) return;
    const deckOwnerId = slotId.startsWith("player_2-") ? "player_2" : "player_1";
    if (controlledPlayerId && controlledPlayerId !== deckOwnerId) return;

    const pendingDrawEffect = getPendingManualDrawEffectForPlayer(match, deckOwnerId);
    if (pendingDrawEffect) {
      resolveManualDrawEffect(pendingDrawEffect.id, deckOwnerId);
      return;
    }

    const activeDeckSlot = match.turn.activePlayerId === "player_1" ? "player_1-deck" : "player_2-deck";
    if (slotId === activeDeckSlot && canDrawForCurrentTurn(match, controlledPlayerId)) {
      drawActivePlayerAndAdvance();
    }
  }

  function discardHandCardToCemetery(playerId: "player_1" | "player_2", cardInstanceId: string) {
    if (!match) return;
    socket.emit("match:discardFromHand", {
      matchId: match.matchId,
      playerId,
      cardInstanceId
    });
  }

  function callCemeteryHpLoss(losingPlayerId: "player_1" | "player_2", callingPlayerId: "player_1" | "player_2") {
    if (!match) return;
    socket.emit("match:callCemeteryHpLoss", {
      matchId: match.matchId,
      losingPlayerId,
      callingPlayerId
    });
  }

  function startManualBattle(attackerCreatureInstanceId: string, selectedDefenderCreatureInstanceId?: string) {
    if (!match) return;

    const defendingPlayer = match.players.find(player => player.id !== match.turn.activePlayerId);
    const defenderCreatureInstanceId = selectedDefenderCreatureInstanceId ?? defendingPlayer?.field.primaryCreature?.instanceId;

    socket.emit("match:startManualBattle", {
      matchId: match.matchId,
      playerId: match.turn.activePlayerId,
      attackerCreatureInstanceId,
      defenderCreatureInstanceId
    });
  }

  function updateCannotInflictAttackDamageBattlePolicy(policy: "DAMAGE_ONLY" | "SKIP_BATTLE") {
    if (!match) return;

    socket.emit("match:updateCannotInflictAttackDamageBattlePolicy", {
      matchId: match.matchId,
      policy
    });
  }

  function runBattleSpeedCheck(battleSessionId: string) {
    if (!match) return;

    socket.emit("match:runBattleSpeedCheck", {
      matchId: match.matchId,
      battleSessionId
    });
  }

  function updateBattleSpeedModifiers(
    battleSessionId: string,
    modifiers: {
      attackingSpeedDelta: number;
      defendingSpeedDelta: number;
      override: "AUTO" | "ATTACKER_FIRST" | "DEFENDER_FIRST";
      note?: string;
    }
  ) {
    if (!match) return;

    socket.emit("match:updateBattleSpeedModifiers", {
      matchId: match.matchId,
      battleSessionId,
      modifiers
    });
  }

  function updateBattleStrikeModifiers(
    battleSessionId: string,
    strikeId: string,
    modifiers: {
      hitDiceDelta: number;
      hitDiceLimit?: number;
      hitFlatBonus: number;
      forceHitResult: "AUTO" | "FORCE_HIT" | "FORCE_MISS";
      damageDiceDelta: number;
      damageFlatBonus: number;
      damageMultiplier: number;
      preventAttackDamage: boolean;
      note?: string;
    }
  ) {
    if (!match) return;

    socket.emit("match:updateBattleStrikeModifiers", {
      matchId: match.matchId,
      battleSessionId,
      strikeId,
      modifiers
    });
  }

  function rollBattleHit(battleSessionId: string) {
    if (!match) return;

    socket.emit("match:rollBattleHit", {
      matchId: match.matchId,
      battleSessionId
    });
  }

  function rollBattleDamage(battleSessionId: string) {
    if (!match) return;

    socket.emit("match:rollBattleDamage", {
      matchId: match.matchId,
      battleSessionId
    });
  }

  function rollAndApplyBattleDamage(battleSessionId: string) {
    if (!match) return;

    socket.emit("match:rollAndApplyBattleDamage", {
      matchId: match.matchId,
      battleSessionId
    });
  }

  function playBattleResponseFromHand(
    battleSessionId: string,
    strikeId: string,
    playerId: string,
    cardInstanceId: string
  ) {
    if (!match) return;

    socket.emit("match:playBattleResponseFromHand", {
      matchId: match.matchId,
      playerId,
      cardInstanceId,
      battleSessionId,
      strikeId
    });
  }

  function applyBattleDamage(battleSessionId: string) {
    if (!match) return;

    socket.emit("match:applyBattleDamage", {
      matchId: match.matchId,
      battleSessionId
    });
  }

  function rollEffectRoll(effectRollSessionId: string) {
    if (!match) return;

    socket.emit("match:rollEffectRoll", {
      matchId: match.matchId,
      effectRollSessionId
    });
  }

  function applyEffectRoll(effectRollSessionId: string) {
    if (!match) return;

    socket.emit("match:applyEffectRoll", {
      matchId: match.matchId,
      effectRollSessionId
    });
  }

  function skipEffectRoll(effectRollSessionId: string) {
    if (!match) return;

    socket.emit("match:skipEffectRoll", {
      matchId: match.matchId,
      effectRollSessionId
    });
  }

  function activateCardEffect(sourceInstanceId: string, effectId: string) {
    if (!match) return;

    const source = match.players.flatMap(player => [
      player.field.primaryCreature ? { playerId: player.id, card: player.field.primaryCreature } : null,
      ...player.field.limitedSummons.map(card => ({ playerId: player.id, card })),
      ...player.field.magicSlots.flatMap(card => card ? [{ playerId: player.id, card }] : [])
    ]).find(entry => entry?.card.instanceId === sourceInstanceId);
    const playerId = source?.card.controllerPlayerId ?? source?.playerId ?? controlledPlayerId;
    if (!playerId) return;
    if (controlledPlayerId && controlledPlayerId !== playerId) return;

    socket.emit("match:activateCardEffect", {
      matchId: match.matchId,
      playerId,
      sourceInstanceId,
      effectId
    });
  }

  function finishManualBattle(battleSessionId: string) {
    if (!match) return;

    socket.emit("match:finishManualBattle", {
      matchId: match.matchId,
      battleSessionId
    });
  }

  function cancelManualBattle(battleSessionId: string) {
    if (!match) return;

    socket.emit("match:cancelManualBattle", {
      matchId: match.matchId,
      battleSessionId
    });
  }

  function battlePrimaryCreatures() {
    const activePlayer = match?.players.find(player => player.id === match.turn.activePlayerId);
    const primaryCreature = activePlayer?.field.primaryCreature;

    if (!match || !primaryCreature) return;

    startManualBattle(primaryCreature.instanceId);
  }

  function completeManualMagicEffect(effectId: string) {
    if (!match) return;

    socket.emit("match:completeManualMagicEffect", {
      matchId: match.matchId,
      effectId
    });
  }

  function applyManualMagicDamage(
    effectId: string,
    targetPlayerId: string,
    amount: number
  ) {
    if (!match) return;

    socket.emit("match:manualMagicDamagePrimary", {
      matchId: match.matchId,
      effectId,
      targetPlayerId,
      amount
    });
  }

  function forceDevRolls(kind: DevRollKind, dice: number[], label?: string) {
    if (!match) return;
    socket.emit("match:devForceRolls", {
      matchId: match.matchId,
      kind,
      dice,
      label
    });
  }

  function saveEffectRuntimeTestStatus(
    row: EffectCoverageRow,
    statuses: {
      engineStatus: EffectRuntimeTestStatus;
      boardAffordanceStatus: EffectRuntimeTestStatus;
      boardAnimationStatus: EffectRuntimeTestStatus;
    },
    issueType: EffectRuntimeIssueType,
    notes: string
  ) {
    const packIds = selectedPackIds.length > 0
      ? selectedPackIds
      : cardPacks.map(pack => pack.id);

    socket.emit("dev:saveEffectRuntimeTestStatus", {
      packIds,
      record: {
        packId: row.packId,
        cardId: row.cardId,
        cardName: row.cardName,
        effectId: row.effectId,
        trigger: row.trigger,
        actionType: row.actionType,
        engineStatus: statuses.engineStatus,
        boardAffordanceStatus: statuses.boardAffordanceStatus,
        boardAnimationStatus: statuses.boardAnimationStatus,
        issueType,
        notes,
        testedBy: "Dev"
      }
    });
  }

  function createEffectScenarioMatch(row: EffectCoverageRow) {
    const packIds = selectedPackIds.length > 0
      ? selectedPackIds
      : cardPacks.map(pack => pack.id);

    socket.emit("dev:createEffectScenarioMatch", {
      packIds,
      cardId: row.cardId,
      effectId: row.effectId
    });
  }


  function refreshLlmStatus() {
    socket.emit("llm:getStatus");
    socket.emit("llm:listRegressionScenarios");
  }

  function resetLlmWorkflow() {
    setLlmBatchPlans([]);
    setLlmBatchProgress(undefined);
    setLlmPhase4Report(undefined);
    setLlmDirectTestResults({});
    setLlmBusy(false);
    setSaveMessage("LLM phase workflow reset. Card/effect queue selections are preserved.");
    setError("");
  }

  function generateLlmEffectTestPlanBatch(requests: Array<{ packId: string; cardId: string; effectId?: string }>) {
    if (requests.length === 0) {
      setError("Add at least one effect to the bulk queue before generating batch plans.");
      return;
    }

    setError("");
    setSaveMessage("");
    setLlmBatchProgress({
      stage: "started",
      completed: 0,
      total: requests.length,
      message: `Sending ${requests.length} bulk effect request(s) to the server...`
    });
    setLlmBusy(true);
    socket.emit("llm:generateEffectTestPlanBatch", {
      packIds: selectedPackIds.length > 0 ? selectedPackIds : cardPacks.map(pack => pack.id),
      requests
    });
  }

  function saveLlmCoverageRecords(records: EffectRuntimeTestStatusRecord[]) {
    if (records.length === 0) {
      setError("No included coverage records were selected to save.");
      return;
    }

    setError("");
    setSaveMessage("");
    setLlmBusy(true);
    socket.emit("dev:bulkSaveEffectRuntimeTestStatus", {
      packIds: selectedPackIds.length > 0 ? selectedPackIds : cardPacks.map(pack => pack.id),
      records
    });
  }

  function saveLlmRegressionScenarioBatch(plans: LlmEffectTestPlan[], coverageRecords: EffectRuntimeTestStatusRecord[]) {
    if (plans.length === 0) {
      setError("No included regression fixtures were selected to save.");
      return;
    }

    setError("");
    setSaveMessage("");
    setLlmBusy(true);
    socket.emit("llm:saveRegressionScenarioBatch", {
      plans,
      coverageRecords
    });
  }

  function runLlmDirectEffectSmokeTest(plan: LlmEffectTestPlan) {
    setError("");
    setSaveMessage(`Running headless engine test for ${plan.card.cardName} ${plan.effect?.effectId ?? "NO_EFFECT"}...`);
    setLlmBusy(true);
    socket.emit("llm:runDirectEffectSmokeTest", {
      packIds: selectedPackIds.length > 0 ? selectedPackIds : cardPacks.map(pack => pack.id),
      plan
    });
  }

  function autoRunLlmIncludedDrafts(plans: LlmEffectTestPlan[]) {
    if (plans.length === 0) {
      setError("No included coverage drafts were selected for headless auto-run.");
      return;
    }

    setError("");
    setSaveMessage(`Starting headless auto-run for ${plans.length} included draft${plans.length === 1 ? "" : "s"}...`);
    setLlmBusy(true);
    socket.emit("llm:autoRunIncludedDrafts", {
      packIds: selectedPackIds.length > 0 ? selectedPackIds : cardPacks.map(pack => pack.id),
      plans
    });
  }

  function createLlmScenarioMatchFromPlan(plan: LlmEffectTestPlan) {
    setError("");
    setSaveMessage(`Creating play test for ${plan.card.cardName} ${plan.effect?.effectId ?? "NO_EFFECT"}...`);
    setLlmBusy(true);
    socket.emit("llm:createScenarioMatchFromPlan", {
      packIds: selectedPackIds.length > 0 ? selectedPackIds : cardPacks.map(pack => pack.id),
      plan
    });
  }


  function openCoverageRowInEffectDev(row: EffectCoverageRow) {
    setEffectDevFocusedCardKey(`${row.packId}:${row.cardId}`);
    setActivePage("effect-dev");
  }

  function openEffectDevCardInCoverage(cardKey: string) {
    setEffectCoverageFocusedCardKey(cardKey);
    setActivePage("effect-coverage");
  }

  function resolveEffectTarget(promptId: string, selectedOptionId: string) {
    if (!match) return;

    socket.emit("match:resolveEffectTarget", {
      matchId: match.matchId,
      promptId,
      selectedOptionId
    });
  }

  function applyManualMagicHeal(
    effectId: string,
    targetPlayerId: string,
    amount: number
  ) {
    if (!match) return;

    socket.emit("match:manualMagicHealPrimary", {
      matchId: match.matchId,
      effectId,
      targetPlayerId,
      amount
    });
  }

  function destroyMagicWithManualEffect(
    effectId: string,
    fieldOwnerPlayerId: string,
    cardInstanceId: string
  ) {
    if (!match) return;

    socket.emit("match:manualMagicDestroySlotCard", {
      matchId: match.matchId,
      effectId,
      fieldOwnerPlayerId,
      cardInstanceId
    });
  }

  function applyManualMagicStatModifier(
    effectId: string,
    targetPlayerId: string,
    stat: ManualEffectStatKey,
    delta: number,
    durationType: ManualEffectDurationType,
    durationTargetPlayerTurnStarts?: number
  ) {
    if (!match) return;

    socket.emit("match:manualMagicStatModifier", {
      matchId: match.matchId,
      effectId,
      targetPlayerId,
      stat,
      delta,
      durationType,
      durationTargetPlayerTurnStarts
    });
  }

  function resolveMagicChain() {
    if (!match) return;
    socket.emit("match:resolveMagicChain", match.matchId);
  }

  function passMagicChainPriority(playerId: string) {
    if (!match) return;
    socket.emit("match:passMagicChainPriority", {
      matchId: match.matchId,
      playerId
    });
  }

  function approveRevealRedraw() {
    if (!match?.pendingPrompt || match.pendingPrompt.type !== "NO_CREATURE_REDRAW_REVEAL") return;

    socket.emit("match:approveNoCreatureRedrawReveal", {
      matchId: match.matchId,
      approvingPlayerId: match.pendingPrompt.approvingPlayerId
    });
  }

  function requestNoCreatureRedraw(playerId: "player_1" | "player_2") {
    if (!match) return;
    socket.emit("match:requestNoCreatureRedrawReveal", {
      matchId: match.matchId,
      playerId
    });
  }

  function resolveForcedAlSummon(cardInstanceId: string) {
    if (!match?.pendingPrompt || match.pendingPrompt.type !== "FORCED_AL_SUMMON") return;
    socket.emit("match:resolveForcedAlSummonPrompt", {
      matchId: match.matchId,
      playerId: match.pendingPrompt.controllerPlayerId,
      cardInstanceId
    });
  }

  function mulliganForcedAlSummon() {
    if (!match?.pendingPrompt || match.pendingPrompt.type !== "FORCED_AL_SUMMON") return;
    socket.emit("match:mulliganForcedAlSummonPrompt", {
      matchId: match.matchId,
      playerId: match.pendingPrompt.controllerPlayerId
    });
  }

  function setHandRevealed(playerId: "player_1" | "player_2", revealed: boolean) {
    if (!match) return;
    socket.emit("match:setHandRevealed", {
      matchId: match.matchId,
      playerId,
      revealed
    });
  }

  async function logout() {
    await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: "POST",
      credentials: "include"
    });

    setAuthUser(null);
    setMatch(null);
    setSavedMatches([]);
    setDeckDetails([]);
    setCardOwnershipCounts({});
    setOwnershipSaveStatus("idle");
    setSocketAuthenticated(false);
    setServerRestartNotice("");
    removeClientStorage(AUTH_SESSION_SEEN_STORAGE_KEY);
    socket.disconnect();
  }

  const advanceBlockReason = match ? getAdvanceBlockReason(match) : "";
  const hasPendingManualEffects =
    match?.manualEffectQueue.some(effect => !effect.completed) ?? false;

  useEffect(() => {
    if (!activeLobby?.matchId || !authUser) return;
    const lobbyPlayer = activeLobby.players.find(player => player.userId === authUser.id && !player.isClone);
    if (lobbyPlayer?.seat !== 1 && lobbyPlayer?.seat !== 2) return;

    setControlledPlayersByMatchId(current => {
      if (activeLobby.mode === "SOLO" && current[activeLobby.matchId!]) {
        return current;
      }

      return {
        ...current,
        [activeLobby.matchId!]: lobbyPlayer.seat === 1 ? "player_1" : "player_2"
      };
    });
  }, [activeLobby, authUser]);

  const controlledPlayerId = (() => {
    if (!match || !authUser) {
      return undefined;
    }

    if (activeLobby?.matchId === match.matchId) {
      if (activeLobby.mode === "SOLO") {
        return controlledPlayersByMatchId[match.matchId] ?? "player_1";
      }

      const lobbyPlayer = activeLobby.players.find(player => player.userId === authUser.id && !player.isClone);
      if (lobbyPlayer?.seat === 1 || lobbyPlayer?.seat === 2) {
        return lobbyPlayer.seat === 1 ? "player_1" : "player_2";
      }
    }

    return controlledPlayersByMatchId[match.matchId];
  })();
  const canResolvePendingEffectTargetPrompt = Boolean(
    match?.pendingEffectTargetPrompt &&
    (!controlledPlayerId || controlledPlayerId === match.pendingEffectTargetPrompt.controllerPlayerId)
  );
  const canRespondToPendingChain = Boolean(
    match?.pendingChain &&
    (!controlledPlayerId ||
      controlledPlayerId === (match.pendingChain.priorityPlayerId ?? match.turn.activePlayerId))
  );
  const canViewPendingPrompt = Boolean(
    match?.pendingPrompt &&
    (!controlledPlayerId || controlledPlayerId === getPendingPromptControllerId(match.pendingPrompt))
  );
  const show3dBoardView = playViewMode === "board3d";
  const isLiveMatchSpectator = Boolean(
    match &&
    authUser &&
    activeLobby?.matchId === match.matchId &&
    !activeLobby.players.some(player =>
      player.userId === authUser.id ||
      (player.isClone && player.ownerUserId === authUser.id)
    )
  );

  function runBoardDiceRollShortcut(): boolean {
    if (!match || getMatchStatus(match) === "COMPLETE") return false;

    const openingRoll = getOpeningRollState(match);
    if (openingRoll?.status === "AWAITING_ROLL") {
      const rollPlayer = controlledPlayerId
        ? match.players.find(player => player.id === controlledPlayerId)
        : match.players.find(player => openingRoll.rolls[player.id] === undefined) ?? match.players[0];
      if (!rollPlayer || openingRoll.rolls[rollPlayer.id] !== undefined) return false;

      rollOpeningTurnOrder(rollPlayer.id);
      setLastBoardCommandLabel(`Shortcut: roll first (${rollPlayer.displayName})`);
      return true;
    }

    if (match.pendingEffectRoll?.status === "AWAITING_ROLL") {
      const rollPlayerId = match.pendingEffectRoll.rollPlayerId ?? match.pendingEffectRoll.sourcePlayerId;
      if (controlledPlayerId && controlledPlayerId !== rollPlayerId) return false;

      rollEffectRoll(match.pendingEffectRoll.id);
      setLastBoardCommandLabel("Shortcut: roll effect dice");
      return true;
    }

    if (!match.pendingBattle || match.pendingEffectRoll || match.pendingEffectTargetPrompt) {
      return false;
    }

    const pendingBattle = match.pendingBattle;
    const currentStrike = pendingBattle.strikes[pendingBattle.currentStrikeIndex];
    const battleControllerId =
      pendingBattle.status === "AWAITING_SPEED_CHECK"
        ? pendingBattle.attackingPlayerId
        : currentStrike?.attacker.playerId ?? pendingBattle.attackingPlayerId;
    if (controlledPlayerId && controlledPlayerId !== battleControllerId) return false;

    if (pendingBattle.status === "AWAITING_SPEED_CHECK") {
      runBattleSpeedCheck(pendingBattle.id);
      setLastBoardCommandLabel("Shortcut: run speed check");
      return true;
    }

    if (pendingBattle.status === "AWAITING_HIT_ROLL") {
      rollBattleHit(pendingBattle.id);
      setLastBoardCommandLabel("Shortcut: roll hit");
      return true;
    }

    if (pendingBattle.status === "AWAITING_DAMAGE_ROLL") {
      rollAndApplyBattleDamage(pendingBattle.id);
      setLastBoardCommandLabel("Shortcut: roll damage");
      return true;
    }

    return false;
  }

  function runGameplayKeybindingAction(action: GameplayKeybindingAction): boolean {
    if (!match) return false;

    const matchStatus = getMatchStatus(match);
    const canUseMatchActions = matchStatus !== "COMPLETE";
    const canControlActiveTurn = !controlledPlayerId || controlledPlayerId === match.turn.activePlayerId;

    if (action === "openEventLog") {
      setDashboardModal("event-log");
      setLastBoardCommandLabel("Shortcut: event log");
      return true;
    }

    if (isLiveMatchSpectator) {
      return false;
    }

    if (action === "swapPlayerView") {
      if (activeLobby?.matchId !== match.matchId || activeLobby.mode !== "SOLO") return false;

      const nextPlayerId = controlledPlayerId === "player_2" ? "player_1" : "player_2";
      switchSoloControlledPlayer(nextPlayerId);
      setLastBoardCommandLabel(`Shortcut: ${nextPlayerId === "player_2" ? "clone side" : "player side"}`);
      return true;
    }

    if (action === "drawCards") {
      if (!canUseMatchActions) return false;

      const drawTargetPlayerId =
        controlledPlayerId === "player_1" || controlledPlayerId === "player_2"
          ? controlledPlayerId
          : match.turn.activePlayerId;
      const pendingDrawEffect = getPendingManualDrawEffectForPlayer(match, drawTargetPlayerId);

      if (pendingDrawEffect) {
        resolveManualDrawEffect(pendingDrawEffect.id, drawTargetPlayerId);
        setLastBoardCommandLabel("Shortcut: draw effect resolved");
        return true;
      }

      if (!canDrawForCurrentTurn(match, controlledPlayerId)) return false;

      drawActivePlayer();
      setLastBoardCommandLabel("Shortcut: draw");
      return true;
    }

    if (action === "advancePhase") {
      if (!canUseMatchActions || !canControlActiveTurn || advanceBlockReason) return false;

      advancePhase();
      setLastBoardCommandLabel("Shortcut: advance phase");
      return true;
    }

    if (action === "undoLastAction") {
      if (!canUseMatchActions || !canControlActiveTurn) return false;

      undoLastAction();
      setLastBoardCommandLabel("Shortcut: undo");
      return true;
    }

    if (action === "rollBoardDice") {
      return runBoardDiceRollShortcut();
    }

    if (action === "openSaveLoad") {
      setDashboardModal("save-load");
      setLastBoardCommandLabel("Shortcut: save / load");
      return true;
    }

    return false;
  }

  useEffect(() => {
    if (activePage !== "play" || !match || !show3dBoardView || dashboardModal) return;

    function handleGameplayKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        isEditableKeybindingTarget(event.target)
      ) {
        return;
      }

      const action = getGameplayKeybindingActionByCode(readGameplayKeybindings(), event.code);
      if (!action) return;

      event.preventDefault();
      event.stopPropagation();

      if (event.repeat) return;
      runGameplayKeybindingAction(action);
    }

    window.addEventListener("keydown", handleGameplayKeyDown, true);
    return () => window.removeEventListener("keydown", handleGameplayKeyDown, true);
  }, [
    activeLobby,
    activePage,
    advanceBlockReason,
    controlledPlayerId,
    dashboardModal,
    isLiveMatchSpectator,
    match,
    show3dBoardView
  ]);

  if (!authChecked) {
    return (
      <main className="login-page">
        <section className="login-panel">
          <div className="login-title">
            <span>Ward Nexus</span>
            <h1>Loading</h1>
          </div>
        </section>
      </main>
    );
  }

  if (!authUser) {
    return (
      <LoginPage
        discordAuthEnabled={discordAuthEnabled}
        serverRestartNotice={serverRestartNotice}
        onDismissServerRestartNotice={() => setServerRestartNotice("")}
        onAuthenticated={user => {
          recordAuthenticatedSession();
          setServerRestartNotice("");
          setAuthUser(user);
          setSocketAuthenticated(null);
        }}
      />
    );
  }

  if (needsEmailVerification(authUser)) {
    return (
      <EmailVerificationGate
        user={authUser}
        onVerified={user => {
          setAuthUser(user);
          setSocketAuthenticated(null);
          setActivePage(DEFAULT_APP_PAGE);
        }}
        onLogout={() => void logout()}
      />
    );
  }

  const isBoardFocusMode = activePage === "play" && !!match && playViewMode === "board3d";

  const appShellClassName = [
    "app-shell",
    activePage === "card-library" || activePage === "deck-library" ? "app-shell-library-decks" : "",
    isBoardFocusMode ? "app-shell-board-focus" : "",
    boardWindowMode && activePage === "board-preview" ? "app-shell-board-window" : "",
    embedModeEnabled ? "app-shell-embed-mode" : ""
  ].filter(Boolean).join(" ");

  return (
    <main className={appShellClassName}>
      <section className="panel">
        {!embedModeEnabled && <header className="app-header">
          <div>
            <h1>Ward Nexus</h1>
            <p className="subtitle">Local rules-assisted 1v1 prototype</p>
          </div>

          <div className="app-header-actions">
            <button type="button" className="header-report-button" onClick={() => setDashboardModal("site-report")}>
              Report Issue
            </button>

            <div className="account-pill">
              <span>{authUser.displayName}</span>
              <button onClick={logout}>Logout</button>
            </div>

            <div className="server-pill">
              <span className="status-dot" />
              {serverMessage}
            </div>
          </div>
        </header>}

        {dashboardModal === "site-report" && (
          <ModalPanel
            title="Report Site Issue"
            onClose={() => setDashboardModal(null)}
            wide
          >
            <SiteReportPanel activePage={activePage} match={match} onSubmitted={() => setDashboardModal(null)} />
          </ModalPanel>
        )}

        {!embedModeEnabled && <nav className="app-page-nav" aria-label="App pages">
          {canSeePage("play") && <button
            className={activePage === "play" ? "app-page-nav-button active" : "app-page-nav-button"}
            onClick={() => navigateToPage("play")}
          >
            Play Table
          </button>}

          {canSeePage("board-preview") && <button
            className={activePage === "board-preview" ? "app-page-nav-button active" : "app-page-nav-button"}
            onClick={() => navigateToPage("board-preview")}
          >
            Board Preview
          </button>}

          {canSeePage("card-library") && <button
            className={activePage === "card-library" ? "app-page-nav-button active" : "app-page-nav-button"}
            onClick={() => navigateToPage("card-library")}
          >
            Card Library
          </button>}
          {canSeePage("deck-library") && <button
            className={activePage === "deck-library" ? "app-page-nav-button active" : "app-page-nav-button"}
            onClick={() => navigateToPage("deck-library")}
          >
            Deck Library
          </button>}
          {canSeePage("saved-matches") && <button
            className={activePage === "saved-matches" ? "app-page-nav-button active" : "app-page-nav-button"}
            onClick={() => navigateToPage("saved-matches")}
          >
            Saved Matches
          </button>}
          <button
            className={activePage === "qa-tickets" ? "app-page-nav-button active" : "app-page-nav-button"}
            onClick={() => navigateToPage("qa-tickets")}
          >
            Reports
          </button>
          {canSeePage("marketplace") && <button
            className={activePage === "marketplace" ? "app-page-nav-button active" : "app-page-nav-button"}
            onClick={() => navigateToPage("marketplace")}
          >
            Marketplace
          </button>}
          <button
            className={activePage === "profile" ? "app-page-nav-button active" : "app-page-nav-button"}
            onClick={() => navigateToPage("profile")}
          >
            Profile
          </button>
          {isAdminUser && (
            <button
              className={activePage === "admin-controls" ? "app-page-nav-button active" : "app-page-nav-button"}
              onClick={() => navigateToPage("admin-controls")}
            >
              Admin Controls
            </button>
          )}
          {canUseDevTools && (
            <>
              <button
                className={activePage === "effect-dev" ? "app-page-nav-button active" : "app-page-nav-button"}
                onClick={() => navigateToPage("effect-dev")}
              >
                Effect Dev Tool
              </button>

              <button
                className={activePage === "effect-coverage" ? "app-page-nav-button active" : "app-page-nav-button"}
                onClick={() => navigateToPage("effect-coverage")}
              >
                Effect Coverage
              </button>

              <button
                className={activePage === "llm-tests" ? "app-page-nav-button active" : "app-page-nav-button"}
                onClick={() => navigateToPage("llm-tests")}
              >
                LLM Test Lab
              </button>
            </>
          )}
        </nav>}

        {serverRestartNotice && (
          <div className="warning-box server-restart-notice">
            <span>{serverRestartNotice}</span>
            <div className="server-restart-actions">
              {authUser ? (
                <button type="button" onClick={() => void refreshLoginSessionForSocket({ manual: true, serverRestarted: true })}>
                  Reconnect Login Session
                </button>
              ) : null}
              <button type="button" onClick={() => window.location.reload()}>
                Reload Page
              </button>
              <button type="button" onClick={() => setServerRestartNotice("")}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="error-box">
            <span>{error}</span>
            {authUser && socketAuthenticated === false ? (
              <button type="button" onClick={() => void refreshLoginSessionForSocket({ manual: true })}>
                Reconnect Login Session
              </button>
            ) : null}
          </div>
        )}
        {match && matchHasRetestCards && dismissedRetestToastMatchId !== match.matchId ? (
          <div className="warning-box">
            <span>Existing report found for card {retestCardNamesInMatch.join(", ")} — please retest and add an addendum instead of creating a duplicate.</span>
            <button type="button" onClick={() => setDismissedRetestToastMatchId(match.matchId)}>Dismiss</button>
          </div>
        ) : null}
        {saveMessage && <div className="success-box">{saveMessage}</div>}
        {activePage === "card-library" && ownershipSaveStatus !== "idle" && (
          <div className={`ownership-save-status ${ownershipSaveStatus}`}>
            Ownership: {ownershipSaveStatus === "saving" ? "Saving..." : ownershipSaveStatus === "saved" ? "Saved" : "Could not save"}
          </div>
        )}

        {canUseDevTools && activePage === "effect-dev" ? (
          <EffectDevToolPage
            cardPacks={cardPacks}
            selectedPackIds={selectedPackIds}
            cardLibrary={cardLibrary}
            focusedCardKey={effectDevFocusedCardKey}
            onSelectedCardKeyChange={setEffectDevFocusedCardKey}
            onOpenSelectedInCoverage={openEffectDevCardInCoverage}
            onToggleSelectedPack={toggleSelectedPack}
            onRefreshCardLibrary={refreshCardLibrary}
            onSaveCardEffects={saveCardEffects}
            onCreateTestMatch={createEffectTestMatch}
          />
        ) : canUseDevTools && activePage === "effect-coverage" ? (
          <EffectCoveragePage
            cardPacks={cardPacks}
            selectedPackIds={selectedPackIds}
            rows={effectCoverageRows}
            cardLibrary={cardLibrary}
            focusedCardKey={effectCoverageFocusedCardKey}
            onClearFocusedCard={() => setEffectCoverageFocusedCardKey("")}
            onOpenCardInDevTool={openCoverageRowInEffectDev}
            onToggleSelectedPack={toggleSelectedPack}
            onRefreshCoverage={refreshEffectCoverage}
            onCreateScenarioMatch={createEffectScenarioMatch}
            onSaveTestStatus={saveEffectRuntimeTestStatus}
          />
        ) : canUseDevTools && activePage === "llm-tests" ? (
          <LlmEffectTestLabPage
            cardPacks={cardPacks}
            selectedPackIds={selectedPackIds}
            cardLibrary={cardLibrary}
            llmStatus={llmStatus}
            batchPlans={llmBatchPlans}
            batchProgress={llmBatchProgress}
            regressionScenarios={llmRegressionScenarios}
            phase4Report={llmPhase4Report}
            isBusy={llmBusy}
            onToggleSelectedPack={toggleSelectedPack}
            onRefreshStatus={refreshLlmStatus}
            onGeneratePlanBatch={generateLlmEffectTestPlanBatch}
            onSaveRegressionScenarioBatch={saveLlmRegressionScenarioBatch}
            onSaveCoverageRecords={saveLlmCoverageRecords}
            onRunDirectEffectSmokeTest={runLlmDirectEffectSmokeTest}
            onAutoRunIncludedDrafts={autoRunLlmIncludedDrafts}
            onCreateScenarioMatchFromPlan={createLlmScenarioMatchFromPlan}
            directTestResults={llmDirectTestResults}
            effectCoverageRows={effectCoverageRows}
            onResetWorkflow={resetLlmWorkflow}
          />
        ) : activePage === "admin-controls" && isAdminUser ? (
          <AdminControlsPage
            features={featureFlags}
            refreshKey={supportTicketRefreshKey}
            onToggleFeature={updateFeatureRollout}
          />
        ) : activePage === "deck-library" ? (
          <DeckLibraryPage
            decks={decks}
            deckDetails={deckDetails}
            tournamentDeckSubmissions={tournamentDeckSubmissions}
            currentUser={authUser}
            cardLibrary={cardLibrary}
            onEditDeck={deckId => loadDeckIntoBuilderAndOpenCardLibrary(deckId, "edit")}
            onCloneDeck={deckId => loadDeckIntoBuilderAndOpenCardLibrary(deckId, "clone")}
            onDeleteDeck={deleteDeck}
            onImportDeckCode={importDeckCodeIntoBuilder}
            onImportDecksToLibrary={saveImportedDecksToLibrary}
            onRefreshDeckDetails={() => socket.emit("deck:listDetails")}
            onReviewTournamentDeck={(ownerUserId, deckId, status, notes) => {
              socket.emit("deck:reviewTournamentSubmission", { ownerUserId, deckId, status, notes });
            }}
          />

        ) : activePage === "board-preview" ? (
          <BoardPreviewPage
            cardLibrary={cardLibrary}
            controlledPlayerId={controlledPlayerId === "player_1" || controlledPlayerId === "player_2" ? controlledPlayerId : null}
            liveMatch={match}
          />
        ) : activePage === "saved-matches" ? (
          <SaveLoadPanel
            savedMatches={savedMatches}
            canSave={match ? getMatchStatus(match) === "COMPLETE" : false}
            onRefresh={refreshSavedMatches}
            onSave={saveCurrentMatch}
            onLoad={loadSavedMatch}
            onDelete={deleteSavedMatch}
            onDeleteSelected={deleteSelectedSavedMatches}
          />
        ) : activePage === "qa-tickets" ? (
          <QATicketsPage
            tickets={qaTickets}
            authDisplayName={authUser.displayName}
            liveMatch={match}
            cardLibrary={cardLibrary}
            preferredPlayerId={controlledPlayerId}
            onCreateTicket={createQaTicket}
            onUpdateTicket={updateQaTicket}
            onDownloadTicketJson={downloadQaTicketJson}
            onDownloadAllTicketsJson={downloadAllQaTicketsJson}
            initialAddendumTicketId={qaInitialAddendumTicketId}
            canMarkReadyForRetest={authUser.role === "ADMIN"}
          />
        ) : activePage === "profile" ? (
          <ProfilePage key={profileRefreshKey} onUserUpdated={user => {
            setAuthUser(user);
            setSocketAuthenticated(null);
            if (hasCompletedEmailVerification(user)) {
              socket.disconnect();
              socket.connect();
            } else {
              socket.disconnect();
            }
          }} discordAuthEnabled={discordAuthEnabled} />
        ) : activePage === "marketplace" ? (
          <MarketplacePage authUser={authUser} cardLibrary={cardLibrary} />
        ) : activePage === "card-library" ? (
          <LibraryDecksPage
            selectedPackCount={selectedPackIds.length}
            cardLibrary={cardLibrary}
            deckBuilderName={deckBuilderName}
            deckBuilderId={deckBuilderId}
            deckBuilderCardIds={deckBuilderCardIds}
            deckBuilderCardArtKeys={deckBuilderCardArtKeys}
            deckBuilderFormat={deckBuilderFormat}
            ownershipCounts={cardOwnershipCounts}
            normalizeId={normalizeId}
            getDeckBuilderCounts={getDeckBuilderCounts}
            getDeckBuilderCardCount={getDeckBuilderCardCount}
            onDeckNameChange={value => {
              setDeckBuilderName(value);
              setDeckBuilderId(normalizeId(value));
            }}
            onDeckFormatChange={setDeckBuilderFormat}
            onImportDeckCode={importDeckCodeIntoBuilder}
            onRefreshCardLibrary={refreshCardLibrary}
            onClearDeckBuilder={clearDeckBuilder}
            onNewDeck={startNewDeckBuilder}
            onAddCard={addCardToDeckBuilder}
            onRemoveCard={removeCardFromDeckBuilder}
            onSetCardCopies={setDeckBuilderCardCopies}
            onSetOwnedCopies={setOwnedCardCopies}
            onSaveDeck={saveBuiltDeck}
            onAddMarketplaceNeed={data => {
              const needItems = getMarketplacePayloadItems(data, cardLibrary);
              if (needItems.length === 0) return;
              socket.emit("marketplace:createPost", {
                discordHandle: authUser.username,
                title: needItems.length === 1 ? `Need ${needItems[0].name}` : `Need ${needItems.length} missing cards`,
                description: "Created from collection completion.",
                status: "OPEN",
                haveItems: [],
                needItems,
                listingKinds: ["TRADE"],
                note: typeof data.note === "string" ? data.note : undefined
              });
            }}
            onAddMarketplaceHave={data => {
              const haveItems = getMarketplacePayloadItems(data, cardLibrary);
              if (haveItems.length === 0) return;
              const salePrice = typeof data.price === "string" && data.price.trim() ? Number(data.price) : undefined;
              socket.emit("marketplace:createPost", {
                discordHandle: authUser.username,
                title: haveItems.length === 1 ? `Have ${haveItems[0].name}` : `Have ${haveItems.length} cards available`,
                description: "Created from the card library.",
                status: "OPEN",
                haveItems,
                needItems: [],
                listingKinds: [data.trade === false ? null : "TRADE", data.sale ? "SALE" : null].filter(Boolean),
                salePrice: Number.isFinite(salePrice) ? salePrice : undefined,
                note: typeof data.note === "string" ? data.note : undefined
              });
            }}
            canUseDevTools={canUseDevTools}
            canManageZeroArtVariants={isAdminUser}
            onSaveCardLimit={saveCardTournamentLimit}
            onSaveCardZeroArtVariant={saveCardZeroArtVariant}
            onReportCardBroken={reportCardBroken}
            onSetCardWorking={setCardWorking}
          />
        ) : !match ? (
          <>
            <section className="play-lobby-workspace">
              <section className="play-setup-main">
                <MatchLobbyPanel
                user={authUser}
                lobbies={matchLobbies}
                activeLobby={activeLobby}
                cardPacks={cardPacks}
                decks={decks}
                selectedPackIds={selectedPackIds}
                onToggleSelectedPack={toggleSelectedPack}
                onRefresh={refreshSetupOptions}
                onCreateLobby={createLobby}
                onJoinLobby={joinLobby}
                onSelectDeck={selectLobbyDeck}
                onSelectCloneDeck={selectLobbyCloneDeck}
                onViewLobby={viewLobby}
                onLeaveLobby={leaveLobby}
                onStartMatch={startLobbyMatch}
                canUseDevTools={canUseDevTools}
                onCleanupStaleLobbies={cleanupStaleLobbies}
                />
              </section>
            </section>
            <MarketplaceTransactionPanel
              transactions={marketplaceTransactions}
              onRefresh={refreshMarketplaceTransactions}
              onConfirm={confirmMarketplaceTransaction}
              onDeny={denyMarketplaceTransaction}
              onCancel={cancelMarketplaceTransaction}
            />
          </>
        ) : (
          <>
            <section className="play-view-toolbar" aria-label="Play table view mode">
              <div>
                <span className="label">Table View</span>
                <strong>3D Board (Only)</strong>
              </div>
            </section>

            <section className={`match-workspace match-workspace-${playViewMode}`}>
              {show3dBoardView && (
                <section className="live-3d-board-view" aria-label="Live 3D game board">
                  <div className="live-3d-board-stage">
                    <BoardPreview3D
                      match={match}
                      adminView={canUseDevTools}
                      presentation="game"
                      defaultIntegrationMode
                      gameplayKeybindings={gameplayKeybindings}
                      controlledPlayerId={controlledPlayerId === "player_1" || controlledPlayerId === "player_2" ? controlledPlayerId : null}
                      spectatorMode={isLiveMatchSpectator}
                      onAdvancePhase={advancePhase}
                      onEndTurn={endTurn}
                      onUndoLastAction={undoLastAction}
                      onRequestNoCreatureRedraw={requestNoCreatureRedraw}
                      onSetHandRevealed={setHandRevealed}
                      onApproveRevealRedraw={approveRevealRedraw}
                      onResolveForcedAlSummon={resolveForcedAlSummon}
                      onMulliganForcedAlSummon={mulliganForcedAlSummon}
                      onOpeningRoll={rollOpeningTurnOrder}
                      onDeckSlotClick={handleDeckClick}
                      onResolveEffectTarget={resolveEffectTarget}
                      onDiscardHandCardToCemetery={discardHandCardToCemetery}
                      onDestroyMagic={(fieldOwnerPlayerId, cardInstanceId) => {
                        socket.emit("match:destroyMagicSlotCard", {
                          matchId: match.matchId,
                          fieldOwnerPlayerId,
                          cardInstanceId
                        });
                      }}
                      onCallCemeteryHpLoss={callCemeteryHpLoss}
                      onPlayHandCardToSlot={(cardInstanceId, slotId, sacrificeCardInstanceIds = []) => {
                        const slotOwnerId = slotId.startsWith("player_2-") ? "player_2" : "player_1";
                        const handOwner = match.players.find(player =>
                          player.id === slotOwnerId &&
                          player.hand.some(item => item.instanceId === cardInstanceId)
                        );
                        if (!handOwner) return;
                        if (slotId.includes("-primary")) {
                          socket.emit("match:playPrimaryCreature", { matchId: match.matchId, playerId: handOwner.id, cardInstanceId, sacrificeCardInstanceIds });
                          return;
                        }
                        if (slotId.includes("-magic")) {
                          socket.emit("match:playMagic", { matchId: match.matchId, playerId: handOwner.id, cardInstanceId });
                        }
                      }}
                      onPlayLightningResponse={(playerId, cardInstanceId) => {
                        socket.emit("match:playLightningResponse", {
                          matchId: match.matchId,
                          playerId,
                          cardInstanceId
                        });
                      }}
                      onPlayBattleResponse={playBattleResponseFromHand}
                      onResolveMagicChain={resolveMagicChain}
                      onPassMagicChainPriority={(playerId) => {
                        passMagicChainPriority(playerId);
                      }}
                      onAttachEquipMagicToCreature={(fieldOwnerPlayerId, magicCardInstanceId, targetPlayerId, targetCreatureInstanceId, targetKind) => {
                        socket.emit("match:attachEquipMagicToCreature", {
                          matchId: match.matchId,
                          fieldOwnerPlayerId,
                          magicCardInstanceId,
                          targetPlayerId,
                          targetCreatureInstanceId,
                          targetKind
                        });
                      }}
                      onStartBattleFromPiece={(cardInstanceId, defenderCreatureInstanceId) => {
                        startManualBattle(cardInstanceId, defenderCreatureInstanceId);
                      }}
                      onRunBattleSpeedCheck={runBattleSpeedCheck}
                      onRollBattleHit={rollBattleHit}
                      onRollBattleDamage={rollAndApplyBattleDamage}
                      onApplyBattleDamage={applyBattleDamage}
                      onFinishBattle={finishManualBattle}
                      onRollEffectRoll={rollEffectRoll}
                      onApplyEffectRoll={applyEffectRoll}
                      onSkipEffectRoll={skipEffectRoll}
                      onActivateCardEffect={activateCardEffect}
                      onOpenBoardReport={() => setDashboardModal("board-report")}
                      highlightReport={matchHasRetestCards}
                      onCloseMatch={isLiveMatchSpectator ? undefined : closeActiveMatchWithoutSaving}
                      intentLabel={lastBoardIntentLabel}
                      commandLabel={lastBoardCommandLabel}
                      onIntent={(intent: PointerGestureIntent) => {
                        const label = intent.kind === "NO_OP"
                          ? `Blocked: ${intent.reason}`
                          : intent.kind === "SELECT_SLOT"
                            ? `Slot: ${intent.slotId}`
                            : `Piece: ${intent.pieceId}`;
                        setLastBoardIntentLabel(label);
                      }}
                      onIntentCommand={(command: BoardIntentCommand) => {
                        const label = command.kind === "NONE"
                          ? `Command: none (${command.reason})`
                          : command.kind === "FOCUS_SLOT"
                            ? `Command: focus slot ${command.slotId}`
                            : `Command: focus piece ${command.cardInstanceId ?? command.pieceId}`;
                        setLastBoardCommandLabel(label);
                      }}
                      soloControlOverlay={activeLobby?.matchId === match.matchId && activeLobby.mode === "SOLO" ? (
                        <div className="solo-control-switch" aria-label="Solo control side">
                          <span className="label">Solo Control</span>
                          <strong>{controlledPlayerId === "player_2" ? "Clone side" : "Player side"}</strong>
                          <button
                            type="button"
                            onClick={() => switchSoloControlledPlayer(controlledPlayerId === "player_2" ? "player_1" : "player_2")}
                          >
                            <GameplayKeybindingLabel action="swapPlayerView" keybindings={gameplayKeybindings}>
                              Switch to {controlledPlayerId === "player_2" ? "Player" : "Clone"}
                            </GameplayKeybindingLabel>
                          </button>
                        </div>
                      ) : null}
                      actionDock={(
                        <CompactMatchControlPanel
                          match={match}
                          advanceBlockReason={advanceBlockReason}
                          controlledPlayerId={controlledPlayerId}
                          gameplayKeybindings={gameplayKeybindings}
                          onOpeningRoll={rollOpeningTurnOrder}
                          onShuffleAllDecks={shuffleAllDecks}
                          onUndoLastAction={undoLastAction}
                          onDrawActivePlayer={drawActivePlayer}
                          onStartManualBattle={startManualBattle}
                          onUpdateCannotInflictAttackDamageBattlePolicy={updateCannotInflictAttackDamageBattlePolicy}
                          onAdvancePhase={advancePhase}
                          onOpenSaveLoad={() => setDashboardModal("save-load")}
                          onOpenManualEffects={() => setDashboardModal("manual-effects")}
                          onOpenBattleResult={() => setDashboardModal("battle-result")}
                          onOpenDiceRoller={() => setDashboardModal("dice-roller")}
                          onOpenEventLog={() => setDashboardModal("event-log")}
                          onOpenMatchDetails={() => setDashboardModal("match-details")}
                          onOpenEffectDebug={canUseDevTools ? () => setDashboardModal("effect-debug") : undefined}
                        />
                      )}
                    />
                  </div>

                </section>
              )}


            </section>

            {match.pendingBattle && !match.pendingChain && !show3dBoardView && (
              <ModalPanel title="Manual Battle Resolver" blocking wide>
                <BattleResolverModal
                  match={match}
                  battle={match.pendingBattle}
                  onRunSpeedCheck={runBattleSpeedCheck}
                  onUpdateSpeedModifiers={updateBattleSpeedModifiers}
                  onUpdateStrikeModifiers={updateBattleStrikeModifiers}
                  onRollHit={rollBattleHit}
                  onForceRolls={forceDevRolls}
                  enableDevTools={canUseDevTools}
                  onRollDamage={rollBattleDamage}
                  onPlayBattleResponse={playBattleResponseFromHand}
                  onUndo={undoLastAction}
                  onApplyDamage={applyBattleDamage}
                  onFinish={finishManualBattle}
                  onCancel={cancelManualBattle}
                />
              </ModalPanel>
            )}

            {match.pendingEffectRoll && !show3dBoardView && (
              <ModalPanel title="Effect Roll" blocking wide>
                <EffectRollModal
                  match={match}
                  effectRoll={match.pendingEffectRoll}
                  onRoll={rollEffectRoll}
                  onApply={applyEffectRoll}
                  onSkip={skipEffectRoll}
                />
              </ModalPanel>
            )}

            {canViewPendingPrompt && !show3dBoardView && (
              <ModalPanel title="Action Required" blocking>
                {match.pendingPrompt?.type === "NO_CREATURE_REDRAW_REVEAL" ? (
                  <HandRevealPromptCard
                    match={match}
                    controlledPlayerId={controlledPlayerId}
                    onApprove={approveRevealRedraw}
                  />
                ) : (
                  <ForcedAlSummonPromptCard
                    match={match}
                    controlledPlayerId={controlledPlayerId}
                    onSummon={resolveForcedAlSummon}
                    onMulligan={mulliganForcedAlSummon}
                  />
                )}
              </ModalPanel>
            )}

            {match.pendingEffectTargetPrompt && canResolvePendingEffectTargetPrompt && !targetPromptCanResolveOnBoard(match) && (
              <ModalPanel title="Choose Effect Target" blocking wide>
                <TargetPromptCard
                  prompt={match.pendingEffectTargetPrompt}
                  onUndo={undoLastAction}
                  onResolve={resolveEffectTarget}
                />
              </ModalPanel>
            )}

            {match.pendingChain && canRespondToPendingChain && !show3dBoardView && (
              <ModalPanel title="Resolve Chain" blocking wide>
                <MagicChainCard
                  match={match}
                  onResolve={resolveMagicChain}
                  onUndo={undoLastAction}
                  onPassPriority={passMagicChainPriority}
                />
              </ModalPanel>
            )}

            {getMatchStatus(match) === "COMPLETE" && (
              <ModalPanel title="Match Complete" blocking wide>
                <MatchCompleteCard
                  match={match}
                  onClose={closeCompletedMatchWithoutSaving}
                  onSaveAndClose={saveCompletedMatchAndClose}
                />
              </ModalPanel>
            )}

            {dashboardModal === "save-load" && (
              <ModalPanel
                title="Save / Load Match"
                onClose={() => setDashboardModal(null)}
                wide
              >
                <SaveLoadPanel
                  savedMatches={savedMatches}
                  canSave={getMatchStatus(match) === "COMPLETE"}
                  onRefresh={refreshSavedMatches}
                  onSave={saveCurrentMatch}
                  onLoad={loadSavedMatch}
                  onDelete={deleteSavedMatch}
                  onDeleteSelected={deleteSelectedSavedMatches}
                />
              </ModalPanel>
            )}

            {dashboardModal === "manual-effects" && (
              <ModalPanel
                title="Pending Magic Effects"
                onClose={() => setDashboardModal(null)}
                wide
              >
                {hasPendingManualEffects ? (
                  <ManualEffectQueueCard
                    match={match}
                    manualEffectAmounts={manualEffectAmounts}
                    manualEffectStats={manualEffectStats}
                    manualEffectDurations={manualEffectDurations}
                    manualEffectDurationTypes={manualEffectDurationTypes}
                    setManualEffectAmounts={setManualEffectAmounts}
                    setManualEffectStats={setManualEffectStats}
                    setManualEffectDurations={setManualEffectDurations}
                    setManualEffectDurationTypes={setManualEffectDurationTypes}
                    onCompleteEffect={completeManualMagicEffect}
                    onDamagePrimary={applyManualMagicDamage}
                    onHealPrimary={applyManualMagicHeal}
                    onApplyStatModifier={applyManualMagicStatModifier}
                    onDestroyMagicWithEffect={destroyMagicWithManualEffect}
                  />
                ) : (
                  <section className="card manual-effect-card modal-empty-card">
                    <h2>Pending Magic Effects</h2>
                    <p className="empty-zone">No pending manual effects.</p>
                  </section>
                )}
              </ModalPanel>
            )}

            {dashboardModal === "dice-roller" && (
              <ModalPanel
                title="Dice Roller"
                onClose={() => setDashboardModal(null)}
                wide
              >
                <DiceRollerPanel />
              </ModalPanel>
            )}

            {dashboardModal === "battle-result" && (
              <ModalPanel
                title="Last Battle Result"
                onClose={() => setDashboardModal(null)}
                wide
              >
                <BattleResultCard match={match} />
              </ModalPanel>
            )}

            {dashboardModal === "event-log" && (
              <ModalPanel
                title="Event Log"
                onClose={() => setDashboardModal(null)}
                wide
              >
                <EventLogCard match={match} />
              </ModalPanel>
            )}


            {canUseDevTools && dashboardModal === "effect-debug" && (
              <ModalPanel
                title="Effect Debug Inspector"
                onClose={() => setDashboardModal(null)}
                wide
              >
                <EffectDebugPanel match={match} />
              </ModalPanel>
            )}
            {dashboardModal === "board-report" && (
              <ModalPanel
                title="Report Board Issue"
                onClose={() => setDashboardModal(null)}
                wide
              >
                <BoardReportPanel
                  match={match}
                  qaTickets={qaTickets}
                  onOpenQaTickets={openQaTab}
                  onAddendumToTicket={openQaTabForAddendum}
                  onQueued={queueBoardReport}
                  onSubmitted={() => setDashboardModal(null)}
                />
              </ModalPanel>
            )}
            {dashboardModal === "match-details" && (
              <ModalPanel
                title="Full Match State"
                onClose={() => setDashboardModal(null)}
                wide
              >
                <MatchStatePanel
                  match={match}
                  advanceBlockReason={advanceBlockReason}
                  controlledPlayerId={controlledPlayerId}
                  onOpeningRoll={rollOpeningTurnOrder}
                  onShuffleAllDecks={shuffleAllDecks}
                  onUndoLastAction={undoLastAction}
                  onDrawActivePlayer={drawActivePlayer}
                  onBattlePrimaryCreatures={battlePrimaryCreatures}
                  onAdvancePhase={advancePhase}
                />
              </ModalPanel>
            )}
          </>
        )}
      </section>
    </main>
  );
}
