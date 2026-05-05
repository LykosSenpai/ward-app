import type { AppMatchState } from "../clientTypes";
import { getLoserName, getWinnerName } from "../gameViewHelpers";

type MatchCompleteCardProps = {
  match: AppMatchState;
  onClose: () => void;
};

export function MatchCompleteCard({ match, onClose }: MatchCompleteCardProps) {
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
      </div>
      <p className="event-meta">
        Gameplay actions are locked. You can still save, load, and review the event log.
      </p>
    </section>
  );
}
