import { BOARD_SLOTS, BOARD_ZONES, ZONE_ANCHORS } from "../boardPreview3dLayout";
import type { BoardObject } from "../boardPreview3dAdapter";

type Props = {
  showAnchors: boolean;
  selectedSlotId: string | null;
  filteredBoardObjects: BoardObject[];
  resolveSlotPosition: (slotId: string, fallbackX: number, fallbackZ: number) => { xPercent: number; zPercent: number };
  onSelectSlot: (slotId: string) => void;
  onSelectPiece?: (pieceId: string) => void;
};

export function BoardPreview3DMiniMap({ showAnchors, selectedSlotId, filteredBoardObjects, resolveSlotPosition, onSelectSlot, onSelectPiece }: Props) {
  return (
    <aside className="board-preview-3d__mini" aria-label="Condensed 2D board map">
      <div className="board-preview-3d__mini-grid" aria-hidden="true" />
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
        <div key={`mini-zone-${zone.id}`} className="board-preview-3d__mini-zone" style={{ left: `${zone.xPercent}%`, top: `${zone.zPercent}%` }}>
          {zone.label}
        </div>
      )) : null}
      {BOARD_SLOTS.map((slot) => (
        <div
          key={`mini-slot-${slot.id}`}
          className={`board-preview-3d__mini-slot board-preview-3d__mini-slot--${slot.owner}${selectedSlotId === slot.id ? " is-selected" : ""}`}
          style={{
            left: `${resolveSlotPosition(slot.id, slot.xPercent, slot.zPercent).xPercent}%`,
            top: `${resolveSlotPosition(slot.id, slot.xPercent, slot.zPercent).zPercent}%`
          }}
          title={slot.label}
          onClick={() => onSelectSlot(slot.id)}
        />
      ))}
      {filteredBoardObjects.map((object) => (
        <div
          key={`mini-${object.id}`}
          className={`board-preview-3d__mini-piece board-preview-3d__mini-piece--${object.owner}`}
          style={{
            left: `${resolveSlotPosition(object.slotId, object.xPercent, object.zPercent).xPercent}%`,
            top: `${resolveSlotPosition(object.slotId, object.xPercent, object.zPercent).zPercent}%`
          }}
          title={object.label}
        >
          <button type="button" onClick={() => onSelectPiece?.(object.id)}>
            {object.lane.slice(0, 1).toUpperCase()}
          </button>
        </div>
      ))}
    </aside>
  );
}
