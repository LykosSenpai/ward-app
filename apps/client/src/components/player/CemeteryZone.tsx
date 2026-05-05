import type { PlayerState } from "@ward/shared";
import type { AppMatchState } from "../../clientTypes";
import { getCardName } from "../../gameViewHelpers";

export function CemeteryZone({
  match,
  player
}: {
  match: AppMatchState;
  player: PlayerState;
}) {
  return (
    <section className="zone-box">
      <h3>Cemetery</h3>

      {player.cemetery.length === 0 ? (
        <p className="empty-zone">Cemetery is empty.</p>
      ) : (
        <div className="cemetery-list">
          {player.cemetery.map(card => (
            <div key={card.instanceId}>{getCardName(match, card)}</div>
          ))}
        </div>
      )}
    </section>
  );
}
