import type { PlayerState } from "@ward/shared";
import type { AppMatchState } from "../../clientTypes";

export function PlayerSummaryPanel({
  match,
  player,
  isActivePlayer,
  isMatchComplete,
  canControlThisPlayer,
  normalSummonUsed,
  discardRequiredForThisPlayer,
  replacementRequiredForThisPlayer,
  canPlayPrimaryNow,
  hasSummonableCreature,
  onShuffleDeck,
  onConcede,
  onCallCemeteryHpLoss,
  onRequestNoCreatureRedraw
}: {
  match: AppMatchState;
  player: PlayerState;
  isActivePlayer: boolean;
  isMatchComplete: boolean;
  canControlThisPlayer: boolean;
  normalSummonUsed: boolean;
  discardRequiredForThisPlayer: boolean;
  replacementRequiredForThisPlayer: boolean;
  canPlayPrimaryNow: boolean;
  hasSummonableCreature: boolean;
  onShuffleDeck: () => void;
  onConcede: () => void;
  onCallCemeteryHpLoss: () => void;
  onRequestNoCreatureRedraw: () => void;
}) {
  const deckValidation = match.setup.deckValidation[player.id];

  return (
    <>
      <div className="player-header">
        <h2>{player.displayName}</h2>
        <button
          onClick={onShuffleDeck}
          disabled={!canControlThisPlayer || player.hand.length > 0 || !!match.pendingPrompt}
        >
          Shuffle Deck
        </button>
      </div>

      {isActivePlayer && <div className="active-player-banner">Active Player</div>}

      {player.hasLost && (
        <div className="error-box">
          Lost: {player.lossReason ?? "No reason recorded."}
        </div>
      )}

      <section className="match-control-box">
        <h3>Match Controls</h3>

        <div className="match-control-actions">
          <button className="concede-button" onClick={onConcede} disabled={isMatchComplete || !canControlThisPlayer}>
            Concede as {player.displayName}
          </button>

          <button
            className="call-loss-button"
            onClick={onCallCemeteryHpLoss}
            disabled={
              isMatchComplete ||
              canControlThisPlayer ||
              player.cemeteryCreatureHpTotal < match.settings.cemeteryHpLimit
            }
          >
            Call Cemetery HP Loss Against {player.displayName}
          </button>
        </div>
      </section>

      {isActivePlayer && (
        <div className="turn-rule-box">
          Normal Primary Summon Used: {normalSummonUsed ? "Yes" : "No"}
        </div>
      )}

      <div className="player-stat">
        <span>Cemetery HP</span>
        <strong>{player.cemeteryCreatureHpTotal}</strong>
        {Number(player.cemeteryHpAdjustment ?? 0) !== 0 ? (
          <small className="player-stat-adjustment">
            Effect {Number(player.cemeteryHpAdjustment ?? 0) > 0 ? "+" : ""}{player.cemeteryHpAdjustment}
          </small>
        ) : null}
      </div>

      {(player.playerLocks?.length ?? 0) > 0 || Number(player.skipNextTurnCount ?? 0) > 0 ? (
        <div className="warning-box">
          {player.playerLocks?.[0]?.label ?? `${player.displayName} must skip their next turn.`}
        </div>
      ) : null}

      <section className="validation-box">
        <h3>Deck Validation</h3>

        {deckValidation ? (
          <>
            <div className="validation-summary">
              <div>Legal: {deckValidation.isLegal ? "Yes" : "No"}</div>
              <div>Deck Size: {deckValidation.deckSize}</div>
              <div>Creatures: {deckValidation.creatureCount}</div>
              <div>Magics: {deckValidation.magicCount}</div>
            </div>

            {deckValidation.issues.length > 0 && (
              <div className="issue-list">
                {deckValidation.issues.map(issue => (
                  <div
                    className={
                      issue.severity === "ERROR"
                        ? "issue issue-error"
                        : "issue issue-warning"
                    }
                    key={`${issue.code}-${issue.message}`}
                  >
                    <strong>{issue.severity}</strong>: {issue.message}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="empty-zone">No validation data.</p>
        )}
      </section>

      {player.cemeteryCreatureHpTotal >= match.settings.cemeteryHpLimit && (
        <div className="warning-box">
          Cemetery HP is at or over {match.settings.cemeteryHpLimit}.
        </div>
      )}

      <div className="zone-summary">
        <div>Deck: {player.deck.length}</div>
        <div>Hand: {player.hand.length}</div>
        <div>Cemetery: {player.cemetery.length}</div>
        <div>Removed: {player.removedFromGame.length}</div>
        <div>Limited Summons: {player.field.limitedSummons.length}/4</div>
        <div>Magic Slots: {player.field.magicSlots.length}/5</div>
      </div>

      {discardRequiredForThisPlayer && (
        <div className="warning-box">
          This player has {player.hand.length} cards and must discard down to 8 before doing anything else.
        </div>
      )}

      {replacementRequiredForThisPlayer && player.field.limitedSummons.length > 0 && (
        <div className="warning-box">
          This player must promote one Limited Summon to primary. Hand summon and reveal/redraw are blocked until all Limited Summons are gone or one is promoted.
        </div>
      )}

      {replacementRequiredForThisPlayer && player.field.limitedSummons.length === 0 && (
        <div className="warning-box">
          This player must immediately replace their primary creature. This does not count as their one normal primary summon for the turn.
        </div>
      )}

      {canPlayPrimaryNow &&
        canControlThisPlayer &&
        !player.field.primaryCreature &&
        player.field.limitedSummons.length === 0 &&
        !hasSummonableCreature && (
        <div className="actions small-actions">
          <button onClick={onRequestNoCreatureRedraw}>
            Request No-Creature Reveal / Redraw
          </button>
        </div>
      )}
    </>
  );
}
