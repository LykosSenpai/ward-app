import type { CardInstance } from "@ward/shared";
import type { AppMatchState } from "../clientTypes";
import {
  getPlayerName,
} from "../gameViewHelpers";
import { MatchCardImage } from "./MatchCardImage";

type HandRevealPromptCardProps = {
  match: AppMatchState;
  controlledPlayerId?: string;
  onApprove: () => void;
};

export function HandRevealPromptCard({ match, controlledPlayerId, onApprove }: HandRevealPromptCardProps) {
  if (!match.pendingPrompt || match.pendingPrompt.type !== "NO_CREATURE_REDRAW_REVEAL") {
    return null;
  }

  const canApprove = !controlledPlayerId || controlledPlayerId === match.pendingPrompt.approvingPlayerId;
  const revealedPlayerId = match.pendingPrompt.requestingPlayerId;

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
        {match.pendingPrompt.revealedCards.map(card => {
          const cardInstance: CardInstance = {
            instanceId: card.cardInstanceId,
            cardId: card.cardId,
            ownerPlayerId: revealedPlayerId,
            controllerPlayerId: revealedPlayerId,
            zone: "HAND"
          };
          return (
            <div className="mini-card revealed-hand-card" key={card.cardInstanceId}>
              <MatchCardImage match={match} card={cardInstance} />
            </div>
          );
        })}
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
