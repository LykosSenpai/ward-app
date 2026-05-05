import { useEffect, useMemo, useState } from "react";
import type {
  CardLibraryCardSummary,
  CardPackSummary,
  EffectCoverageRow,
  EffectRuntimeIssueType,
  EffectRuntimeTestStatus,
  EffectRuntimeTestStatusRecord,
  LlmBatchProgress,
  LlmDirectEffectSmokeTestResult,
  LlmEffectTestPlan,
  LlmPhase4ReportSummary,
  LlmRegressionScenarioSummary,
  LlmServiceStatus
} from "../clientTypes";
import { getDisplayMagicType } from "../gameViewHelpers";

type LlmPlanRequest = {
  packId: string;
  cardId: string;
  effectId?: string;
};

type BulkEffectQueueCard = {
  packId: string;
  cardId: string;
  cardName: string;
  cardLabel: string;
  effectIds: string[];
};

type CoverageDraft = {
  include: boolean;
  status: EffectRuntimeTestStatus;
  issueType: EffectRuntimeIssueType;
  notes: string;
};

const STATUS_OPTIONS: EffectRuntimeTestStatus[] = [
  "UNTESTED",
  "WORKING",
  "PARTIAL",
  "BROKEN",
  "BLOCKED_RUNTIME",
  "BLOCKED_DATA",
  "NEEDS_RULES_REVIEW"
];

const ISSUE_OPTIONS: EffectRuntimeIssueType[] = [
  "NONE",
  "WRONG_TARGET",
  "WRONG_TIMING",
  "WRONG_DURATION",
  "WRONG_COUNTER",
  "WRONG_DAMAGE",
  "WRONG_STAT_MODIFIER",
  "MISSING_BUTTON",
  "MISSING_PROMPT",
  "MISSING_CHAIN_WINDOW",
  "MISSING_CLEANUP",
  "UNSUPPORTED_ACTION_TYPE"
];

function getCardKey(card: CardLibraryCardSummary): string {
  return `${card.packId}:${card.id}`;
}

function getPlanKey(plan: LlmEffectTestPlan): string {
  return `${plan.card.packId}:${plan.card.cardId}:${plan.effect?.effectId ?? "NO_EFFECT"}`;
}

function formatCardLabel(card: CardLibraryCardSummary): string {
  const generation = card.generation ? `Gen ${card.generation}` : card.packId;
  const number = card.cardNumber ? `#${card.cardNumber}` : card.id;
  return `${generation} ${number}  -  ${card.name}`;
}

function getCardSummary(card: CardLibraryCardSummary): string {
  if (card.cardType === "CREATURE") {
    return `${card.creatureType ?? "Creature"}  -  AL ${card.armorLevel ?? "?"}  -  SPD ${card.speed ?? "?"}  -  HP ${card.hp ?? "?"}  -  ${card.attackDice ?? "?"}D6  -  MOD ${card.modifier ?? "?"}`;
  }

  return `${getDisplayMagicType(card.magicType) || "MAGIC"}  -  ${card.magicSubType ?? "NONE"}`;
}

function getSearchText(card: CardLibraryCardSummary): string {
  return [
    card.id,
    card.name,
    card.packId,
    card.cardNumber,
    card.generation,
    card.cardType,
    card.creatureType,
    card.magicType,
    card.magicSubType,
    card.text,
    ...(card.effectTypes ?? [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function buildCoverageRecordFromPlan(
  plan: LlmEffectTestPlan,
  draft: CoverageDraft,
  testedBy: string
): EffectRuntimeTestStatusRecord | undefined {
  if (!plan.effect?.effectId) return undefined;

  return {
    key: `${plan.card.packId}:${plan.card.cardId}:${plan.effect.effectId}`,
    packId: plan.card.packId,
    cardId: plan.card.cardId,
    cardName: plan.card.cardName,
    effectId: plan.effect.effectId,
    trigger: plan.effect.trigger,
    actionType: plan.effect.actionType,
    status: draft.status,
    issueType: draft.issueType,
    notes: draft.notes,
    testedBy
  };
}

function buildDefaultDraft(plan: LlmEffectTestPlan): CoverageDraft {
  return {
    include: true,
    status: plan.coverageSuggestion.status,
    issueType: plan.coverageSuggestion.issueType,
    notes:
      plan.coverageSuggestion.notes ||
      `LLM batch plan generated for ${plan.card.cardName} ${plan.effect?.effectId ?? "NO_EFFECT"}. Manually verify before saving as Working.`
  };
}

type LlmEffectTestLabPageProps = {
  cardPacks: CardPackSummary[];
  selectedPackIds: string[];
  cardLibrary: CardLibraryCardSummary[];
  llmStatus?: LlmServiceStatus;
  batchPlans: LlmEffectTestPlan[];
  batchProgress?: LlmBatchProgress;
  regressionScenarios: LlmRegressionScenarioSummary[];
  phase4Report?: LlmPhase4ReportSummary;
  isBusy: boolean;
  onToggleSelectedPack: (packId: string) => void;
  onRefreshStatus: () => void;
  onGeneratePlanBatch: (requests: LlmPlanRequest[]) => void;
  onSaveRegressionScenarioBatch: (plans: LlmEffectTestPlan[], coverageRecords: EffectRuntimeTestStatusRecord[]) => void;
  onSaveCoverageRecords: (records: EffectRuntimeTestStatusRecord[]) => void;
  onRunDirectEffectSmokeTest: (plan: LlmEffectTestPlan) => void;
  onAutoRunIncludedDrafts: (plans: LlmEffectTestPlan[]) => void;
  onCreateScenarioMatchFromPlan: (plan: LlmEffectTestPlan) => void;
  directTestResults: Record<string, LlmDirectEffectSmokeTestResult>;
  effectCoverageRows: EffectCoverageRow[];
  onResetWorkflow: () => void;
};

export function LlmEffectTestLabPage({
  cardPacks,
  selectedPackIds,
  cardLibrary,
  llmStatus,
  batchPlans,
  batchProgress,
  regressionScenarios,
  phase4Report,
  isBusy,
  onToggleSelectedPack,
  onRefreshStatus,
  onGeneratePlanBatch,
  onSaveRegressionScenarioBatch,
  onSaveCoverageRecords,
  onRunDirectEffectSmokeTest,
  onAutoRunIncludedDrafts,
  onCreateScenarioMatchFromPlan,
  directTestResults,
  effectCoverageRows,
  onResetWorkflow
}: LlmEffectTestLabPageProps) {
  const [searchText, setSearchText] = useState("");
  const [showOnlyNeedsTesting, setShowOnlyNeedsTesting] = useState(false);
  const [selectedCardKey, setSelectedCardKey] = useState("");
  const [selectedEffectIds, setSelectedEffectIds] = useState<string[]>([]);
  const [bulkEffectQueue, setBulkEffectQueue] = useState<BulkEffectQueueCard[]>([]);
  const [coverageDrafts, setCoverageDrafts] = useState<Record<string, CoverageDraft>>({});
  const [reviewReady, setReviewReady] = useState(false);
  const [manualCheckpointKey, setManualCheckpointKey] = useState("");

  const sortedCards = useMemo(() => {
    return [...cardLibrary].sort((a, b) => {
      const generationSort = `${a.generation ?? ""}`.localeCompare(`${b.generation ?? ""}`, undefined, { numeric: true });
      if (generationSort !== 0) return generationSort;

      const numberSort = `${a.cardNumber ?? ""}`.localeCompare(`${b.cardNumber ?? ""}`, undefined, { numeric: true });
      if (numberSort !== 0) return numberSort;

      return a.name.localeCompare(b.name);
    });
  }, [cardLibrary]);

  const cardsByKey = useMemo(() => {
    return new Map(sortedCards.map(card => [getCardKey(card), card]));
  }, [sortedCards]);

  const savedEffectStatusByKey = useMemo(() => {
    const map = new Map<string, EffectCoverageRow>();

    for (const row of effectCoverageRows) {
      map.set(`${row.packId}:${row.cardId}:${row.effectId}`, row);
    }

    return map;
  }, [effectCoverageRows]);

  const draftEffectStatusByKey = useMemo(() => {
    const map = new Map<string, CoverageDraft>();

    for (const plan of batchPlans) {
      if (!plan.effect?.effectId) continue;
      const key = getPlanKey(plan);
      map.set(key, coverageDrafts[key] ?? buildDefaultDraft(plan));
    }

    return map;
  }, [batchPlans, coverageDrafts]);

  function getEffectStatusSnapshot(card: CardLibraryCardSummary, effectId: string): {
    status: EffectRuntimeTestStatus;
    issueType: EffectRuntimeIssueType;
    source: "Draft" | "Auto" | "Saved" | "None";
    notes?: string;
  } {
    const key = `${card.packId}:${card.id}:${effectId}`;
    const draft = draftEffectStatusByKey.get(key);
    const autoResult = directTestResults[key];
    const saved = savedEffectStatusByKey.get(key);

    if (draft && draft.status !== "UNTESTED") {
      return {
        status: draft.status,
        issueType: draft.issueType,
        source: "Draft",
        notes: draft.notes
      };
    }

    if (autoResult && autoResult.status !== "UNTESTED") {
      return {
        status: autoResult.status,
        issueType: autoResult.issueType,
        source: "Auto",
        notes: autoResult.summary
      };
    }

    if (saved?.testStatus) {
      return {
        status: saved.testStatus,
        issueType: saved.testIssueType ?? "NONE",
        source: "Saved",
        notes: saved.testNotes
      };
    }

    if (draft) {
      return {
        status: draft.status,
        issueType: draft.issueType,
        source: "Draft",
        notes: draft.notes
      };
    }

    return {
      status: "UNTESTED",
      issueType: "NONE",
      source: "None"
    };
  }

  function getCardStatusSummary(card: CardLibraryCardSummary): {
    total: number;
    working: number;
    needs: number;
    primaryStatus: EffectRuntimeTestStatus | "NO_EFFECTS";
    label: string;
  } {
    const effects = card.effects ?? [];
    const total = effects.length;

    if (total === 0) {
      return {
        total,
        working: 0,
        needs: 0,
        primaryStatus: "NO_EFFECTS",
        label: "No effects"
      };
    }

    const snapshots = effects.map(effect => getEffectStatusSnapshot(card, effect.id));
    const working = snapshots.filter(snapshot => snapshot.status === "WORKING").length;
    const needs = total - working;

    let primaryStatus: EffectRuntimeTestStatus = "UNTESTED";
    if (needs === 0) {
      primaryStatus = "WORKING";
    } else if (snapshots.some(snapshot => snapshot.status === "BROKEN")) {
      primaryStatus = "BROKEN";
    } else if (snapshots.some(snapshot => snapshot.status === "BLOCKED_RUNTIME" || snapshot.status === "BLOCKED_DATA")) {
      primaryStatus = "BLOCKED_RUNTIME";
    } else if (snapshots.some(snapshot => snapshot.status === "PARTIAL")) {
      primaryStatus = "PARTIAL";
    } else if (snapshots.some(snapshot => snapshot.status === "NEEDS_RULES_REVIEW")) {
      primaryStatus = "NEEDS_RULES_REVIEW";
    }

    return {
      total,
      working,
      needs,
      primaryStatus,
      label: needs === 0 ? `${working}/${total} working` : `${needs} need test/fix`
    };
  }

  const filteredCards = useMemo(() => {
    const search = searchText.trim().toLowerCase();

    return sortedCards.filter(card => {
      if (search && !getSearchText(card).includes(search)) return false;
      if (!showOnlyNeedsTesting) return true;

      const summary = getCardStatusSummary(card);
      return summary.total > 0 && summary.needs > 0;
    });
  }, [draftEffectStatusByKey, directTestResults, savedEffectStatusByKey, searchText, showOnlyNeedsTesting, sortedCards]);

  const selectedCard = useMemo(() => {
    return sortedCards.find(card => getCardKey(card) === selectedCardKey) ?? filteredCards[0];
  }, [filteredCards, selectedCardKey, sortedCards]);

  const selectedBulkEffects = useMemo(() => {
    if (!selectedCard?.effects?.length) return [];
    return selectedCard.effects.filter(effect => selectedEffectIds.includes(effect.id));
  }, [selectedCard, selectedEffectIds]);

  const bulkPlanRequests = useMemo<LlmPlanRequest[]>(() => {
    return bulkEffectQueue.flatMap(item =>
      item.effectIds.map(effectId => ({
        packId: item.packId,
        cardId: item.cardId,
        effectId
      }))
    );
  }, [bulkEffectQueue]);

  const includedBatchPlans = useMemo(() => {
    return batchPlans.filter(plan => coverageDrafts[getPlanKey(plan)]?.include ?? true);
  }, [batchPlans, coverageDrafts]);

  const includedCoverageRecords = useMemo(() => {
    return batchPlans.flatMap(plan => {
      const draft = coverageDrafts[getPlanKey(plan)] ?? buildDefaultDraft(plan);
      if (!draft.include || draft.status === "UNTESTED") return [];
      const record = buildCoverageRecordFromPlan(plan, draft, "LLM Test Lab Batch");
      return record ? [record] : [];
    });
  }, [batchPlans, coverageDrafts]);

  const includedUntestedCount = useMemo(() => {
    return batchPlans.filter(plan => {
      const draft = coverageDrafts[getPlanKey(plan)] ?? buildDefaultDraft(plan);
      return draft.include && draft.status === "UNTESTED";
    }).length;
  }, [batchPlans, coverageDrafts]);

  const nextUnrunPlan = useMemo(() => {
    return includedBatchPlans.find(plan => !directTestResults[getPlanKey(plan)]);
  }, [directTestResults, includedBatchPlans]);

  const nextCheckpointPlan = useMemo(() => {
    return includedBatchPlans.find(plan => {
      const key = getPlanKey(plan);
      const result = directTestResults[key];
      const draft = coverageDrafts[key] ?? buildDefaultDraft(plan);
      return Boolean(result) && draft.include && draft.status === "UNTESTED";
    });
  }, [coverageDrafts, directTestResults, includedBatchPlans]);

  const activeCheckpointPlan = useMemo(() => {
    if (manualCheckpointKey) {
      const explicitPlan = includedBatchPlans.find(plan => getPlanKey(plan) === manualCheckpointKey);
      if (explicitPlan) return explicitPlan;
    }
    return nextCheckpointPlan;
  }, [includedBatchPlans, manualCheckpointKey, nextCheckpointPlan]);

  const statusCounts = useMemo(() => {
    return batchPlans.reduce<Record<string, number>>((counts, plan) => {
      const draft = coverageDrafts[getPlanKey(plan)] ?? buildDefaultDraft(plan);
      counts[draft.status] = (counts[draft.status] ?? 0) + 1;
      return counts;
    }, {});
  }, [batchPlans, coverageDrafts]);

  useEffect(() => {
    if (!selectedCard) return;
    const firstEffectId = selectedCard.effects?.[0]?.id ?? "";
    setSelectedEffectIds(current => {
      const validIds = current.filter(id => selectedCard.effects?.some(effect => effect.id === id));
      return validIds.length > 0 ? validIds : firstEffectId ? [firstEffectId] : [];
    });
  }, [selectedCard]);

  useEffect(() => {
    setCoverageDrafts(current => {
      const next: Record<string, CoverageDraft> = {};

      for (const plan of batchPlans) {
        const key = getPlanKey(plan);
        next[key] = current[key] ?? buildDefaultDraft(plan);
      }

      return next;
    });
    setReviewReady(false);
  }, [batchPlans]);

  function selectCard(card: CardLibraryCardSummary) {
    const firstEffectId = card.effects?.[0]?.id ?? "";
    setSelectedCardKey(getCardKey(card));
    setSelectedEffectIds(firstEffectId ? [firstEffectId] : []);
  }

  function toggleSelectedEffect(effectId: string) {
    setSelectedEffectIds(current =>
      current.includes(effectId)
        ? current.filter(id => id !== effectId)
        : [...current, effectId]
    );
  }

  function selectAllEffectsForCard() {
    setSelectedEffectIds((selectedCard?.effects ?? []).map(effect => effect.id));
  }

  function clearSelectedEffectsForCard() {
    setSelectedEffectIds([]);
  }

  function addSelectedEffectsToBulkQueue() {
    if (!selectedCard || selectedBulkEffects.length === 0) return;

    setBulkEffectQueue(current => {
      const existing = current.find(item => item.packId === selectedCard.packId && item.cardId === selectedCard.id);
      if (existing) {
        const mergedIds = Array.from(new Set([...existing.effectIds, ...selectedBulkEffects.map(effect => effect.id)]));
        return current.map(item =>
          item === existing
            ? { ...item, effectIds: mergedIds }
            : item
        );
      }

      return [
        ...current,
        {
          packId: selectedCard.packId,
          cardId: selectedCard.id,
          cardName: selectedCard.name,
          cardLabel: formatCardLabel(selectedCard),
          effectIds: selectedBulkEffects.map(effect => effect.id)
        }
      ];
    });
  }

  function addAllEffectsToQueue() {
    selectAllEffectsForCard();
    if (!selectedCard?.effects?.length) return;

    const effectIds = selectedCard.effects.map(effect => effect.id);
    setBulkEffectQueue(current => {
      const existing = current.find(item => item.packId === selectedCard.packId && item.cardId === selectedCard.id);
      if (existing) {
        const mergedIds = Array.from(new Set([...existing.effectIds, ...effectIds]));
        return current.map(item => item === existing ? { ...item, effectIds: mergedIds } : item);
      }

      return [
        ...current,
        {
          packId: selectedCard.packId,
          cardId: selectedCard.id,
          cardName: selectedCard.name,
          cardLabel: formatCardLabel(selectedCard),
          effectIds
        }
      ];
    });
  }

  function removeBulkQueueCard(packId: string, cardId: string) {
    setBulkEffectQueue(current => current.filter(item => item.packId !== packId || item.cardId !== cardId));
  }

  function updateCoverageDraft(plan: LlmEffectTestPlan, patch: Partial<CoverageDraft>) {
    const key = getPlanKey(plan);
    setCoverageDrafts(current => ({
      ...current,
      [key]: {
        ...(current[key] ?? buildDefaultDraft(plan)),
        ...patch
      }
    }));
  }

  function markAllBulk(status: EffectRuntimeTestStatus) {
    setCoverageDrafts(current => {
      const next = { ...current };
      for (const plan of batchPlans) {
        const key = getPlanKey(plan);
        next[key] = {
          ...(next[key] ?? buildDefaultDraft(plan)),
          include: true,
          status,
          issueType: status === "WORKING" ? "NONE" : next[key]?.issueType ?? plan.coverageSuggestion.issueType
        };
      }
      return next;
    });
  }

  function prepareReviewDrafts() {
    setCoverageDrafts(current => {
      const next = { ...current };
      for (const plan of batchPlans) {
        const key = getPlanKey(plan);
        next[key] = next[key] ?? buildDefaultDraft(plan);
      }
      return next;
    });
    setReviewReady(true);
  }

  function applyDirectTestResultToDraft(plan: LlmEffectTestPlan, result: LlmDirectEffectSmokeTestResult) {
    updateCoverageDraft(plan, {
      include: true,
      status: result.status,
      issueType: result.issueType,
      notes: [
        `Headless engine test: ${result.summary}`,
        `Match ID: ${result.matchId}`,
        result.pendingEffectTargetPrompt ? `Pending target prompt: ${result.pendingEffectTargetPrompt}` : undefined,
        result.pendingPrompt ? `Pending prompt: ${result.pendingPrompt}` : undefined,
        result.manualEffectQueueCount > 0 ? `Manual effect queue count: ${result.manualEffectQueueCount}` : undefined,
        result.eventTypes.length ? `Event types: ${result.eventTypes.join(", ")}` : undefined,
        result.evidence.length ? "Evidence:" : undefined,
        ...result.evidence.map(item => `- ${item}`)
      ].filter(Boolean).join("\n")
    });
    setReviewReady(true);
  }

  function applyAllAutoRunResultsToDrafts() {
    setCoverageDrafts(current => {
      const next = { ...current };
      for (const plan of includedBatchPlans) {
        const key = getPlanKey(plan);
        const result = directTestResults[key];
        if (!result) continue;
        next[key] = {
          ...(next[key] ?? buildDefaultDraft(plan)),
          include: true,
          status: result.status,
          issueType: result.issueType,
          notes: [
            `Headless engine test: ${result.summary}`,
            `Representative match ID: ${result.matchId}`,
            result.beforeSummary ? `Before: ${result.beforeSummary}` : undefined,
            result.afterSummary ? `After: ${result.afterSummary}` : undefined,
            result.pendingEffectTargetPrompt ? `Pending target prompt: ${result.pendingEffectTargetPrompt}` : undefined,
            result.pendingPrompt ? `Pending prompt: ${result.pendingPrompt}` : undefined,
            result.manualEffectQueueCount > 0 ? `Manual effect queue count: ${result.manualEffectQueueCount}` : undefined,
            result.eventTypes.length ? `Event types: ${result.eventTypes.join(", ")}` : undefined,
            result.variantResults?.length ? "Variant routes:" : undefined,
            ...(result.variantResults ?? []).map(variant => `- ${variant.name}: ${variant.status} - ${variant.summary}`),
            result.assertionResults?.length ? "Assertion results:" : undefined,
            ...(result.assertionResults ?? []).map(assertion => `- ${assertion.status}: ${assertion.label} (${assertion.path})`),
            result.evidence.length ? "Evidence:" : undefined,
            ...result.evidence.map(item => `- ${item}`)
          ].filter(Boolean).join("\n")
        };
      }
      return next;
    });
    setReviewReady(true);
  }

  function buildAutoRunNotes(plan: LlmEffectTestPlan, result: LlmDirectEffectSmokeTestResult | undefined, decisionLabel: string): string {
    const existing = (coverageDrafts[getPlanKey(plan)] ?? buildDefaultDraft(plan)).notes.trim();

    return [
      existing,
      existing ? "" : undefined,
      `Manual confirmation: ${decisionLabel}.`,
      result ? `Auto-run summary: ${result.summary}` : undefined,
      result ? `Representative match ID: ${result.matchId}` : undefined,
      result?.beforeSummary ? `Before: ${result.beforeSummary}` : undefined,
      result?.afterSummary ? `After: ${result.afterSummary}` : undefined,
      result?.pendingEffectTargetPrompt ? `Pending target prompt: ${result.pendingEffectTargetPrompt}` : undefined,
      result?.pendingPrompt ? `Pending prompt: ${result.pendingPrompt}` : undefined,
      result?.variantResults?.length ? "Variant routes:" : undefined,
      ...(result?.variantResults ?? []).map(variant => `- ${variant.name}: ${variant.status} - ${variant.summary}`),
      result?.assertionResults?.length ? "Assertion results:" : undefined,
      ...(result?.assertionResults ?? []).map(assertion => `- ${assertion.status}: ${assertion.label} (${assertion.path})`),
      result?.evidence.length ? "Evidence:" : undefined,
      ...(result?.evidence ?? []).slice(0, 20).map(item => `- ${item}`)
    ].filter(Boolean).join("\n");
  }

  function confirmDraftStatus(plan: LlmEffectTestPlan, status: EffectRuntimeTestStatus, issueType?: EffectRuntimeIssueType) {
    const key = getPlanKey(plan);
    const result = directTestResults[key];
    const resolvedIssueType = issueType ?? (status === "WORKING" ? "NONE" : result?.issueType ?? (coverageDrafts[key] ?? buildDefaultDraft(plan)).issueType);

    updateCoverageDraft(plan, {
      include: true,
      status,
      issueType: resolvedIssueType,
      notes: buildAutoRunNotes(plan, result, status)
    });
    setReviewReady(true);
    setManualCheckpointKey("");
  }

  function acceptWorkingAutoRuns() {
    setCoverageDrafts(current => {
      const next = { ...current };
      for (const plan of includedBatchPlans) {
        const key = getPlanKey(plan);
        const result = directTestResults[key];
        const draft = next[key] ?? buildDefaultDraft(plan);
        if (!result || result.status !== "WORKING" || draft.status !== "UNTESTED") continue;
        next[key] = {
          ...draft,
          include: true,
          status: "WORKING",
          issueType: "NONE",
          notes: buildAutoRunNotes(plan, result, "WORKING auto-run accepted")
        };
      }
      return next;
    });
    setReviewReady(true);
  }

  function runNextIncludedDraft() {
    const targetPlan = nextUnrunPlan ?? nextCheckpointPlan;
    if (!targetPlan) return;
    onRunDirectEffectSmokeTest(targetPlan);
    setManualCheckpointKey(getPlanKey(targetPlan));
  }

  function resetWorkflow() {
    setCoverageDrafts({});
    setReviewReady(false);
    setManualCheckpointKey("");
    onResetWorkflow();
  }

  function clearAllSelections() {
    setBulkEffectQueue([]);
    setSelectedEffectIds([]);
    resetWorkflow();
  }

  return (
    <section className="llm-test-lab-page llm-test-lab-page-compact">
      <section className="card llm-test-lab-hero llm-sticky-toolbar">
        <div>
          <h2>LLM Batch Effect Test Lab</h2>
          <p>
            Batch workflow: select one or all effects on cards, generate plans, then auto-run included drafts through real engine actions, battle rolls, effect rolls, chain priority, and prompt resolution before saving coverage.
          </p>
        </div>

        <div className="llm-status-card llm-status-card-compact">
          <span className={llmStatus?.configured ? "llm-status-dot configured" : "llm-status-dot fallback"} />
          <div>
            <strong>{llmStatus?.configured ? "LLM Configured" : "Local Fallback"}</strong>
            <span>{llmStatus?.model ?? "No model loaded"}</span>
          </div>
          <button className="secondary-button" onClick={onRefreshStatus}>Refresh</button>
        </div>
      </section>

      <section className="card llm-pack-row llm-pack-row-compact">
        <div>
          <strong>Loaded Packs</strong>
          <p>{selectedPackIds.length}/{cardPacks.length} selected.</p>
        </div>
        <div className="llm-pack-chip-row">
          {cardPacks.map(pack => (
            <label key={pack.id} className="effect-coverage-pack-chip">
              <input
                type="checkbox"
                checked={selectedPackIds.includes(pack.id)}
                onChange={() => onToggleSelectedPack(pack.id)}
              />
              <span>{pack.name}</span>
              <small>{pack.cardCount}</small>
            </label>
          ))}
        </div>
      </section>

      <section className="llm-workflow-grid">
        <aside className="card llm-card-picker llm-card-picker-compact">
          <div className="effect-dev-pane-header">
            <h3>1. Pick Card Effects</h3>
            <span>{filteredCards.length} cards</span>
          </div>

          <label>
            Search
            <input
              value={searchText}
              onChange={event => setSearchText(event.target.value)}
              placeholder="Card, action, trigger, text..."
            />
          </label>

          <label className="llm-picker-filter-row">
            <input
              type="checkbox"
              checked={showOnlyNeedsTesting}
              onChange={event => setShowOnlyNeedsTesting(event.target.checked)}
            />
            <span>Only show cards with effects needing test/fix</span>
          </label>

          {selectedCard && (
            <section className="llm-selected-card-summary llm-selected-card-summary-compact">
              <span className="library-card-kicker">Selected Card</span>
              <strong>{selectedCard.name}</strong>
              <p>{formatCardLabel(selectedCard)}</p>
              <p>{getCardSummary(selectedCard)}</p>

              {(() => {
                const summary = getCardStatusSummary(selectedCard);
                return (
                  <div className="llm-selected-card-status-row">
                    <span className={`llm-effect-status-pill llm-effect-status-${summary.primaryStatus.toLowerCase()}`}>{summary.primaryStatus === "NO_EFFECTS" ? "NO EFFECTS" : summary.primaryStatus}</span>
                    <small>{summary.total === 0 ? "No parsed effects on this card." : `${summary.working}/${summary.total} working  -  ${summary.needs} need test/fix`}</small>
                  </div>
                );
              })()}

              <div className="llm-effect-select-tools">
                <strong>{selectedEffectIds.length}/{selectedCard.effects?.length ?? 0} effects selected</strong>
                <div>
                  <button className="secondary-button" onClick={selectAllEffectsForCard} disabled={!selectedCard.effects?.length}>Select All</button>
                  <button className="secondary-button" onClick={clearSelectedEffectsForCard} disabled={!selectedEffectIds.length}>Clear</button>
                </div>
              </div>

              <div className="llm-effect-checkbox-list llm-effect-checkbox-list-compact">
                {(selectedCard.effects ?? []).map(effect => {
                  const status = getEffectStatusSnapshot(selectedCard, effect.id);

                  return (
                    <label key={effect.id} className={`llm-effect-checkbox-row llm-effect-checkbox-row-${status.status.toLowerCase()}`}>
                      <input
                        type="checkbox"
                        checked={selectedEffectIds.includes(effect.id)}
                        onChange={() => toggleSelectedEffect(effect.id)}
                      />
                      <span>
                        <strong>
                          {effect.id}  -  {effect.actionType}
                          <span className={`llm-effect-status-pill llm-effect-status-${status.status.toLowerCase()}`}>
                            {status.source !== "None" ? `${status.source}: ` : ""}{status.status}
                          </span>
                        </strong>
                        <small>{effect.trigger ?? "NO_TRIGGER"}{effect.value ? `  -  ${effect.value}` : ""}</small>
                        {status.issueType !== "NONE" && <small className="llm-effect-status-issue">Issue: {status.issueType}</small>}
                        {status.notes && <small className="llm-effect-status-notes">{status.notes}</small>}
                      </span>
                    </label>
                  );
                })}
              </div>

              <div className="llm-button-row llm-button-row-tight">
                <button onClick={addSelectedEffectsToBulkQueue} disabled={selectedBulkEffects.length === 0}>
                  Add Selected
                </button>
                <button onClick={addAllEffectsToQueue} disabled={!selectedCard.effects?.length}>
                  Add All Effects
                </button>
              </div>
            </section>
          )}

          <div className="llm-card-list llm-card-list-compact">
            {filteredCards.map(card => {
              const key = getCardKey(card);
              const summary = getCardStatusSummary(card);

              return (
                <button
                  key={key}
                  className={selectedCard && key === getCardKey(selectedCard) ? "effect-dev-card-select selected" : "effect-dev-card-select"}
                  onClick={() => selectCard(card)}
                >
                  <strong>{formatCardLabel(card)}</strong>
                  <span>{getCardSummary(card)}</span>
                  <span>{card.effectCount ?? 0} effect{card.effectCount === 1 ? "" : "s"}</span>
                  <span className="llm-card-picker-status-line">
                    <span className={`llm-effect-status-pill llm-effect-status-${summary.primaryStatus.toLowerCase()}`}>{summary.primaryStatus === "NO_EFFECTS" ? "NO EFFECTS" : summary.primaryStatus}</span>
                    <small>{summary.label}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="llm-workflow-main">
          <section className="card llm-phase-board">
            <div className="llm-phase-header">
              <div>
                <h3>2. Batch Phase 1  to  4</h3>
                <p>Works directly from the bulk effect queue. Use Run Next for manual checkpoints, or Auto-Run all included drafts when you want a full pass.</p>
              </div>
              {isBusy && <span className="zone-details-badge">Working...</span>}
            </div>

            {batchPlans.length > 0 && (
              <div className="llm-status-summary-row">
                {STATUS_OPTIONS.map(status => (
                  <span key={status} className={`llm-status-summary-chip llm-status-summary-chip-${status.toLowerCase()}`}>
                    {status}: {statusCounts[status] ?? 0}
                  </span>
                ))}
              </div>
            )}

            <div className="llm-phase-step-row">
              <button
                className="llm-phase-step-card"
                onClick={() => onGeneratePlanBatch(bulkPlanRequests)}
                disabled={bulkPlanRequests.length === 0 || isBusy}
              >
                <span>Phase 1</span>
                <strong>Generate Batch Plans</strong>
                <small>{bulkPlanRequests.length} effect request{bulkPlanRequests.length === 1 ? "" : "s"}</small>
              </button>

              <button
                className="llm-phase-step-card"
                onClick={runNextIncludedDraft}
                disabled={(!nextUnrunPlan && !nextCheckpointPlan) || isBusy}
              >
                <span>Phase 2A</span>
                <strong>Run Next + Check</strong>
                <small>{nextUnrunPlan ? `Next: ${nextUnrunPlan.card.cardName}` : nextCheckpointPlan ? "Waiting for manual confirmation" : "All included drafts have results"}</small>
              </button>

              <button
                className="llm-phase-step-card"
                onClick={() => onAutoRunIncludedDrafts(includedBatchPlans)}
                disabled={includedBatchPlans.length === 0 || isBusy}
              >
                <span>Phase 2A Bulk</span>
                <strong>Auto-Run All Included</strong>
                <small>{includedBatchPlans.length} included plan{includedBatchPlans.length === 1 ? "" : "s"}</small>
              </button>

              <button
                className="llm-phase-step-card"
                onClick={prepareReviewDrafts}
                disabled={batchPlans.length === 0 || isBusy}
              >
                <span>Phase 2B</span>
                <strong>Review / Edit Drafts</strong>
                <small>{batchPlans.length} generated plan{batchPlans.length === 1 ? "" : "s"}</small>
              </button>

              <button
                className="llm-phase-step-card"
                onClick={() => onSaveCoverageRecords(includedCoverageRecords)}
                disabled={!reviewReady || includedCoverageRecords.length === 0 || isBusy}
              >
                <span>Phase 3</span>
                <strong>Bulk Save Coverage</strong>
                <small>{includedCoverageRecords.length} reviewed record{includedCoverageRecords.length === 1 ? "" : "s"}; {includedUntestedCount} still untested</small>
              </button>

              <button
                className="llm-phase-step-card"
                onClick={() => onSaveRegressionScenarioBatch(includedBatchPlans, includedCoverageRecords)}
                disabled={!reviewReady || includedBatchPlans.length === 0 || isBusy}
              >
                <span>Phase 4</span>
                <strong>Save Fixtures + Report</strong>
                <small>{includedBatchPlans.length} included fixture{includedBatchPlans.length === 1 ? "" : "s"}</small>
              </button>
            </div>

            <div className="llm-button-row llm-button-row-tight">
              <button className="secondary-button" onClick={resetWorkflow} disabled={isBusy && !batchProgress}>
                Reset Phase Results Only
              </button>
              <button className="secondary-button" onClick={clearAllSelections} disabled={isBusy || (bulkEffectQueue.length === 0 && batchPlans.length === 0)}>
                Clear Queue + Results
              </button>
            </div>

            {batchProgress && (
              <div className={`llm-batch-progress llm-batch-progress-${batchProgress.stage}`}>
                <strong>{batchProgress.completed}/{batchProgress.total}</strong>
                <span>{batchProgress.message}</span>
              </div>
            )}

            {activeCheckpointPlan && directTestResults[getPlanKey(activeCheckpointPlan)] && (
              <article className="llm-manual-checkpoint-card">
                <div>
                  <strong>Manual checkpoint: {activeCheckpointPlan.card.cardName} {activeCheckpointPlan.effect?.effectId ?? "NO_EFFECT"}</strong>
                  <span>{directTestResults[getPlanKey(activeCheckpointPlan)].status}  -  {directTestResults[getPlanKey(activeCheckpointPlan)].summary}</span>
                </div>
                <div className="llm-button-row llm-button-row-tight">
                  <button onClick={() => confirmDraftStatus(activeCheckpointPlan, "WORKING", "NONE")}>Confirm Working</button>
                  <button className="secondary-button" onClick={() => confirmDraftStatus(activeCheckpointPlan, "PARTIAL")}>Confirm Partial</button>
                  <button className="secondary-button" onClick={() => confirmDraftStatus(activeCheckpointPlan, "BROKEN")}>Confirm Broken</button>
                  <button className="secondary-button" onClick={() => confirmDraftStatus(activeCheckpointPlan, "BLOCKED_RUNTIME", directTestResults[getPlanKey(activeCheckpointPlan)].issueType)}>Confirm Blocked</button>
                  <button className="secondary-button" onClick={() => onCreateScenarioMatchFromPlan(activeCheckpointPlan)}>Open Play Test</button>
                </div>
                <small>Use this checkpoint when auto-run evidence does not match what you can verify through the normal battle/effect UI.</small>
              </article>
            )}
          </section>

          <section className="card llm-bulk-panel llm-queue-panel-compact">
            <div className="llm-phase-header">
              <div>
                <h3>Bulk Effect Queue</h3>
                <p>Queue is preserved when you reset phase results.</p>
              </div>
              <span className="zone-details-badge">{bulkPlanRequests.length} effect{bulkPlanRequests.length === 1 ? "" : "s"}</span>
            </div>

            {bulkEffectQueue.length === 0 ? (
              <p className="empty-zone">Select a card, choose one or all effects, then add them here.</p>
            ) : (
              <div className="llm-bulk-queue-list llm-bulk-queue-list-compact">
                {bulkEffectQueue.map(item => (
                  <article key={`${item.packId}:${item.cardId}`} className="llm-bulk-queue-card">
                    <div>
                      <strong>{item.cardLabel}</strong>
                      <small>{item.effectIds.length} effect{item.effectIds.length === 1 ? "" : "s"}: {item.effectIds.join(", ")}</small>
                    </div>
                    <button className="secondary-button" onClick={() => removeBulkQueueCard(item.packId, item.cardId)}>Remove</button>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="card llm-batch-plans-panel llm-batch-plans-panel-compact">
            <div className="llm-phase-header">
              <div>
                <h3>Coverage Drafts</h3>
                <p>Auto-run included drafts, check each result, then set status before Phase 3 save.</p>
              </div>
              <span className="zone-details-badge">{batchPlans.length} plan{batchPlans.length === 1 ? "" : "s"}</span>
            </div>

            {batchPlans.length === 0 ? (
              <p className="empty-zone">Run Phase 1 to generate batch plans.</p>
            ) : (
              <>
                <div className="llm-button-row llm-button-row-tight">
                  <button className="secondary-button" onClick={acceptWorkingAutoRuns}>Accept Working Auto-Runs</button>
                  <button className="secondary-button" onClick={applyAllAutoRunResultsToDrafts}>Apply All Auto-Run Results</button>
                  <button className="secondary-button" onClick={() => markAllBulk("WORKING")}>Mark All Working</button>
                  <button className="secondary-button" onClick={() => markAllBulk("PARTIAL")}>Mark All Partial</button>
                  <button className="secondary-button" onClick={() => markAllBulk("BROKEN")}>Mark All Broken</button>
                </div>

                <div className="llm-batch-plan-list llm-batch-plan-list-compact">
                  {batchPlans.map(plan => {
                    const key = getPlanKey(plan);
                    const draft = coverageDrafts[key] ?? buildDefaultDraft(plan);
                    const card = cardsByKey.get(`${plan.card.packId}:${plan.card.cardId}`);

                    return (
                      <article key={key} className="llm-batch-plan-card llm-batch-plan-card-compact">
                        <label className="llm-include-row">
                          <input
                            type="checkbox"
                            checked={draft.include}
                            onChange={event => updateCoverageDraft(plan, { include: event.target.checked })}
                          />
                          <span>
                            <strong>{plan.card.cardName}</strong>
                            <small>{plan.effect?.effectId ?? "NO_EFFECT"}  -  {plan.effect?.trigger ?? "NO_TRIGGER"}  -  {plan.effect?.actionType ?? "NO_ACTION"}</small>
                          </span>
                        </label>
                        {card && <small>{formatCardLabel(card)}</small>}
                        <p>{plan.summary}</p>
                        <div className="llm-direct-test-row">
                          <button
                            className="secondary-button"
                            onClick={() => onRunDirectEffectSmokeTest(plan)}
                            disabled={isBusy}
                          >
                            Auto-Run This Draft
                          </button>
                          <button
                            className="secondary-button"
                            onClick={() => onCreateScenarioMatchFromPlan(plan)}
                            disabled={isBusy}
                          >
                            Create Play Test
                          </button>
                        </div>
                        {directTestResults[key] && (
                          <article className={`llm-direct-test-result llm-direct-test-result-${directTestResults[key].status.toLowerCase()}`}>
                            <div>
                              <strong>{directTestResults[key].status}</strong>
                              <span>{directTestResults[key].issueType}</span>
                              {directTestResults[key].runMode && <span>{directTestResults[key].runMode}</span>}
                            </div>
                            <p>{directTestResults[key].summary}</p>
                            <small>Representative match: {directTestResults[key].matchId}</small>
                            {directTestResults[key].beforeSummary && <small>Before: {directTestResults[key].beforeSummary}</small>}
                            {directTestResults[key].afterSummary && <small>After: {directTestResults[key].afterSummary}</small>}
                            {directTestResults[key].pendingEffectTargetPrompt && (
                              <small>Pending target prompt: {directTestResults[key].pendingEffectTargetPrompt}</small>
                            )}
                            {directTestResults[key].manualEffectQueueCount > 0 && (
                              <small>Manual effect queue: {directTestResults[key].manualEffectQueueCount}</small>
                            )}
                            {directTestResults[key].assertionResults && directTestResults[key].assertionResults.length > 0 && (
                              <details>
                                <summary>Assertion results</summary>
                                <ul>
                                  {directTestResults[key].assertionResults.map((assertion, index) => (
                                    <li key={`${key}-assertion-result-${index}`}>
                                      <strong>{assertion.status}</strong>  -  {assertion.label}  -  <code>{assertion.path}</code>
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                            {directTestResults[key].variantResults && directTestResults[key].variantResults.length > 0 && (
                              <details>
                                <summary>Variant routes</summary>
                                <div className="llm-variant-result-list">
                                  {directTestResults[key].variantResults.map(variant => (
                                    <article key={`${key}-variant-${variant.name}`} className="llm-variant-result-card">
                                      <strong>{variant.name}: {variant.status}</strong>
                                      <span>{variant.summary}</span>
                                      <small>Events: {variant.eventTypes.join(", ") || "none"}</small>
                                    </article>
                                  ))}
                                </div>
                              </details>
                            )}
                            <details>
                              <summary>Headless test evidence</summary>
                              <ul>
                                {directTestResults[key].evidence.map((item, index) => (
                                  <li key={`${key}-direct-evidence-${index}`}>{item}</li>
                                ))}
                              </ul>
                            </details>
                            <div className="llm-button-row llm-button-row-tight">
                              <button
                                className="secondary-button"
                                onClick={() => applyDirectTestResultToDraft(plan, directTestResults[key])}
                              >
                                Use Auto-Run Result
                              </button>
                              <button onClick={() => confirmDraftStatus(plan, "WORKING", "NONE")}>Confirm Working</button>
                              <button className="secondary-button" onClick={() => confirmDraftStatus(plan, "PARTIAL")}>Confirm Partial</button>
                              <button className="secondary-button" onClick={() => confirmDraftStatus(plan, "BROKEN")}>Confirm Broken</button>
                              <button className="secondary-button" onClick={() => confirmDraftStatus(plan, "BLOCKED_RUNTIME", directTestResults[key].issueType)}>Confirm Blocked</button>
                            </div>
                          </article>
                        )}
                        <details className="llm-details">
                          <summary>Plan steps / assertions</summary>
                          <ol>
                            {plan.steps.map((step, index) => <li key={`${key}-step-${index}`}>{step}</li>)}
                          </ol>
                          <div className="llm-assertion-list">
                            {plan.expectedAssertions.map((assertion, index) => (
                              <article key={`${key}-assertion-${index}`} className="llm-assertion-card">
                                <strong>{assertion.label}</strong>
                                <code>{assertion.path}</code>
                                <span>{assertion.operator}{assertion.value !== undefined ? `  -  ${String(assertion.value)}` : ""}</span>
                              </article>
                            ))}
                          </div>
                        </details>
                        <div className="llm-batch-editor-grid">
                          <label>
                            Status
                            <select
                              value={draft.status}
                              onChange={event => updateCoverageDraft(plan, { status: event.target.value as EffectRuntimeTestStatus })}
                            >
                              {STATUS_OPTIONS.map(status => <option key={status} value={status}>{status}</option>)}
                            </select>
                          </label>
                          <label>
                            Issue
                            <select
                              value={draft.issueType}
                              onChange={event => updateCoverageDraft(plan, { issueType: event.target.value as EffectRuntimeIssueType })}
                            >
                              {ISSUE_OPTIONS.map(issue => <option key={issue} value={issue}>{issue}</option>)}
                            </select>
                          </label>
                          <label className="llm-notes-label">
                            Notes
                            <textarea
                              value={draft.notes}
                              onChange={event => updateCoverageDraft(plan, { notes: event.target.value })}
                              rows={3}
                            />
                          </label>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        </section>

        <aside className="card llm-review-panel llm-regression-panel-compact">
          <h3>Phase 4 Output</h3>
          {phase4Report ? (
            <article className="llm-phase4-report-card">
              <strong>{phase4Report.fileName}</strong>
              <span>{phase4Report.needsFixCount} effect{phase4Report.needsFixCount === 1 ? "" : "s"} need fix/review</span>
              <small>Markdown: {phase4Report.relativePath}</small>
              <small>JSON: {phase4Report.jsonRelativePath}</small>
              <small>Open the Markdown file in Notepad and paste the "Effects needing fixes / unsupported / review" section here.</small>
            </article>
          ) : (
            <p className="empty-zone">Phase 4 will create a copy/paste Markdown report in data/dev/llm-phase4-reports.</p>
          )}

          <h3>Saved Regression Fixtures</h3>
          {regressionScenarios.length === 0 ? (
            <p className="empty-zone">No LLM regression fixtures saved yet.</p>
          ) : (
            <div className="llm-regression-list llm-regression-list-compact">
              {regressionScenarios.slice(0, 20).map(item => (
                <article className="llm-regression-card" key={item.fileName}>
                  <strong>{item.fileName}</strong>
                  <span>{item.cardId}{item.effectId ? `  -  ${item.effectId}` : ""}</span>
                  <small>{new Date(item.updatedAt).toLocaleString()}</small>
                </article>
              ))}
            </div>
          )}
        </aside>
      </section>
    </section>
  );
}



