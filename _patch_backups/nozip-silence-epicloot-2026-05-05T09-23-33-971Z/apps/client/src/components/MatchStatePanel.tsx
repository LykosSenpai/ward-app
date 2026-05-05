import type { AppMatchState } from "../clientTypes";
import {
  getActivePlayerName,
  getLoserName,
  getMatchStatus,
  getWinnerName
} from "../gameViewHelpers";

type MatchStatePanelProps = {
  match: AppMatchState;
  advanceBlockReason: string;
  onShuffleAllDecks: () => void;
  onUndoLastAction: () => void;
  onDrawActivePlayer: () => void;
  onBattlePrimaryCreatures: () => void;
  onAdvancePhase: () => void;
};

export function MatchStatePanel({
  match,
  advanceBlockReason,
  onShuffleAllDecks,
  onUndoLastAction,
  onDrawActivePlayer,
  onBattlePrimaryCreatures,
  onAdvancePhase
}: MatchStatePanelProps) {
  return (
    <section className="card">
      <h2>Match State</h2>

      <div className="grid">
        <div>
          <span className="label">Match Status</span>
          <strong>{getMatchStatus(match)}</strong>
        </div>

        <div>
          <span className="label">Winner</span>
          <strong>{getWinnerName(match)}</strong>
        </div>

        <div>
          <span className="label">Loser</span>
          <strong>{getLoserName(match)}</strong>
        </div>

        <div>
          <span className="label">Completion Reason</span>
          <strong>{match.completionReason ?? "None"}</strong>
        </div>

        <div>
          <span className="label">Match ID</span>
          <strong>{match.matchId}</strong>
        </div>

        <div>
          <span className="label">Format</span>
          <strong>{match.format}</strong>
        </div>

        <div>
          <span className="label">Turn Number</span>
          <strong>{match.turn.turnNumber}</strong>
        </div>

        <div>
          <span className="label">Turn Cycle</span>
          <strong>{match.turn.turnCycleNumber}</strong>
        </div>

        <div>
          <span className="label">Active Player</span>
          <strong>{getActivePlayerName(match)}</strong>
        </div>

        <div>
          <span className="label">Current Phase</span>
          <strong>{match.turn.phase}</strong>
        </div>

        <div>
          <span className="label">First Turn Cycle Complete</span>
          <strong>{match.turn.firstTurnCycleComplete ? "Yes" : "No"}</strong>
        </div>

        <div>
          <span className="label">Cemetery HP Limit</span>
          <strong>{match.settings.cemeteryHpLimit}</strong>
        </div>

        <div>
          <span className="label">No-Atk Status Battle Policy</span>
          <strong>
            {match.settings.cannotInflictAttackDamageBattlePolicy === "DAMAGE_ONLY"
              ? "Allow battle, damage = 0"
              : "Skip battle turn"}
          </strong>
        </div>
      </div>

      <div className="setup-status">
        <div>
          <span className="label">Decks Shuffled</span>
          <strong>{match.setup.decksShuffled ? "Yes" : "No"}</strong>
        </div>

        <div>
          <span className="label">Player 1 First Draw</span>
          <strong>{match.setup.firstTurnDrawsByPlayer.player_1 ? "Done" : "Not Done"}</strong>
        </div>

        <div>
          <span className="label">Player 2 First Draw</span>
          <strong>{match.setup.firstTurnDrawsByPlayer.player_2 ? "Done" : "Not Done"}</strong>
        </div>
      </div>

      {advanceBlockReason && (
        <div className="warning-box">
          Turn advancement blocked: {advanceBlockReason}
        </div>
      )}

      <div className="actions">
        <button
          onClick={onShuffleAllDecks}
          disabled={match.players.some(player => player.hand.length > 0) || !!match.pendingPrompt}
        >
          Shuffle Both Decks
        </button>

        <button
          onClick={onUndoLastAction}
          disabled={getMatchStatus(match) === "COMPLETE"}
        >
          Undo Last Action
        </button>

        <button
          onClick={onDrawActivePlayer}
          disabled={
            getMatchStatus(match) === "COMPLETE" ||
            !match.setup.decksShuffled ||
            !!match.pendingPrompt ||
            !!match.pendingChain ||
            !!match.pendingEffectTargetPrompt ||
            match.manualEffectQueue.some(effect => !effect.completed) ||
            !!match.setup.handDiscardRequiredForPlayerId ||
            !!match.players.find(
              player =>
                player.id === match.turn.activePlayerId &&
                player.turnFlags.drawnThisTurn
            )
          }
        >
          Draw For Current Turn
        </button>

        <button
          onClick={onBattlePrimaryCreatures}
          disabled={
            getMatchStatus(match) === "COMPLETE" ||
            match.turn.phase !== "COMBAT" ||
            !match.turn.firstTurnCycleComplete ||
            !!match.pendingPrompt ||
            !!match.pendingChain ||
            !!match.pendingEffectTargetPrompt ||
            match.manualEffectQueue.some(effect => !effect.completed) ||
            !!match.setup.handDiscardRequiredForPlayerId ||
            !!match.setup.primaryReplacementRequiredForPlayerId ||
            !!match.players.find(
              player =>
                player.id === match.turn.activePlayerId &&
                player.turnFlags.hasBattledThisCombat
            )
          }
        >
          Battle Primary Creatures
        </button>

        <button
          onClick={onAdvancePhase}
          disabled={getMatchStatus(match) === "COMPLETE" || !!advanceBlockReason}
        >
          Advance Phase
        </button>
      </div>
    </section>
  );
}
