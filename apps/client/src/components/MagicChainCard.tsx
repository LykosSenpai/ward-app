import type { AppMatchState } from "../clientTypes";
import { getPlayerName } from "../gameViewHelpers";

type MagicChainCardProps = {
  match: AppMatchState;
  onResolve: () => void;
  onUndo?: () => void;
  onPassPriority?: (playerId: string) => void;
};

export function MagicChainCard({ match, onResolve, onUndo, onPassPriority }: MagicChainCardProps) {
  if (!match.pendingChain) {
    return null;
  }

  const priorityPlayerName = match.pendingChain.priorityPlayerId
    ? getPlayerName(match, match.pendingChain.priorityPlayerId)
    : "No response priority";
  const lastLinkPlayerName = match.pendingChain.lastLinkPlayerId
    ? getPlayerName(match, match.pendingChain.lastLinkPlayerId)
    : "Unknown";

  return (
    <section className="card chain-card">
      <h2>Pending Magic Chain</h2>

      <p>
        Chain started by{" "}
        <strong>{getPlayerName(match, match.pendingChain.startedByPlayerId)}</strong>.
        Responses now use explicit priority: the player who played the latest link cannot respond to their own link.
      </p>

      <div className="chain-priority-box">
        <strong>Current response priority: {priorityPlayerName}</strong>
        <span>Last chain link controller: {lastLinkPlayerName}</span>
        <span>Passes since last response: {match.pendingChain.passesSinceLastResponse}</span>
      </div>

      <div className="chain-list">
        {match.pendingChain.links.map((link, index) => (
          <div className="chain-link-card" key={link.id}>
            <div className="chain-link-header">
              <strong>Chain Link {index + 1}</strong>
              <span>{link.status}</span>
            </div>

            <div>
              Player: <strong>{getPlayerName(match, link.playerId)}</strong>
            </div>

            <div>
              Card: <strong>{link.cardName}</strong>
            </div>

            <div>
              Type: {link.magicType} | {link.magicSubType}
            </div>

            {link.isLightningResponse && (
              <div className="lightning-note">
                Lightning Response: resolves in reverse order against the previous chain link.
              </div>
            )}

            {link.text && <p className="magic-text">{link.text}</p>}
          </div>
        ))}
      </div>

      <div className="actions">
        {onUndo && (
          <button className="secondary-button" onClick={onUndo}>
            Undo Last Chain Step
          </button>
        )}
        {match.pendingChain.priorityPlayerId && onPassPriority && (
          <button onClick={() => onPassPriority(match.pendingChain!.priorityPlayerId!)}>
            Pass Priority as {priorityPlayerName}
          </button>
        )}
        <button className="secondary" onClick={onResolve}>Force Resolve Chain</button>
      </div>
    </section>
  );
}
