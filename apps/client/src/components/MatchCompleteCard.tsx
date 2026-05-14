import type { AppMatchState } from "../clientTypes";
import { getLoserName, getWinnerName } from "../gameViewHelpers";

type MatchCompleteCardProps = {
  match: AppMatchState;
  onClose: () => void;
  onAddMissingNeedsToMarketplace?: (payload: { quantity: number; mergeWithExisting: boolean; onlyFocusedMissingCards: boolean }) => void;
};

export function MatchCompleteCard({ match, onClose, onAddMissingNeedsToMarketplace }: MatchCompleteCardProps) {
  return (
    <section className="card match-complete-card">
      <h2>Match Complete</h2>
      <p>
        Winner: <strong>{getWinnerName(match)}</strong>
      </p>
      <p>
        Loser: <strong>{getLoserName(match)}</strong>
      </p>
      <p>{match.completionReason}</p>
      <div className="actions">
        <button onClick={onClose}>Close Match</button>
        {onAddMissingNeedsToMarketplace ? (
          <button onClick={() => onAddMissingNeedsToMarketplace({ quantity: 1, mergeWithExisting: true, onlyFocusedMissingCards: false })}>
            Add Missing to Marketplace Needs
          </button>
        ) : null}
      </div>
      <p className="event-meta">
        Gameplay actions are locked. You can still save, load, and review the event log.
      </p>
    </section>
  );
}
