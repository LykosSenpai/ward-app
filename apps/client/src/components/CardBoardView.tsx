import type { PlayerState } from "@ward/shared";
import type { AppMatchState } from "../clientTypes";
import {
  getCardName,
  getCreatureStatsLine,
  getMatchStatus
} from "../gameViewHelpers";
import { PlayerPanel } from "./PlayerPanel";

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

export function CardBoardView({
  match,
  players,
  controlledPlayerId
}: {
  match: AppMatchState;
  players: PlayerState[];
  controlledPlayerId?: string;
}) {
  const nearPlayer = players[0];
  const farPlayer = players[1] ?? players[0];
  const activePlayer = match.players.find(player => player.id === match.turn.activePlayerId);
  const matchComplete = getMatchStatus(match) === "COMPLETE";
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
          <PlayerPanel match={match} player={farPlayer} controlledPlayerId={controlledPlayerId} boardMode />
        </div>
      )}

      <div className="duel-center-lane" aria-label="Battle lane">
        <div className="duel-center-marker duel-center-marker-left">
          <span>{farPlayer?.field.limitedSummons.length ?? 0}/4</span>
          <small>Limited</small>
        </div>

        <div className="duel-phase-core">
          <span>{centerStatus}</span>
          <strong>{activePlayer?.displayName ?? "Waiting"}</strong>
          <small>Turn {match.turn.currentTurnIndex + 1}</small>
        </div>

        <div className="duel-center-marker duel-center-marker-right">
          <span>{nearPlayer?.field.magicSlots.length ?? 0}/5</span>
          <small>Magic</small>
        </div>
      </div>

      {nearPlayer && nearPlayer.id !== farPlayer?.id && (
        <div className="duel-player-row duel-player-row-near">
          <PlayerPanel match={match} player={nearPlayer} controlledPlayerId={controlledPlayerId} boardMode />
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
