import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEventHandler, type PointerEventHandler, type ReactNode, type WheelEventHandler } from "react";
import type { CardInstance } from "@ward/shared";
import type { AppMatchState } from "../clientTypes";
import { BOARD_SLOTS, BOARD_ZONES, type BoardZone } from "./boardPreview3dLayout";
import { BoardPreview3DControls } from "./boardPreview3d/BoardPreview3DControls";
import { BoardPreview3DDebugPanel, type BoardZoneAdjustment } from "./boardPreview3d/BoardPreview3DDebugPanel";
import { BoardPreview3DMiniMap } from "./boardPreview3d/BoardPreview3DMiniMap";
import { BoardPreview3DTable } from "./boardPreview3d/BoardPreview3DTable";
import { MatchCardImage } from "./MatchCardImage";
import { parseLayoutSnapshotJson, resolveSlotPosition, toLayoutSnapshot } from "./boardPreview3dAdapter";
import { buildBoardInteractionContext, buildBoardRenderModel, translateGameEventsToBoardRenderEvents } from "./boardRenderAdapter";
import { createBoardAnimationQueueState, enqueueBoardRenderEvents, resetBoardAnimationQueueToSequence, settleActiveBoardAnimation, startNextBoardAnimation } from "./boardAnimationQueue";
import { getBoardAnimationProfile } from "./boardAnimationProfiles";
import { decideBoardReconciliation } from "./boardRenderReconciliation";
import { resolveBoardRuntimeMode } from "./boardRuntimeHealth";
import { canSummonCreatureFromHand, getCardName, getCardText, getCreatureStatsLine, getEffectiveCreatureStat, getMagicLine, getPrimarySummonSacrificeCandidates, getRequiredSacrificesForCard, isCreature, isEquipMagic, isMagic, playerHasSummonableCreatureInHand } from "../gameViewHelpers";
import { mapPointerGestureToIntent } from "./boardInteractionIntents";
import type { PointerGestureIntent } from "./boardInteractionIntents";
import type { BoardIntentCommand } from "./boardIntentCommands";
import { resolveBoardIntentCommand } from "./boardIntentCommands";
import type { BoardPieceFocusEvent, BoardPlayerId, BoardSlotFocusEvent, BoardSlotId, BoardSlotOffsetMap } from "./boardPreview3dTypes";

const BOARD_PREVIEW_STORAGE_KEY = "ward.boardPreview3D.settings";
const BOARD_PREVIEW_STORAGE_VERSION = 10;
const BOARD_PREVIEW_CAMERA_DEFAULTS_VERSION = 1;

type FloatingDockPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type ActionDockPosition = "bottom" | "left" | "right";
type AttachTargetKind = "PRIMARY_CREATURE" | "LIMITED_SUMMON";

const FLOATING_DOCK_POSITIONS: FloatingDockPosition[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
const ACTION_DOCK_POSITIONS: ActionDockPosition[] = ["bottom", "left", "right"];
const EMPTY_ZONE_ADJUSTMENT: BoardZoneAdjustment = { x: 0, z: 0, width: 0, height: 0 };
const DEFAULT_CAMERA_SETTINGS = {
  tiltDegrees: 0,
  zoomScale: 0.95,
  heightScale: 0.6,
  boardScaleX: 0.7,
  boardScaleZ: 0.7,
  boardOffsetX: 0,
  boardOffsetZ: -1,
  cameraPanX: 0,
  cameraPanY: -3
};
type VisibleSlotLayers = {
  primary: boolean;
  limited: boolean;
  magic: boolean;
  stacks: boolean;
  hand: boolean;
};
const DEFAULT_VISIBLE_SLOT_LAYERS: VisibleSlotLayers = {
  primary: true,
  limited: true,
  magic: true,
  stacks: false,
  hand: false
};

function getCreatureOverlayStats(match: AppMatchState, card: CardInstance) {
  const definition = match.cardCatalog[card.cardId];
  if (definition?.cardType !== "CREATURE") return null;

  const baseHp = Number(card.baseHp ?? definition.hp);
  const currentHp = Number(card.currentHp ?? baseHp);
  const hpPercent = baseHp > 0 ? Math.max(0, Math.min(100, (currentHp / baseHp) * 100)) : 0;
  const hpTone = hpPercent <= 30 ? "danger" : hpPercent <= 60 ? "warn" : "healthy";

  return {
    armorLevel: getEffectiveCreatureStat(card, "armorLevel", definition.armorLevel),
    attackDice: getEffectiveCreatureStat(card, "attackDice", definition.attackDice),
    baseHp,
    currentHp,
    hpTone,
    modifier: getEffectiveCreatureStat(card, "modifier", definition.modifier),
    speed: getEffectiveCreatureStat(card, "speed", definition.speed)
  };
}

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
  onAdvancePhase?: () => void;
  onUndoLastAction?: () => void;
  onRequestNoCreatureRedraw?: (playerId: "player_1" | "player_2") => void;
  onSetHandRevealed?: (playerId: "player_1" | "player_2", revealed: boolean) => void;
  onApproveRevealRedraw?: () => void;
  onOpeningRoll?: (playerId: "player_1" | "player_2") => void;
  onPlayHandCardToSlot?: (cardInstanceId: string, slotId: string, sacrificeCardInstanceIds?: string[]) => void;
  onAttachEquipMagicToCreature?: (
    fieldOwnerPlayerId: BoardPlayerId,
    magicCardInstanceId: string,
    targetPlayerId: BoardPlayerId,
    targetCreatureInstanceId: string,
    targetKind: AttachTargetKind
  ) => void;
  onStartBattleFromPiece?: (cardInstanceId: string) => void;
  intentLabel?: string;
  commandLabel?: string;
  onSlotFocus?: (event: BoardSlotFocusEvent) => void;
  onPieceFocus?: (event: BoardPieceFocusEvent) => void;
  onIntent?: (intent: PointerGestureIntent) => void;
  onIntentCommand?: (command: BoardIntentCommand) => void;
  onResolveEffectTarget?: (promptId: string, selectedOptionId: string) => void;
};

function DiceFace({ value }: { value?: number }) {
  const normalizedValue = value && value >= 1 && value <= 6 ? value : 1;

  return (
    <span className={`board-opening-roll__die board-opening-roll__die--${normalizedValue}`} aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <i key={index} />
      ))}
    </span>
  );
}

function getOpeningRollViewState(match: AppMatchState) {
  if (match.setup.openingRoll) return match.setup.openingRoll;

  const noOpeningCardsDrawn =
    match.players.every(player => player.hand.length === 0) &&
    match.players.every(player => !match.setup.firstTurnDrawsByPlayer[player.id]);
  const appearsToBeFreshOpening =
    match.status !== "COMPLETE" &&
    noOpeningCardsDrawn &&
    match.turn.turnNumber === 1 &&
    match.turn.phase === "DRAW";

  if (!appearsToBeFreshOpening) return null;

  return {
    status: "AWAITING_ROLL" as const,
    round: 1,
    rolls: Object.fromEntries(match.players.map(player => [player.id, undefined])) as Record<string, number | undefined>
  };
}

function OpeningRollBoardControl({
  match,
  controlledPlayerId,
  onOpeningRoll
}: {
  match: AppMatchState;
  controlledPlayerId: BoardPlayerId | null;
  onOpeningRoll?: (playerId: BoardPlayerId) => void;
}) {
  const openingRoll = getOpeningRollViewState(match);
  if (!openingRoll) return null;

  const isComplete = openingRoll.status === "COMPLETE";
  const rollPlayer = controlledPlayerId
    ? match.players.find(player => player.id === controlledPlayerId)
    : match.players.find(player => openingRoll.rolls[player.id] === undefined) ?? match.players[0];
  const canRoll = !isComplete && Boolean(rollPlayer) && openingRoll.rolls[rollPlayer!.id] === undefined;
  const hasCurrentRoundRoll = Object.values(openingRoll.rolls).some(value => value !== undefined);
  const displayedRolls = hasCurrentRoundRoll || !openingRoll.lastRolls
    ? openingRoll.rolls
    : openingRoll.lastRolls;
  const winnerName = openingRoll.winnerPlayerId
    ? match.players.find(player => player.id === openingRoll.winnerPlayerId)?.displayName ?? openingRoll.winnerPlayerId
    : null;

  return (
    <aside className={`board-opening-roll${isComplete ? " is-complete" : " is-pending"}`} aria-label="Opening low-roll control">
      <button
        type="button"
        className="board-opening-roll__trigger"
        onClick={() => {
          if (rollPlayer) onOpeningRoll?.(rollPlayer.id as BoardPlayerId);
        }}
        disabled={!canRoll}
        title={isComplete ? "Opening roll complete" : canRoll ? `Roll 1D6 for ${rollPlayer?.displayName ?? "player"}` : "Waiting for the other opening roll"}
      >
        <DiceFace value={displayedRolls[rollPlayer?.id ?? ""] ?? 1} />
        <span>{isComplete ? "First Set" : "Roll First"}</span>
      </button>

      <div className="board-opening-roll__lanes">
        {match.players.map(player => {
          const roll = displayedRolls[player.id];
          const hasRolled = roll !== undefined;
          return (
            <div className={`board-opening-roll__lane board-opening-roll__lane--${player.id}${hasRolled ? " has-roll" : ""}`} key={player.id}>
              <span>{player.displayName}</span>
              <DiceFace value={roll ?? 1} />
              <strong>{hasRolled ? roll : "-"}</strong>
            </div>
          );
        })}
      </div>

      <p>
        {isComplete && winnerName
          ? `${winnerName} goes first`
          : openingRoll.lastRolls
            ? `Tie on round ${openingRoll.round - 1}. Roll again.`
            : `Low roll wins. Round ${openingRoll.round}.`}
      </p>
    </aside>
  );
}

export function BoardPreview3D({
  match,
  adminView = false,
  presentation = "lab",
  defaultIntegrationMode = false,
  actionDock,
  onDeckSlotClick,
  controlledPlayerId = null,
  onAdvancePhase,
  onUndoLastAction,
  onRequestNoCreatureRedraw,
  onSetHandRevealed,
  onApproveRevealRedraw,
  onOpeningRoll,
  onPlayHandCardToSlot,
  onAttachEquipMagicToCreature,
  onStartBattleFromPiece,
  intentLabel = "",
  commandLabel = "",
  onSlotFocus,
  onPieceFocus,
  onIntent,
  onIntentCommand,
  onResolveEffectTarget
}: BoardPreview3DProps) {
  const focusedPlayerId: BoardPlayerId = controlledPlayerId ?? (match.turn.activePlayerId === "player_1" ? "player_1" : "player_2");
  const [locallyRevealedHands, setLocallyRevealedHands] = useState<Partial<Record<BoardPlayerId, boolean>>>({});
  const revealedHandPlayerIds = match.setup.revealedHandPlayerIds ?? [];
  const handRevealMode = (() => {
    if (adminView && presentation === "lab") return "all";
    const revealedOwners = new Set<BoardPlayerId>();
    if (locallyRevealedHands.player_1 || revealedHandPlayerIds.includes("player_1")) revealedOwners.add("player_1");
    if (locallyRevealedHands.player_2 || revealedHandPlayerIds.includes("player_2")) revealedOwners.add("player_2");
    if (revealedOwners.size === 0) return null;
    return revealedOwners.size > 1 ? "all" : [...revealedOwners][0]!;
  })();
  const renderModel = useMemo(
    () => buildBoardRenderModel(match, { revealHandsForPlayerId: handRevealMode }),
    [handRevealMode, match]
  );
  const interactionContext = useMemo(() => buildBoardInteractionContext(match), [match]);
  const renderEvents = useMemo(() => translateGameEventsToBoardRenderEvents(match), [match]);
  const boardObjects = renderModel.boardObjects;
  const storageKey = presentation === "game" ? `${BOARD_PREVIEW_STORAGE_KEY}.game` : BOARD_PREVIEW_STORAGE_KEY;
  const [tiltDegrees, setTiltDegrees] = useState(DEFAULT_CAMERA_SETTINGS.tiltDegrees);
  const [zoomScale, setZoomScale] = useState(DEFAULT_CAMERA_SETTINGS.zoomScale);
  const [heightScale, setHeightScale] = useState(DEFAULT_CAMERA_SETTINGS.heightScale);
  const [boardScaleX, setBoardScaleX] = useState(DEFAULT_CAMERA_SETTINGS.boardScaleX);
  const [boardScaleZ, setBoardScaleZ] = useState(DEFAULT_CAMERA_SETTINGS.boardScaleZ);
  const [boardOffsetX, setBoardOffsetX] = useState(DEFAULT_CAMERA_SETTINGS.boardOffsetX);
  const [boardOffsetZ, setBoardOffsetZ] = useState(DEFAULT_CAMERA_SETTINGS.boardOffsetZ);
  const [cameraPanX, setCameraPanX] = useState(DEFAULT_CAMERA_SETTINGS.cameraPanX);
  const [cameraPanY, setCameraPanY] = useState(DEFAULT_CAMERA_SETTINGS.cameraPanY);
  const [showDebugPanel, setShowDebugPanel] = useState(() =>
    presentation === "game" ? false : (globalThis.innerHeight ? globalThis.innerHeight > 980 : true)
  );
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>("player_1-primary");
  const [slotOffsets, setSlotOffsets] = useState<BoardSlotOffsetMap>({});
  const [selectedZoneId, setSelectedZoneId] = useState(BOARD_ZONES[0]?.id ?? "");
  const [zoneAdjustments, setZoneAdjustments] = useState<Record<string, BoardZoneAdjustment>>({});
  const [nudgeStep, setNudgeStep] = useState(1);
  const [showAnchors, setShowAnchors] = useState(true);
  const [showZoneRects, setShowZoneRects] = useState(false);
  const [visibleSlotLayers, setVisibleSlotLayers] = useState<VisibleSlotLayers>(DEFAULT_VISIBLE_SLOT_LAYERS);
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
  const [selectedEquipMagicCardId, setSelectedEquipMagicCardId] = useState<string | null>(null);
  const [selectedSacrificeIdsByCard, setSelectedSacrificeIdsByCard] = useState<Record<string, string[]>>({});
  const [hoveredHandCardId, setHoveredHandCardId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [controlsCollapsed, setControlsCollapsed] = useState(true);
  const [controlsDockPosition, setControlsDockPosition] = useState<FloatingDockPosition>("top-right");
  const [actionDockPosition, setActionDockPosition] = useState<ActionDockPosition>("right");
  const [actionDockCollapsed, setActionDockCollapsed] = useState(false);
  const [deckHandControlsOwner, setDeckHandControlsOwner] = useState<BoardPlayerId | null>(null);
  const [deckActionsExpanded, setDeckActionsExpanded] = useState(false);
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
        cameraDefaultsVersion?: number;
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
        selectedZoneId?: string;
        zoneAdjustments?: Record<string, BoardZoneAdjustment>;
        nudgeStep?: number;
        showAnchors?: boolean;
        showZoneRects?: boolean;
        visibleSlotLayers?: Partial<VisibleSlotLayers>;
        ownerFilter?: "all" | "player_1" | "player_2";
        showDiagnostics?: boolean;
        integrationMode?: boolean;
        controlsDockPosition?: FloatingDockPosition;
        actionDockPosition?: ActionDockPosition;
        actionDockCollapsed?: boolean;
      };
      if (parsed.cameraDefaultsVersion === BOARD_PREVIEW_CAMERA_DEFAULTS_VERSION) {
        if (typeof parsed.tiltDegrees === "number") setTiltDegrees(parsed.tiltDegrees);
        if (typeof parsed.zoomScale === "number") setZoomScale(parsed.zoomScale);
        if (typeof parsed.heightScale === "number") setHeightScale(parsed.heightScale);
        if (typeof parsed.boardScaleX === "number") setBoardScaleX(parsed.boardScaleX);
        if (typeof parsed.boardScaleZ === "number") setBoardScaleZ(parsed.boardScaleZ);
        if (typeof parsed.boardOffsetX === "number") setBoardOffsetX(parsed.boardOffsetX);
        if (typeof parsed.boardOffsetZ === "number") setBoardOffsetZ(parsed.boardOffsetZ);
        if (typeof parsed.cameraPanX === "number") setCameraPanX(parsed.cameraPanX);
        if (typeof parsed.cameraPanY === "number") setCameraPanY(parsed.cameraPanY);
      }
      if (typeof parsed.showDebugPanel === "boolean") setShowDebugPanel(parsed.showDebugPanel);
      if (typeof parsed.selectedSlotId === "string" || parsed.selectedSlotId === null) setSelectedSlotId(parsed.selectedSlotId);
      if (parsed.version >= BOARD_PREVIEW_STORAGE_VERSION && parsed.slotOffsets) setSlotOffsets(parsed.slotOffsets);
      if (typeof parsed.selectedZoneId === "string" && BOARD_ZONES.some(zone => zone.id === parsed.selectedZoneId)) {
        setSelectedZoneId(parsed.selectedZoneId);
      }
      if (parsed.zoneAdjustments) setZoneAdjustments(parsed.zoneAdjustments);
      if (typeof parsed.nudgeStep === "number") setNudgeStep(parsed.nudgeStep);
      if (typeof parsed.showAnchors === "boolean") setShowAnchors(parsed.showAnchors);
      if (typeof parsed.showZoneRects === "boolean") setShowZoneRects(parsed.showZoneRects);
      if (parsed.visibleSlotLayers && typeof parsed.visibleSlotLayers === "object") {
        setVisibleSlotLayers({ ...DEFAULT_VISIBLE_SLOT_LAYERS, ...parsed.visibleSlotLayers });
      }
      if (parsed.ownerFilter === "all" || parsed.ownerFilter === "player_1" || parsed.ownerFilter === "player_2") setOwnerFilter(parsed.ownerFilter);
      if (typeof parsed.showDiagnostics === "boolean") setShowDiagnostics(parsed.showDiagnostics);
      if (typeof parsed.integrationMode === "boolean") setIntegrationMode(defaultIntegrationMode || parsed.integrationMode);
      if (FLOATING_DOCK_POSITIONS.includes(parsed.controlsDockPosition as FloatingDockPosition)) {
        setControlsDockPosition(parsed.controlsDockPosition as FloatingDockPosition);
      }
      if (parsed.version >= BOARD_PREVIEW_STORAGE_VERSION && ACTION_DOCK_POSITIONS.includes(parsed.actionDockPosition as ActionDockPosition)) {
        setActionDockPosition(parsed.actionDockPosition as ActionDockPosition);
      }
      if (typeof parsed.actionDockCollapsed === "boolean") setActionDockCollapsed(parsed.actionDockCollapsed);

      if (parsed.version < BOARD_PREVIEW_STORAGE_VERSION) {
        globalThis.localStorage?.setItem(
          storageKey,
          JSON.stringify({ ...parsed, version: BOARD_PREVIEW_STORAGE_VERSION, showDiagnostics: false, slotOffsets: {} })
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
      JSON.stringify({ version: BOARD_PREVIEW_STORAGE_VERSION, cameraDefaultsVersion: BOARD_PREVIEW_CAMERA_DEFAULTS_VERSION, tiltDegrees, zoomScale, heightScale, boardScaleX, boardScaleZ, boardOffsetX, boardOffsetZ, cameraPanX, cameraPanY, showDebugPanel, selectedSlotId, slotOffsets, selectedZoneId, zoneAdjustments, nudgeStep, showAnchors, showZoneRects, visibleSlotLayers, ownerFilter, showDiagnostics, integrationMode, controlsDockPosition, actionDockPosition, actionDockCollapsed })
    );
  }, [actionDockCollapsed, actionDockPosition, boardOffsetX, boardOffsetZ, boardScaleX, boardScaleZ, cameraPanX, cameraPanY, controlsDockPosition, heightScale, hydrated, integrationMode, nudgeStep, ownerFilter, selectedSlotId, selectedZoneId, showAnchors, showDebugPanel, showDiagnostics, showZoneRects, slotOffsets, storageKey, tiltDegrees, visibleSlotLayers, zoneAdjustments, zoomScale]);

  const slotById = useMemo(() => new Map(BOARD_SLOTS.map((slot) => [slot.id, slot])), []);
  const handCards = useMemo(() => {
    const player = match.players.find((item) => item.id === focusedPlayerId);
    return player?.hand ?? [];
  }, [focusedPlayerId, match.players]);
  const cardByInstanceId = useMemo(() => {
    const cards = match.players.flatMap(player => [
      ...player.hand,
      ...player.deck,
      ...player.cemetery,
      ...player.field.limitedSummons,
      ...player.field.magicSlots.filter(Boolean),
      ...(player.field.primaryCreature ? [player.field.primaryCreature] : [])
    ]);
    return new Map(cards.map(card => [card.instanceId, card]));
  }, [match.players]);
  const inspectedHandCardId = hoveredHandCardId ?? selectedHandCardId;
  const inspectedHandCard = inspectedHandCardId
    ? handCards.find(card => card.instanceId === inspectedHandCardId) ?? null
    : null;
  const inspectedHandCreatureStats = inspectedHandCard ? getCreatureOverlayStats(match, inspectedHandCard) : null;
  const selectedHandCard = selectedHandCardId
    ? handCards.find(card => card.instanceId === selectedHandCardId) ?? null
    : null;
  const focusedPlayer = useMemo(
    () => match.players.find((player) => player.id === focusedPlayerId) ?? null,
    [focusedPlayerId, match.players]
  );
  const opponentPlayer = useMemo(
    () => match.players.find((player) => player.id !== focusedPlayerId) ?? null,
    [focusedPlayerId, match.players]
  );
  const opponentPlayerId: BoardPlayerId | null = opponentPlayer
    ? opponentPlayer.id === "player_1" ? "player_1" : "player_2"
    : null;
  const canControlPlayer = (playerId: string) => !controlledPlayerId || controlledPlayerId === playerId;
  const opponentHandIsRevealed = opponentPlayerId
    ? Boolean(locallyRevealedHands[opponentPlayerId]) || revealedHandPlayerIds.includes(opponentPlayerId)
    : false;
  const opponentPromptRevealCards = opponentPlayer && match.pendingPrompt?.requestingPlayerId === opponentPlayer.id
    ? match.pendingPrompt.revealedCards.map(card => ({
      instanceId: card.cardInstanceId,
      cardId: card.cardId,
      ownerPlayerId: opponentPlayer.id,
      controllerPlayerId: opponentPlayer.id,
      zone: "HAND" as const
    }))
    : [];
  const visibleOpponentHandCards = opponentPromptRevealCards.length > 0
    ? opponentPromptRevealCards
    : opponentHandIsRevealed
      ? opponentPlayer?.hand ?? []
      : [];
  const occupiedSlotIds = useMemo(
    () => new Set<string>(boardObjects.filter((object) => object.lane !== "hand").map((object) => object.slotId)),
    [boardObjects]
  );
  const selectedSummonRequiredSacrifices =
    selectedHandCard && isCreature(match, selectedHandCard)
      ? getRequiredSacrificesForCard(match, selectedHandCard)
      : 0;
  const sacrificeCandidates = useMemo(() => {
    if (!selectedHandCard || !focusedPlayer || !isCreature(match, selectedHandCard)) return [] as CardInstance[];
    if (selectedSummonRequiredSacrifices <= 0) return [] as CardInstance[];
    return getPrimarySummonSacrificeCandidates(match, focusedPlayer, selectedHandCard);
  }, [focusedPlayer, match, selectedHandCard, selectedSummonRequiredSacrifices]);
  const sacrificeCandidateIds = useMemo(
    () => new Set(sacrificeCandidates.map(card => card.instanceId)),
    [sacrificeCandidates]
  );
  const selectedSacrificeIds = selectedHandCardId
    ? (selectedSacrificeIdsByCard[selectedHandCardId] ?? []).filter(id => sacrificeCandidateIds.has(id)).slice(0, selectedSummonRequiredSacrifices)
    : [];
  const selectedSacrificeIdSet = useMemo(() => new Set(selectedSacrificeIds), [selectedSacrificeIds]);
  const sacrificeSelectionActive = Boolean(selectedHandCard && selectedSummonRequiredSacrifices > 0);
  const sacrificeSelectionComplete = selectedSacrificeIds.length >= selectedSummonRequiredSacrifices;
  const sacrificeDropSlotId = `${focusedPlayerId}-cemetery`;

  const toggleSacrificeSelection = useCallback((cardInstanceId: string) => {
    if (!selectedHandCardId || !sacrificeCandidateIds.has(cardInstanceId) || selectedSummonRequiredSacrifices <= 0) return;
    setSelectedSacrificeIdsByCard(current => {
      const currentIds = current[selectedHandCardId] ?? [];
      const nextIds = currentIds.includes(cardInstanceId)
        ? currentIds.filter(id => id !== cardInstanceId)
        : [...currentIds, cardInstanceId].slice(0, selectedSummonRequiredSacrifices);
      return {
        ...current,
        [selectedHandCardId]: nextIds
      };
    });
  }, [sacrificeCandidateIds, selectedHandCardId, selectedSummonRequiredSacrifices]);

  const getLegalTargetSlotIdsForCard = useCallback((cardInstanceId: string) => {
    const selectedCard = handCards.find(card => card.instanceId === cardInstanceId);
    if (!selectedCard || !focusedPlayer) return [] as string[];
    const isMatchComplete = match.status === "COMPLETE";
    const anyDiscardRequired = Boolean(match.setup.handDiscardRequiredForPlayerId);
    const replacementRequiredForThisPlayer =
      match.setup.primaryReplacementRequiredForPlayerId === focusedPlayer.id;
    const limitedSummonPromotionRequiredForThisPlayer =
      replacementRequiredForThisPlayer && focusedPlayer.field.limitedSummons.length > 0;
    const canControlThisPlayer = !controlledPlayerId || controlledPlayerId === focusedPlayer.id;
    const isActivePlayer = match.turn.activePlayerId === focusedPlayer.id;
    const canPlayPrimaryNow =
      !isMatchComplete &&
      canControlThisPlayer &&
      !match.pendingPrompt &&
      !match.pendingChain &&
      !anyDiscardRequired &&
      !limitedSummonPromotionRequiredForThisPlayer &&
      (replacementRequiredForThisPlayer ||
        (isActivePlayer &&
          match.turn.phase === "SUMMON_MAGIC" &&
          !focusedPlayer.turnFlags.normalSummonUsed));
    const canPlayMagicNow =
      !isMatchComplete &&
      canControlThisPlayer &&
      isActivePlayer &&
      !match.pendingPrompt &&
      !match.pendingChain &&
      !anyDiscardRequired &&
      !match.setup.primaryReplacementRequiredForPlayerId &&
      (match.turn.phase === "SUMMON_MAGIC" || match.turn.phase === "SECOND_MAGIC");

    if (isCreature(match, selectedCard)) {
      const requiredSacrifices = getRequiredSacrificesForCard(match, selectedCard);
      const selectedSacrifices = selectedSacrificeIdsByCard[cardInstanceId] ?? [];
      const hasEnoughSelectedSacrifices = selectedSacrifices.length >= requiredSacrifices;
      return canPlayPrimaryNow && hasEnoughSelectedSacrifices && canSummonCreatureFromHand(match, focusedPlayer, selectedCard)
        ? [`${focusedPlayerId}-primary`]
        : [];
    }
    if (isMagic(match, selectedCard)) {
      return canPlayMagicNow
        ? Array.from({ length: 5 }, (_, index) => `${focusedPlayerId}-magic-${index + 1}`)
          .filter(slotId => !occupiedSlotIds.has(slotId))
        : [];
    }
    return [] as string[];
  }, [controlledPlayerId, focusedPlayer, focusedPlayerId, handCards, match, occupiedSlotIds, selectedSacrificeIdsByCard]);
  const getVisualTargetSlotIdsForCard = useCallback((cardInstanceId: string) => {
    const selectedCard = handCards.find(card => card.instanceId === cardInstanceId);
    if (!selectedCard || !focusedPlayer) return [] as string[];
    const isMatchComplete = match.status === "COMPLETE";
    const anyDiscardRequired = Boolean(match.setup.handDiscardRequiredForPlayerId);
    const replacementRequiredForThisPlayer =
      match.setup.primaryReplacementRequiredForPlayerId === focusedPlayer.id;
    const limitedSummonPromotionRequiredForThisPlayer =
      replacementRequiredForThisPlayer && focusedPlayer.field.limitedSummons.length > 0;
    const canControlThisPlayer = !controlledPlayerId || controlledPlayerId === focusedPlayer.id;
    const isActivePlayer = match.turn.activePlayerId === focusedPlayer.id;
    const canPlayPrimaryNow =
      !isMatchComplete &&
      canControlThisPlayer &&
      !match.pendingPrompt &&
      !match.pendingChain &&
      !anyDiscardRequired &&
      !limitedSummonPromotionRequiredForThisPlayer &&
      (replacementRequiredForThisPlayer ||
        (isActivePlayer &&
          match.turn.phase === "SUMMON_MAGIC" &&
          !focusedPlayer.turnFlags.normalSummonUsed));

    if (isCreature(match, selectedCard) && canPlayPrimaryNow && canSummonCreatureFromHand(match, focusedPlayer, selectedCard)) {
      return [`${focusedPlayerId}-primary`];
    }

    return getLegalTargetSlotIdsForCard(cardInstanceId);
  }, [controlledPlayerId, focusedPlayer, focusedPlayerId, getLegalTargetSlotIdsForCard, handCards, match]);
  const visualTargetSlotIds = useMemo(() => {
    if (!selectedHandCardId) return [] as string[];
    return getVisualTargetSlotIdsForCard(selectedHandCardId);
  }, [getVisualTargetSlotIdsForCard, selectedHandCardId]);
  const sacrificeTargetSlotIds = sacrificeSelectionActive ? [sacrificeDropSlotId] : [];
  const sacrificeCandidatePieceIds = useMemo(() => {
    if (!sacrificeCandidateIds.size) return [] as string[];
    return boardObjects
      .filter(object => object.cardInstanceId && sacrificeCandidateIds.has(object.cardInstanceId))
      .map(object => object.id);
  }, [boardObjects, sacrificeCandidateIds]);
  const selectedEquipMagic = useMemo(() => {
    if (!selectedEquipMagicCardId) return null;
    const object = boardObjects.find(candidate => candidate.cardInstanceId === selectedEquipMagicCardId);
    if (!object || object.lane !== "magic") return null;
    const card = cardByInstanceId.get(selectedEquipMagicCardId);
    if (!card || !isEquipMagic(match, card) || card.attachedToInstanceId) return null;
    return { card, object };
  }, [boardObjects, cardByInstanceId, match, selectedEquipMagicCardId]);
  const canAttachSelectedEquipMagic = Boolean(
    selectedEquipMagic &&
    canControlPlayer(selectedEquipMagic.object.owner) &&
    !match.pendingPrompt &&
    !match.pendingChain &&
    !match.pendingEffectTargetPrompt &&
    !match.setup.handDiscardRequiredForPlayerId &&
    !match.setup.primaryReplacementRequiredForPlayerId
  );
  const equipAttachTargetOptions = useMemo(() => {
    if (!selectedEquipMagic || !canAttachSelectedEquipMagic) {
      return [] as Array<{ pieceId: string; playerId: BoardPlayerId; creatureInstanceId: string; targetKind: AttachTargetKind }>;
    }

    return boardObjects.flatMap(object => {
      if (!object.cardInstanceId || (object.lane !== "primary" && object.lane !== "limited")) return [];
      return [{
        pieceId: object.id,
        playerId: object.owner,
        creatureInstanceId: object.cardInstanceId,
        targetKind: object.lane === "primary" ? "PRIMARY_CREATURE" as const : "LIMITED_SUMMON" as const
      }];
    });
  }, [boardObjects, canAttachSelectedEquipMagic, selectedEquipMagic]);
  const equipAttachTargetPieceIds = useMemo(
    () => equipAttachTargetOptions.map(option => option.pieceId),
    [equipAttachTargetOptions]
  );
  const equipAttachSourcePieceIds = selectedEquipMagic ? [selectedEquipMagic.object.id] : [];
  const effectTargetBoardOptions = useMemo(() => {
    const prompt = match.pendingEffectTargetPrompt;
    if (!prompt) return [] as Array<{ optionId: string; pieceId?: string; slotId?: string }>;

    return prompt.options.flatMap(option => {
      if (!option.cardInstanceId) return [];
      const object = boardObjects.find(candidate => candidate.cardInstanceId === option.cardInstanceId);
      if (!object || !["primary", "limited", "magic"].includes(object.lane)) return [];
      return [{
        optionId: option.id,
        pieceId: object.id,
        slotId: object.slotId
      }];
    });
  }, [boardObjects, match.pendingEffectTargetPrompt]);
  const effectTargetSlotIds = useMemo(
    () => [...new Set(effectTargetBoardOptions.map(option => option.slotId).filter((slotId): slotId is string => !!slotId))],
    [effectTargetBoardOptions]
  );
  const effectTargetPieceIds = useMemo(
    () => [...new Set(effectTargetBoardOptions.map(option => option.pieceId).filter((pieceId): pieceId is string => !!pieceId))],
    [effectTargetBoardOptions]
  );
  const resolveBoardEffectTarget = (optionId: string) => {
    const prompt = match.pendingEffectTargetPrompt;
    if (!prompt) return;
    onResolveEffectTarget?.(prompt.id, optionId);
  };

  useEffect(() => {
    setSelectedSacrificeIdsByCard(current => {
      const handIds = new Set(handCards.map(card => card.instanceId));
      const candidateIds = new Set<string>();
      for (const player of match.players) {
        if (player.field.primaryCreature) candidateIds.add(player.field.primaryCreature.instanceId);
        for (const card of player.hand) candidateIds.add(card.instanceId);
      }

      const next: Record<string, string[]> = {};
      let changed = false;
      for (const [cardId, sacrificeIds] of Object.entries(current)) {
        if (!handIds.has(cardId)) {
          changed = true;
          continue;
        }
        const filtered = sacrificeIds.filter(id => candidateIds.has(id));
        if (filtered.length !== sacrificeIds.length) changed = true;
        if (filtered.length > 0) next[cardId] = filtered;
      }

      if (!changed && Object.keys(next).length === Object.keys(current).length) return current;
      return next;
    });
  }, [handCards, match.players]);

  useEffect(() => {
    if (!selectedEquipMagicCardId) return;
    const card = cardByInstanceId.get(selectedEquipMagicCardId);
    const object = boardObjects.find(candidate => candidate.cardInstanceId === selectedEquipMagicCardId);
    if (!card || !object || object.lane !== "magic" || !isEquipMagic(match, card) || card.attachedToInstanceId) {
      setSelectedEquipMagicCardId(null);
    }
  }, [boardObjects, cardByInstanceId, match, selectedEquipMagicCardId]);

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
    if (!selectedSlotId) return;
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
    if (!selectedSlotId) return;
    setSlotOffsets((current) => {
      const next = { ...current };
      delete next[selectedSlotId];
      return next;
    });
  };

  const resetCamera = () => {
    setTiltDegrees(DEFAULT_CAMERA_SETTINGS.tiltDegrees);
    setZoomScale(DEFAULT_CAMERA_SETTINGS.zoomScale);
    setHeightScale(DEFAULT_CAMERA_SETTINGS.heightScale);
    setBoardScaleX(DEFAULT_CAMERA_SETTINGS.boardScaleX);
    setBoardScaleZ(DEFAULT_CAMERA_SETTINGS.boardScaleZ);
    setBoardOffsetX(DEFAULT_CAMERA_SETTINGS.boardOffsetX);
    setBoardOffsetZ(DEFAULT_CAMERA_SETTINGS.boardOffsetZ);
    setCameraPanX(DEFAULT_CAMERA_SETTINGS.cameraPanX);
    setCameraPanY(DEFAULT_CAMERA_SETTINGS.cameraPanY);
  };

  const resetAllEditorState = () => {
    resetCamera();
    setSlotOffsets({});
    setZoneAdjustments({});
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

  const shouldMirrorBoardForViewer = presentation === "game" && focusedPlayerId === "player_2";

  const resolveBoardPoint = (xPercent: number, zPercent: number) => {
    const orientedX = shouldMirrorBoardForViewer ? 100 - xPercent : xPercent;
    const orientedZ = shouldMirrorBoardForViewer ? 100 - zPercent : zPercent;
    return {
      xPercent: Math.max(0, Math.min(100, 50 + (orientedX - 50) * boardScaleX + boardOffsetX)),
      zPercent: Math.max(0, Math.min(100, 50 + (orientedZ - 50) * boardScaleZ + boardOffsetZ))
    };
  };

  const resolvePosition = (slotId: string, fallbackX: number, fallbackZ: number) => {
    const raw = resolveSlotPosition(slotId, slotOffsets, fallbackX, fallbackZ);
    return resolveBoardPoint(raw.xPercent, raw.zPercent);
  };

  const resolveZoneRect = (zone: BoardZone): BoardZone => {
    const adjustment = zoneAdjustments[zone.id] ?? EMPTY_ZONE_ADJUSTMENT;
    const point = resolveBoardPoint(zone.xPercent + adjustment.x, zone.zPercent + adjustment.z);
    return {
      ...zone,
      xPercent: point.xPercent,
      zPercent: point.zPercent,
      widthPercent: Math.max(2, Math.min(100, zone.widthPercent + adjustment.width)),
      heightPercent: Math.max(2, Math.min(100, zone.heightPercent + adjustment.height))
    };
  };

  const slotOccupancy = BOARD_SLOTS.map((slot) => ({
    slot,
    occupant: boardObjects.find((object) => object.slotId === slot.id)
  }));

  const selectedSlot = slotOccupancy.find(({ slot }) => slot.id === selectedSlotId) ?? null;
  const selectedZone = BOARD_ZONES.find(zone => zone.id === selectedZoneId) ?? BOARD_ZONES[0]!;
  const selectedZoneAdjustment = zoneAdjustments[selectedZone.id] ?? EMPTY_ZONE_ADJUSTMENT;
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
    const effectTarget = effectTargetBoardOptions.find(option => option.slotId === slotId);
    if (effectTarget) {
      resolveBoardEffectTarget(effectTarget.optionId);
      return;
    }

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
    const effectTarget = effectTargetBoardOptions.find(option => option.pieceId === pieceId);
    if (effectTarget) {
      resolveBoardEffectTarget(effectTarget.optionId);
      return;
    }

    const attachTarget = equipAttachTargetOptions.find(option => option.pieceId === pieceId);
    if (selectedEquipMagic) {
      if (attachTarget) {
        if (!onAttachEquipMagicToCreature) {
          setStatusMessage("Equip attachment is unavailable in this preview.");
          return;
        }
        onAttachEquipMagicToCreature?.(
          selectedEquipMagic.object.owner,
          selectedEquipMagic.card.instanceId,
          attachTarget.playerId,
          attachTarget.creatureInstanceId,
          attachTarget.targetKind
        );
        setStatusMessage("Attaching Equip Magic.");
        setSelectedEquipMagicCardId(null);
        return;
      }

      const clickedSource = selectedEquipMagic.object.id === pieceId;
      if (clickedSource) {
        setSelectedEquipMagicCardId(null);
        setStatusMessage("Equip attachment canceled.");
        return;
      }
    }

    const piece = boardObjects.find(item => item.id === pieceId);
    const pieceCard = piece?.cardInstanceId ? cardByInstanceId.get(piece.cardInstanceId) : null;
    if (
      piece?.lane === "magic" &&
      pieceCard &&
      isEquipMagic(match, pieceCard) &&
      !pieceCard.attachedToInstanceId
    ) {
      if (!canControlPlayer(piece.owner)) {
        setStatusMessage("You cannot attach that Equip Magic.");
        return;
      }
      if (match.pendingPrompt || match.pendingChain || match.pendingEffectTargetPrompt || match.setup.handDiscardRequiredForPlayerId || match.setup.primaryReplacementRequiredForPlayerId) {
        setStatusMessage("Resolve the current prompt before attaching Equip Magic.");
        return;
      }
      setSelectedEquipMagicCardId(pieceCard.instanceId);
      setStatusMessage("Select a creature on the 3D board to attach this Equip Magic.");
      onPieceFocus?.({ pieceId, source });
      return;
    }

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
    resetSlotOffsets();
  };

  const adjustSelectedZone = (axis: keyof BoardZoneAdjustment, value: number) => {
    if (!selectedZone) return;
    setZoneAdjustments(current => ({
      ...current,
      [selectedZone.id]: {
        ...(current[selectedZone.id] ?? EMPTY_ZONE_ADJUSTMENT),
        [axis]: Number(value.toFixed(2))
      }
    }));
  };

  const resetSelectedZoneAdjustment = () => {
    if (!selectedZone) return;
    setZoneAdjustments(current => {
      const next = { ...current };
      delete next[selectedZone.id];
      return next;
    });
  };

  const resetZoneAdjustments = () => {
    setZoneAdjustments({});
  };
  const setVisibleSlotLayer = (layer: keyof VisibleSlotLayers, value: boolean) => {
    setVisibleSlotLayers(current => ({ ...current, [layer]: value }));
  };

  const emptySlotCount = slotOccupancy.length - occupiedSlotCount;
  const selectedOffset = selectedSlotId ? slotOffsets[selectedSlotId as BoardSlotId] ?? { x: 0, z: 0 } : { x: 0, z: 0 };
  const unresolvedBoardObjects = boardObjects.filter((object) => !slotById.has(object.slotId));
  const effectiveOwnerFilter = presentation === "game" ? "all" : ownerFilter;
  const filteredBoardObjects = (effectiveOwnerFilter === "all" ? boardObjects : boardObjects.filter((object) => object.owner === effectiveOwnerFilter))
    .filter(object => object.lane !== "hand");
  const pendingRevealPrompt = match.pendingPrompt;
  const boardDeckActions = match.players.filter(player => player.id === focusedPlayerId).map(player => {
    const owner: BoardPlayerId = player.id === "player_1" ? "player_1" : "player_2";
    const canControlThisPlayer = canControlPlayer(player.id);
    const isActivePlayer = match.turn.activePlayerId === player.id;
    const hasSummonableCreature = playerHasSummonableCreatureInHand(match, player);
    const canRequestNoCreatureRedraw =
      canControlThisPlayer &&
      isActivePlayer &&
      !pendingRevealPrompt &&
      !hasSummonableCreature &&
      match.turn.phase === "SUMMON_MAGIC";
    const isApprovingReveal = pendingRevealPrompt?.approvingPlayerId === player.id && canControlThisPlayer;
    const isRequestingReveal = pendingRevealPrompt?.requestingPlayerId === player.id;
    const handIsLocallyRevealed = Boolean(locallyRevealedHands[owner]) || revealedHandPlayerIds.includes(owner);
    const shouldShowHandControls =
      deckHandControlsOwner === owner ||
      handIsLocallyRevealed ||
      canRequestNoCreatureRedraw ||
      isApprovingReveal ||
      isRequestingReveal;
    return {
      player,
      owner,
      canControlThisPlayer,
      canAdvance: canControlThisPlayer && isActivePlayer && !pendingRevealPrompt,
      canUndo: canControlThisPlayer && Boolean(onUndoLastAction),
      canRequestNoCreatureRedraw,
      isApprovingReveal,
      isRequestingReveal,
      handIsLocallyRevealed,
      shouldShowHandControls
    };
  });
  const blockedReasonsBySlotId = useMemo<Record<string, string>>(() => {
    if (!selectedHandCardId) return {};
    const selectedCard = handCards.find(card => card.instanceId === selectedHandCardId);
    if (!selectedCard) return {};
    return Object.fromEntries(
      BOARD_SLOTS
        .filter(slot => !visualTargetSlotIds.includes(slot.id) && !sacrificeTargetSlotIds.includes(slot.id))
        .map(slot => [slot.id, `Cannot play ${match.cardCatalog[selectedCard.cardId]?.name ?? "this card"} to ${slot.label}`])
    );
  }, [handCards, match.cardCatalog, sacrificeTargetSlotIds, selectedHandCardId, visualTargetSlotIds]);

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
    if (!selectedSlotId) return;
    if (event.key === "ArrowLeft") nudgeSelectedSlot("x", -1);
    if (event.key === "ArrowRight") nudgeSelectedSlot("x", 1);
    if (event.key === "ArrowUp") nudgeSelectedSlot("z", -1);
    if (event.key === "ArrowDown") nudgeSelectedSlot("z", 1);
    if (event.key.startsWith("Arrow")) event.preventDefault();
    if (!event.shiftKey && event.key.toLowerCase() === "r") resetAllEditorState();
  };

  const handleIntegrationModeChange = (value: boolean) => {
    setIntegrationMode(value);
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
        <details className="board-preview-3d__hud-tab">
          <summary>{presentation === "game" ? "3D game board" : "3D board lab"}</summary>
          <div className="board-preview-3d__hud-tab-panel">
            {presentation === "lab" ? <p>Left: placement map. Right: 3D board prototype.</p> : null}
            <p>Occupied slots: {occupiedSlotCount} | Empty slots: {emptySlotCount} | Unresolved pieces: {unresolvedBoardObjects.length}</p>
            <p>Event queue: {animationQueue.queue.length} | Active: {animationQueue.activeEvent?.type ?? "none"} ({getBoardAnimationProfile(animationQueue.activeEvent?.type).label}) | Mode: {runtimeMode}</p>
            <p>Drag to pan | Wheel to zoom | WASD to move | +/- zoom | 0 reset</p>
            {intentLabel ? <p>Intent: {intentLabel}</p> : null}
            {commandLabel ? <p>Command: {commandLabel}</p> : null}
            <div>
              <button type="button" className="ghost" onClick={() => setControlsCollapsed(value => !value)}>{controlsCollapsed ? "Show HUD Controls" : "Hide HUD Controls"}</button>
              <button type="button" className="ghost" onClick={cycleControlsDockPosition}>Move HUD Controls</button>
              {actionDock ? <button type="button" className="ghost" onClick={() => setActionDockCollapsed(value => !value)}>{actionDockCollapsed ? "Show Action Dock" : "Hide Action Dock"}</button> : null}
              {actionDock && !actionDockCollapsed ? <button type="button" className="ghost" onClick={cycleActionDockPosition}>Move Action Dock</button> : null}
              <button type="button" className="ghost" onClick={() => {
                setShowDebugPanel(true);
              }}>Show Debug HUD</button>
              <button type="button" className="ghost" onClick={() => setShowDebugPanel(false)}>Hide Debug HUD</button>
            </div>
          </div>
        </details>
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
      {integrationMode ? <p className="board-preview-3d__status">Integration mode enabled: gameplay dispatch wiring is active.</p> : null}

      {statusMessage ? <p className="board-preview-3d__status">{statusMessage}</p> : null}
      {lastCopiedLabel ? <p className="board-preview-3d__status">Last copied: {lastCopiedLabel}</p> : null}

      <div className="board-preview-3d__layout">
        {presentation === "lab" ? (
          <BoardPreview3DMiniMap
            showAnchors={showAnchors}
            selectedSlotId={selectedSlotId}
            filteredBoardObjects={filteredBoardObjects}
            resolveSlotPosition={resolvePosition}
            resolveBoardPoint={resolveBoardPoint}
            resolveZoneRect={resolveZoneRect}
            onSelectSlot={(slotId) => selectSlot(slotId, "mini-map")}
            onSelectPiece={(pieceId) => selectPiece(pieceId, "mini-map")}
          />
        ) : null}
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
            showZoneRects={showZoneRects}
            visibleSlotLayers={visibleSlotLayers}
            selectedSlotId={selectedSlotId}
            filteredBoardObjects={filteredBoardObjects}
            resolveSlotPosition={resolvePosition}
            resolveBoardPoint={resolveBoardPoint}
            resolveZoneRect={resolveZoneRect}
            onSelectSlot={(slotId) => selectSlot(slotId, "table")}
            onDeckSlotClick={onDeckSlotClick}
            onPlayHandCardToSlot={(slotId) => {
              if (!selectedHandCardId) return;
              if (!getLegalTargetSlotIdsForCard(selectedHandCardId).includes(slotId)) {
                setStatusMessage("That card cannot be played to that 3D board slot right now.");
                return;
              }
              onPlayHandCardToSlot?.(selectedHandCardId, slotId, selectedSacrificeIds);
              setSelectedSacrificeIdsByCard(current => {
                const next = { ...current };
                delete next[selectedHandCardId];
                return next;
              });
              setSelectedHandCardId(null);
            }}
            onDropHandCardToSlot={(slotId, cardInstanceId) => {
              if (!getLegalTargetSlotIdsForCard(cardInstanceId).includes(slotId)) {
                setStatusMessage("That card cannot be dropped there right now.");
                return;
              }
              const sacrificeIds = (selectedSacrificeIdsByCard[cardInstanceId] ?? []).filter(id => sacrificeCandidateIds.has(id));
              onPlayHandCardToSlot?.(cardInstanceId, slotId, sacrificeIds);
              setSelectedSacrificeIdsByCard(current => {
                const next = { ...current };
                delete next[cardInstanceId];
                return next;
              });
              setSelectedHandCardId(null);
            }}
            onSelectPiece={(pieceId) => selectPiece(pieceId, "table")}
            onSelectHandCard={(cardInstanceId) => setSelectedHandCardId(current => current === cardInstanceId ? null : cardInstanceId)}
            onHandCardDragStart={(cardInstanceId) => setSelectedHandCardId(cardInstanceId)}
            onToggleSacrificeCard={toggleSacrificeSelection}
            sacrificeCandidateCardIds={[...sacrificeCandidateIds]}
            selectedSacrificeCardIds={selectedSacrificeIds}
            onDeckStackContextMenu={(owner) => {
              if (owner !== focusedPlayerId) return;
              setDeckActionsExpanded(true);
              setDeckHandControlsOwner(owner);
            }}
            draggableHandCardIds={handCards.map(card => card.instanceId)}
            highlightedSlotIds={[...animationHighlights.slotIds, ...visualTargetSlotIds, ...sacrificeTargetSlotIds, ...battleTargetSlotIds, ...effectTargetSlotIds]}
            highlightedPieceIds={[...animationHighlights.pieceIds, ...sacrificeCandidatePieceIds, ...effectTargetPieceIds, ...equipAttachSourcePieceIds, ...equipAttachTargetPieceIds]}
            activeEventType={activeEvent?.type ?? null}
            match={match}
            cardByInstanceId={cardByInstanceId}
            blockedReasonsBySlotId={blockedReasonsBySlotId}
          />
          <OpeningRollBoardControl
            match={match}
            controlledPlayerId={controlledPlayerId}
            onOpeningRoll={onOpeningRoll}
          />
          {boardDeckActions.map(action => (
            <div
              key={`${action.owner}-deck-actions`}
              className={`board-preview-3d__deck-actions board-preview-3d__deck-actions--${action.owner}${action.shouldShowHandControls ? " has-hand-controls" : ""}${deckActionsExpanded ? " is-expanded" : " is-collapsed"}`}
            >
              <button
                type="button"
                className="board-preview-3d__deck-actions-menu"
                onClick={() => {
                  setDeckActionsExpanded(current => !current);
                  setDeckHandControlsOwner(action.owner);
                }}
                aria-expanded={deckActionsExpanded}
              >
                <span aria-hidden="true"><i /><i /><i /></span>
                Menu
              </button>
              <div className="board-preview-3d__deck-actions-panel">
                <button type="button" disabled={!action.canAdvance || !onAdvancePhase} onClick={onAdvancePhase}>
                  Advance
                </button>
                <button type="button" disabled={!action.canUndo} onClick={onUndoLastAction}>
                  Undo
                </button>
                {action.shouldShowHandControls ? (
                  <>
                    <button
                      type="button"
                      className="is-hand-control"
                      onClick={() => {
                        const nextRevealed = !action.handIsLocallyRevealed;
                        setLocallyRevealedHands(current => ({
                          ...current,
                          [action.owner]: nextRevealed
                        }));
                        onSetHandRevealed?.(action.owner, nextRevealed);
                      }}
                      title="Toggle this hand face-up on the 3D board for manual reveal effects."
                    >
                      {action.handIsLocallyRevealed ? "Hide Hand" : "Reveal Hand"}
                    </button>
                    {action.isApprovingReveal ? (
                      <button type="button" className="is-emphasis is-hand-control" onClick={onApproveRevealRedraw} disabled={!onApproveRevealRedraw}>
                        Accept Hand
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={`${action.canRequestNoCreatureRedraw ? "is-emphasis " : ""}is-hand-control`}
                        disabled={!action.canRequestNoCreatureRedraw}
                        onClick={() => {
                          setLocallyRevealedHands(current => ({
                            ...current,
                            [action.owner]: true
                          }));
                          onRequestNoCreatureRedraw?.(action.owner);
                        }}
                        title="Reveal this hand and request a no-creature redraw."
                      >
                        {action.isRequestingReveal ? "Mulligan Pending" : "Mulligan Reveal"}
                      </button>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          ))}
          {actionDock && !actionDockCollapsed ? (
            <div className={`board-preview-3d__action-dock board-preview-3d__action-dock--${actionDockPosition}`}>
              <div className="board-preview-3d__floating-title">
                <strong>Action Dock</strong>
                <button type="button" className="ghost" onClick={cycleActionDockPosition}>Move</button>
                <button type="button" className="ghost" onClick={() => setActionDockCollapsed(true)}>Hide</button>
              </div>
              {actionDock}
            </div>
          ) : null}
          {handCards.length > 0 ? (
            <section className="board-preview-3d__hand-rail" aria-label="3D board hand rail">
              <div className="board-preview-3d__hand-rail-tab">Hand {handCards.length}</div>
              <div className="board-preview-3d__hand-rail-cards">
                {handCards.map(card => (
                  <button
                    key={card.instanceId}
                    type="button"
                    draggable
                    className={[
                      selectedHandCardId === card.instanceId ? "is-selected" : "",
                      sacrificeCandidateIds.has(card.instanceId) ? "is-sacrifice-candidate" : "",
                      selectedSacrificeIdSet.has(card.instanceId) ? "is-selected-sacrifice" : ""
                    ].filter(Boolean).join(" ") || undefined}
                    onClick={() => {
                      if (sacrificeCandidateIds.has(card.instanceId) && selectedHandCardId !== card.instanceId) {
                        toggleSacrificeSelection(card.instanceId);
                        return;
                      }
                      setSelectedHandCardId(current => current === card.instanceId ? null : card.instanceId);
                    }}
                    onFocus={() => setHoveredHandCardId(card.instanceId)}
                    onMouseEnter={() => setHoveredHandCardId(card.instanceId)}
                    onBlur={() => setHoveredHandCardId(current => current === card.instanceId ? null : current)}
                    onMouseLeave={() => setHoveredHandCardId(current => current === card.instanceId ? null : current)}
                    onDragStart={(event) => {
                      if (!sacrificeCandidateIds.has(card.instanceId)) {
                        setSelectedHandCardId(card.instanceId);
                      }
                      event.dataTransfer.setData("application/x-ward-board-hand-card", card.instanceId);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    <MatchCardImage match={match} card={card} className="board-preview-3d__hand-card-art" />
                    <span>{match.cardCatalog[card.cardId]?.name ?? card.cardId}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {inspectedHandCard ? (
            <aside className="board-preview-3d__card-inspector board-preview-3d__card-inspector--hand" aria-label="Hand card preview">
              <div className="board-preview-3d__card-inspector-header">
                <strong>{getCardName(match, inspectedHandCard)}</strong>
                <span>{isCreature(match, inspectedHandCard) ? "Creature" : isMagic(match, inspectedHandCard) ? getMagicLine(match, inspectedHandCard) : "Card"}</span>
                {selectedHandCardId === inspectedHandCard.instanceId && sacrificeSelectionActive ? (
                  <small className={sacrificeSelectionComplete ? "is-complete" : undefined}>
                    Sacrifice {selectedSacrificeIds.length}/{selectedSummonRequiredSacrifices}
                  </small>
                ) : null}
              </div>
              <MatchCardImage match={match} card={inspectedHandCard} className="board-preview-3d__card-inspector-art" />
              {inspectedHandCreatureStats ? (
                <div className="board-preview-3d__card-inspector-stat-wall">
                  <div className={`board-preview-3d__card-inspector-hp board-preview-3d__card-inspector-hp--${inspectedHandCreatureStats.hpTone}`}>
                    <span>HP</span>
                    <strong>{inspectedHandCreatureStats.currentHp}</strong>
                    <small>/ {inspectedHandCreatureStats.baseHp}</small>
                  </div>
                  <span>AL <strong>{inspectedHandCreatureStats.armorLevel}</strong></span>
                  <span>SPD <strong>{inspectedHandCreatureStats.speed}</strong></span>
                  <span>ATK <strong>{inspectedHandCreatureStats.attackDice}D6</strong></span>
                  <span>MOD <strong>{inspectedHandCreatureStats.modifier}</strong></span>
                </div>
              ) : null}
              {selectedHandCardId === inspectedHandCard.instanceId && sacrificeSelectionActive ? (
                <div className="board-preview-3d__sacrifice-tracker">
                  <div className="board-preview-3d__sacrifice-tracker-title">
                    <span>Sacrifices</span>
                    <strong>{selectedSacrificeIds.length}/{selectedSummonRequiredSacrifices}</strong>
                  </div>
                  <div className="board-preview-3d__sacrifice-meter" aria-hidden="true">
                    {Array.from({ length: selectedSummonRequiredSacrifices }, (_, index) => (
                      <i key={index} className={index < selectedSacrificeIds.length ? "is-filled" : undefined} />
                    ))}
                  </div>
                  <div className="board-preview-3d__sacrifice-candidates">
                    {sacrificeCandidates.map(candidate => {
                      const selected = selectedSacrificeIdSet.has(candidate.instanceId);
                      return (
                        <button
                          type="button"
                          key={candidate.instanceId}
                          className={selected ? "is-selected" : undefined}
                          onClick={() => toggleSacrificeSelection(candidate.instanceId)}
                        >
                          <span>{getCardName(match, candidate)}</span>
                          <small>{candidate.zone === "PRIMARY_CREATURE" ? "Primary" : "Hand"}</small>
                        </button>
                      );
                    })}
                  </div>
                  <p>Drag valid sacrifices to your cemetery or tap them here, then play this creature to Primary.</p>
                </div>
              ) : null}
              <div className="board-preview-3d__card-inspector-copy">
                {isCreature(match, inspectedHandCard) ? <span>{getCreatureStatsLine(match, inspectedHandCard)}</span> : null}
                {isMagic(match, inspectedHandCard) ? <span>{getMagicLine(match, inspectedHandCard)}</span> : null}
                {getCardText(match, inspectedHandCard) ? <p>{getCardText(match, inspectedHandCard)}</p> : null}
              </div>
            </aside>
          ) : null}
          {opponentPlayer && opponentPlayer.hand.length > 0 ? (
            <section className="board-preview-3d__hand-rail board-preview-3d__hand-rail--opponent" aria-label={`${opponentPlayer.displayName} ${visibleOpponentHandCards.length > 0 ? "revealed" : "hidden"} hand`}>
              <div className="board-preview-3d__hand-rail-tab">
                Opponent Hand {opponentPlayer.hand.length}{visibleOpponentHandCards.length > 0 ? " Revealed" : ""}
              </div>
              <div className="board-preview-3d__hand-rail-cards" aria-hidden={visibleOpponentHandCards.length === 0 ? "true" : undefined}>
                {visibleOpponentHandCards.length > 0
                  ? visibleOpponentHandCards.slice(0, 10).map(card => (
                    <div className="board-preview-3d__revealed-hand-card" key={card.instanceId}>
                      <MatchCardImage match={match} card={card} className="board-preview-3d__hand-card-art" />
                      <span>{match.cardCatalog[card.cardId]?.name ?? card.cardId}</span>
                    </div>
                  ))
                  : opponentPlayer.hand.slice(0, 10).map((card, index) => (
                    <div className="board-preview-3d__hidden-hand-card" key={`${card.instanceId}-${index}`}>
                      WARD
                    </div>
                  ))}
              </div>
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
        {showDebugPanel ? (
          <aside className="board-preview-3d__debug-drawer">
            <BoardPreview3DDebugPanel
              show={showDebugPanel}
              showZoneRects={showZoneRects}
              setShowZoneRects={setShowZoneRects}
              showAnchors={showAnchors}
              setShowAnchors={setShowAnchors}
              visibleSlotLayers={visibleSlotLayers}
              setVisibleSlotLayer={setVisibleSlotLayer}
              selectedSlot={selectedSlot}
              selectedSlotId={selectedSlotId}
              selectedSlotIndex={selectedSlotIndex}
              slotCount={BOARD_SLOTS.length}
              selectedOffset={selectedOffset}
              selectedZoneId={selectedZone.id}
              selectedZone={selectedZone}
              selectedZoneAdjustment={selectedZoneAdjustment}
              nudgeStep={nudgeStep}
              setNudgeStep={setNudgeStep}
              onNudge={nudgeSelectedSlot}
              onSelectZone={setSelectedZoneId}
              onZoneAdjust={adjustSelectedZone}
              onResetSelectedZone={resetSelectedZoneAdjustment}
              onResetZoneAdjustments={resetZoneAdjustments}
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
              readOnly={false}
            />
          </aside>
        ) : null}
      </div>
    </section>
  );
}
