import { useEffect, useMemo, useRef, useState } from "react";

type DiceRollerPanelProps = {
  maxDice?: number;
};

function clampDiceCount(value: number, maxDice: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(maxDice, Math.max(1, Math.floor(value)));
}

function rollD6(count: number): number[] {
  return Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function DiceRollerPanel({ maxDice = 20 }: DiceRollerPanelProps) {
  const [diceCount, setDiceCount] = useState(2);
  const [displayedDice, setDisplayedDice] = useState<number[]>([1, 1]);
  const [finalDice, setFinalDice] = useState<number[]>([1, 1]);
  const [isRolling, setIsRolling] = useState(false);
  const [rollSequence, setRollSequence] = useState(0);
  const rollTimerRef = useRef<number | undefined>(undefined);
  const stopTimerRef = useRef<number | undefined>(undefined);

  const total = useMemo(() => sum(finalDice), [finalDice]);

  useEffect(() => {
    return () => {
      if (rollTimerRef.current !== undefined) window.clearInterval(rollTimerRef.current);
      if (stopTimerRef.current !== undefined) window.clearTimeout(stopTimerRef.current);
    };
  }, []);

  function updateDiceCount(value: number) {
    const nextDiceCount = clampDiceCount(value, maxDice);

    setDiceCount(nextDiceCount);
    setDisplayedDice(current => {
      const nextDice = current.slice(0, nextDiceCount);

      while (nextDice.length < nextDiceCount) {
        nextDice.push(1);
      }

      return nextDice;
    });
    setFinalDice(current => {
      const nextDice = current.slice(0, nextDiceCount);

      while (nextDice.length < nextDiceCount) {
        nextDice.push(1);
      }

      return nextDice;
    });
  }

  function rollDice() {
    const finalValues = rollD6(diceCount);

    if (rollTimerRef.current !== undefined) window.clearInterval(rollTimerRef.current);
    if (stopTimerRef.current !== undefined) window.clearTimeout(stopTimerRef.current);

    setIsRolling(true);
    setRollSequence(current => current + 1);

    rollTimerRef.current = window.setInterval(() => {
      setDisplayedDice(rollD6(diceCount));
    }, 70);

    stopTimerRef.current = window.setTimeout(() => {
      if (rollTimerRef.current !== undefined) {
        window.clearInterval(rollTimerRef.current);
        rollTimerRef.current = undefined;
      }

      setDisplayedDice(finalValues);
      setFinalDice(finalValues);
      setIsRolling(false);
    }, 850);
  }

  return (
    <section className="card dice-roller-card">
      <h2>D6 Dice Roller</h2>
      <p className="effect-source-line">
        Select how many six-sided dice to roll. The dice animate before locking onto the final result.
      </p>

      <div className="dice-roller-controls">
        <label>
          Number of D6 dice
          <input
            type="number"
            min="1"
            max={maxDice}
            value={diceCount}
            onChange={event => updateDiceCount(Number(event.target.value))}
            disabled={isRolling}
          />
        </label>

        <button onClick={rollDice} disabled={isRolling}>
          {isRolling ? "Rolling..." : "Roll D6"}
        </button>
      </div>

      <div className="dice-stage" aria-live="polite">
        {displayedDice.map((value, index) => (
          <div
            className={isRolling ? "die rolling" : "die stopped"}
            key={`${rollSequence}-${index}`}
            style={{ animationDelay: `${index * 45}ms` }}
          >
            {value}
          </div>
        ))}
      </div>

      <div className="dice-result-box">
        <strong>Total: {isRolling ? sum(displayedDice) : total}</strong>
        <span>Dice: {(isRolling ? displayedDice : finalDice).join(" + ")}</span>
      </div>
    </section>
  );
}
