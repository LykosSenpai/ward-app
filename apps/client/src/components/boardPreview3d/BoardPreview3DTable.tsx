import { useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { BOARD_SLOTS, ZONE_ANCHORS } from "../boardPreview3dLayout";
import type { BoardObject } from "../boardPreview3dAdapter";

const MIN_ZOOM_SCALE = 0.5;
const MAX_ZOOM_SCALE = 2.2;

type Props = {
  zoomScale: number;
  setZoomScale: (value: number) => void;
  cameraPanX: number;
  setCameraPanX: (value: number) => void;
  cameraPanY: number;
  setCameraPanY: (value: number) => void;
  tiltDegrees: number;
  heightScale: number;
  showAnchors: boolean;
  selectedSlotId: string | null;
  filteredBoardObjects: BoardObject[];
  resolveSlotPosition: (slotId: string, fallbackX: number, fallbackZ: number) => { xPercent: number; zPercent: number };
  onSelectSlot: (slotId: string) => void;
  onSelectPiece?: (pieceId: string) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function shouldIgnoreCameraDrag(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("button, input, select, textarea, [role='button']"));
}

export function BoardPreview3DTable({
  zoomScale,
  setZoomScale,
  cameraPanX,
  setCameraPanX,
  cameraPanY,
  setCameraPanY,
  tiltDegrees,
  heightScale,
  showAnchors,
  selectedSlotId,
  filteredBoardObjects,
  resolveSlotPosition,
  onSelectSlot,
  onSelectPiece
}: Props) {
  const cameraRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey) return;
    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.92 : 1.08;
    setZoomScale(Number(clamp(zoomScale * factor, MIN_ZOOM_SCALE, MAX_ZOOM_SCALE).toFixed(2)));
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || shouldIgnoreCameraDrag(event.target)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: cameraPanX,
      panY: cameraPanY
    };
    setIsPanning(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const camera = cameraRef.current;
    if (!drag || !camera || drag.pointerId !== event.pointerId) return;

    const rect = camera.getBoundingClientRect();
    setCameraPanX(Number(clamp(drag.panX + ((event.clientX - drag.x) / rect.width) * 100, -60, 60).toFixed(1)));
    setCameraPanY(Number(clamp(drag.panY + ((event.clientY - drag.y) / rect.height) * 100, -60, 60).toFixed(1)));
  };

  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={cameraRef}
      className={`board-preview-3d__camera${isPanning ? " is-panning" : ""}`}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      <div className="board-preview-3d__camera-stage" style={{ transform: `translate(${cameraPanX}%, ${cameraPanY}%) scale(${zoomScale})` }}>
        <div className="board-preview-3d__table" style={{ transform: `rotateX(${tiltDegrees}deg) translateZ(-20px)` }}>
          <div className="board-preview-3d__grid" aria-hidden="true" />
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
              <button type="button" onClick={() => onSelectPiece?.(object.id)}>{object.label} | {object.slotId}</button>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
