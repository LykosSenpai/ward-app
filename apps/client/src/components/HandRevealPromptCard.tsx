import type { CardInstance } from "@ward/shared";
import type { AppMatchState } from "../clientTypes";
import {
  getCardName,
  getCardText,
  getCreatureStatsLine,
  getMagicLine,
  getPlayerName,
  getRequiredSacrificesForCard,
  isCreature,
  isMagic
} from "../gameViewHelpers";
import { MatchCardImage } from "./MatchCardImage";

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
              <div className="card-hover-preview revealed-hand-hover-preview" aria-hidden="true">
                <div className="card-hover-preview-art">
                  <MatchCardImage match={match} card={cardInstance} />
                </div>
                <div className="card-hover-preview-copy">
                  <strong>{getCardName(match, cardInstance)}</strong>
                  <span>{match.cardCatalog[card.cardId]?.cardType}</span>
                  {isCreature(match, cardInstance) && (
                    <>
                      <span>{getCreatureStatsLine(match, cardInstance)}</span>
                      <span>Required Sacrifices: {getRequiredSacrificesForCard(match, cardInstance)}</span>
                    </>
                  )}
                  {isMagic(match, cardInstance) && (
                    <>
                      <span>{getMagicLine(match, cardInstance)}</span>
                      <span>{getCardText(match, cardInstance)}</span>
                    </>
                  )}
                </div>
              </div>
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
