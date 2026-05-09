import { useEffect, useMemo, useRef, useState, type KeyboardEventHandler, type PointerEventHandler, type ReactNode, type WheelEventHandler } from "react";
import type { AppMatchState } from "../clientTypes";
import { BOARD_SLOTS } from "./boardPreview3dLayout";
import { BoardPreview3DControls } from "./boardPreview3d/BoardPreview3DControls";
import { BoardPreview3DDebugPanel } from "./boardPreview3d/BoardPreview3DDebugPanel";
import { BoardPreview3DMiniMap } from "./boardPreview3d/BoardPreview3DMiniMap";
import { BoardPreview3DTable } from "./boardPreview3d/BoardPreview3DTable";
import { MatchCardImage } from "./MatchCardImage";
import { parseLayoutSnapshotJson, resolveSlotPosition, toLayoutSnapshot } from "./boardPreview3dAdapter";
import { buildBoardInteractionContext, buildBoardRenderModel, translateGameEventsToBoardRenderEvents } from "./boardRenderAdapter";
import { createBoardAnimationQueueState, enqueueBoardRenderEvents, resetBoardAnimationQueueToSequence, settleActiveBoardAnimation, startNextBoardAnimation } from "./boardAnimationQueue";
import { getBoardAnimationProfile } from "./boardAnimationProfiles";
import { decideBoardReconciliation } from "./boardRenderReconciliation";
import { resolveBoardRuntimeMode } from "./boardRuntimeHealth";
import { mapPointerGestureToIntent } from "./boardInteractionIntents";
import type { PointerGestureIntent } from "./boardInteractionIntents";
import type { BoardIntentCommand } from "./boardIntentCommands";
import { resolveBoardIntentCommand } from "./boardIntentCommands";
import type { BoardPieceFocusEvent, BoardSlotFocusEvent, BoardSlotId, BoardSlotOffsetMap } from "./boardPreview3dTypes";

const BOARD_PREVIEW_STORAGE_KEY = "ward.boardPreview3D.settings";
const BOARD_PREVIEW_STORAGE_VERSION = 5;

type FloatingDockPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type ActionDockPosition = "bottom" | "left" | "right";

const FLOATING_DOCK_POSITIONS: FloatingDockPosition[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
const ACTION_DOCK_POSITIONS: ActionDockPosition[] = ["bottom", "left", "right"];

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

type BoardPreview3DProps = {
  match: AppMatchState;
  adminView?: boolean;
  presentation?: "lab" | "game";
  defaultIntegrationMode?: boolean;
  actionDock?: ReactNode;
  onDeckSlotClick?: (slotId: string) => void;
  controlledPlayerId?: "player_1" | "player_2" | null;
  onPlayHandCardToSlot?: (cardInstanceId: string, slotId: string) => void;
  onStartBattleFromPiece?: (cardInstanceId: string) => void;
  intentLabel?: string;
  commandLabel?: string;
  onSlotFocus?: (event: BoardSlotFocusEvent) => void;
  onPieceFocus?: (event: BoardPieceFocusEvent) => void;
  onIntent?: (intent: PointerGestureIntent) => void;
  onIntentCommand?: (command: BoardIntentCommand) => void;
};

export function BoardPreview3D({
  match,
  adminView = false,
  presentation = "lab",
  defaultIntegrationMode = false,
  actionDock,
  onDeckSlotClick,
  controlledPlayerId = null,
  onPlayHandCardToSlot,
  onStartBattleFromPiece,
  intentLabel = "",
  commandLabel = "",
  onSlotFocus,
  onPieceFocus,
  onIntent,
  onIntentCommand
}: BoardPreview3DProps) {
  const renderModel = useMemo(() => buildBoardRenderModel(match), [match]);
  const interactionContext = useMemo(() => buildBoardInteractionContext(match), [match]);
  const renderEvents = useMemo(() => translateGameEventsToBoardRenderEvents(match), [match]);
  const boardObjects = renderModel.boardObjects;
  const storageKey = presentation === "game" ? `${BOARD_PREVIEW_STORAGE_KEY}.game` : BOARD_PREVIEW_STORAGE_KEY;
  const [tiltDegrees, setTiltDegrees] = useState(60);
  const [zoomScale, setZoomScale] = useState(() => presentation === "game" ? 1.18 : 1);
  const [heightScale, setHeightScale] = useState(1);
  const [boardScaleX, setBoardScaleX] = useState(1);
  const [boardScaleZ, setBoardScaleZ] = useState(1);
  const [boardOffsetX, setBoardOffsetX] = useState(0);
  const [boardOffsetZ, setBoardOffsetZ] = useState(0);
  const [cameraPanX, setCameraPanX] = useState(0);
  const [cameraPanY, setCameraPanY] = useState(0);
  const [showDebugPanel, setShowDebugPanel] = useState(() =>
    presentation === "game" ? false : (globalThis.innerHeight ? globalThis.innerHeight > 980 : true)
  );
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
  const [integrationMode, setIntegrationMode] = useState(defaultIntegrationMode);
  const [animationQueue, setAnimationQueue] = useState(createBoardAnimationQueueState);
  const [runtimeMode, setRuntimeMode] = useState<"ANIMATED" | "FAST_FORWARD">("ANIMATED");
  const [selectedHandCardId, setSelectedHandCardId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [hudMode, setHudMode] = useState<"player" | "debug">("player");
  const [controlsCollapsed, setControlsCollapsed] = useState(true);
  const [controlsDockPosition, setControlsDockPosition] = useState<FloatingDockPosition>("top-right");
  const [actionDockPosition, setActionDockPosition] = useState<ActionDockPosition>("right");
  const [isCameraDragging, setIsCameraDragging] = useState(false);
  const previousRenderModelRef = useRef<typeof renderModel | null>(null);
  const cameraDragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  useEffect(() => {
    setAnimationQueue(current => {
      const decision = decideBoardReconciliation({
        previousModel: previousRenderModelRef.current,
        nextModel: renderModel,
        queueCursor: current.cursor
      });
      previousRenderModelRef.current = renderModel;
      if (decision.shouldResetQueue) {
        return resetBoardAnimationQueueToSequence(current, renderModel.sequenceNumber);
      }
      return enqueueBoardRenderEvents(current, renderEvents);
    });
  }, [renderEvents, renderModel.sequenceNumber]);

  useEffect(() => {
    setAnimationQueue(current => startNextBoardAnimation(current));
  }, [renderEvents]);

  useEffect(() => {
    const updateRuntimeMode = () => {
      setRuntimeMode(resolveBoardRuntimeMode({
        queue: animationQueue,
        isDocumentHidden: Boolean(globalThis.document?.hidden)
      }));
    };
    updateRuntimeMode();
    globalThis.document?.addEventListener("visibilitychange", updateRuntimeMode);
    return () => globalThis.document?.removeEventListener("visibilitychange", updateRuntimeMode);
  }, [animationQueue]);

  useEffect(() => {
    if (!animationQueue.activeEvent) return;
    const profile = getBoardAnimationProfile(animationQueue.activeEvent.type);
    if (runtimeMode === "FAST_FORWARD") {
      setAnimationQueue(current => settleActiveBoardAnimation(current));
      return;
    }
    const timeout = globalThis.setTimeout(() => {
      setAnimationQueue(current => settleActiveBoardAnimation(current));
    }, profile.durationMs);
    return () => globalThis.clearTimeout(timeout);
  }, [animationQueue.activeEvent, runtimeMode]);

  useEffect(() => {
    const saved = globalThis.localStorage?.getItem(storageKey);
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
        controlsDockPosition?: FloatingDockPosition;
        actionDockPosition?: ActionDockPosition;
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
      if (typeof parsed.showDebugPanel === "boolean") setShowDebugPanel(presentation === "game" ? false : parsed.showDebugPanel);
      if (typeof parsed.selectedSlotId === "string" || parsed.selectedSlotId === null) setSelectedSlotId(parsed.selectedSlotId);
      if (parsed.slotOffsets) setSlotOffsets(parsed.slotOffsets);
      if (typeof parsed.nudgeStep === "number") setNudgeStep(parsed.nudgeStep);
      if (typeof parsed.showAnchors === "boolean") setShowAnchors(parsed.showAnchors);
      if (parsed.ownerFilter === "all" || parsed.ownerFilter === "player_1" || parsed.ownerFilter === "player_2") setOwnerFilter(parsed.ownerFilter);
      if (typeof parsed.showDiagnostics === "boolean") setShowDiagnostics(parsed.showDiagnostics);
      if (typeof parsed.integrationMode === "boolean") setIntegrationMode(defaultIntegrationMode || parsed.integrationMode);
      if (FLOATING_DOCK_POSITIONS.includes(parsed.controlsDockPosition as FloatingDockPosition)) {
        setControlsDockPosition(parsed.controlsDockPosition as FloatingDockPosition);
      }
      if (parsed.version >= BOARD_PREVIEW_STORAGE_VERSION && ACTION_DOCK_POSITIONS.includes(parsed.actionDockPosition as ActionDockPosition)) {
        setActionDockPosition(parsed.actionDockPosition as ActionDockPosition);
      }

      if (parsed.version < BOARD_PREVIEW_STORAGE_VERSION) {
        globalThis.localStorage?.setItem(
          storageKey,
          JSON.stringify({ ...parsed, version: BOARD_PREVIEW_STORAGE_VERSION, showDiagnostics: false })
        );
      }
    } catch {
      // ignore malformed saved settings
    } finally {
      setHydrated(true);
    }
  }, [defaultIntegrationMode, presentation, storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    globalThis.localStorage?.setItem(
      storageKey,
      JSON.stringify({ version: BOARD_PREVIEW_STORAGE_VERSION, tiltDegrees, zoomScale, heightScale, boardScaleX, boardScaleZ, boardOffsetX, boardOffsetZ, cameraPanX, cameraPanY, showDebugPanel, selectedSlotId, slotOffsets, nudgeStep, showAnchors, ownerFilter, showDiagnostics, integrationMode, controlsDockPosition, actionDockPosition })
    );
  }, [actionDockPosition, boardOffsetX, boardOffsetZ, boardScaleX, boardScaleZ, cameraPanX, cameraPanY, controlsDockPosition, heightScale, hydrated, integrationMode, nudgeStep, ownerFilter, selectedSlotId, showAnchors, showDebugPanel, showDiagnostics, slotOffsets, storageKey, tiltDegrees, zoomScale]);

  const slotById = useMemo(() => new Map(BOARD_SLOTS.map((slot) => [slot.id, slot])), []);
  const focusedPlayerId = controlledPlayerId ?? match.turn.activePlayerId;
  const handCards = useMemo(() => {
    const player = match.players.find((item) => item.id === focusedPlayerId);
    return player?.hand ?? [];
  }, [focusedPlayerId, match.players]);
  const legalTargetSlotIds = useMemo(() => {
    if (!selectedHandCardId) return [] as string[];
    const selectedCard = handCards.find(card => card.instanceId === selectedHandCardId);
    if (!selectedCard) return [] as string[];
    const definition = match.cardCatalog[selectedCard.cardId];
    if (!definition) return [] as string[];
    if (definition.cardType === "CREATURE") {
      return [`${focusedPlayerId}-primary`];
    }
    if (definition.cardType === "MAGIC") {
      return Array.from({ length: 5 }, (_, index) => `${focusedPlayerId}-magic-${index + 1}`);
    }
    return [] as string[];
  }, [focusedPlayerId, handCards, match.cardCatalog, selectedHandCardId]);
  const selectedBattlePiece = useMemo(() => {
    if (!selectedSlotId) return null;
    const piece = boardObjects.find(item => item.slotId === selectedSlotId && item.owner === focusedPlayerId);
    if (!piece?.cardInstanceId) return null;
    return piece;
  }, [boardObjects, focusedPlayerId, selectedSlotId]);
  const battleTargetSlotIds = useMemo(() => {
    if (!selectedBattlePiece) return [] as string[];
    const defender = focusedPlayerId === "player_1" ? "player_2-primary" : "player_1-primary";
    return [defender];
  }, [focusedPlayerId, selectedBattlePiece]);

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
    setZoomScale(presentation === "game" ? 1.18 : 1);
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
    const intent = mapPointerGestureToIntent({ interaction: interactionContext, slotId });
    const command = resolveBoardIntentCommand(intent, boardObjects);
    onIntent?.(intent);
    onIntentCommand?.(command);
    if (intent.kind === "NO_OP") {
      setStatusMessage(intent.reason);
      return;
    }
    setSelectedSlotId(slotId);
    onSlotFocus?.({ slotId, source });
  };

  const selectPiece = (pieceId: string, source: "mini-map" | "table") => {
    const intent = mapPointerGestureToIntent({ interaction: interactionContext, pieceId });
    const command = resolveBoardIntentCommand(intent, boardObjects);
    onIntent?.(intent);
    onIntentCommand?.(command);
    if (intent.kind === "NO_OP") {
      setStatusMessage(intent.reason);
      return;
    }
    onPieceFocus?.({ pieceId, source });
  };

  const activeEvent = animationQueue.activeEvent;
  const animationHighlights = useMemo(() => {
    if (!activeEvent) return { slotIds: [] as string[], pieceIds: [] as string[] };
    const candidateSlotIds = activeEvent.visualTargets.slotIds.filter(value =>
      BOARD_SLOTS.some(slot => slot.id === value)
    );
    const instanceIds = activeEvent.visualTargets.cardInstanceIds;
    const pieceIds = boardObjects
      .filter(object => instanceIds.some(instanceId => object.id.includes(instanceId)))
      .map(object => object.id);
    return { slotIds: [...new Set(candidateSlotIds)], pieceIds: [...new Set(pieceIds)] };
  }, [activeEvent, boardObjects]);

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
  const cardByInstanceId = useMemo(() => {
    const cards = match.players.flatMap(player => [
      ...player.hand,
      ...player.deck,
      ...player.field.limitedSummons,
      ...player.field.magicSlots.filter(Boolean),
      ...(player.field.primaryCreature ? [player.field.primaryCreature] : [])
    ]);
    return new Map(cards.map(card => [card.instanceId, card]));
  }, [match.players]);
  const blockedReasonsBySlotId = useMemo<Record<string, string>>(() => {
    if (!selectedHandCardId) return {};
    const selectedCard = handCards.find(card => card.instanceId === selectedHandCardId);
    if (!selectedCard) return {};
    return Object.fromEntries(
      BOARD_SLOTS.filter(slot => !legalTargetSlotIds.includes(slot.id)).map(slot => [slot.id, `Cannot play ${match.cardCatalog[selectedCard.cardId]?.name ?? "this card"} to ${slot.label}`])
    );
  }, [handCards, legalTargetSlotIds, match.cardCatalog, selectedHandCardId]);

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
    if (isTextInputTarget(event.target)) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === "w") setClampedCameraPan("y", cameraPanY - 4);
    if (key === "s") setClampedCameraPan("y", cameraPanY + 4);
    if (key === "a") setClampedCameraPan("x", cameraPanX - 4);
    if (key === "d") setClampedCameraPan("x", cameraPanX + 4);
    if (event.key === "+" || event.key === "=") setClampedZoomScale(zoomScale + 0.08);
    if (event.key === "-" || event.key === "_") setClampedZoomScale(zoomScale - 0.08);
    if (event.key === "0") resetCamera();
    if (["w", "a", "s", "d", "+", "=", "-", "_", "0"].includes(key) || event.key === "+" || event.key === "=") {
      event.preventDefault();
      return;
    }
    if (integrationMode || !selectedSlotId) return;
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

  const setClampedZoomScale = (value: number) => {
    setZoomScale(clampNumber(Math.round(value * 100) / 100, 0.6, 2.2));
  };

  const setClampedCameraPan = (axis: "x" | "y", value: number) => {
    const clamped = clampNumber(Math.round(value * 10) / 10, -90, 90);
    if (axis === "x") {
      setCameraPanX(clamped);
      return;
    }
    setCameraPanY(clamped);
  };

  const cycleControlsDockPosition = () => {
    const currentIndex = FLOATING_DOCK_POSITIONS.indexOf(controlsDockPosition);
    setControlsDockPosition(FLOATING_DOCK_POSITIONS[(currentIndex + 1) % FLOATING_DOCK_POSITIONS.length]);
  };

  const cycleActionDockPosition = () => {
    const currentIndex = ACTION_DOCK_POSITIONS.indexOf(actionDockPosition);
    setActionDockPosition(ACTION_DOCK_POSITIONS[(currentIndex + 1) % ACTION_DOCK_POSITIONS.length]);
  };

  const isCameraControlTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(target.closest("button, input, select, textarea, a, .board-preview-3d__hand-rail, .board-preview-3d__action-dock, .board-preview-3d__floating-controls, .board-preview-3d__debug-drawer"));
  };

  const handleBoardPointerDown: PointerEventHandler<HTMLElement> = (event) => {
    if (event.button !== 0 || isCameraControlTarget(event.target)) return;
    cameraDragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setIsCameraDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleBoardPointerMove: PointerEventHandler<HTMLElement> = (event) => {
    const drag = cameraDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    cameraDragRef.current = { ...drag, x: event.clientX, y: event.clientY };
    setClampedCameraPan("x", cameraPanX + deltaX / 8);
    setClampedCameraPan("y", cameraPanY + deltaY / 8);
  };

  const stopBoardPointerDrag: PointerEventHandler<HTMLElement> = (event) => {
    if (cameraDragRef.current?.pointerId === event.pointerId) {
      cameraDragRef.current = null;
      setIsCameraDragging(false);
    }
  };

  const handleBoardWheel: WheelEventHandler<HTMLElement> = (event) => {
    if (isCameraControlTarget(event.target)) return;
    event.preventDefault();
    setClampedZoomScale(zoomScale + (event.deltaY < 0 ? 0.06 : -0.06));
  };

  return (
    <section className={`board-preview-3d board-preview-3d--${presentation}`} aria-label={presentation === "game" ? "Live 3D game board" : "Prototype 3D board space"} tabIndex={0} onKeyDown={handleKeyDown}>
      <header className="board-preview-3d__hud">
        <h3>{presentation === "game" ? "3D game board" : "3D board iteration lab"}</h3>
        {presentation === "lab" ? <p>Left: placement map. Right: 3D board prototype.</p> : null}
        <p>Occupied slots: {occupiedSlotCount} | Empty slots: {emptySlotCount} | Unresolved pieces: {unresolvedBoardObjects.length}</p>
        <p>Event queue: {animationQueue.queue.length} | Active: {animationQueue.activeEvent?.type ?? "none"} ({getBoardAnimationProfile(animationQueue.activeEvent?.type).label}) | Mode: {runtimeMode}</p>
        <p>Drag to pan | Wheel to zoom | WASD to move | +/- zoom | 0 reset</p>
        {intentLabel ? <p>Intent: {intentLabel}</p> : null}
        {commandLabel ? <p>Command: {commandLabel}</p> : null}
        <div>
          <button type="button" className="ghost" onClick={() => setControlsCollapsed(value => !value)}>{controlsCollapsed ? "Show HUD Controls" : "Hide HUD Controls"}</button>
          <button type="button" className="ghost" onClick={cycleControlsDockPosition}>Move HUD Controls</button>
          {actionDock ? <button type="button" className="ghost" onClick={cycleActionDockPosition}>Move Action Dock</button> : null}
          <button type="button" className="ghost" onClick={() => setHudMode(mode => mode === "player" ? "debug" : "player")}>{hudMode === "player" ? "Debug HUD" : "Player HUD"}</button>
        </div>
      </header>
      {!controlsCollapsed ? (
        <aside className={`board-preview-3d__floating-controls board-preview-3d__floating-controls--${controlsDockPosition}`}>
          <div className="board-preview-3d__floating-title">
            <strong>HUD Controls</strong>
            <button type="button" className="ghost" onClick={cycleControlsDockPosition}>Move</button>
          </div>
          <BoardPreview3DControls
            tiltDegrees={tiltDegrees}
            setTiltDegrees={setTiltDegrees}
            zoomScale={zoomScale}
            setZoomScale={setClampedZoomScale}
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
            setCameraPanX={(value) => setClampedCameraPan("x", value)}
            cameraPanY={cameraPanY}
            setCameraPanY={(value) => setClampedCameraPan("y", value)}
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
        </aside>
      ) : null}
      {integrationMode ? <p className="board-preview-3d__status">Integration mode enabled: layout editing actions are read-only.</p> : null}

      {statusMessage ? <p className="board-preview-3d__status">{statusMessage}</p> : null}
      {lastCopiedLabel ? <p className="board-preview-3d__status">Last copied: {lastCopiedLabel}</p> : null}

      <div className="board-preview-3d__layout">
        <BoardPreview3DMiniMap
          showAnchors={showAnchors}
          selectedSlotId={selectedSlotId}
          filteredBoardObjects={filteredBoardObjects}
          resolveSlotPosition={resolvePosition}
          onSelectSlot={(slotId) => selectSlot(slotId, "mini-map")}
          onSelectPiece={(pieceId) => selectPiece(pieceId, "mini-map")}
        />
        <section
          className={`board-preview-3d__board-column${isCameraDragging ? " is-panning" : ""}`}
          onPointerDown={handleBoardPointerDown}
          onPointerMove={handleBoardPointerMove}
          onPointerUp={stopBoardPointerDrag}
          onPointerCancel={stopBoardPointerDrag}
          onWheel={handleBoardWheel}
        >
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
            onDeckSlotClick={onDeckSlotClick}
            onPlayHandCardToSlot={(slotId) => {
              if (!selectedHandCardId) return;
              onPlayHandCardToSlot?.(selectedHandCardId, slotId);
              setSelectedHandCardId(null);
            }}
            onDropHandCardToSlot={(slotId, cardInstanceId) => {
              onPlayHandCardToSlot?.(cardInstanceId, slotId);
              setSelectedHandCardId(null);
            }}
            onSelectPiece={(pieceId) => selectPiece(pieceId, "table")}
            highlightedSlotIds={[...animationHighlights.slotIds, ...legalTargetSlotIds, ...battleTargetSlotIds]}
            highlightedPieceIds={animationHighlights.pieceIds}
            activeEventType={activeEvent?.type ?? null}
            match={match}
            cardByInstanceId={cardByInstanceId}
            blockedReasonsBySlotId={blockedReasonsBySlotId}
          />
          {actionDock ? (
            <div className={`board-preview-3d__action-dock board-preview-3d__action-dock--${actionDockPosition}`}>
              <div className="board-preview-3d__floating-title">
                <strong>Action Dock</strong>
                <button type="button" className="ghost" onClick={cycleActionDockPosition}>Move</button>
              </div>
              {actionDock}
            </div>
          ) : null}
          {handCards.length > 0 ? (
            <section className="board-preview-3d__hand-rail" aria-label="3D board hand rail">
              {handCards.map(card => (
                <button
                  key={card.instanceId}
                  type="button"
                  draggable
                  className={selectedHandCardId === card.instanceId ? "is-selected" : undefined}
                  onClick={() => setSelectedHandCardId(current => current === card.instanceId ? null : card.instanceId)}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("application/x-ward-board-hand-card", card.instanceId);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                >
                  <MatchCardImage match={match} card={card} className="board-preview-3d__hand-card-art" />
                  <span>{match.cardCatalog[card.cardId]?.name ?? card.cardId}</span>
                </button>
              ))}
            </section>
          ) : null}
          {selectedBattlePiece ? (
            <section className="board-preview-3d__quick-actions">
              <button type="button" onClick={() => onStartBattleFromPiece?.(selectedBattlePiece.cardInstanceId!)}>
                Start Battle ({selectedBattlePiece.label})
              </button>
              <small>Target: {focusedPlayerId === "player_1" ? "player_2-primary" : "player_1-primary"}</small>
            </section>
          ) : null}
        </section>
        {showDebugPanel && hudMode === "debug" ? (
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
      </div>
    </section>
  );
}
