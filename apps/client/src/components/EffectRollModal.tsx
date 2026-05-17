import { useEffect, useMemo, useRef, useState } from "react";
import type { PendingEffectRollSession } from "@ward/shared";
import type { AppMatchState } from "../clientTypes";

type EffectRollModalProps = {
  match: AppMatchState;
  effectRoll: PendingEffectRollSession;
  onRoll: (effectRollSessionId: string) => void;
  onApply: (effectRollSessionId: string) => void;
  onSkip: (effectRollSessionId: string) => void;
};

function randomD6Values(count: number): number[] {
  return Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1);
}

function sum(values: number[] | undefined): number {
  return (values ?? []).reduce((total, value) => total + value, 0);
}

function getPlayerName(match: AppMatchState, playerId?: string): string {
  if (!playerId) return "Unknown player";
  return match.players.find(player => player.id === playerId)?.displayName ?? playerId;
}

function successRangeLabel(effectRoll: PendingEffectRollSession): string {
  return effectRoll.successRanges
    .map(range => range.min === range.max ? String(range.min) : `${range.min}-${range.max}`)
    .join(", ");
}

function AnimatedDiceRow({ label, dice }: { label: string; dice?: number[] }) {
  const finalDice = useMemo(() => dice ?? [], [dice]);
  const [displayedDice, setDisplayedDice] = useState<number[]>(finalDice);
  const [isRolling, setIsRolling] = useState(false);
  const previousKeyRef = useRef("");

  useEffect(() => {
    const key = finalDice.join("|");

    if (finalDice.length === 0 || previousKeyRef.current === key) {
      setDisplayedDice(finalDice);
      previousKeyRef.current = key;
      return;
    }

    previousKeyRef.current = key;
    setIsRolling(true);

    const intervalId = window.setInterval(() => {
      setDisplayedDice(randomD6Values(finalDice.length));
    }, 65);

    const timeoutId = window.setTimeout(() => {
      window.clearInterval(intervalId);
      setDisplayedDice(finalDice);
      setIsRolling(false);
    }, 650);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [finalDice]);

  if (finalDice.length === 0) {
    return null;
  }

  return (
    <div className="battle-dice-row">
      <span>{label}</span>
      <div className="battle-dice-stage" aria-live="polite">
        {displayedDice.map((value, index) => (
          <div
            className={isRolling ? "die rolling" : "die stopped"}
            key={`${label}-${index}-${value}`}
            style={{ animationDelay: `${index * 45}ms` }}
          >
            {value}
          </div>
        ))}
      </div>
      <strong>Total: {sum(isRolling ? displayedDice : finalDice)}</strong>
    </div>
  );
}

export function EffectRollModal({
  match,
  effectRoll,
  onRoll,
  onApply,
  onSkip
}: EffectRollModalProps) {
  const hasRolled = effectRoll.status === "ROLLED" || effectRoll.rolledDice?.length;
  const canRoll = effectRoll.status === "AWAITING_ROLL";
  const canApply = effectRoll.status === "ROLLED";

  return (
    <section className="card battle-wizard-card effect-roll-card">
      <div className="battle-wizard-header">
        <div>
          <span className="label">Effect Roll</span>
          <h2>{effectRoll.sourceCardName}</h2>
          <p className="effect-source-line">{effectRoll.message}</p>
        </div>

        <div className="battle-wizard-status-pill">
          {effectRoll.status.split("_").join(" ")}
        </div>
      </div>

      <div className="battle-wizard-summary-grid">
        <div>
          <span className="label">Source</span>
          <strong>{getPlayerName(match, effectRoll.sourcePlayerId)}  -  {effectRoll.sourceCardName}</strong>
          <small>{effectRoll.trigger}  -  {effectRoll.actionType}  -  {effectRoll.effectId}</small>
        </div>
        <div>
          <span className="label">Target</span>
          <strong>{getPlayerName(match, effectRoll.targetPlayerId)}  -  {effectRoll.targetCardName ?? "Unknown target"}</strong>
          <small>Effect applies only if the roll succeeds.</small>
        </div>
        <div>
          <span className="label">Roll needed</span>
          <strong>{effectRoll.diceCount}D6</strong>
          <small>Success on {successRangeLabel(effectRoll)}</small>
        </div>
      </div>

      <div className="battle-modifier-card">
        <strong>Effect text</strong>
        <span>{effectRoll.actionText ?? "No effect text provided."}</span>
        {effectRoll.onSuccessActionType && (
          <small>
            On success: {effectRoll.onSuccessActionType}
            {effectRoll.onSuccessStatus ? `  -  ${effectRoll.onSuccessStatus}` : ""}
            {effectRoll.duration?.text ? ` for ${effectRoll.duration.text}` : ""}
          </small>
        )}
      </div>

      <AnimatedDiceRow label="Effect Roll" dice={effectRoll.rolledDice} />

      {hasRolled && (
        <div className="battle-resolution-box">
          <strong>{effectRoll.success ? "Effect roll succeeded" : "Effect roll failed"}</strong>
          <span>Total rolled: {effectRoll.rollTotal ?? sum(effectRoll.rolledDice)}</span>
          {effectRoll.success ? (
            <span>Click Apply Effect to apply {effectRoll.onSuccessLabel ?? effectRoll.onSuccessStatus ?? "the success effect"}.</span>
          ) : (
            <span>Click Apply Effect to close this roll and continue battle without applying a status.</span>
          )}
        </div>
      )}

      <div className="battle-wizard-action-row">
        {canRoll && (
          <button onClick={() => onRoll(effectRoll.id)}>
            Roll Effect Dice
          </button>
        )}

        {canApply && (
          <button onClick={() => onApply(effectRoll.id)}>
            {effectRoll.success ? "Apply Effect" : "Close Failed Roll"}
          </button>
        )}

        <button className="secondary-button" onClick={() => onSkip(effectRoll.id)}>
          Skip Effect Roll
        </button>
      </div>
    </section>
  );
}


