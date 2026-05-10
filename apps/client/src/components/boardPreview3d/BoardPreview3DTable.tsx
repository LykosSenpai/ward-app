import { useState, type CSSProperties } from "react";
import { BOARD_SLOTS, BOARD_ZONES, ZONE_ANCHORS, type BoardZone } from "../boardPreview3dLayout";
import type { BoardObject } from "../boardPreview3dAdapter";
import type { BoardRenderEventType } from "../boardRenderContracts";
import type { CardInstance } from "@ward/shared";
import type { AppMatchState } from "../../clientTypes";
import { MatchCardImage } from "../MatchCardImage";
import { getCardName, getCardText, getCreatureStatsLine, getEffectiveCreatureStat, getMagicLine, isCreature, isMagic } from "../../gameViewHelpers";
import { BoardPreview3DWebGLCards } from "./BoardPreview3DWebGLCards";

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
  showZoneRects: boolean;
  visibleSlotLayers: {
    primary: boolean;
    limited: boolean;
    magic: boolean;
    stacks: boolean;
    hand: boolean;
  };
  selectedSlotId: string | null;
  filteredBoardObjects: BoardObject[];
  resolveSlotPosition: (slotId: string, fallbackX: number, fallbackZ: number) => { xPercent: number; zPercent: number };
  resolveBoardPoint: (xPercent: number, zPercent: number) => { xPercent: number; zPercent: number };
  resolveZoneRect: (zone: BoardZone) => BoardZone;
  onSelectSlot: (slotId: string) => void;
  onDeckSlotClick?: (slotId: string) => void;
  onPlayHandCardToSlot?: (slotId: string) => void;
  onDropHandCardToSlot?: (slotId: string, cardInstanceId: string) => void;
  onSelectPiece?: (pieceId: string) => void;
  onDeckStackContextMenu?: (owner: "player_1" | "player_2") => void;
  onSelectHandCard?: (cardInstanceId: string) => void;
  onHandCardDragStart?: (cardInstanceId: string) => void;
  onToggleSacrificeCard?: (cardInstanceId: string) => void;
  draggableHandCardIds?: string[];
  sacrificeCandidateCardIds?: string[];
  selectedSacrificeCardIds?: string[];
  highlightedSlotIds?: string[];
  highlightedPieceIds?: string[];
  activeEventType?: BoardRenderEventType | null;
  match: AppMatchState;
  cardByInstanceId: Map<string, CardInstance>;
  blockedReasonsBySlotId?: Record<string, string>;
};

function getCreatureOverlayStats(match: AppMatchState, card: CardInstance) {
  const definition = match.cardCatalog[card.cardId];
  if (definition?.cardType !== "CREATURE") return null;

  const baseHp = Number(card.baseHp ?? definition.hp);
  const currentHp = Number(card.currentHp ?? baseHp);
  const hpPercent = baseHp > 0 ? Math.max(0, Math.min(100, (currentHp / baseHp) * 100)) : 0;
  const hpTone = hpPercent <= 30 ? "danger" : hpPercent <= 60 ? "warn" : "healthy";
  const attackDice = getEffectiveCreatureStat(card, "attackDice", definition.attackDice);
  const modifier = getEffectiveCreatureStat(card, "modifier", definition.modifier);

  return {
    armorLevel: getEffectiveCreatureStat(card, "armorLevel", definition.armorLevel),
    attackDice,
    baseHp,
    currentHp,
    hpPercent,
    hpTone,
    modifier,
    speed: getEffectiveCreatureStat(card, "speed", definition.speed)
  };
}

export function BoardPreview3DTable({ zoomScale, cameraPanX, cameraPanY, tiltDegrees, heightScale, showAnchors, showZoneRects, visibleSlotLayers, selectedSlotId, filteredBoardObjects, resolveSlotPosition, resolveBoardPoint, resolveZoneRect, onSelectSlot, onDeckSlotClick, onPlayHandCardToSlot, onDropHandCardToSlot, onSelectPiece, onDeckStackContextMenu, onSelectHandCard, onHandCardDragStart, onToggleSacrificeCard, draggableHandCardIds, sacrificeCandidateCardIds, selectedSacrificeCardIds, highlightedSlotIds, highlightedPieceIds, match, cardByInstanceId, blockedReasonsBySlotId }: Props) {
  const highlightedSet = new Set(highlightedSlotIds ?? []);
  const highlightedPieceSet = new Set(highlightedPieceIds ?? []);
  const draggableHandCardSet = new Set(draggableHandCardIds ?? []);
  const sacrificeCandidateSet = new Set(sacrificeCandidateCardIds ?? []);
  const selectedSacrificeSet = new Set(selectedSacrificeCardIds ?? []);
  const [hoveredSlotId, setHoveredSlotId] = useState<string | null>(null);
  const [hoveredFieldCardId, setHoveredFieldCardId] = useState<string | null>(null);
  const [pinnedFieldCardId, setPinnedFieldCardId] = useState<string | null>(null);
  const hasHandCardDragPayload = (types: Iterable<string>) =>
    Array.from(types).includes("application/x-ward-board-hand-card");
  const inspectedFieldCardId = pinnedFieldCardId ?? hoveredFieldCardId;
  const inspectedFieldCard = inspectedFieldCardId ? cardByInstanceId.get(inspectedFieldCardId) ?? null : null;
  const inspectedCreatureStats = inspectedFieldCard ? getCreatureOverlayStats(match, inspectedFieldCard) : null;
  const visibleSlots = BOARD_SLOTS.filter(slot => {
    if (highlightedSet.has(slot.id)) return true;
    if (slot.id.includes("-primary")) return visibleSlotLayers.primary;
    if (slot.id.includes("-limited-")) return visibleSlotLayers.limited;
    if (slot.id.includes("-magic-")) return visibleSlotLayers.magic;
    if (slot.id.includes("-deck") || slot.id.includes("-cemetery")) return visibleSlotLayers.stacks;
    if (slot.id.includes("-hand-")) return visibleSlotLayers.hand;
    return false;
  });
  const cameraStyle = {
    "--board-camera-scale": zoomScale.toFixed(2),
    transform: `translate3d(${cameraPanX}%, ${cameraPanY}%, 0)`
  } as CSSProperties;

  return (
    <div className="board-preview-3d__camera has-webgl-cards" style={cameraStyle}>
      <div className="board-preview-3d__table" style={{ transform: `translate(-50%, -50%) rotateX(${tiltDegrees}deg) translateZ(-20px)` }}>
        <div className="board-preview-3d__grid" aria-hidden="true" />
        <BoardPreview3DWebGLCards
          cardByInstanceId={cardByInstanceId}
          filteredBoardObjects={filteredBoardObjects}
          heightScale={heightScale}
          match={match}
          resolveSlotPosition={resolveSlotPosition}
        />
        {showZoneRects ? BOARD_ZONES.map((zone) => {
          const rect = resolveZoneRect(zone);
          return (
            <div key={zone.id} className="board-preview-3d__zone" style={{
              left: `${rect.xPercent}%`,
              top: `${rect.zPercent}%`,
              width: `${rect.widthPercent}%`,
              height: `${rect.heightPercent}%`,
              transform: `translate(-50%, -50%) rotate(${rect.rotationDeg ?? 0}deg)`
            }}><span>{rect.label}</span></div>
          );
        }) : null}
        {showAnchors ? ZONE_ANCHORS.map((zone) => {
          const point = resolveBoardPoint(zone.xPercent, zone.zPercent);
          return (
            <div key={zone.id} className="board-preview-3d__zone-anchor" style={{ left: `${point.xPercent}%`, top: `${point.zPercent}%` }}>
              <span>{zone.label}</span>
            </div>
          );
        }) : null}
        {visibleSlots.map((slot) => (
          <div
            key={slot.id}
            className={`board-preview-3d__slot board-preview-3d__slot--${slot.owner}${selectedSlotId === slot.id ? " is-selected" : ""}${highlightedSet.has(slot.id) ? " is-highlighted" : ""}${blockedReasonsBySlotId?.[slot.id] ? " is-blocked" : ""}${hoveredSlotId === slot.id ? " is-hovered" : ""}`}
            style={{
              left: `${resolveSlotPosition(slot.id, slot.xPercent, slot.zPercent).xPercent}%`,
              top: `${resolveSlotPosition(slot.id, slot.xPercent, slot.zPercent).zPercent}%`
            }}
            onDragOver={(event) => {
              if (!hasHandCardDragPayload(event.dataTransfer.types) || blockedReasonsBySlotId?.[slot.id]) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setHoveredSlotId(slot.id);
            }}
            onDrop={(event) => {
              setHoveredSlotId(null);
              const cardInstanceId = event.dataTransfer.getData("application/x-ward-board-hand-card");
              if (!cardInstanceId || blockedReasonsBySlotId?.[slot.id]) return;
              event.preventDefault();
              if (slot.id.endsWith("-cemetery") && sacrificeCandidateSet.has(cardInstanceId)) {
                onToggleSacrificeCard?.(cardInstanceId);
                return;
              }
              onDropHandCardToSlot?.(slot.id, cardInstanceId);
            }}
            onDragLeave={() => setHoveredSlotId(current => current === slot.id ? null : current)}
            onMouseEnter={() => setHoveredSlotId(slot.id)}
            onMouseLeave={() => setHoveredSlotId(current => current === slot.id ? null : current)}
            title={blockedReasonsBySlotId?.[slot.id] ?? ""}
          >
            <button type="button" onClick={() => {
              onSelectSlot(slot.id);
              if (!blockedReasonsBySlotId?.[slot.id]) {
                onPlayHandCardToSlot?.(slot.id);
              }
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
        {filteredBoardObjects.map((object) => {
          const draggableHandCardId =
            object.lane === "hand" &&
            object.cardInstanceId &&
            draggableHandCardSet.has(object.cardInstanceId)
              ? object.cardInstanceId
              : null;
          const isCardBack = object.lane === "hand" && !object.cardInstanceId;
          const renderedCard = object.cardInstanceId ? cardByInstanceId.get(object.cardInstanceId) : null;
          const isFieldCard = ["primary", "limited", "magic"].includes(object.lane);
          const isStack = object.lane === "deck" || object.lane === "cemetery";
          const isSacrificeCandidate = Boolean(object.cardInstanceId && sacrificeCandidateSet.has(object.cardInstanceId));
          const isSelectedSacrifice = Boolean(object.cardInstanceId && selectedSacrificeSet.has(object.cardInstanceId));
          const canInspectCard = Boolean(renderedCard && isFieldCard);
          const creatureStats = renderedCard && isFieldCard ? getCreatureOverlayStats(match, renderedCard) : null;
          const showPieceLabel = !renderedCard && !isCardBack && !isStack;
          return (
            <article
              key={object.id}
              draggable={Boolean(draggableHandCardId || isSacrificeCandidate)}
              className={`board-preview-3d__piece board-preview-3d__piece--${object.owner} board-preview-3d__piece--${object.lane}${draggableHandCardId ? " is-draggable-hand-card" : ""}${isSacrificeCandidate ? " is-sacrifice-candidate" : ""}${isSelectedSacrifice ? " is-selected-sacrifice" : ""}${highlightedPieceSet.has(object.id) ? " is-highlighted" : ""}${isCardBack ? " is-card-back" : ""}`}
            style={{
              left: `${resolveSlotPosition(object.slotId, object.xPercent, object.zPercent).xPercent}%`,
              top: `${resolveSlotPosition(object.slotId, object.xPercent, object.zPercent).zPercent}%`,
              transform: `translate(-50%, -50%) translateZ(${(object.yDepth * heightScale).toFixed(1)}px)`
            }}
            onDragStart={(event) => {
              const dragCardId = draggableHandCardId ?? (isSacrificeCandidate ? object.cardInstanceId : null);
              if (!dragCardId) return;
              if (draggableHandCardId) onHandCardDragStart?.(draggableHandCardId);
              event.dataTransfer.setData("application/x-ward-board-hand-card", dragCardId);
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
              if (object.lane !== "cemetery" || !hasHandCardDragPayload(event.dataTransfer.types)) return;
              const slotBlocked = blockedReasonsBySlotId?.[object.slotId];
              if (slotBlocked) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              if (object.lane !== "cemetery") return;
              const cardInstanceId = event.dataTransfer.getData("application/x-ward-board-hand-card");
              if (!cardInstanceId || !sacrificeCandidateSet.has(cardInstanceId)) return;
              event.preventDefault();
              onToggleSacrificeCard?.(cardInstanceId);
            }}
            onContextMenu={(event) => {
              if (object.lane !== "deck") return;
              event.preventDefault();
              onDeckStackContextMenu?.(object.owner);
            }}
            onMouseEnter={() => {
              if (canInspectCard && object.cardInstanceId) setHoveredFieldCardId(object.cardInstanceId);
            }}
            onMouseLeave={() => {
              if (object.cardInstanceId) setHoveredFieldCardId(current => current === object.cardInstanceId ? null : current);
            }}
          >
            <button type="button" onFocus={() => {
              if (canInspectCard && object.cardInstanceId) setHoveredFieldCardId(object.cardInstanceId);
            }} onBlur={() => {
              if (object.cardInstanceId) setHoveredFieldCardId(current => current === object.cardInstanceId ? null : current);
            }} onClick={() => {
              if (draggableHandCardId) {
                onSelectHandCard?.(draggableHandCardId);
                return;
              }
              if (isSacrificeCandidate && object.cardInstanceId) {
                onToggleSacrificeCard?.(object.cardInstanceId);
                return;
              }
              if (object.lane === "deck") {
                onDeckSlotClick?.(object.slotId);
                onSelectPiece?.(object.id);
                return;
              }
              if (canInspectCard && object.cardInstanceId) {
                setPinnedFieldCardId(current => current === object.cardInstanceId ? null : object.cardInstanceId!);
              }
              onSelectPiece?.(object.id);
            }}>
              {renderedCard ? (
                <MatchCardImage className="board-preview-3d__piece-card-art" match={match} card={renderedCard} />
              ) : null}
              {showPieceLabel ? <span>{object.label}</span> : null}
            </button>
            {isStack ? <span className="board-preview-3d__stack-label">{object.label}</span> : null}
            {creatureStats ? (
              <div className={`board-preview-3d__field-stat-plate board-preview-3d__field-stat-plate--${creatureStats.hpTone}`}>
                <span>HP</span>
                <strong>{creatureStats.currentHp}</strong>
                <span>/ {creatureStats.baseHp}</span>
              </div>
            ) : null}
          </article>
          );
        })}
      </div>
      {inspectedFieldCard ? (
        <aside className={`board-preview-3d__card-inspector${pinnedFieldCardId ? " is-pinned" : ""}`} aria-label="Card preview">
          {pinnedFieldCardId ? (
            <button type="button" className="board-preview-3d__card-inspector-close" onClick={() => setPinnedFieldCardId(null)} aria-label="Close card preview">
              x
            </button>
          ) : null}
          <div className="board-preview-3d__card-inspector-header">
            <strong>{getCardName(match, inspectedFieldCard)}</strong>
            <span>{isCreature(match, inspectedFieldCard) ? "Creature" : isMagic(match, inspectedFieldCard) ? getMagicLine(match, inspectedFieldCard) : "Card"}</span>
          </div>
          <MatchCardImage match={match} card={inspectedFieldCard} className="board-preview-3d__card-inspector-art" />
          {inspectedCreatureStats ? (
            <div className="board-preview-3d__card-inspector-stat-wall">
              <div className={`board-preview-3d__card-inspector-hp board-preview-3d__card-inspector-hp--${inspectedCreatureStats.hpTone}`}>
                <span>HP</span>
                <strong>{inspectedCreatureStats.currentHp}</strong>
                <small>/ {inspectedCreatureStats.baseHp}</small>
              </div>
              <span>AL <strong>{inspectedCreatureStats.armorLevel}</strong></span>
              <span>SPD <strong>{inspectedCreatureStats.speed}</strong></span>
              <span>ATK <strong>{inspectedCreatureStats.attackDice}D6</strong></span>
              <span>MOD <strong>{inspectedCreatureStats.modifier}</strong></span>
            </div>
          ) : null}
          <div className="board-preview-3d__card-inspector-copy">
            {isCreature(match, inspectedFieldCard) ? <span>{getCreatureStatsLine(match, inspectedFieldCard)}</span> : null}
            {isMagic(match, inspectedFieldCard) ? <span>{getMagicLine(match, inspectedFieldCard)}</span> : null}
            {getCardText(match, inspectedFieldCard) ? <p>{getCardText(match, inspectedFieldCard)}</p> : null}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
