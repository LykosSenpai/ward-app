import type { AppMatchState } from "../clientTypes";
import {
  getActivePlayerName,
  getBattleBlockReason,
  getCreatureStatsLine,
  getMatchStatus,
  getPlayerBattleCreatureOptions,
  getWinnerName
} from "../gameViewHelpers";

type CompactMatchControlPanelProps = {
  match: AppMatchState;
  advanceBlockReason: string;
  controlledPlayerId?: string;
  onShuffleAllDecks: () => void;
  onUndoLastAction: () => void;
  onDrawActivePlayer: () => void;
  onStartManualBattle: (attackerCreatureInstanceId: string) => void;
  onUpdateCannotInflictAttackDamageBattlePolicy: (policy: "DAMAGE_ONLY" | "SKIP_BATTLE") => void;
  onAdvancePhase: () => void;
  onOpenSaveLoad: () => void;
  onOpenManualEffects: () => void;
  onOpenBattleResult: () => void;
  onOpenEventLog: () => void;
  onOpenMatchDetails: () => void;
  onOpenEffectDebug: () => void;
  onOpenDiceRoller: () => void;
};

export function CompactMatchControlPanel({
  match,
  advanceBlockReason,
  controlledPlayerId,
  onShuffleAllDecks,
  onUndoLastAction,
  onDrawActivePlayer,
  onStartManualBattle,
  onUpdateCannotInflictAttackDamageBattlePolicy,
  onAdvancePhase,
  onOpenSaveLoad,
  onOpenManualEffects,
  onOpenBattleResult,
  onOpenEventLog,
  onOpenMatchDetails,
  onOpenEffectDebug,
  onOpenDiceRoller
}: CompactMatchControlPanelProps) {
  const matchStatus = getMatchStatus(match);
  const pendingManualEffects = match.manualEffectQueue.filter(effect => !effect.completed).length;
  const canUseMatchActions = matchStatus !== "COMPLETE";
  const canControlActiveTurn = !controlledPlayerId || controlledPlayerId === match.turn.activePlayerId;
  const battleBlockReason = getBattleBlockReason(match);
  const activePlayer = match.players.find(player => player.id === match.turn.activePlayerId);
  const battleOptions = activePlayer
    ? getPlayerBattleCreatureOptions(match, activePlayer)
    : [];

  const drawDisabled =
    !canUseMatchActions ||
    !canControlActiveTurn ||
    !match.setup.decksShuffled ||
    !!match.pendingPrompt ||
    !!match.pendingBattle ||
    !!match.pendingChain ||
    !!match.pendingEffectTargetPrompt ||
    pendingManualEffects > 0 ||
    !!match.setup.handDiscardRequiredForPlayerId ||
    !!match.players.find(
      player =>
        player.id === match.turn.activePlayerId &&
        player.turnFlags.drawnThisTurn
    );

  return (
    <section className="card compact-match-control-card">
      <div className="compact-match-main">
        <div className="compact-match-status">
          <span className="label">Current Turn</span>
          <h2>
            {getActivePlayerName(match)}  -  {match.turn.phase}
          </h2>

          <div className="match-chip-row">
            <span className="match-chip">Status: {matchStatus}</span>
            <span className="match-chip">Turn {match.turn.turnNumber}</span>
            <span className="match-chip">Cycle {match.turn.turnCycleNumber}</span>
            <span className="match-chip">
              First Cycle: {match.turn.firstTurnCycleComplete ? "Done" : "Locked"}
            </span>
            <span className="match-chip">
              No-Atk Battle: {match.settings.cannotInflictAttackDamageBattlePolicy === "DAMAGE_ONLY" ? "Damage = 0" : "Skip battle"}
            </span>
            {matchStatus === "COMPLETE" && (
              <span className="match-chip match-chip-success">
                Winner: {getWinnerName(match)}
              </span>
            )}
          </div>
        </div>

        <div className="compact-primary-actions">
          <button
            onClick={onShuffleAllDecks}
            disabled={!canControlActiveTurn || match.players.some(player => player.hand.length > 0) || !!match.pendingPrompt}
          >
            Shuffle Both
          </button>

          <button onClick={onUndoLastAction} disabled={!canUseMatchActions || !canControlActiveTurn}>
            Undo
          </button>

          <button onClick={onDrawActivePlayer} disabled={drawDisabled}>
            Draw
          </button>

          <button onClick={onOpenDiceRoller} disabled={!canUseMatchActions}>
            Dice Roller
          </button>

          <label className="compact-setting-control" title="Toggle how statuses like Frozen/Stunned behave when they say the creature cannot inflict attack damage.">
            <span>No-Atk Status</span>
            <select
              value={match.settings.cannotInflictAttackDamageBattlePolicy ?? "SKIP_BATTLE"}
              onChange={event => onUpdateCannotInflictAttackDamageBattlePolicy(event.target.value as "DAMAGE_ONLY" | "SKIP_BATTLE")}
              disabled={!canUseMatchActions || !canControlActiveTurn}
            >
              <option value="SKIP_BATTLE">Skip battle turn</option>
              <option value="DAMAGE_ONLY">Allow battle, damage = 0</option>
            </select>
          </label>

          <button onClick={onAdvancePhase} disabled={!canUseMatchActions || !canControlActiveTurn || !!advanceBlockReason}>
            Advance Phase
          </button>
        </div>
      </div>

      {battleOptions.length > 0 && (
        <div className="battle-control-strip">
          <div>
            <span className="label">Manual Battle Control</span>
            <p>
              Choose the active creature to open the step-by-step battle resolver. Each creature can battle once per Combat Phase.
            </p>
          </div>

          <div className="battle-attacker-buttons">
            {battleOptions.map(option => {
              const disabled = !canControlActiveTurn || !!battleBlockReason || option.usedThisCombat;
              const title = option.usedThisCombat
                ? "This creature already battled this Combat Phase."
                : option.statusBattleSkipReason
                  ? `Click to mark this creature's battle turn complete because it ${option.statusBattleSkipReason}.`
                  : battleBlockReason || `Battle with ${option.label}`;

              return (
                <button
                  key={option.id}
                  className={option.kind === "LIMITED_SUMMON" ? "secondary-button" : undefined}
                  onClick={() => onStartManualBattle(option.id)}
                  disabled={disabled}
                  title={title}
                >
                  {option.usedThisCombat ? "Used: " : option.statusBattleSkipReason ? "Skip: " : "Battle: "}
                  {option.label}
                  <span>
                    {getCreatureStatsLine(match, option.card)}
                    {option.statusBattleSkipReason ? `  -  ${option.statusBattleSkipReason}` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {battleBlockReason && match.turn.phase === "COMBAT" && (
        <div className="warning-box compact-block-warning">
          Battle blocked: {battleBlockReason}
        </div>
      )}

      {advanceBlockReason && (
        <div className="warning-box compact-block-warning">
          Turn advancement blocked: {advanceBlockReason}
        </div>
      )}

      <div className="compact-utility-actions">
        <button className="secondary-button" onClick={onOpenSaveLoad}>
          Save / Load
        </button>

        <button className="secondary-button" onClick={onOpenMatchDetails}>
          Full State
        </button>

        <button
          className={pendingManualEffects > 0 ? "attention-button" : "secondary-button"}
          onClick={onOpenManualEffects}
        >
          Pending Effects {pendingManualEffects > 0 ? `(${pendingManualEffects})` : ""}
        </button>

        <button
          className="secondary-button"
          onClick={onOpenBattleResult}
          disabled={!match.lastBattle}
        >
          Last Battle
        </button>

        <button className="secondary-button" onClick={onOpenEventLog}>
          Event Log ({match.eventLog.length})
        </button>

        <button className="secondary-button" onClick={onOpenEffectDebug}>
          Effect Debug
        </button>
      </div>
    </section>
  );
}


