import { BOARD_SLOTS, BOARD_ZONES, ZONE_ANCHORS } from "../boardPreview3dLayout";
import type { BoardObject } from "../boardPreview3dAdapter";

type Props = {
  zoomScale: number;
  cameraPanX: number;
  cameraPanY: number;

  tiltDegrees: number;
  heightScale: number;
  showAnchors: boolean;
  selectedSlotId: string | null;
  filteredBoardObjects: BoardObject[];
  resolveSlotPosition: (slotId: string, fallbackX: number, fallbackZ: number) => { xPercent: number; zPercent: number };
  onSelectSlot: (slotId: string) => void;
  onSelectPiece?: (pieceId: string) => void;
  highlightedSlotIds?: string[];
  highlightedPieceIds?: string[];
  activeEventType?: BoardRenderEventType | null;
};

export function BoardPreview3DTable({ zoomScale, cameraPanX, cameraPanY, tiltDegrees, heightScale, showAnchors, selectedSlotId, filteredBoardObjects, resolveSlotPosition, onSelectSlot, onSelectPiece }: Props) {
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
            className={`board-preview-3d__slot board-preview-3d__slot--${slot.owner}${selectedSlotId === slot.id ? " is-selected" : ""}`}
            style={{
              left: `${resolveSlotPosition(slot.id, slot.xPercent, slot.zPercent).xPercent}%`,
              top: `${resolveSlotPosition(slot.id, slot.xPercent, slot.zPercent).zPercent}%`
            }}
          >
            <button type="button" onClick={() => onSelectSlot(slot.id)}>{slot.label}</button>
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
            <button type="button" onClick={() => onSelectPiece?.(object.id)}>{object.label} · {object.slotId}</button>
          </article>
        ))}

      </div>
    </div>
  );
}
