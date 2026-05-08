import type { PlayerState } from "@ward/shared";
import type { AppMatchState } from "../clientTypes";
import {
  getAdvanceBlockReason,
  getCardName,
  getCreatureStatsLine,
  getBattleBlockReason,
  getMatchStatus
} from "../gameViewHelpers";
import { PlayerPanel } from "./PlayerPanel";

type BoardActions = {
  advanceBlockReason: string;
  onShuffleAllDecks: () => void;
  onUndoLastAction: () => void;
  onDrawActivePlayer: () => void;
  onStartManualBattle: (attackerCreatureInstanceId: string) => void;
  onAdvancePhase: () => void;
  onOpenManualEffects: () => void;
  onOpenBattleResult: () => void;
  onOpenEventLog: () => void;
  onOpenDiceRoller: () => void;
};

const PHASES = ["DRAW", "SUMMON_MAGIC", "COMBAT", "SECOND_MAGIC", "END"] as const;

function getBattleLine(match: AppMatchState, player?: PlayerState): string {
  const primary = player?.field.primaryCreature;
  if (!player || !primary) return "No primary";

  return `${getCardName(match, primary)} | ${getCreatureStatsLine(match, primary)}`;
}

function getPlayerRoleLabel(player?: PlayerState, controlledPlayerId?: string): string {
  if (!player) return "Player";
  if (controlledPlayerId === player.id) return "Your Field";
  return player.id === "player_1" ? "Player One" : "Player Two";
}

function getEventLabel(type: string): string {
  return type
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getTableAlert(match: AppMatchState, actions?: BoardActions): { tone: string; label: string; detail: string } {
  if (match.pendingBattle) {
    return { tone: "battle", label: "Battle", detail: getEventLabel(match.pendingBattle.status) };
  }
  if (match.pendingChain) {
    return { tone: "chain", label: "Chain", detail: "Magic response window" };
  }
  if (match.pendingEffectTargetPrompt) {
    return { tone: "prompt", label: "Target", detail: match.pendingEffectTargetPrompt.sourceCardName };
  }
  if (match.pendingPrompt) {
    return { tone: "prompt", label: "Prompt", detail: "Reveal approval" };
  }
  const manualCount = match.manualEffectQueue.filter(effect => !effect.completed).length;
  if (manualCount > 0) {
    return { tone: "manual", label: "Effects", detail: `${manualCount} pending` };
  }
  const blockReason = actions?.advanceBlockReason || getAdvanceBlockReason(match);
  if (blockReason) {
    return { tone: "blocked", label: "Blocked", detail: blockReason };
  }
  return { tone: "ready", label: "Ready", detail: match.turn.phase.replace(/_/g, " ") };
}

function getBattleOptions(match: AppMatchState, activePlayer?: PlayerState) {
  if (!activePlayer) return [];
  const usedCreatureIds = activePlayer.turnFlags.battleUsedCreatureInstanceIds ?? [];
  const options = [
    activePlayer.field.primaryCreature && {
      id: activePlayer.field.primaryCreature.instanceId,
      label: getCardName(match, activePlayer.field.primaryCreature),
      card: activePlayer.field.primaryCreature,
      kind: "Primary"
    },
    ...activePlayer.field.limitedSummons.map(card => ({
      id: card.instanceId,
      label: getCardName(match, card),
      card,
      kind: "Limited"
    }))
  ].filter(Boolean) as Array<{ id: string; label: string; card: NonNullable<PlayerState["field"]["primaryCreature"]>; kind: string }>;

  return options.map(option => ({
    ...option,
    usedThisCombat: usedCreatureIds.includes(option.id)
  }));
}

function TableCommandDock({
  match,
  activePlayer,
  controlledPlayerId,
  actions
}: {
  match: AppMatchState;
  activePlayer?: PlayerState;
  controlledPlayerId?: string;
  actions?: BoardActions;
}) {
  if (!actions) return null;

  const matchComplete = getMatchStatus(match) === "COMPLETE";
  const pendingManualEffects = match.manualEffectQueue.filter(effect => !effect.completed).length;
  const canControlActiveTurn = !controlledPlayerId || controlledPlayerId === match.turn.activePlayerId;
  const battleBlockReason = getBattleBlockReason(match);
  const battleOptions = getBattleOptions(match, activePlayer);
  const drawDisabled =
    matchComplete ||
    !canControlActiveTurn ||
    !match.setup.decksShuffled ||
    !!match.pendingPrompt ||
    !!match.pendingBattle ||
    !!match.pendingChain ||
    !!match.pendingEffectTargetPrompt ||
    pendingManualEffects > 0 ||
    !!match.setup.handDiscardRequiredForPlayerId ||
    !!activePlayer?.turnFlags.drawnThisTurn;
  const canShuffle = canControlActiveTurn &&
    match.players.every(player => player.hand.length === 0) &&
    !match.pendingPrompt;
  const canAdvance = !matchComplete && canControlActiveTurn && !actions.advanceBlockReason;
  const lastEvent = match.eventLog.at(-1);

  return (
    <div className="table-command-dock" aria-label="Table commands">
      <div className="table-phase-track" aria-label="Phase track">
        {PHASES.map(phase => (
          <span
            key={phase}
            className={[
              "table-phase-step",
              match.turn.phase === phase ? "active" : "",
              PHASES.indexOf(phase) < PHASES.indexOf(match.turn.phase as typeof PHASES[number]) ? "passed" : ""
            ].filter(Boolean).join(" ")}
          >
            {phase.replace(/_/g, " ")}
          </span>
        ))}
      </div>

      <div className="table-primary-actions">
        <button type="button" onClick={actions.onShuffleAllDecks} disabled={!canShuffle}>Shuffle</button>
        <button type="button" onClick={actions.onUndoLastAction} disabled={matchComplete || !canControlActiveTurn}>Undo</button>
        <button type="button" onClick={actions.onDrawActivePlayer} disabled={drawDisabled}>Draw</button>
        <button type="button" onClick={actions.onAdvancePhase} disabled={!canAdvance}>Advance</button>
        <button type="button" className="secondary-button" onClick={actions.onOpenDiceRoller} disabled={matchComplete}>Dice</button>
        <button type="button" className={pendingManualEffects > 0 ? "attention-button" : "secondary-button"} onClick={actions.onOpenManualEffects}>
          Effects {pendingManualEffects > 0 ? pendingManualEffects : ""}
        </button>
      </div>

      {battleOptions.length > 0 && (
        <div className="table-battle-buttons" aria-label="Battle declarations">
          {battleOptions.map(option => {
            const disabled = !canControlActiveTurn || !!battleBlockReason || option.usedThisCombat;
            return (
              <button
                type="button"
                key={option.id}
                onClick={() => actions.onStartManualBattle(option.id)}
                disabled={disabled}
                title={battleBlockReason || `${option.kind}: ${option.label}`}
              >
                <span>{option.usedThisCombat ? "Used" : option.kind}</span>
                <strong>{option.label}</strong>
              </button>
            );
          })}
        </div>
      )}

      <div className="table-utility-strip">
        <button type="button" className="secondary-button" onClick={actions.onOpenBattleResult} disabled={!match.lastBattle}>Last Battle</button>
        <button type="button" className="secondary-button" onClick={actions.onOpenEventLog}>Log {match.eventLog.length}</button>
        {lastEvent && <span className="table-last-event">{getEventLabel(lastEvent.type)}</span>}
      </div>
    </div>
  );
}

export function CardBoardView({
  match,
  players,
  controlledPlayerId,
  actions
}: {
  match: AppMatchState;
  players: PlayerState[];
  controlledPlayerId?: string;
  actions?: BoardActions;
}) {
  const nearPlayer = players[0];
  const farPlayer = players[1] ?? players[0];
  const activePlayer = match.players.find(player => player.id === match.turn.activePlayerId);
  const matchComplete = getMatchStatus(match) === "COMPLETE";
  const tableAlert = getTableAlert(match, actions);
  const centerStatus = match.pendingBattle
    ? "Battle"
    : match.pendingChain
      ? "Chain"
      : match.pendingPrompt || match.pendingEffectTargetPrompt
        ? "Prompt"
        : matchComplete
          ? "Complete"
          : match.turn.phase.replace(/_/g, " ");

  return (
    <section className="duel-board-view" aria-label="Card board">
      {farPlayer && (
        <div className="duel-player-row duel-player-row-far">
          <div className="duel-player-rail">
            <span>{getPlayerRoleLabel(farPlayer, controlledPlayerId)}</span>
            <strong>{farPlayer.displayName}</strong>
            <small>{getBattleLine(match, farPlayer)}</small>
          </div>
          <PlayerPanel
            match={match}
            player={farPlayer}
            controlledPlayerId={controlledPlayerId}
            boardMode
            onStartManualBattle={actions?.onStartManualBattle}
          />
        </div>
      )}

      <div className="duel-center-lane" aria-label="Battle lane">
        <div className="duel-center-marker duel-center-marker-left">
          <span>{farPlayer?.field.limitedSummons.length ?? 0}/4</span>
          <small>Limited</small>
        </div>

        <div className="duel-phase-core">
          <span className={`table-alert-pill ${tableAlert.tone}`}>{tableAlert.label}</span>
          <strong>{activePlayer?.displayName ?? "Waiting"}</strong>
          <small>{centerStatus} | Turn {match.turn.turnNumber} | Cycle {match.turn.turnCycleNumber}</small>
          <em>{tableAlert.detail}</em>
        </div>

        <div className="duel-center-marker duel-center-marker-right">
          <span>{nearPlayer?.field.magicSlots.length ?? 0}/5</span>
          <small>Magic</small>
        </div>
      </div>

      <TableCommandDock
        match={match}
        activePlayer={activePlayer}
        controlledPlayerId={controlledPlayerId}
        actions={actions}
      />

      {nearPlayer && nearPlayer.id !== farPlayer?.id && (
        <div className="duel-player-row duel-player-row-near">
          <PlayerPanel
            match={match}
            player={nearPlayer}
            controlledPlayerId={controlledPlayerId}
            boardMode
            onStartManualBattle={actions?.onStartManualBattle}
          />
          <div className="duel-player-rail">
            <span>{getPlayerRoleLabel(nearPlayer, controlledPlayerId)}</span>
            <strong>{nearPlayer.displayName}</strong>
            <small>{getBattleLine(match, nearPlayer)}</small>
          </div>
        </div>
      )}
    </section>
  );
}
