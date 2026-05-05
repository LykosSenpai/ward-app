import type { PlayerState } from "@ward/shared";
import type { AppMatchState } from "../../clientTypes";
import { CreatureDetails } from "./CreatureDetails";

export function LimitedSummonsZone({
  match,
  player,
  canPromoteToPrimary = false,
  onPromoteToPrimary
}: {
  match: AppMatchState;
  player: PlayerState;
  canPromoteToPrimary?: boolean;
  onPromoteToPrimary?: (cardInstanceId: string) => void;
}) {
  return (
    <section className="zone-box">
      <h3>Limited Summons</h3>

      {canPromoteToPrimary && (
        <div className="warning-box">
          Primary replacement is required. Choose one Limited Summon to become the new primary creature.
        </div>
      )}

      {player.field.limitedSummons.length === 0 ? (
        <p className="empty-zone">No limited summons.</p>
      ) : (
        <div className="limited-summon-list">
          {player.field.limitedSummons.map(card => (
            <div className="mini-card creature-card" key={card.instanceId}>
              <CreatureDetails match={match} card={card} />

              {canPromoteToPrimary && onPromoteToPrimary && (
                <div className="actions small-actions">
                  <button onClick={() => onPromoteToPrimary(card.instanceId)}>
                    Promote to Primary
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
