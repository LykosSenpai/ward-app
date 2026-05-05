import { useMemo, useState } from "react";
import type { DevRollKind } from "@ward/shared";
import type { AppMatchState } from "../clientTypes";

const ROLL_KINDS: DevRollKind[] = [
  "HIT_ROLL",
  "ATTACK_DAMAGE_ROLL",
  "EFFECT_ROLL",
  "SPEED_TIE_ROLL",
  "SELF_DAMAGE_ROLL",
  "GENERIC_ROLL"
];

type DevTestControlsPanelProps = {
  match: AppMatchState;
  onForceRolls: (kind: DevRollKind, dice: number[], label?: string) => void;
  onClearForcedRolls: (kind?: DevRollKind) => void;
};

function parseDiceInput(value: string): number[] {
  return value
    .split(/[^0-9]+/g)
    .map(part => Number(part))
    .filter(value => Number.isInteger(value) && value >= 1 && value <= 6);
}

export function DevTestControlsPanel({
  match,
  onForceRolls,
  onClearForcedRolls
}: DevTestControlsPanelProps) {
  const [kind, setKind] = useState<DevRollKind>("HIT_ROLL");
  const [diceText, setDiceText] = useState("6,6");
  const [label, setLabel] = useState("");

  const queue = match.devTools?.rolls?.forcedRollQueue ?? [];
  const parsedDice = useMemo(() => parseDiceInput(diceText), [diceText]);

  return (
    <details className="card dev-test-controls-card">
      <summary>
        <span>Dev Test Controls</span>
        <span className="zone-details-badge">{queue.length} forced roll(s)</span>
      </summary>

      <div className="dev-test-controls-grid">
        <label>
          Roll kind
          <select value={kind} onChange={event => setKind(event.target.value as DevRollKind)}>
            {ROLL_KINDS.map(item => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>

        <label>
          Dice results
          <input
            value={diceText}
            onChange={event => setDiceText(event.target.value)}
            placeholder="Example: 6,6 or 5"
          />
        </label>

        <label>
          Label / note
          <input
            value={label}
            onChange={event => setLabel(event.target.value)}
            placeholder="Blue Dragon effect roll"
          />
        </label>

        <div className="dev-test-control-actions">
          <button
            onClick={() => onForceRolls(kind, parsedDice, label)}
            disabled={parsedDice.length === 0}
          >
            Queue Forced Roll
          </button>
          <button className="secondary-button" onClick={() => onClearForcedRolls(kind)}>
            Clear This Kind
          </button>
          <button className="secondary-button" onClick={() => onClearForcedRolls()}>
            Clear All
          </button>
        </div>
      </div>

      {queue.length > 0 ? (
        <div className="forced-roll-queue-list">
          {queue.map(item => (
            <div key={item.id} className="forced-roll-queue-item">
              <strong>{item.kind}</strong>
              <span>{item.dice.join(", ")}</span>
              {item.label && <small>{item.label}</small>}
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-zone">No forced rolls queued. Random rolls will be used.</p>
      )}
    </details>
  );
}
