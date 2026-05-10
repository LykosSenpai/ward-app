import type { BoardObject } from "../boardPreview3dAdapter";
import { BOARD_ZONES, type BoardSlot, type BoardZone } from "../boardPreview3dLayout";

export type BoardZoneAdjustment = {
  x: number;
  z: number;
  width: number;
  height: number;
};

type VisibleSlotLayers = {
  primary: boolean;
  limited: boolean;
  magic: boolean;
  stacks: boolean;
  hand: boolean;
};

type Props = {
  show: boolean;
  showZoneRects: boolean;
  setShowZoneRects: (value: boolean) => void;
  showAnchors: boolean;
  setShowAnchors: (value: boolean) => void;
  visibleSlotLayers: VisibleSlotLayers;
  setVisibleSlotLayer: (layer: keyof VisibleSlotLayers, value: boolean) => void;
  selectedSlot: { slot: BoardSlot; occupant?: BoardObject } | null;
  selectedSlotId: string | null;
  selectedSlotIndex: number;
  slotCount: number;
  selectedOffset: { x: number; z: number };
  selectedZoneId: string;
  selectedZone: BoardZone;
  selectedZoneAdjustment: BoardZoneAdjustment;
  nudgeStep: number;
  setNudgeStep: (value: number) => void;
  onNudge: (axis: "x" | "z", delta: number) => void;
  onSelectZone: (zoneId: string) => void;
  onZoneAdjust: (axis: keyof BoardZoneAdjustment, value: number) => void;
  onResetSelectedZone: () => void;
  onResetZoneAdjustments: () => void;
  onSelectRelative: (delta: number) => void;
  onCopySelected: () => void;
  onResetCamera: () => void;
  onResetOffsets: () => void;
  onResetSelectedOffset: () => void;
  onCopyLayout: () => void;
  layoutDraft: string;
  setLayoutDraft: (value: string) => void;
  layoutDraftError: string | null;
  layoutDraftIsValid: boolean;
  onApplyLayout: () => void;
  slotOccupancy: Array<{ slot: BoardSlot; occupant?: BoardObject }>;
  onSelectSlot: (slotId: string) => void;
  readOnly?: boolean;
};

export function BoardPreview3DDebugPanel({
  show,
  showZoneRects,
  setShowZoneRects,
  showAnchors,
  setShowAnchors,
  visibleSlotLayers,
  setVisibleSlotLayer,
  selectedSlot,
  selectedSlotId,
  selectedSlotIndex,
  slotCount,
  selectedOffset,
  selectedZoneId,
  selectedZone,
  selectedZoneAdjustment,
  nudgeStep,
  setNudgeStep,
  onNudge,
  onSelectZone,
  onZoneAdjust,
  onResetSelectedZone,
  onResetZoneAdjustments,
  onSelectRelative,
  onCopySelected,
  onResetCamera,
  onResetOffsets,
  onResetSelectedOffset,
  onCopyLayout,
  layoutDraft,
  setLayoutDraft,
  layoutDraftError,
  layoutDraftIsValid,
  onApplyLayout,
  slotOccupancy,
  onSelectSlot,
  readOnly = false
}: Props) {
  if (!show) return null;

  return (
    <section className="board-preview-3d__debug" aria-label="Board slot and zone editor">
      <h4>Slot occupancy</h4>
      <div className="board-preview-3d__layer-toggles" aria-label="Board visual layers">
        <label><input type="checkbox" checked={showZoneRects} onChange={(event) => setShowZoneRects(event.target.checked)} /> Zone rectangles</label>
        <label><input type="checkbox" checked={showAnchors} onChange={(event) => setShowAnchors(event.target.checked)} /> Zone anchors</label>
        <label><input type="checkbox" checked={visibleSlotLayers.primary} onChange={(event) => setVisibleSlotLayer("primary", event.target.checked)} /> Primary slots</label>
        <label><input type="checkbox" checked={visibleSlotLayers.limited} onChange={(event) => setVisibleSlotLayer("limited", event.target.checked)} /> Limited slots</label>
        <label><input type="checkbox" checked={visibleSlotLayers.magic} onChange={(event) => setVisibleSlotLayer("magic", event.target.checked)} /> Magic slots</label>
        <label><input type="checkbox" checked={visibleSlotLayers.stacks} onChange={(event) => setVisibleSlotLayer("stacks", event.target.checked)} /> Deck/Cemetery slots</label>
        <label><input type="checkbox" checked={visibleSlotLayers.hand} onChange={(event) => setVisibleSlotLayer("hand", event.target.checked)} /> Hand slots</label>
      </div>
      {selectedSlot ? (
        <p>
          Selected: {selectedSlot.slot.label} ({selectedSlot.slot.xPercent}%, {selectedSlot.slot.zPercent}%)
          {" "}slot {selectedSlotIndex + 1}/{slotCount} offset ({selectedOffset.x}%, {selectedOffset.z}%)
        </p>
      ) : null}

      {selectedSlot ? (
        <>
          <label className="board-preview-3d__nudge-step">
            Nudge step
            <input type="range" min={0.25} max={3} step={0.25} value={nudgeStep} onChange={(event) => setNudgeStep(Number(event.target.value))} />
            <span>{nudgeStep.toFixed(2)}%</span>
          </label>
          <div className="board-preview-3d__nudge-controls">
            <button type="button" disabled={readOnly} onClick={() => onNudge("x", -1)}>Left</button>
            <button type="button" disabled={readOnly} onClick={() => onNudge("z", -1)}>Up</button>
            <button type="button" disabled={readOnly} onClick={() => onNudge("z", 1)}>Down</button>
            <button type="button" disabled={readOnly} onClick={() => onNudge("x", 1)}>Right</button>
          </div>
          <div className="board-preview-3d__slot-nav-controls">
            <button type="button" onClick={() => onSelectRelative(-1)}>Prev Slot</button>
            <button type="button" onClick={() => onSelectRelative(1)}>Next Slot</button>
            <button type="button" onClick={onCopySelected}>Copy Selected Slot</button>
          </div>
        </>
      ) : null}

      <div className="board-preview-3d__zone-editor">
        <h4>Zone size</h4>
        <label>
          Zone
          <select value={selectedZoneId} onChange={(event) => onSelectZone(event.target.value)}>
            {BOARD_ZONES.map(zone => (
              <option key={zone.id} value={zone.id}>{zone.label}</option>
            ))}
          </select>
        </label>
        <p>
          {selectedZone.label}: {(selectedZone.widthPercent + selectedZoneAdjustment.width).toFixed(1)}% x{" "}
          {(selectedZone.heightPercent + selectedZoneAdjustment.height).toFixed(1)}%
        </p>
        <div className="board-preview-3d__zone-size-grid">
          <label>
            Zone width
            <input type="range" min={-30} max={30} step={0.5} value={selectedZoneAdjustment.width} disabled={readOnly} onChange={(event) => onZoneAdjust("width", Number(event.target.value))} />
            <span>{selectedZoneAdjustment.width >= 0 ? "+" : ""}{selectedZoneAdjustment.width.toFixed(1)}%</span>
          </label>
          <label>
            Zone height
            <input type="range" min={-20} max={20} step={0.5} value={selectedZoneAdjustment.height} disabled={readOnly} onChange={(event) => onZoneAdjust("height", Number(event.target.value))} />
            <span>{selectedZoneAdjustment.height >= 0 ? "+" : ""}{selectedZoneAdjustment.height.toFixed(1)}%</span>
          </label>
          <label>
            Zone X
            <input type="range" min={-20} max={20} step={0.5} value={selectedZoneAdjustment.x} disabled={readOnly} onChange={(event) => onZoneAdjust("x", Number(event.target.value))} />
            <span>{selectedZoneAdjustment.x >= 0 ? "+" : ""}{selectedZoneAdjustment.x.toFixed(1)}%</span>
          </label>
          <label>
            Zone Z
            <input type="range" min={-20} max={20} step={0.5} value={selectedZoneAdjustment.z} disabled={readOnly} onChange={(event) => onZoneAdjust("z", Number(event.target.value))} />
            <span>{selectedZoneAdjustment.z >= 0 ? "+" : ""}{selectedZoneAdjustment.z.toFixed(1)}%</span>
          </label>
        </div>
        <div className="board-preview-3d__debug-actions">
          <button type="button" disabled={readOnly} onClick={onResetSelectedZone}>Reset selected zone</button>
          <button type="button" disabled={readOnly} onClick={onResetZoneAdjustments}>Reset all zones</button>
        </div>
      </div>

      <div className="board-preview-3d__debug-actions">
        <button type="button" onClick={onResetCamera}>Reset camera</button>
        <button type="button" onClick={onResetOffsets} disabled={readOnly}>Reset slot offsets</button>
        <button type="button" onClick={onResetSelectedOffset} disabled={readOnly || !selectedSlotId}>Reset selected slot</button>
        <button type="button" onClick={onCopyLayout}>Copy layout JSON</button>
      </div>
      <label className="board-preview-3d__layout-draft">
        {layoutDraftError ? <span className="board-preview-3d__layout-draft-error">{layoutDraftError}</span> : null}
        Layout JSON
        <textarea value={layoutDraft} onChange={(event) => setLayoutDraft(event.target.value)} rows={5} readOnly={readOnly} />
        <button type="button" disabled={readOnly || !layoutDraftIsValid} onClick={onApplyLayout}>Apply layout JSON</button>
      </label>
      <ul>
        {slotOccupancy.map(({ slot, occupant }) => (
          <li key={`debug-${slot.id}`} className={selectedSlotId === slot.id ? "is-selected" : undefined} onClick={() => onSelectSlot(slot.id)}>
            <strong>{slot.label}</strong>
            <span>{occupant ? occupant.label : "Empty"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
