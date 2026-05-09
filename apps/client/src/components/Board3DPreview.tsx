import type { CSSProperties } from "react";
import type { CardInstance, PlayerState } from "@ward/shared";
import type { AppMatchState } from "../clientTypes";
import { getCardName, getCreatureStatsLine } from "../gameViewHelpers";
import { MatchCardImage } from "./MatchCardImage";

type CameraMode = "table" | "near" | "far";

type Board3DPreviewProps = {
  match: AppMatchState;
  controlledPlayerId?: string;
  cameraMode: CameraMode;
  onCameraModeChange: (mode: CameraMode) => void;
};

const CAMERA_MODES: Array<{ mode: CameraMode; label: string }> = [
  { mode: "table", label: "Table" },
  { mode: "near", label: "Near" },
  { mode: "far", label: "Far" }
];

function cardTone(match: AppMatchState, card?: CardInstance): string {
  if (!card) return "empty";
  return match.cardCatalog[card.cardId]?.cardType === "MAGIC" ? "magic" : "creature";
}

function Mini3DCard({
  match,
  card,
  label,
  raised = false
}: {
  match: AppMatchState;
  card?: CardInstance;
  label: string;
  raised?: boolean;
}) {
  const definition = card ? match.cardCatalog[card.cardId] : undefined;
  const title = card ? getCardName(match, card) : label;
  const stats = card && definition?.cardType === "CREATURE" ? getCreatureStatsLine(match, card) : definition?.cardType ?? "Open";

  return (
    <div className={["board3d-card", cardTone(match, card), raised ? "raised" : ""].filter(Boolean).join(" ")}>
      <span className="board3d-zone-label">{label}</span>
      {card ? (
        <>
          <MatchCardImage match={match} card={card} />
          <strong>{title}</strong>
          <small>{stats}</small>
        </>
      ) : (
        <em>Open slot</em>
      )}
    </div>
  );
}

function Stack3D({
  label,
  count,
  tone
}: {
  label: string;
  count: number;
  tone: "deck" | "cemetery";
}) {
  return (
    <div className={`board3d-stack ${tone}`}>
      <span>{label}</span>
      <strong>{count}</strong>
      <small>{tone === "deck" ? "cards" : "HP pile"}</small>
    </div>
  );
}

function Player3DField({
  match,
  player,
  controlledPlayerId,
  side
}: {
  match: AppMatchState;
  player: PlayerState;
  controlledPlayerId?: string;
  side: "near" | "far";
}) {
  const isControlled = player.id === controlledPlayerId;
  const limitedSummons = [
    player.field.limitedSummons[0],
    player.field.limitedSummons[1],
    undefined,
    undefined
  ];
  const magicSlots = [
    player.field.magicSlots[0],
    player.field.magicSlots[1],
    player.field.magicSlots[2],
    player.field.magicSlots[3],
    player.field.magicSlots[4]
  ];

  return (
    <section className={`board3d-player board3d-player-${side}`} aria-label={`${player.displayName} 3D field`}>
      <div className="board3d-player-nameplate">
        <span>{isControlled ? "Your field" : "Opponent field"}</span>
        <strong>{player.displayName}</strong>
        <small>{player.field.primaryCreature ? getCreatureStatsLine(match, player.field.primaryCreature) : "No primary"}</small>
      </div>

      <div className="board3d-row board3d-magic-row">
        {magicSlots.map((card, index) => (
          <Mini3DCard key={`magic-${index}`} match={match} card={card} label={`Magic ${index + 1}`} />
        ))}
      </div>

      <div className="board3d-row board3d-creature-row">
        <Mini3DCard match={match} card={limitedSummons[0]} label="Limited" />
        <Mini3DCard match={match} card={limitedSummons[1]} label="Limited" />
        <Mini3DCard match={match} card={player.field.primaryCreature} label="Primary" raised />
        <Mini3DCard match={match} card={limitedSummons[2]} label="Limited" />
        <Mini3DCard match={match} card={limitedSummons[3]} label="Limited" />
      </div>

      <div className="board3d-stack-row">
        <Stack3D label="Deck" count={player.deck.length} tone="deck" />
        <div className={`board3d-hand ${isControlled ? "revealed" : ""}`}>
          <span>{isControlled ? "Hand" : "Opponent hand"}</span>
          <strong>{player.hand.length}</strong>
          <small>{isControlled ? "visible" : "cards"}</small>
          {isControlled && (
            <div className="board3d-hand-fan" aria-hidden="true">
              {player.hand.slice(0, 4).map((card, index) => (
                <div
                  key={card.instanceId}
                  className="board3d-hand-card"
                  style={{ "--fan-index": String(index) } as CSSProperties}
                >
                  <MatchCardImage match={match} card={card} />
                </div>
              ))}
            </div>
          )}
        </div>
        <Stack3D label="Cemetery" count={player.cemetery.length} tone="cemetery" />
      </div>
    </section>
  );
}

export function Board3DPreview({
  match,
  controlledPlayerId,
  cameraMode,
  onCameraModeChange
}: Board3DPreviewProps) {
  const nearPlayer = match.players[0];
  const farPlayer = match.players[1] ?? match.players[0];
  const activePlayer = match.players.find(player => player.id === match.turn.activePlayerId);

  return (
    <section className={`board3d-shell camera-${cameraMode}`} aria-label="3D board preview">
      <div className="board3d-toolbar">
        <div>
          <span>3D Preview</span>
          <strong>{activePlayer?.displayName ?? "Waiting"}</strong>
          <small>{match.turn.phase.replace(/_/g, " ")} | Turn {match.turn.turnNumber}</small>
        </div>
        <div className="board3d-camera-toggle" aria-label="Camera controls">
          {CAMERA_MODES.map(option => (
            <button
              type="button"
              key={option.mode}
              className={cameraMode === option.mode ? "active" : ""}
              onClick={() => onCameraModeChange(option.mode)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="board3d-viewport">
        <div className="board3d-scene">
          <div className="board3d-table">
            <div className="board3d-table-glow" />
            {farPlayer && (
              <Player3DField
                match={match}
                player={farPlayer}
                controlledPlayerId={controlledPlayerId}
                side="far"
              />
            )}
            <div className="board3d-center-line">
              <span>Battle Lane</span>
              <strong>{match.turn.phase.replace(/_/g, " ")}</strong>
            </div>
            {nearPlayer && (
              <Player3DField
                match={match}
                player={nearPlayer}
                controlledPlayerId={controlledPlayerId}
                side="near"
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
