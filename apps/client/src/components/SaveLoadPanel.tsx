import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { SavedMatchSummary } from "../clientTypes";

type SaveLoadPanelProps = {
  savedMatches: SavedMatchSummary[];
  canSave: boolean;
  onRefresh: () => void;
  onSave: () => void;
  onLoad: (matchId: string) => void;
  onDelete: (matchId: string) => void;
  onDeleteSelected: (matchIds: string[]) => void;
};

function formatSavedMatchDate(value: string): string {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

export function SaveLoadPanel({
  savedMatches,
  canSave,
  onRefresh,
  onSave,
  onLoad,
  onDelete,
  onDeleteSelected
}: SaveLoadPanelProps) {
  const [selectedMatchIds, setSelectedMatchIds] = useState<Record<string, boolean>>({});

  const savedMatchIds = useMemo(
    () => savedMatches.map(savedMatch => savedMatch.matchId),
    [savedMatches]
  );

  const selectedIds = useMemo(
    () => savedMatchIds.filter(matchId => selectedMatchIds[matchId]),
    [savedMatchIds, selectedMatchIds]
  );

  const allSelected = savedMatchIds.length > 0 && selectedIds.length === savedMatchIds.length;
  const partiallySelected = selectedIds.length > 0 && !allSelected;

  useEffect(() => {
    setSelectedMatchIds(current => {
      const next: Record<string, boolean> = {};

      for (const matchId of savedMatchIds) {
        if (current[matchId]) {
          next[matchId] = true;
        }
      }

      return next;
    });
  }, [savedMatchIds]);

  function toggleMatchSelection(matchId: string) {
    setSelectedMatchIds(current => ({
      ...current,
      [matchId]: !current[matchId]
    }));
  }

  function handleSavedMatchKeyDown(
    event: KeyboardEvent<HTMLElement>,
    matchId: string
  ) {
    if (event.target !== event.currentTarget) {
      return;
    }

    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    toggleMatchSelection(matchId);
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedMatchIds({});
      return;
    }

    setSelectedMatchIds(
      Object.fromEntries(savedMatchIds.map(matchId => [matchId, true]))
    );
  }

  function deleteSelectedMatches() {
    if (selectedIds.length === 0) {
      return;
    }

    onDeleteSelected(selectedIds);
    setSelectedMatchIds({});
  }

  return (
    <section className="card save-load-card compact-save-load-card">
      <div className="save-load-header">
        <div>
          <h2>Save / Load Match</h2>
          <p className="event-meta">
            {savedMatches.length} saved match{savedMatches.length === 1 ? "" : "es"}
            {selectedIds.length > 0 ? ` | ${selectedIds.length} selected` : ""}
          </p>
        </div>

        <div className="actions compact-actions save-load-primary-actions">
          <button onClick={onRefresh}>Refresh</button>

          <button onClick={onSave} disabled={!canSave}>
            Save Current
          </button>
        </div>
      </div>

      {savedMatches.length === 0 ? (
        <p className="empty-zone">No saved matches found.</p>
      ) : (
        <>
          <div className="saved-match-toolbar">
            <label className="saved-match-select-all">
              <input
                type="checkbox"
                checked={allSelected}
                ref={input => {
                  if (input) {
                    input.indeterminate = partiallySelected;
                  }
                }}
                onChange={toggleSelectAll}
              />
              <span>Select all</span>
            </label>

            <button
              className="delete-save-button master-delete-button"
              onClick={deleteSelectedMatches}
              disabled={selectedIds.length === 0}
            >
              Delete Selected ({selectedIds.length})
            </button>
          </div>

          <div className="saved-match-grid">
            {savedMatches.map(savedMatch => {
              const isSelected = !!selectedMatchIds[savedMatch.matchId];

              return (
                <article
                  className={`saved-match-entry compact-saved-match-entry${isSelected ? " selected" : ""}`}
                  key={savedMatch.matchId}
                  role="checkbox"
                  aria-checked={isSelected}
                  tabIndex={0}
                  title={isSelected ? "Click to unselect this saved match" : "Click to select this saved match"}
                  onClick={() => toggleMatchSelection(savedMatch.matchId)}
                  onKeyDown={event => handleSavedMatchKeyDown(event, savedMatch.matchId)}
                >
                  <div className="saved-match-card-topline">
                    <label
                      className="saved-match-checkbox-label"
                      title="Select saved match"
                      onClick={event => event.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleMatchSelection(savedMatch.matchId)}
                      />
                    </label>

                    <strong className="saved-match-id" title={savedMatch.matchId}>
                      {savedMatch.matchId}
                    </strong>
                  </div>

                  <div className="saved-match-meta-grid">
                    <span>Format</span>
                    <strong>{savedMatch.format}</strong>

                    <span>Turn</span>
                    <strong>{savedMatch.turnNumber}</strong>

                    <span>Cycle</span>
                    <strong>{savedMatch.turnCycleNumber}</strong>

                    <span>Phase</span>
                    <strong>{savedMatch.phase}</strong>
                  </div>

                  <div className="event-meta saved-match-updated">
                    Updated: {formatSavedMatchDate(savedMatch.updatedAt)}
                  </div>

                  <div
                    className="saved-match-actions compact-saved-match-actions"
                    onClick={event => event.stopPropagation()}
                  >
                    <button onClick={() => onLoad(savedMatch.matchId)}>
                      Load
                    </button>

                    <button
                      className="delete-save-button"
                      onClick={() => onDelete(savedMatch.matchId)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
