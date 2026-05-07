import type { AppMatchState } from "../clientTypes";
import { getPlayerName } from "../gameViewHelpers";

type HandRevealPromptCardProps = {
  match: AppMatchState;
  controlledPlayerId?: string;
  onApprove: () => void;
};

export function HandRevealPromptCard({ match, controlledPlayerId, onApprove }: HandRevealPromptCardProps) {
  if (!match.pendingPrompt) {
    return null;
  }

  const canApprove = !controlledPlayerId || controlledPlayerId === match.pendingPrompt.approvingPlayerId;

  return (
    <section className="card prompt-card">
      <h2>Pending Hand Reveal Approval</h2>

      <p>
        <strong>{getPlayerName(match, match.pendingPrompt.requestingPlayerId)}</strong>{" "}
        is requesting a no-creature redraw.
      </p>

      <p>
        <strong>{getPlayerName(match, match.pendingPrompt.approvingPlayerId)}</strong>{" "}
        must accept the revealed hand before the redraw happens.
      </p>

      <div className="revealed-hand">
        {match.pendingPrompt.revealedCards.map(card => (
          <div className="mini-card" key={card.cardInstanceId}>
            <strong>{card.name}</strong>
            <span>{card.cardType}</span>
          </div>
        ))}
      </div>

      <div className="actions">
        <button onClick={onApprove} disabled={!canApprove}>
          Accept Reveal and Redraw {match.pendingPrompt.redrawCount}
        </button>
      </div>

      {!canApprove && (
        <p className="event-meta">
          Waiting for {getPlayerName(match, match.pendingPrompt.approvingPlayerId)} to accept the reveal.
        </p>
      )}
    </section>
  );
}
