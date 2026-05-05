import { useEffect, useState } from "react";
import { BattleResolverModal } from "./components/BattleResolverModal";
import { BattleResultCard } from "./components/BattleResultCard";
import { DevTestControlsPanel } from "./components/DevTestControlsPanel";
import { DiceRollerPanel } from "./components/DiceRollerPanel";
import { EffectCoveragePage } from "./components/EffectCoveragePage";
import { EffectDebugPanel } from "./components/EffectDebugPanel";
import { EffectDevToolPage } from "./components/EffectDevToolPage";
import { EventLogCard } from "./components/EventLogCard";
import { EffectRollModal } from "./components/EffectRollModal";
import { LibraryDecksPage } from "./components/LibraryDecksPage";
import { LlmEffectTestLabPage } from "./components/LlmEffectTestLabPage";
import { HandRevealPromptCard } from "./components/HandRevealPromptCard";
import { MagicChainCard } from "./components/MagicChainCard";
import { ManualEffectQueueCard } from "./components/ManualEffectQueueCard";
import { MatchCompleteCard } from "./components/MatchCompleteCard";
import { MatchSetupPanel } from "./components/MatchSetupPanel";
import { CompactMatchControlPanel } from "./components/CompactMatchControlPanel";
import { MatchStatePanel } from "./components/MatchStatePanel";
import { PlayerPanel } from "./components/PlayerPanel";
import { SaveLoadPanel } from "./components/SaveLoadPanel";
import { TargetPromptCard } from "./components/TargetPromptCard";
import { ModalPanel } from "./components/ui/ModalPanel";
import { socket } from "./socket";
import type { DevRollKind, WardEngineEffect } from "@ward/shared";
import type {
  AppMatchState,
  CardLibraryCardSummary,
  CardOwnershipMap,
  CardPackSummary,
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
  ManualEffectDurationType,
  ManualEffectStatKey,
  SavedMatchSummary,
  ServerWelcome,
  SetupOptions
} from "./clientTypes";
import { getAdvanceBlockReason, getMatchStatus } from "./gameViewHelpers";
import "./App.css";

type AppPage = "play" | "library-decks" | "effect-dev" | "effect-coverage" | "llm-tests";

type DashboardModal =
  | "save-load"
  | "manual-effects"
  | "battle-result"
  | "dice-roller"
  | "event-log"
  | "match-details"
  | "effect-debug"
  | null;

export default function App() {
  const [serverMessage, setServerMessage] = useState("Connecting...");
  const [socketId, setSocketId] = useState("");
  const [match, setMatch] = useState<AppMatchState | null>(null);
  const [error, setError] = useState("");
  const [savedMatches, setSavedMatches] = useState<SavedMatchSummary[]>([]);
  const [saveMessage, setSaveMessage] = useState("");
  const [cardPacks, setCardPacks] = useState<CardPackSummary[]>([]);
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [selectedPackIds, setSelectedPackIds] = useState<string[]>([]);
  const [selectedPlayer1DeckId, setSelectedPlayer1DeckId] = useState("");
  const [selectedPlayer2DeckId, setSelectedPlayer2DeckId] = useState("");
  const [cardLibrary, setCardLibrary] = useState<CardLibraryCardSummary[]>([]);
  const [effectCoverageRows, setEffectCoverageRows] = useState<EffectCoverageRow[]>([]);
  const [cardOwnershipCounts, setCardOwnershipCounts] = useState<CardOwnershipMap>({});
  const [deckBuilderName, setDeckBuilderName] = useState("New Test Deck");
  const [deckBuilderId, setDeckBuilderId] = useState("new-test-deck");
  const [deckBuilderCardIds, setDeckBuilderCardIds] = useState<string[]>([]);
  const [manualEffectAmounts, setManualEffectAmounts] = useState<Record<string, string>>({});
  const [manualEffectStats, setManualEffectStats] = useState<Record<string, ManualEffectStatKey>>({});
  const [manualEffectDurations, setManualEffectDurations] = useState<Record<string, string>>({});
  const [manualEffectDurationTypes, setManualEffectDurationTypes] = useState<
    Record<string, ManualEffectDurationType>
  >({});
  const [dashboardModal, setDashboardModal] = useState<DashboardModal>(null);
  const [activePage, setActivePage] = useState<AppPage>("play");
  const [effectDevFocusedCardKey, setEffectDevFocusedCardKey] = useState("");
  const [effectCoverageFocusedCardKey, setEffectCoverageFocusedCardKey] = useState("");
  const [setupSavesOpen, setSetupSavesOpen] = useState(true);
  const [llmStatus, setLlmStatus] = useState<LlmServiceStatus | undefined>();
  const [llmBatchPlans, setLlmBatchPlans] = useState<LlmEffectTestPlan[]>([]);
  const [llmRegressionScenarios, setLlmRegressionScenarios] = useState<LlmRegressionScenarioSummary[]>([]);
  const [llmPhase4Report, setLlmPhase4Report] = useState<LlmPhase4ReportSummary | undefined>();
  const [llmBatchProgress, setLlmBatchProgress] = useState<LlmBatchProgress | undefined>();
  const [llmDirectTestResults, setLlmDirectTestResults] = useState<Record<string, LlmDirectEffectSmokeTestResult>>({});
  const [llmBusy, setLlmBusy] = useState(false);

  useEffect(() => {
    socket.on("server:welcome", (data: ServerWelcome) => {
      setServerMessage(data.message);
      setSocketId(data.socketId);
    });

    socket.on("connect", () => {
      requestInitialData();
    });

    socket.on("match:state", (data: AppMatchState) => {
      setMatch(data);
      setError("");
    });

    socket.on("match:error", (data: { message: string }) => {
      setError(data.message);
      setLlmBusy(false);
    });

    socket.on("match:savedList", (data: SavedMatchSummary[]) => {
      setSavedMatches(data);
    });

    socket.on("match:saved", (data: { message: string; matchId: string }) => {
      setSaveMessage(data.message);
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

      const defaultPackIds = data.cardPacks.map(pack => pack.id);
      if (defaultPackIds.length > 0) {
        socket.emit("cards:listForPacks", { packIds: defaultPackIds });
        socket.emit("dev:listEffectCoverage", { packIds: defaultPackIds });
      }

      setSelectedPackIds(current => {
        const validPackIds = data.cardPacks.map(pack => pack.id);
        const stillValidCurrent = current.filter(packId =>
          validPackIds.includes(packId)
        );

        if (stillValidCurrent.length > 0) {
          return stillValidCurrent;
        }

        return validPackIds;
      });

      setSelectedPlayer1DeckId(current => {
        if (current && data.decks.some(deck => deck.id === current)) {
          return current;
        }

        return data.decks[0]?.id ?? "";
      });

      setSelectedPlayer2DeckId(current => {
        if (current && data.decks.some(deck => deck.id === current)) {
          return current;
        }

        return data.decks[0]?.id ?? "";
      });
    });

    socket.on("cards:library", (data: CardLibraryCardSummary[]) => {
      setCardLibrary(data);
    });

    socket.on("collection:ownership", (data: CardOwnershipMap) => {
      setCardOwnershipCounts(data);
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

      setSelectedPlayer1DeckId(current => current || data.deckId);
      setSelectedPlayer2DeckId(current => current || data.deckId);
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
      }) => {
        const confirmed = window.confirm(
          `${data.message}\n\nOverwrite "${data.deckId}"?`
        );

        if (!confirmed) {
          setSaveMessage("Deck overwrite canceled.");
          return;
        }

        socket.emit("deck:save", {
          deckId: data.deckId,
          name: data.name,
          packIds: data.packIds,
          cardIds: data.cardIds,
          overwrite: true
        });
      }
    );

    socket.on("deck:deleted", (data: { message: string; deckId: string }) => {
      setSaveMessage(data.message);

      setSelectedPlayer1DeckId(current =>
        current === data.deckId ? "" : current
      );
      setSelectedPlayer2DeckId(current =>
        current === data.deckId ? "" : current
      );

      socket.emit("setup:listOptions");
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

    socket.on("connect_error", () => {
      setServerMessage("Could not connect to WARD server.");
    });

    requestInitialData();

    return () => {
      socket.off("server:welcome");
      socket.off("connect");
      socket.off("match:state");
      socket.off("match:error");
      socket.off("match:savedList");
      socket.off("match:saved");
      socket.off("match:deleted");
      socket.off("match:bulkDeleted");
      socket.off("setup:options");
      socket.off("cards:library");
      socket.off("collection:ownership");
      socket.off("dev:effectCoverage");
      socket.off("dev:effectRuntimeTestStatusSaved");
      socket.off("deck:saved");
      socket.off("deck:loaded");
      socket.off("deck:overwriteRequired");
      socket.off("deck:deleted");
      socket.off("dev:cardEffectsSaved");
      socket.off("dev:testMatchCreated");
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
      return;
    }

    socket.emit("cards:listForPacks", {
      packIds: selectedPackIds
    });
  }, [selectedPackIds]);

  useEffect(() => {
    const packIds = selectedPackIds.length > 0
      ? selectedPackIds
      : cardPacks.map(pack => pack.id);

    if (packIds.length === 0) {
      setEffectCoverageRows([]);
      return;
    }

    socket.emit("dev:listEffectCoverage", { packIds });
  }, [cardPacks, selectedPackIds]);


  function requestInitialData() {
    socket.emit("match:listSaved");
    socket.emit("setup:listOptions");
    socket.emit("collection:listOwnership");
    socket.emit("llm:getStatus");
  }

  function refreshEffectCoverage() {
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

  function refreshSetupOptions() {
    socket.emit("setup:listOptions");
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

  function createConfiguredMatch() {
    setError("");
    setSaveMessage("");

    if (selectedPackIds.length === 0) {
      setError("Select at least one card pack.");
      return;
    }

    if (!selectedPlayer1DeckId || !selectedPlayer2DeckId) {
      setError("Select a deck for both players.");
      return;
    }

    socket.emit("match:create1v1WithSetup", {
      packIds: selectedPackIds,
      player1DeckId: selectedPlayer1DeckId,
      player2DeckId: selectedPlayer2DeckId
    });
  }

  function normalizeId(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
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

  function addCardToDeckBuilder(cardId: string) {
    const card = cardLibrary.find(item => item.id === cardId);
    const deckLimit = card?.deckLimit ?? 3;
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
  }

  function removeCardFromDeckBuilder(cardId: string) {
    setDeckBuilderCardIds(current => {
      const index = current.indexOf(cardId);

      if (index === -1) {
        return current;
      }

      return [...current.slice(0, index), ...current.slice(index + 1)];
    });
  }

  function clearDeckBuilder() {
    setDeckBuilderCardIds([]);
  }

  function startNewDeckBuilder() {
    setDeckBuilderName("New Test Deck");
    setDeckBuilderId("new-test-deck");
    setDeckBuilderCardIds([]);
    setError("");
    setSaveMessage("Started a new deck.");
  }

  function setDeckBuilderCardCopies(cardId: string, requestedCopyCount: number) {
    const card = cardLibrary.find(item => item.id === cardId);
    const deckLimit = card?.deckLimit ?? 3;
    const safeRequestedCount = Math.max(0, Math.floor(requestedCopyCount));
    const nextCopyCount = Math.min(safeRequestedCount, deckLimit, 30);

    if (deckLimit <= 0 && safeRequestedCount > 0) {
      setError(`${card?.name ?? cardId} is banned and cannot be added.`);
      return;
    }

    setError("");
    setDeckBuilderCardIds(current => {
      const withoutCard = current.filter(currentCardId => currentCardId !== cardId);
      const availableSlots = Math.max(0, 30 - withoutCard.length);
      const finalCopyCount = Math.min(nextCopyCount, availableSlots);

      return [...withoutCard, ...Array.from({ length: finalCopyCount }, () => cardId)];
    });
  }

  function setOwnedCardCopies(cardId: string, requestedOwnedCount: number) {
    const safeOwnedCount = Math.min(999, Math.max(0, Math.floor(requestedOwnedCount)));

    setCardOwnershipCounts(current => ({
      ...current,
      [cardId]: safeOwnedCount
    }));

    socket.emit("collection:setCardOwnership", {
      cardId,
      ownedCount: safeOwnedCount
    });
  }

  function loadDeckIntoBuilder(deckId: string, mode: "edit" | "clone") {
    setError("");
    setSaveMessage("");
    socket.emit("deck:load", { deckId, mode });
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
      const card = cardLibrary.find(item => item.id === cardId);
      const deckLimit = card?.deckLimit ?? 3;

      return count > deckLimit;
    });

    if (overLimit.length > 0) {
      setError("Deck contains cards over their banned/limited restriction.");
      return;
    }

    socket.emit("deck:save", {
      deckId: finalDeckId,
      name: deckBuilderName.trim(),
      packIds: selectedPackIds,
      cardIds: deckBuilderCardIds,
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

  function shuffleAllDecks() {
    if (!match) return;
    socket.emit("match:shuffleAllDecks", match.matchId);
  }

  function refreshSavedMatches() {
    socket.emit("match:listSaved");
  }

  function saveCurrentMatch() {
    if (!match) return;
    socket.emit("match:saveCurrent", match.matchId);
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

  function startManualBattle(attackerCreatureInstanceId: string) {
    if (!match) return;

    const defendingPlayer = match.players.find(player => player.id !== match.turn.activePlayerId);
    const defenderCreatureInstanceId = defendingPlayer?.field.primaryCreature?.instanceId;

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

  function clearForcedDevRolls(kind?: DevRollKind) {
    if (!match) return;
    socket.emit("match:devClearForcedRolls", {
      matchId: match.matchId,
      kind
    });
  }

  function saveEffectRuntimeTestStatus(
    row: EffectCoverageRow,
    status: EffectRuntimeTestStatus,
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
        status,
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
    if (!match?.pendingPrompt) return;

    socket.emit("match:approveNoCreatureRedrawReveal", {
      matchId: match.matchId,
      approvingPlayerId: match.pendingPrompt.approvingPlayerId
    });
  }

  function closeCompletedMatch() {
    setDashboardModal(null);
    socket.emit("match:listSaved");
    setMatch(null);
  }

  const advanceBlockReason = match ? getAdvanceBlockReason(match) : "";
  const hasPendingManualEffects =
    match?.manualEffectQueue.some(effect => !effect.completed) ?? false;

  return (
    <main className="app-shell">
      <section className="panel">
        <header className="app-header">
          <div>
            <h1>WARD Virtual Tabletop</h1>
            <p className="subtitle">Local rules-assisted 1v1 prototype</p>
          </div>

          <div className="server-pill">
            <span className="status-dot" />
            {serverMessage}
          </div>
        </header>

        <nav className="app-page-nav" aria-label="App pages">
          <button
            className={activePage === "play" ? "app-page-nav-button active" : "app-page-nav-button"}
            onClick={() => setActivePage("play")}
          >
            Play Table
          </button>
          <button
            className={activePage === "library-decks" ? "app-page-nav-button active" : "app-page-nav-button"}
            onClick={() => setActivePage("library-decks")}
          >
            Library / Decks
          </button>
          <button
            className={activePage === "effect-dev" ? "app-page-nav-button active" : "app-page-nav-button"}
            onClick={() => setActivePage("effect-dev")}
          >
            Effect Dev Tool
          </button>

          <button
            className={activePage === "effect-coverage" ? "app-page-nav-button active" : "app-page-nav-button"}
            onClick={() => setActivePage("effect-coverage")}
          >
            Effect Coverage
          </button>

          <button
            className={activePage === "llm-tests" ? "app-page-nav-button active" : "app-page-nav-button"}
            onClick={() => setActivePage("llm-tests")}
          >
            LLM Test Lab
          </button>
        </nav>

        {socketId && (
          <p className="socket-id">
            Socket ID: <span>{socketId}</span>
          </p>
        )}

        {error && <div className="error-box">{error}</div>}
        {saveMessage && <div className="success-box">{saveMessage}</div>}

        {activePage === "effect-dev" ? (
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
        ) : activePage === "effect-coverage" ? (
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
        ) : activePage === "llm-tests" ? (
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
        ) : activePage === "library-decks" ? (
          <LibraryDecksPage
            decks={decks}
            selectedPackCount={selectedPackIds.length}
            cardLibrary={cardLibrary}
            deckBuilderName={deckBuilderName}
            deckBuilderId={deckBuilderId}
            deckBuilderCardIds={deckBuilderCardIds}
            ownershipCounts={cardOwnershipCounts}
            normalizeId={normalizeId}
            getDeckBuilderCounts={getDeckBuilderCounts}
            getDeckBuilderCardCount={getDeckBuilderCardCount}
            onDeckNameChange={value => {
              setDeckBuilderName(value);
              setDeckBuilderId(normalizeId(value));
            }}
            onDeckIdChange={value => setDeckBuilderId(normalizeId(value))}
            onRefreshCardLibrary={refreshCardLibrary}
            onClearDeckBuilder={clearDeckBuilder}
            onNewDeck={startNewDeckBuilder}
            onAddCard={addCardToDeckBuilder}
            onRemoveCard={removeCardFromDeckBuilder}
            onSetCardCopies={setDeckBuilderCardCopies}
            onSetOwnedCopies={setOwnedCardCopies}
            onSaveDeck={saveBuiltDeck}
            onLoadDeckIntoBuilder={loadDeckIntoBuilder}
            onDeleteDeck={deleteDeck}
          />
        ) : !match ? (
          <section className={`play-setup-workspace${setupSavesOpen ? " saves-open" : " saves-collapsed"}`}>
            <aside className="play-saves-drawer" aria-label="Saved matches">
              <button
                type="button"
                className="play-saves-drawer-toggle"
                onClick={() => setSetupSavesOpen(current => !current)}
                aria-expanded={setupSavesOpen}
                aria-controls="play-save-load-drawer-content"
              >
                <span>{setupSavesOpen ? "Hide Saves" : "Show Saves"}</span>
                <span className="zone-details-badge">{savedMatches.length}</span>
              </button>

              <div id="play-save-load-drawer-content" className="play-saves-drawer-content">
                {setupSavesOpen && (
                  <SaveLoadPanel
                    savedMatches={savedMatches}
                    canSave={false}
                    onRefresh={refreshSavedMatches}
                    onSave={saveCurrentMatch}
                    onLoad={loadSavedMatch}
                    onDelete={deleteSavedMatch}
                    onDeleteSelected={deleteSelectedSavedMatches}
                  />
                )}
              </div>
            </aside>

            <section className="play-setup-main">
              <MatchSetupPanel
                cardPacks={cardPacks}
                decks={decks}
                selectedPackIds={selectedPackIds}
                selectedPlayer1DeckId={selectedPlayer1DeckId}
                selectedPlayer2DeckId={selectedPlayer2DeckId}
                onRefreshSetupOptions={refreshSetupOptions}
                onToggleSelectedPack={toggleSelectedPack}
                onPlayer1DeckChange={setSelectedPlayer1DeckId}
                onPlayer2DeckChange={setSelectedPlayer2DeckId}
                onCreateConfiguredMatch={createConfiguredMatch}
              />
            </section>
          </section>
        ) : (
          <>
            <CompactMatchControlPanel
              match={match}
              advanceBlockReason={advanceBlockReason}
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
              onOpenEffectDebug={() => setDashboardModal("effect-debug")}
            />

            {!match.pendingBattle && (
              <MagicChainCard match={match} onResolve={resolveMagicChain} onPassPriority={passMagicChainPriority} />
            )}

            <DevTestControlsPanel
              match={match}
              onForceRolls={forceDevRolls}
              onClearForcedRolls={clearForcedDevRolls}
            />

            <section className="match-workspace">
              <section className="players-grid match-board-grid">
                {match.players.map(player => (
                  <PlayerPanel key={player.id} match={match} player={player} />
                ))}
              </section>
            </section>

            {match.pendingBattle && !match.pendingChain && (
              <ModalPanel title="Manual Battle Resolver" blocking wide>
                <BattleResolverModal
                  match={match}
                  battle={match.pendingBattle}
                  onRunSpeedCheck={runBattleSpeedCheck}
                  onUpdateSpeedModifiers={updateBattleSpeedModifiers}
                  onUpdateStrikeModifiers={updateBattleStrikeModifiers}
                  onRollHit={rollBattleHit}
                  onForceRolls={forceDevRolls}
                  onRollDamage={rollBattleDamage}
                  onPlayBattleResponse={playBattleResponseFromHand}
                  onApplyDamage={applyBattleDamage}
                  onFinish={finishManualBattle}
                  onCancel={cancelManualBattle}
                />
              </ModalPanel>
            )}

            {match.pendingBattle && match.pendingChain && (
              <MagicChainCard match={match} onResolve={resolveMagicChain} onPassPriority={passMagicChainPriority} />
            )}

            {match.pendingEffectRoll && (
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

            {match.pendingPrompt && (
              <ModalPanel title="Action Required" blocking>
                <HandRevealPromptCard match={match} onApprove={approveRevealRedraw} />
              </ModalPanel>
            )}

            {match.pendingEffectTargetPrompt && (
              <ModalPanel title="Choose Effect Target" blocking wide>
                <TargetPromptCard
                  prompt={match.pendingEffectTargetPrompt}
                  onResolve={resolveEffectTarget}
                />
              </ModalPanel>
            )}

            {getMatchStatus(match) === "COMPLETE" && (
              <ModalPanel title="Match Complete" blocking wide>
                <MatchCompleteCard match={match} onClose={closeCompletedMatch} />
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
                  canSave={!!match}
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


            {dashboardModal === "effect-debug" && (
              <ModalPanel
                title="Effect Debug Inspector"
                onClose={() => setDashboardModal(null)}
                wide
              >
                <EffectDebugPanel match={match} />
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


