import { useMemo, useState } from "react";
import type {
  CardLibraryCardSummary,
  CardPackSummary,
  EffectCoverageRow,
  EffectRuntimeIssueType,
  EffectRuntimeTestStatus,
  RuntimeSupportLevel
} from "../clientTypes";

type EffectCoveragePageProps = {
  cardPacks: CardPackSummary[];
  selectedPackIds: string[];
  rows: EffectCoverageRow[];
  cardLibrary?: CardLibraryCardSummary[];
  focusedCardKey?: string;
  onClearFocusedCard?: () => void;
  onOpenCardInDevTool?: (row: EffectCoverageRow) => void;
  onToggleSelectedPack: (packId: string) => void;
  onRefreshCoverage: () => void;
  onCreateScenarioMatch: (row: EffectCoverageRow) => void;
  onSaveTestStatus: (
    row: EffectCoverageRow,
    status: EffectRuntimeTestStatus,
    issueType: EffectRuntimeIssueType,
    notes: string
  ) => void;
};

const SUPPORT_ORDER: RuntimeSupportLevel[] = ["SUPPORTED", "PARTIAL", "MANUAL", "UNSUPPORTED"];

const TEST_STATUSES: Array<{ value: EffectRuntimeTestStatus; label: string }> = [
  { value: "UNTESTED", label: "Untested" },
  { value: "WORKING", label: "Working" },
  { value: "PARTIAL", label: "Partially Working" },
  { value: "BROKEN", label: "Broken" },
  { value: "BLOCKED_RUNTIME", label: "Blocked by Runtime" },
  { value: "BLOCKED_DATA", label: "Blocked by Card Data" },
  { value: "NEEDS_RULES_REVIEW", label: "Needs Rules Review" }
];

const ISSUE_TYPES: Array<{ value: EffectRuntimeIssueType; label: string }> = [
  { value: "NONE", label: "None" },
  { value: "WRONG_TARGET", label: "Wrong Target" },
  { value: "WRONG_TIMING", label: "Wrong Timing" },
  { value: "WRONG_DURATION", label: "Wrong Duration" },
  { value: "WRONG_COUNTER", label: "Wrong Counter" },
  { value: "WRONG_DAMAGE", label: "Wrong Damage" },
  { value: "WRONG_STAT_MODIFIER", label: "Wrong Stat Modifier" },
  { value: "MISSING_BUTTON", label: "Missing Button" },
  { value: "MISSING_PROMPT", label: "Missing Prompt" },
  { value: "MISSING_CHAIN_WINDOW", label: "Missing Chain Window" },
  { value: "MISSING_CLEANUP", label: "Missing Cleanup" },
  { value: "UNSUPPORTED_ACTION_TYPE", label: "Unsupported Action Type" }
];

function supportBadgeClass(level: RuntimeSupportLevel): string {
  return `runtime-support-badge runtime-support-${level.toLowerCase()}`;
}

function supportLabel(level: RuntimeSupportLevel): string {
  switch (level) {
    case "SUPPORTED": return "Supported";
    case "PARTIAL": return "Partial";
    case "MANUAL": return "Manual";
    case "UNSUPPORTED": return "Unsupported";
  }
}

function statusLabel(status: EffectRuntimeTestStatus): string {
  return TEST_STATUSES.find(item => item.value === status)?.label ?? status;
}

function issueTypeLabel(issueType: EffectRuntimeIssueType): string {
  return ISSUE_TYPES.find(item => item.value === issueType)?.label ?? issueType;
}

function testStatusBadgeClass(status: EffectRuntimeTestStatus): string {
  return `test-status-badge test-status-${status.toLowerCase().replace(/_/g, "-")}`;
}

function uniqueSorted(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => !!value))).sort((a, b) => a.localeCompare(b));
}

function getRowKey(row: EffectCoverageRow): string {
  return `${row.packId}:${row.cardId}:${row.effectId}`;
}

type DraftStatus = {
  status: EffectRuntimeTestStatus;
  issueType: EffectRuntimeIssueType;
  notes: string;
};

export function EffectCoveragePage({
  cardPacks,
  selectedPackIds,
  rows,
  cardLibrary = [],
  focusedCardKey = "",
  onClearFocusedCard,
  onOpenCardInDevTool,
  onToggleSelectedPack,
  onRefreshCoverage,
  onCreateScenarioMatch,
  onSaveTestStatus
}: EffectCoveragePageProps) {
  const [supportFilter, setSupportFilter] = useState<RuntimeSupportLevel | "ALL">("ALL");
  const [testStatusFilter, setTestStatusFilter] = useState<EffectRuntimeTestStatus | "ALL">("ALL");
  const [searchText, setSearchText] = useState("");
  const [triggerFilter, setTriggerFilter] = useState("ALL");
  const [actionFilter, setActionFilter] = useState("ALL");
  const [drafts, setDrafts] = useState<Record<string, DraftStatus>>({});

  const cardsByKey = useMemo(() => {
    const map = new Map<string, CardLibraryCardSummary>();

    for (const card of cardLibrary) {
      map.set(`${card.packId}:${card.id}`, card);
    }

    return map;
  }, [cardLibrary]);

  function getCardForRow(row: EffectCoverageRow): CardLibraryCardSummary | undefined {
    return cardsByKey.get(`${row.packId}:${row.cardId}`);
  }

  function getEffectForRow(row: EffectCoverageRow) {
    return getCardForRow(row)?.effects?.find(effect => effect.id === row.effectId);
  }

  const triggers = useMemo(() => uniqueSorted(rows.map(row => row.trigger)), [rows]);
  const actionTypes = useMemo(() => uniqueSorted(rows.map(row => row.actionType)), [rows]);

  const supportSummary = useMemo(() => {
    return SUPPORT_ORDER.reduce<Record<RuntimeSupportLevel, number>>((result, level) => {
      result[level] = rows.filter(row => row.supportLevel === level).length;
      return result;
    }, {
      SUPPORTED: 0,
      PARTIAL: 0,
      MANUAL: 0,
      UNSUPPORTED: 0
    });
  }, [rows]);

  const testSummary = useMemo(() => {
    return TEST_STATUSES.reduce<Record<EffectRuntimeTestStatus, number>>((result, item) => {
      result[item.value] = rows.filter(row => (row.testStatus ?? "UNTESTED") === item.value).length;
      return result;
    }, {
      UNTESTED: 0,
      WORKING: 0,
      PARTIAL: 0,
      BROKEN: 0,
      BLOCKED_RUNTIME: 0,
      BLOCKED_DATA: 0,
      NEEDS_RULES_REVIEW: 0
    });
  }, [rows]);

  const filteredRows = useMemo(() => {
    const search = searchText.trim().toLowerCase();

    return rows.filter(row => {
      const rowTestStatus = row.testStatus ?? "UNTESTED";

      if (focusedCardKey && `${row.packId}:${row.cardId}` !== focusedCardKey) return false;
      if (supportFilter !== "ALL" && row.supportLevel !== supportFilter) return false;
      if (testStatusFilter !== "ALL" && rowTestStatus !== testStatusFilter) return false;
      if (triggerFilter !== "ALL" && row.trigger !== triggerFilter) return false;
      if (actionFilter !== "ALL" && row.actionType !== actionFilter) return false;

      if (!search) return true;

      const sourceCard = getCardForRow(row);
      const sourceEffect = getEffectForRow(row);

      return [
        row.cardName,
        row.cardId,
        row.effectId,
        row.trigger,
        row.actionType,
        row.reusableFunction,
        row.effectGroup,
        row.runtimeRoute,
        row.supportNotes,
        row.effectNotes,
        row.testStatus,
        row.testIssueType,
        row.testNotes,
        sourceCard?.text,
        sourceEffect?.actionText,
        sourceEffect?.value,
        sourceEffect?.target,
        sourceEffect?.notes,
        sourceEffect?.reusableFunction
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(search);
    });
  }, [actionFilter, cardsByKey, focusedCardKey, rows, searchText, supportFilter, testStatusFilter, triggerFilter]);

  function getDraft(row: EffectCoverageRow): DraftStatus {
    const key = getRowKey(row);
    return drafts[key] ?? {
      status: row.testStatus ?? "UNTESTED",
      issueType: row.testIssueType ?? "NONE",
      notes: row.testNotes ?? ""
    };
  }

  function updateDraft(row: EffectCoverageRow, patch: Partial<DraftStatus>) {
    const key = getRowKey(row);
    const current = getDraft(row);
    setDrafts(previous => ({
      ...previous,
      [key]: {
        ...current,
        ...patch
      }
    }));
  }

  function saveDraft(row: EffectCoverageRow) {
    const draft = getDraft(row);
    onSaveTestStatus(row, draft.status, draft.issueType, draft.notes);
    setDrafts(previous => {
      const next = { ...previous };
      delete next[getRowKey(row)];
      return next;
    });
  }

  const anyFilterActive =
    !!focusedCardKey ||
    supportFilter !== "ALL" ||
    testStatusFilter !== "ALL" ||
    triggerFilter !== "ALL" ||
    actionFilter !== "ALL" ||
    searchText.trim().length > 0;

  function clearAllFilters() {
    setSupportFilter("ALL");
    setTestStatusFilter("ALL");
    setTriggerFilter("ALL");
    setActionFilter("ALL");
    setSearchText("");
    onClearFocusedCard?.();
  }

  return (
    <section className="effect-coverage-page effect-coverage-option-a-page">
      <section className="card effect-coverage-option-a-toolbar">
        <div className="effect-coverage-toolbar-title-row">
          <div>
            <h2>Effect Runtime Coverage</h2>
            <p>Runtime support, card effect text, manual QA status, and focused test actions.</p>
          </div>

          <div className="effect-coverage-toolbar-actions">
            <button onClick={onRefreshCoverage}>Refresh Coverage</button>
            <button className="secondary-button" onClick={clearAllFilters} disabled={!anyFilterActive}>
              Clear Filters
            </button>
          </div>
        </div>

        <div className="effect-coverage-toolbar-meta-row">
          <span className="effect-coverage-meta-chip">{selectedPackIds.length}/{cardPacks.length} packs</span>
          <span className="effect-coverage-meta-chip">{rows.length} effects</span>
          <span className="effect-coverage-meta-chip">{filteredRows.length} showing</span>
          {focusedCardKey && <span className="effect-coverage-meta-chip active">Focused: {focusedCardKey}</span>}
        </div>

        <details className="effect-coverage-pack-drawer">
          <summary>Card Packs</summary>
          <div className="effect-coverage-pack-chip-row">
            {cardPacks.map(pack => (
              <label key={pack.id} className="effect-coverage-pack-chip">
                <input
                  type="checkbox"
                  checked={selectedPackIds.includes(pack.id)}
                  onChange={() => onToggleSelectedPack(pack.id)}
                />
                <span>{pack.name}</span>
                <small>{pack.cardCount} cards</small>
              </label>
            ))}
          </div>
        </details>
      </section>

      <section className="card effect-coverage-option-a-controls">
        <div className="effect-coverage-filter-row">
          <label className="effect-coverage-search-label">
            Search
            <input
              value={searchText}
              onChange={event => setSearchText(event.target.value)}
              placeholder="Card, action, trigger, route, notes..."
            />
          </label>

          <label>
            Trigger
            <select value={triggerFilter} onChange={event => setTriggerFilter(event.target.value)}>
              <option value="ALL">All triggers</option>
              {triggers.map(trigger => (
                <option key={trigger} value={trigger}>{trigger}</option>
              ))}
            </select>
          </label>

          <label>
            Action
            <select value={actionFilter} onChange={event => setActionFilter(event.target.value)}>
              <option value="ALL">All actions</option>
              {actionTypes.map(actionType => (
                <option key={actionType} value={actionType}>{actionType}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="effect-coverage-chip-filter-section">
          <span className="effect-coverage-chip-section-label">Runtime</span>
          <div className="effect-coverage-chip-filter-row">
            {SUPPORT_ORDER.map(level => (
              <button
                key={level}
                className={supportFilter === level ? "effect-coverage-count-chip active" : "effect-coverage-count-chip"}
                onClick={() => setSupportFilter(current => current === level ? "ALL" : level)}
              >
                <span className={supportBadgeClass(level)}>{supportLabel(level)}</span>
                <strong>{supportSummary[level]}</strong>
              </button>
            ))}
          </div>
        </div>

        <div className="effect-coverage-chip-filter-section">
          <span className="effect-coverage-chip-section-label">Test Status</span>
          <div className="effect-coverage-chip-filter-row compact">
            {TEST_STATUSES.map(item => (
              <button
                key={item.value}
                className={testStatusFilter === item.value ? "effect-coverage-count-chip active" : "effect-coverage-count-chip"}
                onClick={() => setTestStatusFilter(current => current === item.value ? "ALL" : item.value)}
              >
                <span className={testStatusBadgeClass(item.value)}>{item.label}</span>
                <strong>{testSummary[item.value]}</strong>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card effect-coverage-table-card effect-coverage-option-a-table-card">
        <div className="effect-coverage-table-header">
          <h3>Runtime Rows</h3>
          <span className="zone-details-badge">{filteredRows.length}/{rows.length}</span>
        </div>

        {filteredRows.length === 0 ? (
          <p className="empty-zone">No effects match the current filters.</p>
        ) : (
          <div className="effect-coverage-table-wrap effect-coverage-option-a-table-wrap">
            <table className="effect-coverage-table effect-coverage-option-a-table">
              <thead>
                <tr>
                  <th>Card / Effect</th>
                  <th>Trigger / Action</th>
                  <th>Runtime</th>
                  <th>Test Status</th>
                  <th>Notes / Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(row => {
                  const draft = getDraft(row);
                  const lastTested = row.lastTestedAt ? new Date(row.lastTestedAt).toLocaleString() : "Not tested";
                  const sourceCard = getCardForRow(row);
                  const sourceEffect = getEffectForRow(row);
                  const cardRulesText = sourceCard?.text?.trim() || "No rules text saved for this card.";
                  const parsedEffectText = [sourceEffect?.actionText, sourceEffect?.value].filter(Boolean).join(" | ") || "No parsed action/value text saved for this effect.";

                  return (
                    <tr key={getRowKey(row)}>
                      <td>
                        <div className="coverage-card-cell-title">
                          <strong>{row.cardName}</strong>
                          <span>{row.packId} #{row.cardNumber ?? " - "}  -  {row.cardType}</span>
                        </div>
                        <div className="coverage-effect-id-row">
                          <strong>{row.effectId}</strong>
                          {row.effectGroup && <span>{row.effectGroup}</span>}
                          {row.needsReview && <span className="needs-review-pill">Needs review</span>}
                        </div>
                        <details className="coverage-inline-details coverage-effect-text-details">
                          <summary>Parsed effect text</summary>
                          <p>{parsedEffectText}</p>
                          {sourceEffect?.target && <span>Target: {sourceEffect.target}</span>}
                          {sourceEffect?.duration?.text && <span>Duration: {sourceEffect.duration.text}</span>}
                          {sourceEffect?.notes && <span>Notes: {sourceEffect.notes}</span>}
                        </details>
                        <details className="coverage-inline-details coverage-card-rules-details">
                          <summary>Rules text</summary>
                          <p>{cardRulesText}</p>
                        </details>
                      </td>
                      <td>
                        <span className="coverage-code-pill">{row.trigger ?? " - "}</span>
                        <strong>{row.actionType}</strong>
                        {row.reusableFunction && <span>{row.reusableFunction}</span>}
                      </td>
                      <td>
                        <span className={supportBadgeClass(row.supportLevel)}>{supportLabel(row.supportLevel)}</span>
                        <strong>{row.runtimeRoute}</strong>
                        <span>{row.supportNotes}</span>
                      </td>
                      <td className="effect-test-status-cell">
                        <div className="coverage-status-select-grid">
                          <select
                            value={draft.status}
                            onChange={event => updateDraft(row, { status: event.target.value as EffectRuntimeTestStatus })}
                          >
                            {TEST_STATUSES.map(item => (
                              <option key={item.value} value={item.value}>{item.label}</option>
                            ))}
                          </select>
                          <select
                            value={draft.issueType}
                            onChange={event => updateDraft(row, { issueType: event.target.value as EffectRuntimeIssueType })}
                          >
                            {ISSUE_TYPES.map(item => (
                              <option key={item.value} value={item.value}>{item.label}</option>
                            ))}
                          </select>
                        </div>
                        <span className={testStatusBadgeClass(row.testStatus ?? "UNTESTED")}>{statusLabel(row.testStatus ?? "UNTESTED")}</span>
                        <small>Issue: {issueTypeLabel(row.testIssueType ?? "NONE")}</small>
                        <small>Last: {lastTested}</small>
                      </td>
                      <td className="effect-test-notes-cell coverage-notes-actions-cell">
                        <textarea
                          value={draft.notes}
                          onChange={event => updateDraft(row, { notes: event.target.value })}
                          placeholder="What passed, failed, or still needs runtime support?"
                        />
                        {row.effectNotes && <span>{row.effectNotes}</span>}
                        <div className="coverage-row-action-grid">
                          {onOpenCardInDevTool && (
                            <button
                              className="secondary-button compact-table-button"
                              onClick={() => onOpenCardInDevTool(row)}
                            >
                              Open in Dev Tool
                            </button>
                          )}
                          <button
                            className="secondary-button compact-table-button"
                            onClick={() => onCreateScenarioMatch(row)}
                          >
                            Test Effect
                          </button>
                          <button
                            className="compact-table-button"
                            onClick={() => saveDraft(row)}
                          >
                            Save Status
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}


