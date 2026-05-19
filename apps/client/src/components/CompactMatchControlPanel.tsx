import type { AppMatchState } from "../clientTypes";
import {
  getActivePlayerName,
  getBattleBlockReason,
  getCreatureStatsLine,
  getMatchStatus,
  getPlayerBattleCreatureOptions,
  getWinnerName
} from "../gameViewHelpers";
import type { GameplayKeybindings } from "../keybindings";
import { GameplayKeybindingLabel } from "./GameplayKeybindingHint";

function getOpeningRollViewState(match: AppMatchState) {
  if (match.setup.openingRoll) return match.setup.openingRoll;

  const noOpeningCardsDrawn =
    match.players.every(player => player.hand.length === 0) &&
    match.players.every(player => !match.setup.firstTurnDrawsByPlayer[player.id]);
  const appearsToBeFreshOpening =
    match.status !== "COMPLETE" &&
    noOpeningCardsDrawn &&
    match.turn.turnNumber === 1 &&
    match.turn.phase === "DRAW";

  if (!appearsToBeFreshOpening) return null;

  return {
    status: "AWAITING_ROLL" as const,
    round: 1,
    rolls: Object.fromEntries(match.players.map(player => [player.id, undefined])) as Record<string, number | undefined>
  };
}

type CompactMatchControlPanelProps = {
  match: AppMatchState;
  advanceBlockReason: string;
  controlledPlayerId?: string;
  gameplayKeybindings?: GameplayKeybindings;
  onOpeningRoll: (playerId: string) => void;
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
  onOpenEffectDebug?: () => void;
  onOpenDiceRoller: () => void;
};

export function CompactMatchControlPanel({
  match,
  advanceBlockReason,
  controlledPlayerId,
  gameplayKeybindings,
  onOpeningRoll,
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
  const openingRoll = getOpeningRollViewState(match);
  const openingRollComplete = !openingRoll || openingRoll.status === "COMPLETE";
  const controlledPlayer = controlledPlayerId ? match.players.find(player => player.id === controlledPlayerId) : null;
  const rollPlayer = controlledPlayer ?? match.players.find(player => openingRoll?.rolls[player.id] === undefined) ?? match.players[0];
  const canRollOpening =
    canUseMatchActions &&
    Boolean(openingRoll) &&
    !openingRollComplete &&
    Boolean(rollPlayer) &&
    (!controlledPlayerId || controlledPlayerId === rollPlayer.id) &&
    openingRoll?.rolls[rollPlayer.id] === undefined;
  const battleBlockReason = getBattleBlockReason(match);
  const activePlayer = match.players.find(player => player.id === match.turn.activePlayerId);
  const battleOptions = activePlayer
    ? getPlayerBattleCreatureOptions(match, activePlayer)
    : [];

  const drawDisabled =
    !canUseMatchActions ||
    !canControlActiveTurn ||
    !openingRollComplete ||
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
            {openingRoll && (
              <span className={openingRollComplete ? "match-chip match-chip-success" : "match-chip"}>
                First Roll: {openingRollComplete ? "Done" : `Round ${openingRoll.round}`}
              </span>
            )}
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
            disabled={match.setup.decksShuffled || !openingRollComplete || !canControlActiveTurn || match.players.some(player => player.hand.length > 0) || !!match.pendingPrompt}
          >
            {match.setup.decksShuffled ? "Decks Shuffled" : "Shuffle Both"}
          </button>

          <button onClick={() => rollPlayer && onOpeningRoll(rollPlayer.id)} disabled={!canRollOpening}>
            <GameplayKeybindingLabel action="rollBoardDice" keybindings={gameplayKeybindings}>
              Roll First
            </GameplayKeybindingLabel>
          </button>

          <button onClick={onUndoLastAction} disabled={!canUseMatchActions || !canControlActiveTurn}>
            <GameplayKeybindingLabel action="undoLastAction" keybindings={gameplayKeybindings}>
              Undo
            </GameplayKeybindingLabel>
          </button>

          <button onClick={onDrawActivePlayer} disabled={drawDisabled}>
            <GameplayKeybindingLabel action="drawCards" keybindings={gameplayKeybindings}>
              Draw
            </GameplayKeybindingLabel>
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
            <GameplayKeybindingLabel action="advancePhase" keybindings={gameplayKeybindings}>
              Advance Phase
            </GameplayKeybindingLabel>
          </button>
        </div>
      </div>

      {battleOptions.length > 0 && (
        <div className="battle-control-strip">
          <div>
            <span className="label">Manual Battle Control</span>
            <p>
              Choose the active creature to open the step-by-step battle resolver. Card effects can grant extra battles.
            </p>
          </div>

          <div className="battle-attacker-buttons">
            {battleOptions.map(option => {
              const disabled = !canControlActiveTurn || !!battleBlockReason || option.usedThisCombat;
              const usageLabel = option.battleUseLimit > 1
                ? ` ${Math.min(option.battleUseCount + 1, option.battleUseLimit)}/${option.battleUseLimit}`
                : "";
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
                  {option.usedThisCombat ? "Used: " : option.statusBattleSkipReason ? "Skip: " : `Battle${usageLabel}: `}
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
          <GameplayKeybindingLabel action="openSaveLoad" keybindings={gameplayKeybindings}>
            Save / Load
          </GameplayKeybindingLabel>
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
          <GameplayKeybindingLabel action="openEventLog" keybindings={gameplayKeybindings}>
            Event Log ({match.eventLog.length})
          </GameplayKeybindingLabel>
        </button>

        {onOpenEffectDebug && (
          <button className="secondary-button" onClick={onOpenEffectDebug}>
            Effect Debug
          </button>
        )}
      </div>
    </section>
  );
}


