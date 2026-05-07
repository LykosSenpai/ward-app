import type { PlayerState } from "@ward/shared";
import type { AppMatchState } from "../../clientTypes";
import { CreatureDetails } from "./CreatureDetails";

export function PrimaryCreatureZone({
  match,
  player,
  isActivePlayer,
  canControlThisPlayer,
  anyDiscardRequired,
  replacementRequiredForThisPlayer,
  manualHpAmount,
  setManualHpAmount,
  onApplyManualDamage,
  onApplyManualHeal,
  onPrimaryToCemetery,
  onKillOwnPrimary
}: {
  match: AppMatchState;
  player: PlayerState;
  isActivePlayer: boolean;
  canControlThisPlayer: boolean;
  anyDiscardRequired: boolean;
  replacementRequiredForThisPlayer: boolean;
  manualHpAmount: string;
  setManualHpAmount: (value: string) => void;
  onApplyManualDamage: () => void;
  onApplyManualHeal: () => void;
  onPrimaryToCemetery: () => void;
  onKillOwnPrimary: () => void;
}) {
  const primaryCreature = player.field.primaryCreature;
  const manualHpActionsDisabled =
    !canControlThisPlayer ||
    !!match.pendingPrompt ||
    !!match.pendingEffectTargetPrompt ||
    anyDiscardRequired ||
    !!match.setup.primaryReplacementRequiredForPlayerId;

  return (
    <section className="zone-box">
      <h3>Primary Creature</h3>

      {primaryCreature ? (
        <div className="mini-card creature-card">
          <CreatureDetails match={match} card={primaryCreature} />

          <div className="manual-hp-box">
            <label>
              HP Amount
              <input
                type="number"
                min="1"
                value={manualHpAmount}
                onChange={event => setManualHpAmount(event.target.value)}
              />
            </label>

            <div className="manual-hp-actions">
              <button onClick={onApplyManualDamage} disabled={manualHpActionsDisabled}>
                Apply Damage
              </button>

              <button onClick={onApplyManualHeal} disabled={manualHpActionsDisabled}>
                Apply Heal
              </button>
            </div>
          </div>

          <div className="primary-actions">
            <button
              onClick={onPrimaryToCemetery}
              disabled={!canControlThisPlayer || !!match.pendingPrompt || !!match.pendingEffectTargetPrompt}
            >
              Battle/Card Effect to Cemetery
            </button>

            {isActivePlayer &&
              canControlThisPlayer &&
              match.turn.phase === "SUMMON_MAGIC" &&
              !replacementRequiredForThisPlayer &&
              !player.turnFlags.normalSummonUsed &&
              !player.turnFlags.killedOwnCreatureThisTurn &&
              !match.pendingPrompt &&
              !match.pendingEffectTargetPrompt && (
                <button onClick={onKillOwnPrimary}>Kill Own Creature</button>
              )}
          </div>
        </div>
      ) : (
        <p className="empty-zone">No primary creature.</p>
      )}
    </section>
  );
}
