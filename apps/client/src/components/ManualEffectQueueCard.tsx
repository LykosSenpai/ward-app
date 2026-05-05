import type { Dispatch, SetStateAction } from "react";
import type {
  AppMatchState,
  ManualEffectDurationType,
  ManualEffectStatKey
} from "../clientTypes";
import { getCardName, getDisplayMagicType } from "../gameViewHelpers";

type ManualEffectQueueCardProps = {
  match: AppMatchState;
  manualEffectAmounts: Record<string, string>;
  manualEffectStats: Record<string, ManualEffectStatKey>;
  manualEffectDurations: Record<string, string>;
  manualEffectDurationTypes: Record<string, ManualEffectDurationType>;
  setManualEffectAmounts: Dispatch<SetStateAction<Record<string, string>>>;
  setManualEffectStats: Dispatch<SetStateAction<Record<string, ManualEffectStatKey>>>;
  setManualEffectDurations: Dispatch<SetStateAction<Record<string, string>>>;
  setManualEffectDurationTypes: Dispatch<SetStateAction<Record<string, ManualEffectDurationType>>>;
  onCompleteEffect: (effectId: string) => void;
  onDamagePrimary: (effectId: string, targetPlayerId: string, amount: number) => void;
  onHealPrimary: (effectId: string, targetPlayerId: string, amount: number) => void;
  onApplyStatModifier: (
    effectId: string,
    targetPlayerId: string,
    stat: ManualEffectStatKey,
    delta: number,
    durationType: ManualEffectDurationType,
    durationTargetPlayerTurnStarts?: number
  ) => void;
  onDestroyMagicWithEffect: (
    effectId: string,
    fieldOwnerPlayerId: string,
    cardInstanceId: string
  ) => void;
};

export function ManualEffectQueueCard({
  match,
  manualEffectAmounts,
  manualEffectStats,
  manualEffectDurations,
  manualEffectDurationTypes,
  setManualEffectAmounts,
  setManualEffectStats,
  setManualEffectDurations,
  setManualEffectDurationTypes,
  onCompleteEffect,
  onDamagePrimary,
  onHealPrimary,
  onApplyStatModifier,
  onDestroyMagicWithEffect
}: ManualEffectQueueCardProps) {
  const pendingEffects = match.manualEffectQueue.filter(effect => !effect.completed);

  if (pendingEffects.length === 0) {
    return null;
  }

  return (
    <section className="card manual-effect-card">
      <h2>Pending Magic Effects</h2>

      <p>Apply the resolved Magic card's effect manually, then mark it complete.</p>

      <div className="manual-effect-list">
        {pendingEffects.map(effect => {
          const amount = Number(manualEffectAmounts[effect.id] ?? "10");
          const canUsePermanentDuration = effect.magicType === "INFINITE";

          const selectedDurationType = canUsePermanentDuration
            ? manualEffectDurationTypes[effect.id] ?? "TARGET_PLAYER_TURN_STARTS"
            : "TARGET_PLAYER_TURN_STARTS";

          const selectedStat = manualEffectStats[effect.id] ?? "modifier";
          const durationTurnStarts =
            selectedDurationType === "TARGET_PLAYER_TURN_STARTS"
              ? Number(manualEffectDurations[effect.id] ?? "1")
              : undefined;

          return (
            <div className="manual-effect-entry" key={effect.id}>
              <h3>{effect.sourceCardName}</h3>

              <div className="effect-source-line">
                Source Type: <strong>{getDisplayMagicType(effect.magicType)}</strong> |{" "}
                <strong>{effect.magicSubType}</strong>
              </div>

              {effect.actionType && (
                <div className="effect-source-line">
                  Effect: <strong>{effect.actionType}</strong>
                  {effect.effectGroup ? ` | ${effect.effectGroup}` : ""}
                </div>
              )}

              {effect.actionText && (
                <div className="effect-source-line">Action: {effect.actionText}</div>
              )}

              {effect.effectValue && (
                <div className="effect-source-line">Value: {effect.effectValue}</div>
              )}

              {effect.durationText && (
                <div className="effect-source-line">Duration: {effect.durationText}</div>
              )}

              <p className="magic-text">{effect.text}</p>

              <label className="effect-amount-label">
                Effect Amount
                <input
                  type="number"
                  min="1"
                  value={manualEffectAmounts[effect.id] ?? "10"}
                  onChange={event =>
                    setManualEffectAmounts(current => ({
                      ...current,
                      [effect.id]: event.target.value
                    }))
                  }
                />
              </label>

              <div className="stat-modifier-controls">
                <label className="effect-amount-label">
                  Stat Modifier
                  <select
                    value={selectedStat}
                    onChange={event =>
                      setManualEffectStats(current => ({
                        ...current,
                        [effect.id]: event.target.value as ManualEffectStatKey
                      }))
                    }
                  >
                    <option value="armorLevel">Armor Level</option>
                    <option value="speed">Speed</option>
                    <option value="attackDice">Attack Dice</option>
                    <option value="modifier">Modifier</option>
                  </select>
                </label>

                <label className="effect-amount-label">
                  Duration Type
                  <select
                    value={selectedDurationType}
                    onChange={event =>
                      setManualEffectDurationTypes(current => ({
                        ...current,
                        [effect.id]: event.target.value as ManualEffectDurationType
                      }))
                    }
                  >
                    <option value="TARGET_PLAYER_TURN_STARTS">
                      Expires at target player's turn start
                    </option>

                    {canUsePermanentDuration && (
                      <option value="PERMANENT_UNTIL_SOURCE_REMOVED">
                        Permanent until source Infinite Magic is removed
                      </option>
                    )}
                  </select>
                </label>

                {!canUsePermanentDuration && (
                  <div className="duration-rule-note">
                    Permanent stat effects are restricted to Infinite Magic cards.
                  </div>
                )}

                {selectedDurationType === "TARGET_PLAYER_TURN_STARTS" && (
                  <label className="effect-amount-label">
                    Target Player Turn Starts
                    <input
                      type="number"
                      min="1"
                      value={manualEffectDurations[effect.id] ?? "1"}
                      onChange={event =>
                        setManualEffectDurations(current => ({
                          ...current,
                          [effect.id]: event.target.value
                        }))
                      }
                    />
                  </label>
                )}
              </div>

              <div className="manual-effect-targets">
                {match.players.map(player => (
                  <div className="manual-effect-target" key={player.id}>
                    <h4>{player.displayName}</h4>

                    <div className="manual-effect-buttons">
                      <button
                        onClick={() => onDamagePrimary(effect.id, player.id, amount)}
                        disabled={!player.field.primaryCreature}
                      >
                        Damage Primary
                      </button>

                      <button
                        onClick={() => onHealPrimary(effect.id, player.id, amount)}
                        disabled={!player.field.primaryCreature}
                      >
                        Heal Primary
                      </button>

                      <button
                        onClick={() =>
                          onApplyStatModifier(
                            effect.id,
                            player.id,
                            selectedStat,
                            amount,
                            selectedDurationType,
                            durationTurnStarts
                          )
                        }
                        disabled={!player.field.primaryCreature}
                      >
                        Apply + Stat
                      </button>

                      <button
                        onClick={() =>
                          onApplyStatModifier(
                            effect.id,
                            player.id,
                            selectedStat,
                            -amount,
                            selectedDurationType,
                            durationTurnStarts
                          )
                        }
                        disabled={!player.field.primaryCreature}
                      >
                        Apply - Stat
                      </button>
                    </div>

                    {player.field.magicSlots.length > 0 && (
                      <div className="manual-destroy-list">
                        <span className="label">Destroy Magic Slot Card</span>

                        {player.field.magicSlots.map(card => (
                          <button
                            className="destroy-magic-button"
                            key={card.instanceId}
                            onClick={() =>
                              onDestroyMagicWithEffect(
                                effect.id,
                                player.id,
                                card.instanceId
                              )
                            }
                          >
                            {getCardName(match, card)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="actions">
                <button onClick={() => onCompleteEffect(effect.id)}>
                  Mark Effect Complete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

