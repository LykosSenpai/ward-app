import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BattleEffectSuggestion,
  CardInstance,
  DevRollKind,
  ManualBattleSpeedModifiers,
  ManualBattleStrike,
  ManualBattleStrikeModifiers,
  PendingBattleSession
} from "@ward/shared";
import type { AppMatchState } from "../clientTypes";

const STEP_LABELS = [
  "Choose attacker",
  "Choose target",
  "Speed check",
  "Hit roll",
  "Effect roll",
  "Damage roll",
  "Apply damage",
  "Retaliation",
  "Mark battle used"
];

const DEFAULT_SPEED_MODIFIERS: ManualBattleSpeedModifiers = {
  attackingSpeedDelta: 0,
  defendingSpeedDelta: 0,
  override: "AUTO"
};

const DEFAULT_STRIKE_MODIFIERS: ManualBattleStrikeModifiers = {
  hitDiceDelta: 0,
  hitFlatBonus: 0,
  forceHitResult: "AUTO",
  damageDiceDelta: 0,
  damageFlatBonus: 0,
  damageMultiplier: 1,
  preventAttackDamage: false
};

type BattleResolverModalProps = {
  match: AppMatchState;
  battle: PendingBattleSession;
  onRunSpeedCheck: (battleSessionId: string) => void;
  onUpdateSpeedModifiers: (
    battleSessionId: string,
    modifiers: ManualBattleSpeedModifiers
  ) => void;
  onUpdateStrikeModifiers: (
    battleSessionId: string,
    strikeId: string,
    modifiers: ManualBattleStrikeModifiers
  ) => void;
  onRollHit: (battleSessionId: string) => void;
  onForceRolls: (kind: DevRollKind, dice: number[], label?: string) => void;
  onRollDamage: (battleSessionId: string) => void;
  onPlayBattleResponse: (
    battleSessionId: string,
    strikeId: string,
    playerId: string,
    cardInstanceId: string
  ) => void;
  onApplyDamage: (battleSessionId: string) => void;
  onFinish: (battleSessionId: string) => void;
  onCancel: (battleSessionId: string) => void;
};

function randomD6Values(count: number): number[] {
  return Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1);
}

function sum(values: number[] | undefined): number {
  return (values ?? []).reduce((total, value) => total + value, 0);
}

function getPlayerName(match: AppMatchState, playerId: string): string {
  return match.players.find(player => player.id === playerId)?.displayName ?? playerId;
}

function getCreatureKindLabel(kind: string): string {
  return kind === "LIMITED_SUMMON" ? "Limited Summon" : "Primary";
}

function getParticipantLabel(
  match: AppMatchState,
  participant: ManualBattleStrike["attacker"]
): string {
  return `${getPlayerName(match, participant.playerId)}  -  ${participant.creatureName}`;
}

function getParticipantSubLabel(participant: ManualBattleStrike["attacker"]): string {
  return `${getCreatureKindLabel(participant.creatureKind)}  -  SPD ${participant.speed}  -  AL ${participant.armorLevel}  -  HP ${participant.currentHp}  -  ATK ${participant.attackDice}D6  -  MOD ${participant.modifier}`;
}

function isMinotaurBodyguardCard(match: AppMatchState, card: CardInstance): boolean {
  const definition = match.cardCatalog[card.cardId];
  const name = String(definition?.name ?? "").trim().toLowerCase();
  const id = String(definition?.id ?? "").trim().toLowerCase();
  const cardNumber = String(definition?.cardNumber ?? "").trim();

  return definition?.cardType === "MAGIC" &&
    definition.magicType === "BATTLE_LIGHTNING" &&
    (
      name === "minotaur bodyguard" ||
      id.includes("minotaur-bodyguard") ||
      id.includes("minotaur_bodyguard") ||
      (cardNumber === "016" && name.includes("minotaur") && name.includes("bodyguard"))
    );
}

function normalizeSpeedModifiers(
  modifiers?: Partial<ManualBattleSpeedModifiers>
): ManualBattleSpeedModifiers {
  return {
    attackingSpeedDelta: Number(modifiers?.attackingSpeedDelta ?? DEFAULT_SPEED_MODIFIERS.attackingSpeedDelta),
    defendingSpeedDelta: Number(modifiers?.defendingSpeedDelta ?? DEFAULT_SPEED_MODIFIERS.defendingSpeedDelta),
    override:
      modifiers?.override === "ATTACKER_FIRST" || modifiers?.override === "DEFENDER_FIRST"
        ? modifiers.override
        : "AUTO",
    note: modifiers?.note ?? ""
  };
}

function normalizeStrikeModifiers(
  modifiers?: Partial<ManualBattleStrikeModifiers>
): ManualBattleStrikeModifiers {
  const hitDiceLimitValue = Number(modifiers?.hitDiceLimit);

  return {
    hitDiceDelta: Number(modifiers?.hitDiceDelta ?? DEFAULT_STRIKE_MODIFIERS.hitDiceDelta),
    hitDiceLimit: Number.isFinite(hitDiceLimitValue) && hitDiceLimitValue > 0 ? Math.trunc(hitDiceLimitValue) : undefined,
    hitFlatBonus: Number(modifiers?.hitFlatBonus ?? DEFAULT_STRIKE_MODIFIERS.hitFlatBonus),
    forceHitResult:
      modifiers?.forceHitResult === "FORCE_HIT" || modifiers?.forceHitResult === "FORCE_MISS"
        ? modifiers.forceHitResult
        : "AUTO",
    damageDiceDelta: Number(modifiers?.damageDiceDelta ?? DEFAULT_STRIKE_MODIFIERS.damageDiceDelta),
    damageFlatBonus: Number(modifiers?.damageFlatBonus ?? DEFAULT_STRIKE_MODIFIERS.damageFlatBonus),
    damageMultiplier: Number(modifiers?.damageMultiplier ?? DEFAULT_STRIKE_MODIFIERS.damageMultiplier),
    preventAttackDamage: Boolean(modifiers?.preventAttackDamage),
    note: modifiers?.note ?? ""
  };
}

function getHitDicePreview(modifiers: ManualBattleStrikeModifiers): number {
  const baseCount = Math.max(1, 2 + modifiers.hitDiceDelta);

  return modifiers.hitDiceLimit === undefined
    ? baseCount
    : Math.max(1, Math.min(baseCount, modifiers.hitDiceLimit));
}

function getDamageDicePreview(strike: ManualBattleStrike, modifiers: ManualBattleStrikeModifiers): number {
  return Math.max(1, strike.attacker.attackDice + modifiers.damageDiceDelta);
}


function queueForcedRollAndRun(
  onForceRolls: (kind: DevRollKind, dice: number[], label?: string) => void,
  onRun: () => void,
  kind: DevRollKind,
  dice: number[],
  label: string
): void {
  onForceRolls(kind, dice, label);
  window.setTimeout(onRun, 0);
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

function getStrikeTitle(match: AppMatchState, strike: ManualBattleStrike, index: number): string {
  const prefix = strike.role === "RETALIATION" ? "Retaliation" : "First Strike";
  return `${index + 1}. ${prefix}: ${getParticipantLabel(match, strike.attacker)} -> ${getParticipantLabel(match, strike.defender)}`;
}

function getActiveStepIndex(battle: PendingBattleSession): number {
  if (battle.status === "AWAITING_SPEED_CHECK") return 2;
  if (battle.status === "AWAITING_HIT_ROLL") return 3;
  if (battle.status === "AWAITING_EFFECT_ROLL") return 4;
  if (battle.status === "AWAITING_DAMAGE_ROLL") return 5;
  if (battle.status === "AWAITING_DAMAGE_APPLICATION") return 6;
  return 8;
}

function canCancelBattle(battle: PendingBattleSession): boolean {
  return battle.strikes.every(strike => !strike.hitRollDice?.length);
}

function BattleEffectSuggestionPanel({
  suggestions
}: {
  suggestions: BattleEffectSuggestion[];
}) {
  if (!suggestions.length) {
    return (
      <div className="battle-modifier-card">
        <strong>Detected Battle Effects</strong>
        <span>No active battle modifiers were detected. Use manual overrides if a card effect applies.</span>
      </div>
    );
  }

  return (
    <div className="battle-modifier-card">
      <strong>Detected Battle Effects</strong>
      <small>These are prefilled as suggested modifier defaults where possible. You can still override the values before rolling.</small>
      <div className="battle-effect-suggestion-list">
        {suggestions.map(suggestion => (
          <div className="battle-effect-suggestion" key={suggestion.id}>
            <span className="label">{suggestion.kind.replaceAll("_", " ")}</span>
            <strong>{suggestion.label}</strong>
            <small>
              {suggestion.sourceCardName}
              {suggestion.trigger ? " | " + suggestion.trigger : ""}
              {suggestion.actionType ? " | " + suggestion.actionType : ""}
            </small>
            {suggestion.note && <small>{suggestion.note}</small>}
          </div>
        ))}
      </div>
    </div>
  );
}

function SpeedModifierEditor({
  match,
  battle,
  onSave
}: {
  match: AppMatchState;
  battle: PendingBattleSession;
  onSave: (modifiers: ManualBattleSpeedModifiers) => void;
}) {
  const speedModifiers = normalizeSpeedModifiers(battle.speedModifiers);
  const [form, setForm] = useState<ManualBattleSpeedModifiers>(speedModifiers);

  useEffect(() => {
    setForm(normalizeSpeedModifiers(battle.speedModifiers));
  }, [battle.id, battle.speedModifiers]);

  if (battle.status !== "AWAITING_SPEED_CHECK") {
    return (
      <div className="battle-modifier-card">
        <strong>Speed check result</strong>
        <span>
          {getPlayerName(match, battle.attackingPlayerId)} / {battle.declaredAttacker.creatureName}: SPD {battle.declaredAttacker.speed}
          {speedModifiers.attackingSpeedDelta ? ` ${speedModifiers.attackingSpeedDelta > 0 ? "+" : ""}${speedModifiers.attackingSpeedDelta}` : ""}
          {typeof battle.effectiveAttackingSpeed === "number" ? ` = ${battle.effectiveAttackingSpeed}` : ""}
        </span>
        <span>
          {getPlayerName(match, battle.defendingPlayerId)} / {battle.declaredDefender.creatureName}: SPD {battle.declaredDefender.speed}
          {speedModifiers.defendingSpeedDelta ? ` ${speedModifiers.defendingSpeedDelta > 0 ? "+" : ""}${speedModifiers.defendingSpeedDelta}` : ""}
          {typeof battle.effectiveDefendingSpeed === "number" ? ` = ${battle.effectiveDefendingSpeed}` : ""}
        </span>
        {speedModifiers.override !== "AUTO" && (
          <span>Manual speed override: {speedModifiers.override.replaceAll("_", " ")}</span>
        )}
        {speedModifiers.note && <small>Note: {speedModifiers.note}</small>}
      </div>
    );
  }

  return (
    <div className="battle-modifier-card">
      <div className="battle-modifier-card-header">
        <strong>Speed modifiers before first strike</strong>
        <button className="secondary-button" onClick={() => onSave(form)}>
          Save Speed Modifiers
        </button>
      </div>

      <div className="battle-modifier-grid">
        <label>
          <span>{getPlayerName(match, battle.attackingPlayerId)} attacker SPD delta</span>
          <input
            type="number"
            value={form.attackingSpeedDelta}
            onChange={event => setForm(current => ({
              ...current,
              attackingSpeedDelta: Number(event.target.value)
            }))}
          />
        </label>
        <label>
          <span>{getPlayerName(match, battle.defendingPlayerId)} defender SPD delta</span>
          <input
            type="number"
            value={form.defendingSpeedDelta}
            onChange={event => setForm(current => ({
              ...current,
              defendingSpeedDelta: Number(event.target.value)
            }))}
          />
        </label>
        <label>
          <span>Manual first-strike override</span>
          <select
            value={form.override}
            onChange={event => setForm(current => ({
              ...current,
              override: event.target.value as ManualBattleSpeedModifiers["override"]
            }))}
          >
            <option value="AUTO">Auto by SPD / tie roll</option>
            <option value="ATTACKER_FIRST">Declared attacker first</option>
            <option value="DEFENDER_FIRST">Declared defender first</option>
          </select>
        </label>
        <label className="battle-modifier-wide">
          <span>Speed note</span>
          <input
            value={form.note ?? ""}
            onChange={event => setForm(current => ({ ...current, note: event.target.value }))}
            placeholder="Example: +2 SPD from active magic"
          />
        </label>
      </div>

      <small>
        Current preview: {battle.declaredAttacker.creatureName} SPD {Math.max(0, battle.declaredAttacker.speed + form.attackingSpeedDelta)} vs {battle.declaredDefender.creatureName} SPD {Math.max(0, battle.declaredDefender.speed + form.defendingSpeedDelta)}.
      </small>
    </div>
  );
}

function StrikeModifierEditor({
  strike,
  onSave
}: {
  strike: ManualBattleStrike;
  onSave: (modifiers: ManualBattleStrikeModifiers) => void;
}) {
  const [form, setForm] = useState<ManualBattleStrikeModifiers>(
    normalizeStrikeModifiers(strike.modifiers)
  );

  useEffect(() => {
    setForm(normalizeStrikeModifiers(strike.modifiers));
  }, [strike.id, strike.modifiers]);

  if (strike.status === "RESOLVED") {
    return null;
  }

  const hitLocked = Boolean(strike.hitRollDice?.length);
  const damageLocked = Boolean(strike.damageRollDice?.length);

  return (
    <div className="battle-modifier-card nested">
      <div className="battle-modifier-card-header">
        <strong>Strike modifiers</strong>
        <button className="secondary-button" onClick={() => onSave(form)}>
          Save Strike Modifiers
        </button>
      </div>

      <div className="battle-modifier-grid">
        <label>
          <span>Hit dice delta</span>
          <input
            disabled={hitLocked}
            type="number"
            value={form.hitDiceDelta}
            onChange={event => setForm(current => ({
              ...current,
              hitDiceDelta: Number(event.target.value)
            }))}
          />
        </label>
        <label>
          <span>Hit dice max</span>
          <input
            disabled={hitLocked}
            min="1"
            placeholder="No cap"
            type="number"
            value={form.hitDiceLimit ?? ""}
            onChange={event => setForm(current => ({
              ...current,
              hitDiceLimit: event.target.value === "" ? undefined : Number(event.target.value)
            }))}
          />
        </label>
        <label>
          <span>Hit flat bonus</span>
          <input
            disabled={hitLocked}
            type="number"
            value={form.hitFlatBonus}
            onChange={event => setForm(current => ({
              ...current,
              hitFlatBonus: Number(event.target.value)
            }))}
          />
        </label>
        <label>
          <span>Force hit result</span>
          <select
            disabled={hitLocked}
            value={form.forceHitResult}
            onChange={event => setForm(current => ({
              ...current,
              forceHitResult: event.target.value as ManualBattleStrikeModifiers["forceHitResult"]
            }))}
          >
            <option value="AUTO">Auto</option>
            <option value="FORCE_HIT">Force hit</option>
            <option value="FORCE_MISS">Force miss</option>
          </select>
        </label>
        <label>
          <span>Damage dice delta</span>
          <input
            disabled={damageLocked}
            type="number"
            value={form.damageDiceDelta}
            onChange={event => setForm(current => ({
              ...current,
              damageDiceDelta: Number(event.target.value)
            }))}
          />
        </label>
        <label>
          <span>Damage flat bonus</span>
          <input
            disabled={damageLocked}
            type="number"
            value={form.damageFlatBonus}
            onChange={event => setForm(current => ({
              ...current,
              damageFlatBonus: Number(event.target.value)
            }))}
          />
        </label>
        <label>
          <span>Damage multiplier</span>
          <input
            disabled={damageLocked}
            min="0"
            step="0.5"
            type="number"
            value={form.damageMultiplier}
            onChange={event => setForm(current => ({
              ...current,
              damageMultiplier: Number(event.target.value)
            }))}
          />
        </label>
        <label className="battle-checkbox-label">
          <input
            type="checkbox"
            checked={form.preventAttackDamage}
            onChange={event => setForm(current => ({
              ...current,
              preventAttackDamage: event.target.checked
            }))}
          />
          <span>Prevent this strike's attack damage</span>
        </label>
        <label className="battle-modifier-wide">
          <span>Modifier note</span>
          <input
            value={form.note ?? ""}
            onChange={event => setForm(current => ({ ...current, note: event.target.value }))}
            placeholder="Example: Battle Axe +1 MOD, shield prevents damage"
          />
        </label>
      </div>

      <small>
        Preview: Hit roll {getHitDicePreview(form)}D6 + {strike.attacker.modifier + form.hitFlatBonus}; Damage roll {getDamageDicePreview(strike, form)}D6 + {strike.attacker.modifier + form.damageFlatBonus}, then x{form.damageMultiplier}.
      </small>
    </div>
  );
}

function StrikeDetail({
  match,
  battle,
  strike,
  index,
  isCurrent,
  onSaveModifiers,
  onPlayBattleResponse
}: {
  match: AppMatchState;
  battle: PendingBattleSession;
  strike: ManualBattleStrike;
  index: number;
  isCurrent: boolean;
  onSaveModifiers: (modifiers: ManualBattleStrikeModifiers) => void;
  onPlayBattleResponse: (
    battleSessionId: string,
    strikeId: string,
    playerId: string,
    cardInstanceId: string
  ) => void;
}) {
  const defender = match.players.find(player => player.id === strike.defender.playerId);
  const battleResponseCards = defender?.hand.filter(card => isMinotaurBodyguardCard(match, card)) ?? [];
  const canPlayBattleResponse =
    isCurrent &&
    battleResponseCards.length > 0 &&
    (strike.status === "AWAITING_DAMAGE_ROLL" ||
      strike.status === "AWAITING_DAMAGE_APPLICATION");

  return (
    <article className={`battle-wizard-strike ${strike.status.toLowerCase().replaceAll("_", "-")}`}>
      <div className="battle-strike-heading-row">
        <h4>{getStrikeTitle(match, strike, index)}</h4>
        {isCurrent && <span className="battle-current-pill">Current strike</span>}
      </div>

      <div className="battle-combatant-grid compact">
        <div>
          <span className="label">Attacking creature</span>
          <strong>{getParticipantLabel(match, strike.attacker)}</strong>
          <small>{getParticipantSubLabel(strike.attacker)}</small>
        </div>
        <div>
          <span className="label">Defending creature</span>
          <strong>{getParticipantLabel(match, strike.defender)}</strong>
          <small>{getParticipantSubLabel(strike.defender)}</small>
        </div>
      </div>

      <div className="battle-wizard-stat-row">
        <span>Attacker MOD {strike.attacker.modifier}</span>
        <span>Defender AL {strike.defenderArmorLevel ?? strike.defender.armorLevel}</span>
        {strike.hitDiceCount && <span>Hit dice {strike.hitDiceCount}D6</span>}
        {strike.damageDiceCount && <span>Damage dice {strike.damageDiceCount}D6</span>}
        <span>Status: {strike.status.replaceAll("_", " ")}</span>
      </div>

      {isCurrent && (
        <StrikeModifierEditor strike={strike} onSave={onSaveModifiers} />
      )}

      {canPlayBattleResponse && (
        <div className="battle-modifier-card nested">
          <div className="battle-modifier-card-header">
            <strong>Battle responses from hand</strong>
          </div>
          {battleResponseCards.map(card => (
            <button
              className="lightning-button"
              key={card.instanceId}
              onClick={() => onPlayBattleResponse(battle.id, strike.id, strike.defender.playerId, card.instanceId)}
            >
              Play {match.cardCatalog[card.cardId]?.name ?? "Battle Response"}
            </button>
          ))}
        </div>
      )}

      <AnimatedDiceRow label="Hit Roll" dice={strike.hitRollDice} />

      {strike.hitRollDice && (
        <div className="battle-roll-breakdown">
          <span>
            Hit total: {sum(strike.hitRollDice)} + {strike.hitRollModifier ?? 0} = {strike.hitRollTotal ?? 0}
          </span>
          <strong>
            {strike.criticalMiss
              ? "Critical Miss"
              : strike.criticalHit
                ? "Critical Hit"
                : strike.hit
                  ? "Hit"
                  : "Miss"}
          </strong>
        </div>
      )}

      <AnimatedDiceRow label="Self Damage" dice={strike.selfDamageDice} />
      <AnimatedDiceRow label="Attack Damage" dice={strike.damageRollDice} />

      {strike.damageRollDice && (
        <div className="battle-roll-breakdown">
          <span>
            Damage: {sum(strike.damageRollDice)} + {strike.attackDamageModifier ?? 0}
            {strike.criticalHit ? ` -> ${strike.damageAfterCritical ?? 0} after critical x2` : ""}
            {strike.modifiers?.damageMultiplier && strike.modifiers.damageMultiplier !== 1
              ? ` -> x${strike.modifiers.damageMultiplier}`
              : ""}
          </span>
          <strong>Pending damage: {strike.damageDealt ?? 0}</strong>
        </div>
      )}

      {strike.modifiers?.note && (
        <div className="battle-modifier-note">Modifier note: {strike.modifiers.note}</div>
      )}

      {strike.status === "RESOLVED" && (
        <div className="battle-resolution-box">
          <strong>{strike.message ?? "Strike resolved."}</strong>
          {strike.damagePreventedReason && <span>{strike.damagePreventedReason}</span>}
          {strike.selfDamagePreventedReason && <span>{strike.selfDamagePreventedReason}</span>}
          {typeof strike.defenderRemainingHp === "number" && (
            <span>
              {getParticipantLabel(match, strike.defender)} HP: {strike.defenderRemainingHp}
              {strike.defenderKilled ? "  -  killed" : ""}
            </span>
          )}
          {typeof strike.attackerRemainingHp === "number" && (
            <span>
              {getParticipantLabel(match, strike.attacker)} HP: {strike.attackerRemainingHp}
              {strike.attackerKilledByCriticalMiss ? "  -  killed by critical miss" : ""}
            </span>
          )}
        </div>
      )}
    </article>
  );
}

export function BattleResolverModal({
  match,
  battle,
  onRunSpeedCheck,
  onUpdateSpeedModifiers,
  onUpdateStrikeModifiers,
  onRollHit,
  onForceRolls,
  onRollDamage,
  onPlayBattleResponse,
  onApplyDamage,
  onFinish,
  onCancel
}: BattleResolverModalProps) {
  const activeStepIndex = getActiveStepIndex(battle);
  const currentStrike = battle.strikes[battle.currentStrikeIndex];

  return (
    <section className="card battle-wizard-card">
      <div className="battle-wizard-header">
        <div>
          <span className="label">Manual Battle Resolver</span>
          <h2>
            {getPlayerName(match, battle.attackingPlayerId)} declares battle
          </h2>
          <p className="effect-source-line">{battle.message}</p>
        </div>

        <div className="battle-wizard-status-pill">
          {battle.status.replaceAll("_", " ")}
        </div>
      </div>

      <div className="battle-wizard-summary-grid">
        <div>
          <span className="label">Declared attacker</span>
          <strong>{getPlayerName(match, battle.attackingPlayerId)}  -  {battle.declaredAttacker.creatureName}</strong>
          <small>{getParticipantSubLabel(battle.declaredAttacker)}</small>
        </div>
        <div>
          <span className="label">Declared target</span>
          <strong>{getPlayerName(match, battle.defendingPlayerId)}  -  {battle.declaredDefender.creatureName}</strong>
          <small>{getParticipantSubLabel(battle.declaredDefender)}</small>
        </div>
        <div>
          <span className="label">Retaliation</span>
          <strong>{battle.limitedSummonNoRetaliation ? "No retaliation" : "Retaliation if alive"}</strong>
          <small>
            {battle.limitedSummonNoRetaliation
              ? `${getPlayerName(match, battle.defendingPlayerId)} cannot retaliate into a Limited Summon.`
              : "The slower primary returns attack if still alive."}
          </small>
        </div>
      </div>

      <BattleEffectSuggestionPanel suggestions={battle.suggestedEffects ?? []} />

      <ol className="battle-wizard-step-list">
        {STEP_LABELS.map((label, index) => (
          <li
            className={index < activeStepIndex ? "done" : index === activeStepIndex ? "active" : "waiting"}
            key={label}
          >
            <span>{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      <SpeedModifierEditor
        match={match}
        battle={battle}
        onSave={modifiers => onUpdateSpeedModifiers(battle.id, modifiers)}
      />

      {battle.speedTieRolls.length > 0 && (
        <div className="battle-speed-tie-box">
          <strong>Speed tie roll-off</strong>
          {battle.speedTieRolls.map((round, index) => (
            <span key={`${round.attackingCreatureRoll}-${round.defendingCreatureRoll}-${index}`}>
              Round {index + 1}: {getPlayerName(match, battle.attackingPlayerId)} / {battle.declaredAttacker.creatureName} rolled {round.attackingCreatureRoll}; {getPlayerName(match, battle.defendingPlayerId)} / {battle.declaredDefender.creatureName} rolled {round.defendingCreatureRoll}
            </span>
          ))}
        </div>
      )}

      <div className="battle-wizard-strike-list">
        {battle.strikes.map((strike, index) => (
          <StrikeDetail
            key={strike.id}
            match={match}
            battle={battle}
            strike={strike}
            index={index}
            isCurrent={index === battle.currentStrikeIndex && battle.status !== "COMPLETE"}
            onSaveModifiers={modifiers => onUpdateStrikeModifiers(battle.id, strike.id, modifiers)}
            onPlayBattleResponse={onPlayBattleResponse}
          />
        ))}
      </div>

      <div className="battle-wizard-action-row">
        {battle.status === "AWAITING_SPEED_CHECK" && (
          <button onClick={() => onRunSpeedCheck(battle.id)}>
            Run Speed Check
          </button>
        )}

        {battle.status === "AWAITING_HIT_ROLL" && currentStrike && (
          <div className="battle-critical-test-actions">
            <button onClick={() => onRollHit(battle.id)}>
              Roll Hit for {getParticipantLabel(match, currentStrike.attacker)}
            </button>
            <button
              className="secondary-button"
              onClick={() => queueForcedRollAndRun(
                onForceRolls,
                () => onRollHit(battle.id),
                "HIT_ROLL",
                [6, 6],
                `Critical hit test: ${currentStrike.attacker.creatureName}`
              )}
            >
              Roll Critical Hit 6,6
            </button>
            <button
              className="secondary-button"
              onClick={() => queueForcedRollAndRun(
                onForceRolls,
                () => onRollHit(battle.id),
                "HIT_ROLL",
                [1, 1],
                `Critical miss test: ${currentStrike.attacker.creatureName}`
              )}
            >
              Roll Critical Miss 1,1
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                onForceRolls("HIT_ROLL", [1, 1], `Critical miss test: ${currentStrike.attacker.creatureName}`);
                onForceRolls("SELF_DAMAGE_ROLL", [6], `Critical miss self-damage test: ${currentStrike.attacker.creatureName}`);
                window.setTimeout(() => onRollHit(battle.id), 0);
              }}
            >
              Crit Miss + Self Damage 6
            </button>
            <small>
              Critical checks only apply when the final hit roll has 2+ dice. Force Hit still rolls dice: 6,6 keeps critical hit; 1,1 ignores critical miss and becomes a forced hit.
            </small>
          </div>
        )}

        {battle.status === "AWAITING_DAMAGE_ROLL" && currentStrike && (
          <button onClick={() => onRollDamage(battle.id)}>
            Roll Attack Damage for {getParticipantLabel(match, currentStrike.attacker)}
          </button>
        )}

        {battle.status === "AWAITING_DAMAGE_APPLICATION" && currentStrike && (
          <button onClick={() => onApplyDamage(battle.id)}>
            Apply Damage
          </button>
        )}

        {battle.status === "AWAITING_EFFECT_ROLL" && (
          <div className="battle-resolution-box">
            <strong>Effect roll pending</strong>
            <span>Use the Effect Roll window before rolling attack damage.</span>
          </div>
        )}

        {battle.status === "COMPLETE" && (
          <button onClick={() => onFinish(battle.id)}>
            Finish Battle
          </button>
        )}

        {canCancelBattle(battle) && battle.status !== "COMPLETE" && (
          <button className="secondary-button" onClick={() => onCancel(battle.id)}>
            Cancel Battle
          </button>
        )}
      </div>
    </section>
  );
}


