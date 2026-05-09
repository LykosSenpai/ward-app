import { useState } from "react";
import { BOARD_SLOTS, BOARD_ZONES, ZONE_ANCHORS } from "../boardPreview3dLayout";
import type { BoardObject } from "../boardPreview3dAdapter";
import type { BoardRenderEventType } from "../boardRenderContracts";
<<<<<<< ours
=======
import type { CardInstance } from "@ward/shared";
import type { AppMatchState } from "../../clientTypes";
import { MatchCardImage } from "../MatchCardImage";
>>>>>>> theirs

type Props = {
  zoomScale: number;
  setZoomScale?: (value: number) => void;
  cameraPanX: number;
  setCameraPanX?: (value: number) => void;
  cameraPanY: number;
  setCameraPanY?: (value: number) => void;

  tiltDegrees: number;
  heightScale: number;
  showAnchors: boolean;
  selectedSlotId: string | null;
  filteredBoardObjects: BoardObject[];
  resolveSlotPosition: (slotId: string, fallbackX: number, fallbackZ: number) => { xPercent: number; zPercent: number };
  onSelectSlot: (slotId: string) => void;
  onDeckSlotClick?: (slotId: string) => void;
  onPlayHandCardToSlot?: (slotId: string) => void;
  onDropHandCardToSlot?: (slotId: string, cardInstanceId: string) => void;
  onSelectPiece?: (pieceId: string) => void;
  highlightedSlotIds?: string[];
  highlightedPieceIds?: string[];
  activeEventType?: BoardRenderEventType | null;
  match: AppMatchState;
  cardByInstanceId: Map<string, CardInstance>;
  blockedReasonsBySlotId?: Record<string, string>;
};

export function BoardPreview3DTable({ zoomScale, cameraPanX, cameraPanY, tiltDegrees, heightScale, showAnchors, selectedSlotId, filteredBoardObjects, resolveSlotPosition, onSelectSlot, onDeckSlotClick, onPlayHandCardToSlot, onDropHandCardToSlot, onSelectPiece, highlightedSlotIds, match, cardByInstanceId, blockedReasonsBySlotId }: Props) {
  const highlightedSet = new Set(highlightedSlotIds ?? []);
  const [hoveredSlotId, setHoveredSlotId] = useState<string | null>(null);
  return (
    <div className="board-preview-3d__camera" style={{ transform: `translate(${cameraPanX}%, ${cameraPanY}%) scale(${zoomScale.toFixed(2)}) translateZ(0)` }}>
      <div className="board-preview-3d__table" style={{ transform: `rotateX(${tiltDegrees}deg) translateZ(-20px)` }}>
        <div className="board-preview-3d__grid" aria-hidden="true" />
        {BOARD_ZONES.map((zone) => (
          <div key={zone.id} className="board-preview-3d__zone" style={{
            left: `${zone.xPercent}%`,
            top: `${zone.zPercent}%`,
            width: `${zone.widthPercent}%`,
            height: `${zone.heightPercent}%`,
            transform: `translate(-50%, -50%) rotate(${zone.rotationDeg ?? 0}deg)`
          }}><span>{zone.label}</span></div>
        ))}
        {showAnchors ? ZONE_ANCHORS.map((zone) => (
          <div key={zone.id} className="board-preview-3d__zone-anchor" style={{ left: `${zone.xPercent}%`, top: `${zone.zPercent}%` }}>
            <span>{zone.label}</span>
          </div>
        )) : null}
        {BOARD_SLOTS.map((slot) => (
          <div
            key={slot.id}
            className={`board-preview-3d__slot board-preview-3d__slot--${slot.owner}${selectedSlotId === slot.id ? " is-selected" : ""}${highlightedSet.has(slot.id) ? " is-highlighted" : ""}${blockedReasonsBySlotId?.[slot.id] ? " is-blocked" : ""}${hoveredSlotId === slot.id ? " is-hovered" : ""}`}
            style={{
              left: `${resolveSlotPosition(slot.id, slot.xPercent, slot.zPercent).xPercent}%`,
              top: `${resolveSlotPosition(slot.id, slot.xPercent, slot.zPercent).zPercent}%`
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setHoveredSlotId(slot.id);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setHoveredSlotId(null);
              const cardInstanceId = event.dataTransfer.getData("application/x-ward-board-hand-card");
              if (cardInstanceId) {
                onDropHandCardToSlot?.(slot.id, cardInstanceId);
              }
            }}
            onDragLeave={() => setHoveredSlotId(current => current === slot.id ? null : current)}
            onMouseEnter={() => setHoveredSlotId(slot.id)}
            onMouseLeave={() => setHoveredSlotId(current => current === slot.id ? null : current)}
            title={blockedReasonsBySlotId?.[slot.id] ?? ""}
          >
            <button type="button" onClick={() => {
              onSelectSlot(slot.id);
              onPlayHandCardToSlot?.(slot.id);
              if (slot.id.endsWith("-deck")) {
                onDeckSlotClick?.(slot.id);
              }
            }}>{slot.label}</button>
            {blockedReasonsBySlotId?.[slot.id] ? <small className="board-preview-3d__slot-badge">Blocked</small> : null}
          </div>
        ))}
        <div className="board-preview-3d__depth-guide" aria-hidden="true">
          <span>Depth guide</span>
          <div>Low</div><div>Mid</div><div>High</div>
        </div>
        {filteredBoardObjects.map((object) => (
          <article
            key={object.id}
            className={`board-preview-3d__piece board-preview-3d__piece--${object.owner}`}
            style={{
              left: `${resolveSlotPosition(object.slotId, object.xPercent, object.zPercent).xPercent}%`,
              top: `${resolveSlotPosition(object.slotId, object.xPercent, object.zPercent).zPercent}%`,
              transform: `translate(-50%, -50%) translateZ(${(object.yDepth * heightScale).toFixed(1)}px)`
            }}
          >
            <button type="button" onClick={() => onSelectPiece?.(object.id)}>
              {object.cardInstanceId && cardByInstanceId.get(object.cardInstanceId) ? (
                <MatchCardImage className="board-preview-3d__piece-card-art" match={match} card={cardByInstanceId.get(object.cardInstanceId)!} />
              ) : null}
              <span>{object.label} · {object.slotId}</span>
            </button>
          </article>
        ))}

      </div>
    </div>
  );
}
