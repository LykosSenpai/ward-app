import type { BoardObject } from "../boardPreview3dAdapter";
import type { BoardSlot } from "../boardPreview3dLayout";

type Props = {
  show: boolean;
  selectedSlot: { slot: BoardSlot; occupant?: BoardObject } | null;
  selectedSlotId: string | null;
  selectedSlotIndex: number;
  slotCount: number;
  selectedOffset: { x: number; z: number };
  nudgeStep: number;
  setNudgeStep: (value: number) => void;
  onNudge: (axis: "x" | "z", delta: number) => void;
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
  selectedSlot,
  selectedSlotId,
  selectedSlotIndex,
  slotCount,
  selectedOffset,
  nudgeStep,
  setNudgeStep,
  onNudge,
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
    <section className="board-preview-3d__debug" aria-label="Board slot occupancy">
      <h4>Slot occupancy</h4>
      {selectedSlot ? <p>Selected: {selectedSlot.slot.label} ({selectedSlot.slot.xPercent}%, {selectedSlot.slot.zPercent}%) · slot {selectedSlotIndex + 1}/{slotCount} · offset ({selectedOffset.x}%, {selectedOffset.z}%)</p> : null}
      {selectedSlot ? (
        <>
          <label className="board-preview-3d__nudge-step">
            Nudge step
            <input type="range" min={0.25} max={3} step={0.25} value={nudgeStep} onChange={(event) => setNudgeStep(Number(event.target.value))} />
            <span>{nudgeStep.toFixed(2)}%</span>
          </label>
          <div className="board-preview-3d__nudge-controls">
            <button type="button" disabled={readOnly} onClick={() => onNudge("x", -1)}>←</button>
            <button type="button" disabled={readOnly} onClick={() => onNudge("z", -1)}>↑</button>
            <button type="button" disabled={readOnly} onClick={() => onNudge("z", 1)}>↓</button>
            <button type="button" disabled={readOnly} onClick={() => onNudge("x", 1)}>→</button>
          </div>
          <div className="board-preview-3d__slot-nav-controls">
            <button type="button" onClick={() => onSelectRelative(-1)}>Prev Slot</button>
            <button type="button" onClick={() => onSelectRelative(1)}>Next Slot</button>
            <button type="button" onClick={onCopySelected}>Copy Selected Slot</button>
          </div>
        </>
      ) : null}
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
