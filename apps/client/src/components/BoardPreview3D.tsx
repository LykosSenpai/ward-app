import { useEffect, useMemo, useState, type KeyboardEventHandler } from "react";
import type { AppMatchState } from "../clientTypes";
import { BOARD_SLOTS } from "./boardPreview3dLayout";
import { BoardPreview3DControls } from "./boardPreview3d/BoardPreview3DControls";
import { BoardPreview3DDebugPanel } from "./boardPreview3d/BoardPreview3DDebugPanel";
import { BoardPreview3DMiniMap } from "./boardPreview3d/BoardPreview3DMiniMap";
import { BoardPreview3DTable } from "./boardPreview3d/BoardPreview3DTable";
import { buildBoardObjects, parseLayoutSnapshotJson, resolveSlotPosition, toLayoutSnapshot } from "./boardPreview3dAdapter";
import type { BoardPieceFocusEvent, BoardSlotFocusEvent, BoardSlotId, BoardSlotOffsetMap } from "./boardPreview3dTypes";

const BOARD_PREVIEW_STORAGE_KEY = "ward.boardPreview3D.settings";
<<<<<<< ours
const BOARD_PREVIEW_STORAGE_VERSION = 3;
=======
const BOARD_PREVIEW_STORAGE_VERSION = 2;
>>>>>>> theirs

type BoardPreview3DProps = {
  match: AppMatchState;
  adminView?: boolean;
<<<<<<< ours
  presentation?: "lab" | "game";
  defaultIntegrationMode?: boolean;
=======
>>>>>>> theirs
  onSlotFocus?: (event: BoardSlotFocusEvent) => void;
  onPieceFocus?: (event: BoardPieceFocusEvent) => void;
};

<<<<<<< ours
export function BoardPreview3D({
  match,
  adminView = false,
  presentation = "lab",
  defaultIntegrationMode = false,
  onSlotFocus,
  onPieceFocus
}: BoardPreview3DProps) {
  const boardObjects = useMemo(() => buildBoardObjects(match), [match]);
  const storageKey = presentation === "game" ? `${BOARD_PREVIEW_STORAGE_KEY}.game` : BOARD_PREVIEW_STORAGE_KEY;
=======
export function BoardPreview3D({ match, adminView = false, onSlotFocus, onPieceFocus }: BoardPreview3DProps) {
  const boardObjects = useMemo(() => buildBoardObjects(match), [match]);
>>>>>>> theirs
  const [tiltDegrees, setTiltDegrees] = useState(60);
  const [zoomScale, setZoomScale] = useState(1);
  const [heightScale, setHeightScale] = useState(1);
  const [boardScaleX, setBoardScaleX] = useState(1);
  const [boardScaleZ, setBoardScaleZ] = useState(1);
  const [boardOffsetX, setBoardOffsetX] = useState(0);
  const [boardOffsetZ, setBoardOffsetZ] = useState(0);
  const [cameraPanX, setCameraPanX] = useState(0);
  const [cameraPanY, setCameraPanY] = useState(0);
<<<<<<< ours
  const [showDebugPanel, setShowDebugPanel] = useState(() =>
    presentation === "game" ? false : (globalThis.innerHeight ? globalThis.innerHeight > 980 : true)
  );
=======
  const [showDebugPanel, setShowDebugPanel] = useState(() => (globalThis.innerHeight ? globalThis.innerHeight > 980 : true));
>>>>>>> theirs
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>("player_1-primary");
  const [slotOffsets, setSlotOffsets] = useState<BoardSlotOffsetMap>({});
  const [nudgeStep, setNudgeStep] = useState(1);
  const [showAnchors, setShowAnchors] = useState(true);
  const [layoutDraft, setLayoutDraft] = useState("");
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [layoutDraftError, setLayoutDraftError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [lastCopiedLabel, setLastCopiedLabel] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<"all" | "player_1" | "player_2">("all");
<<<<<<< ours
  const [integrationMode, setIntegrationMode] = useState(defaultIntegrationMode);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = globalThis.localStorage?.getItem(storageKey);
=======
  const [integrationMode, setIntegrationMode] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = globalThis.localStorage?.getItem(BOARD_PREVIEW_STORAGE_KEY);
>>>>>>> theirs
    if (!saved) {
      setHydrated(true);
      return;
    }

    try {
      const parsedRaw = JSON.parse(saved) as Record<string, unknown>;
      const parsed = (typeof parsedRaw.version === "number"
        ? parsedRaw
        : { version: 1, ...parsedRaw }) as {
        version: number;
        tiltDegrees?: number;
        zoomScale?: number;
        heightScale?: number;
        boardScaleX?: number;
        boardScaleZ?: number;
        boardOffsetX?: number;
        boardOffsetZ?: number;
        cameraPanX?: number;
        cameraPanY?: number;
        showDebugPanel?: boolean;
        selectedSlotId?: string | null;
        slotOffsets?: BoardSlotOffsetMap;
        nudgeStep?: number;
        showAnchors?: boolean;
        ownerFilter?: "all" | "player_1" | "player_2";
        showDiagnostics?: boolean;
        integrationMode?: boolean;
      };
      if (typeof parsed.tiltDegrees === "number") setTiltDegrees(parsed.tiltDegrees);
      if (typeof parsed.zoomScale === "number") setZoomScale(parsed.zoomScale);
      if (typeof parsed.heightScale === "number") setHeightScale(parsed.heightScale);
      if (typeof parsed.boardScaleX === "number") setBoardScaleX(parsed.boardScaleX);
      if (typeof parsed.boardScaleZ === "number") setBoardScaleZ(parsed.boardScaleZ);
      if (typeof parsed.boardOffsetX === "number") setBoardOffsetX(parsed.boardOffsetX);
      if (typeof parsed.boardOffsetZ === "number") setBoardOffsetZ(parsed.boardOffsetZ);
      if (typeof parsed.cameraPanX === "number") setCameraPanX(parsed.cameraPanX);
      if (typeof parsed.cameraPanY === "number") setCameraPanY(parsed.cameraPanY);
<<<<<<< ours
      if (typeof parsed.showDebugPanel === "boolean") setShowDebugPanel(presentation === "game" ? false : parsed.showDebugPanel);
=======
      if (typeof parsed.showDebugPanel === "boolean") setShowDebugPanel(parsed.showDebugPanel);
>>>>>>> theirs
      if (typeof parsed.selectedSlotId === "string" || parsed.selectedSlotId === null) setSelectedSlotId(parsed.selectedSlotId);
      if (parsed.slotOffsets) setSlotOffsets(parsed.slotOffsets);
      if (typeof parsed.nudgeStep === "number") setNudgeStep(parsed.nudgeStep);
      if (typeof parsed.showAnchors === "boolean") setShowAnchors(parsed.showAnchors);
      if (parsed.ownerFilter === "all" || parsed.ownerFilter === "player_1" || parsed.ownerFilter === "player_2") setOwnerFilter(parsed.ownerFilter);
      if (typeof parsed.showDiagnostics === "boolean") setShowDiagnostics(parsed.showDiagnostics);
<<<<<<< ours
      if (typeof parsed.integrationMode === "boolean") setIntegrationMode(defaultIntegrationMode || parsed.integrationMode);

      if (parsed.version < BOARD_PREVIEW_STORAGE_VERSION) {
        globalThis.localStorage?.setItem(
          storageKey,
=======
      if (typeof parsed.integrationMode === "boolean") setIntegrationMode(parsed.integrationMode);

      if (parsed.version < BOARD_PREVIEW_STORAGE_VERSION) {
        globalThis.localStorage?.setItem(
          BOARD_PREVIEW_STORAGE_KEY,
>>>>>>> theirs
          JSON.stringify({ ...parsed, version: BOARD_PREVIEW_STORAGE_VERSION, showDiagnostics: false })
        );
      }
    } catch {
      // ignore malformed saved settings
    } finally {
      setHydrated(true);
    }
<<<<<<< ours
  }, [defaultIntegrationMode, presentation, storageKey]);
=======
  }, []);
>>>>>>> theirs

  useEffect(() => {
    if (!hydrated) return;
    globalThis.localStorage?.setItem(
<<<<<<< ours
      storageKey,
      JSON.stringify({ version: BOARD_PREVIEW_STORAGE_VERSION, tiltDegrees, zoomScale, heightScale, boardScaleX, boardScaleZ, boardOffsetX, boardOffsetZ, cameraPanX, cameraPanY, showDebugPanel, selectedSlotId, slotOffsets, nudgeStep, showAnchors, ownerFilter, showDiagnostics, integrationMode })
    );
  }, [boardOffsetX, boardOffsetZ, boardScaleX, boardScaleZ, cameraPanX, cameraPanY, heightScale, hydrated, integrationMode, nudgeStep, ownerFilter, selectedSlotId, showAnchors, showDebugPanel, showDiagnostics, slotOffsets, storageKey, tiltDegrees, zoomScale]);
=======
      "ward.boardPreview3D.settings",
      JSON.stringify({ tiltDegrees, zoomScale, heightScale, boardScaleX, boardScaleZ, boardOffsetX, boardOffsetZ, cameraPanX, cameraPanY, showDebugPanel, selectedSlotId, slotOffsets, nudgeStep, showAnchors, ownerFilter, showDiagnostics, integrationMode })
    );
  }, [boardOffsetX, boardOffsetZ, boardScaleX, boardScaleZ, cameraPanX, cameraPanY, heightScale, hydrated, integrationMode, nudgeStep, ownerFilter, selectedSlotId, showAnchors, showDebugPanel, showDiagnostics, slotOffsets, tiltDegrees, zoomScale]);
>>>>>>> theirs


  const slotById = useMemo(() => new Map(BOARD_SLOTS.map((slot) => [slot.id, slot])), []);

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = globalThis.setTimeout(() => setStatusMessage(null), 2200);

  return () => globalThis.clearTimeout(timeout);
  }, [statusMessage]);

  const nudgeSelectedSlot = (axis: "x" | "z", delta: number) => {
    if (integrationMode || !selectedSlotId) return;

    setSlotOffsets((current) => {
      const previous = current[selectedSlotId] ?? { x: 0, z: 0 };
      return {
        ...current,
        [selectedSlotId]: {
          ...previous,
          [axis]: Number((previous[axis] + delta * nudgeStep).toFixed(2))
        }
      };
    });
  };


  const resetSlotOffsets = () => setSlotOffsets({});
  const resetSelectedSlotOffset = () => {
    if (integrationMode || !selectedSlotId) return;
    setSlotOffsets((current) => {
      const next = { ...current };
      delete next[selectedSlotId];
      return next;
    });
  };
  const resetCamera = () => {
    setTiltDegrees(60);
    setZoomScale(1);
    setHeightScale(1);
    setBoardScaleX(1);
    setBoardScaleZ(1);
    setBoardOffsetX(0);
    setBoardOffsetZ(0);
    setCameraPanX(0);
    setCameraPanY(0);
  };

  const resetAllEditorState = () => {
    if (integrationMode) return;
    resetCamera();
    setSlotOffsets({});
    setShowAnchors(true);
    setShowDebugPanel(true);
    setNudgeStep(1);
    setSelectedSlotId("player_1-primary");
    setStatusMessage("Editor state reset.");
  };

  const copyLayoutSnapshot = async () => {
    const snapshot = toLayoutSnapshot(slotOffsets);

    const payload = JSON.stringify(snapshot, null, 2);
    setLayoutDraft(payload);
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(payload);
      setLastCopiedLabel("Layout snapshot");
      setStatusMessage("Copied layout snapshot.");
      return;
    }

    const file = new Blob([payload], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = "board-layout-snapshot.json";
    link.click();
    URL.revokeObjectURL(link.href);
    setStatusMessage("Clipboard unavailable. Downloaded layout snapshot JSON.");
  };


  const applyLayoutDraft = () => {
    if (integrationMode) return;
    try {
      const parsedResult = parseLayoutSnapshotJson(layoutDraft);
      if (parsedResult.ok === false) {
        throw new Error(parsedResult.error);
      }

      const nextOffsets: BoardSlotOffsetMap = {};
      for (const slot of BOARD_SLOTS) {
        const override = parsedResult.value.find((item) => item.id === slot.id);
        if (!override) continue;
        nextOffsets[slot.id] = {
          x: Number((Math.max(0, Math.min(100, override.xPercent)) - slot.xPercent).toFixed(2)),
          z: Number((Math.max(0, Math.min(100, override.zPercent)) - slot.zPercent).toFixed(2))
        };
      }
      setSlotOffsets(nextOffsets);
      setLayoutDraftError(null);
      setStatusMessage("Layout JSON applied.");
    } catch (error) {
      setLayoutDraftError(error instanceof Error ? error.message : "Unable to apply layout JSON.");
    }
  };

  const resolvePosition = (slotId: string, fallbackX: number, fallbackZ: number) => {
    const raw = resolveSlotPosition(slotId, slotOffsets, fallbackX, fallbackZ);
    return {
      xPercent: Math.max(0, Math.min(100, 50 + (raw.xPercent - 50) * boardScaleX + boardOffsetX)),
      zPercent: Math.max(0, Math.min(100, 50 + (raw.zPercent - 50) * boardScaleZ + boardOffsetZ))
    };
  };

  const slotOccupancy = BOARD_SLOTS.map((slot) => ({
    slot,
    occupant: boardObjects.find((object) => object.slotId === slot.id)
  }));

  const selectedSlot = slotOccupancy.find(({ slot }) => slot.id === selectedSlotId) ?? null;
  const occupiedSlotCount = slotOccupancy.filter((entry) => Boolean(entry.occupant)).length;
  const selectedSlotIndex = selectedSlotId ? BOARD_SLOTS.findIndex((slot) => slot.id === selectedSlotId) : -1;

  const selectRelativeSlot = (delta: number) => {
    if (BOARD_SLOTS.length === 0) return;
    const currentIndex = selectedSlotIndex >= 0 ? selectedSlotIndex : 0;
    const nextIndex = (currentIndex + delta + BOARD_SLOTS.length) % BOARD_SLOTS.length;
    const nextSlotId = BOARD_SLOTS[nextIndex].id;
    setSelectedSlotId(nextSlotId);
    onSlotFocus?.({ slotId: nextSlotId, source: "keyboard" });
  };

  const selectSlot = (slotId: string, source: "mini-map" | "table" | "debug") => {
    setSelectedSlotId(slotId);
    onSlotFocus?.({ slotId, source });
  };

  const copySelectedSlotSnapshot = async () => {
    if (!selectedSlotId) return;
    const slot = slotById.get(selectedSlotId);
    if (!slot) return;
    const resolved = resolveSlotPosition(slot.id, slotOffsets, slot.xPercent, slot.zPercent);
    const payload = JSON.stringify({ id: slot.id, xPercent: resolved.xPercent, zPercent: resolved.zPercent }, null, 2);
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(payload);
      setLastCopiedLabel("Selected slot");
      setStatusMessage("Copied selected slot JSON.");
      return;
    }
    const file = new Blob([payload], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = `${slot.id}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    setStatusMessage("Clipboard unavailable. Downloaded selected slot JSON.");
  };

  const safeResetSlotOffsets = () => {
    if (integrationMode) return;
    resetSlotOffsets();
  };

  const emptySlotCount = slotOccupancy.length - occupiedSlotCount;
  const selectedOffset = selectedSlotId ? slotOffsets[selectedSlotId as BoardSlotId] ?? { x: 0, z: 0 } : { x: 0, z: 0 };
  const unresolvedBoardObjects = boardObjects.filter((object) => !slotById.has(object.slotId));
  const filteredBoardObjects = ownerFilter === "all" ? boardObjects : boardObjects.filter((object) => object.owner === ownerFilter);
  const layoutDraftIsValid = (() => {
    if (!layoutDraft.trim()) return false;
    try {
      return Array.isArray(JSON.parse(layoutDraft));
    } catch {
      return false;
    }
  })();

  const isTextInputTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
  };

  const handleKeyDown: KeyboardEventHandler<HTMLElement> = (event) => {
    if (integrationMode || !selectedSlotId || isTextInputTarget(event.target)) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowLeft") nudgeSelectedSlot("x", -1);
    if (event.key === "ArrowRight") nudgeSelectedSlot("x", 1);
    if (event.key === "ArrowUp") nudgeSelectedSlot("z", -1);
    if (event.key === "ArrowDown") nudgeSelectedSlot("z", 1);
    if (event.key.startsWith("Arrow")) event.preventDefault();
    if (!event.shiftKey && event.key.toLowerCase() === "r") resetAllEditorState();
  };

  const handleIntegrationModeChange = (value: boolean) => {
    setIntegrationMode(value);
    if (value) {
      setShowDebugPanel(false);
    }
  };

  return (
<<<<<<< ours
    <section className={`board-preview-3d board-preview-3d--${presentation}`} aria-label={presentation === "game" ? "Live 3D game board" : "Prototype 3D board space"} tabIndex={0} onKeyDown={handleKeyDown}>
      <header className="board-preview-3d__hud">
        <h3>{presentation === "game" ? "3D game board" : "3D board iteration lab"}</h3>
        {presentation === "lab" ? <p>Left: placement map. Right: 3D board prototype.</p> : null}
        <p>Occupied slots: {occupiedSlotCount} | Empty slots: {emptySlotCount} | Unresolved pieces: {unresolvedBoardObjects.length}</p>
        {presentation === "lab" ? <p>Mouse pans and zooms the 3D board. Keyboard arrows nudge selected slots.</p> : null}
=======
    <section className="board-preview-3d" aria-label="Prototype 3D board space" tabIndex={0} onKeyDown={handleKeyDown}>
      <header className="board-preview-3d__hud">
        <h3>3D board iteration lab</h3>
        <p>Left: condensed 2D placement map. Right: 3D board prototype.</p>
        <p>Occupied slots: {occupiedSlotCount} · Empty slots: {emptySlotCount} · Unresolved pieces: {unresolvedBoardObjects.length}</p>
        <p>Keyboard: Arrow keys nudge selected slot · Use Prev/Next buttons to cycle.</p>
>>>>>>> theirs
      </header>


      <BoardPreview3DControls
        tiltDegrees={tiltDegrees}
        setTiltDegrees={setTiltDegrees}
        zoomScale={zoomScale}
        setZoomScale={setZoomScale}
        heightScale={heightScale}
        setHeightScale={setHeightScale}
        boardScaleX={boardScaleX}
        setBoardScaleX={setBoardScaleX}
        boardScaleZ={boardScaleZ}
        setBoardScaleZ={setBoardScaleZ}
        boardOffsetX={boardOffsetX}
        setBoardOffsetX={setBoardOffsetX}
        boardOffsetZ={boardOffsetZ}
        setBoardOffsetZ={setBoardOffsetZ}
        cameraPanX={cameraPanX}
        setCameraPanX={setCameraPanX}
        cameraPanY={cameraPanY}
        setCameraPanY={setCameraPanY}
        ownerFilter={ownerFilter}
        setOwnerFilter={setOwnerFilter}
        showDebugPanel={showDebugPanel}
        setShowDebugPanel={setShowDebugPanel}
        showAnchors={showAnchors}
        setShowAnchors={setShowAnchors}
        adminView={adminView}
        showDiagnostics={showDiagnostics}
        setShowDiagnostics={setShowDiagnostics}
        integrationMode={integrationMode}
        setIntegrationMode={handleIntegrationModeChange}
        onResetAll={resetAllEditorState}
      />
      {integrationMode ? <p className="board-preview-3d__status">Integration mode enabled: layout editing actions are read-only.</p> : null}


      {statusMessage ? <p className="board-preview-3d__status">{statusMessage}</p> : null}
      {lastCopiedLabel ? <p className="board-preview-3d__status">Last copied: {lastCopiedLabel}</p> : null}

<<<<<<< ours
      <BoardPreview3DDebugPanel
        show={showDebugPanel}
        selectedSlot={selectedSlot}
        selectedSlotId={selectedSlotId}
        selectedSlotIndex={selectedSlotIndex}
        slotCount={BOARD_SLOTS.length}
        selectedOffset={selectedOffset}
        nudgeStep={nudgeStep}
        setNudgeStep={setNudgeStep}
        onNudge={nudgeSelectedSlot}
        onSelectRelative={selectRelativeSlot}
        onCopySelected={() => void copySelectedSlotSnapshot()}
        onResetCamera={resetCamera}
        onResetOffsets={safeResetSlotOffsets}
        onResetSelectedOffset={resetSelectedSlotOffset}
        onCopyLayout={() => void copyLayoutSnapshot()}
        layoutDraft={layoutDraft}
        setLayoutDraft={setLayoutDraft}
        layoutDraftError={layoutDraftError}
        layoutDraftIsValid={layoutDraftIsValid}
        onApplyLayout={applyLayoutDraft}
        slotOccupancy={slotOccupancy}
        onSelectSlot={(slotId) => selectSlot(slotId, "debug")}
        readOnly={integrationMode}
      />

=======
>>>>>>> theirs
      <div className="board-preview-3d__layout">
        <BoardPreview3DMiniMap
          showAnchors={showAnchors}
          selectedSlotId={selectedSlotId}
          filteredBoardObjects={filteredBoardObjects}
          resolveSlotPosition={resolvePosition}
          onSelectSlot={(slotId) => selectSlot(slotId, "mini-map")}
          onSelectPiece={(pieceId) => onPieceFocus?.({ pieceId, source: "mini-map" })}
        />
<<<<<<< ours
        <BoardPreview3DTable
          zoomScale={zoomScale}
          setZoomScale={setZoomScale}
          cameraPanX={cameraPanX}
          setCameraPanX={setCameraPanX}
          cameraPanY={cameraPanY}
          setCameraPanY={setCameraPanY}
          tiltDegrees={tiltDegrees}
          heightScale={heightScale}
          showAnchors={showAnchors}
          selectedSlotId={selectedSlotId}
          filteredBoardObjects={filteredBoardObjects}
          resolveSlotPosition={resolvePosition}
          onSelectSlot={(slotId) => selectSlot(slotId, "table")}
          onSelectPiece={(pieceId) => onPieceFocus?.({ pieceId, source: "table" })}
        />
=======
        <section className="board-preview-3d__board-column">
          <BoardPreview3DTable
            zoomScale={zoomScale}
            cameraPanX={cameraPanX}
            cameraPanY={cameraPanY}
            tiltDegrees={tiltDegrees}
            heightScale={heightScale}
            showAnchors={showAnchors}
            selectedSlotId={selectedSlotId}
            filteredBoardObjects={filteredBoardObjects}
            resolveSlotPosition={resolvePosition}
            onSelectSlot={(slotId) => selectSlot(slotId, "table")}
            onSelectPiece={(pieceId) => onPieceFocus?.({ pieceId, source: "table" })}
          />
        </section>
        {showDebugPanel ? (
          <aside className="board-preview-3d__debug-drawer">
            <BoardPreview3DDebugPanel
              show={showDebugPanel}
              selectedSlot={selectedSlot}
              selectedSlotId={selectedSlotId}
              selectedSlotIndex={selectedSlotIndex}
              slotCount={BOARD_SLOTS.length}
              selectedOffset={selectedOffset}
              nudgeStep={nudgeStep}
              setNudgeStep={setNudgeStep}
              onNudge={nudgeSelectedSlot}
              onSelectRelative={selectRelativeSlot}
              onCopySelected={() => void copySelectedSlotSnapshot()}
              onResetCamera={resetCamera}
              onResetOffsets={safeResetSlotOffsets}
              onResetSelectedOffset={resetSelectedSlotOffset}
              onCopyLayout={() => void copyLayoutSnapshot()}
              layoutDraft={layoutDraft}
              setLayoutDraft={setLayoutDraft}
              layoutDraftError={layoutDraftError}
              layoutDraftIsValid={layoutDraftIsValid}
              onApplyLayout={applyLayoutDraft}
              slotOccupancy={slotOccupancy}
              onSelectSlot={(slotId) => selectSlot(slotId, "debug")}
              readOnly={integrationMode}
            />
          </aside>
        ) : null}
>>>>>>> theirs
      </div>
    </section>
  );
}
