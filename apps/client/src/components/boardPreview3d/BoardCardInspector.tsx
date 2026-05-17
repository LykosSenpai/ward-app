import type { CardInstance } from "@ward/shared";
import type { ReactNode } from "react";
import type { AppMatchState } from "../../clientTypes";
import {
  getCardName,
  getCardText,
  getCreatureStatsLine,
  getEffectiveCreatureStat,
  getMagicLine,
  isCreature,
  isMagic
} from "../../gameViewHelpers";
import { MatchCardImage } from "../MatchCardImage";

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

export function getBoardCardInspectorStats(match: AppMatchState, card: CardInstance) {
  return getCreatureOverlayStats(match, card);
}

function BoardCardInspectorStats({ creatureStats }: { creatureStats: ReturnType<typeof getCreatureOverlayStats> }) {
  if (!creatureStats) return null;

  return (
    <div className="board-preview-3d__card-inspector-stat-wall board-preview-3d__card-inspector-stat-wall--header">
      <div className={`board-preview-3d__card-inspector-hp board-preview-3d__card-inspector-hp--${creatureStats.hpTone}`}>
        <span>HP</span>
        <strong>{creatureStats.currentHp}</strong>
        <small>/ {creatureStats.baseHp}</small>
      </div>
      <span>AL <strong>{creatureStats.armorLevel}</strong></span>
      <span>SPD <strong>{creatureStats.speed}</strong></span>
      <span>ATK <strong>{creatureStats.attackDice}D6</strong></span>
      <span>MOD <strong>{creatureStats.modifier}</strong></span>
    </div>
  );
}

type BoardCardInspectorProps = {
  ariaLabel: string;
  card: CardInstance;
  className?: string;
  detailsExpanded?: boolean;
  extraHeader?: ReactNode;
  match: AppMatchState;
  onClose?: () => void;
  onRelatedCardFocus?: (cardInstanceId: string) => void;
  onToggleDetails?: () => void;
  pinned?: boolean;
  showDetails?: boolean;
  children?: ReactNode;
};

type FieldCardReference = {
  card: CardInstance;
  playerId: string;
  playerName: string;
  zone: "PRIMARY_CREATURE" | "LIMITED_SUMMON" | "MAGIC_SLOT";
};

function getFieldCardReferences(match: AppMatchState): FieldCardReference[] {
  return match.players.flatMap(player => {
    const references: FieldCardReference[] = [];

    if (player.field.primaryCreature) {
      references.push({
        card: player.field.primaryCreature,
        playerId: player.id,
        playerName: player.displayName,
        zone: "PRIMARY_CREATURE"
      });
    }

    for (const card of player.field.limitedSummons) {
      references.push({
        card,
        playerId: player.id,
        playerName: player.displayName,
        zone: "LIMITED_SUMMON"
      });
    }

    for (const card of player.field.magicSlots) {
      references.push({
        card,
        playerId: player.id,
        playerName: player.displayName,
        zone: "MAGIC_SLOT"
      });
    }

    return references;
  });
}

function findFieldCardReference(
  match: AppMatchState,
  cardInstanceId?: string
): FieldCardReference | undefined {
  if (!cardInstanceId) return undefined;
  return getFieldCardReferences(match).find(reference => reference.card.instanceId === cardInstanceId);
}

function BoardCardAttachmentSection({
  card,
  match,
  onRelatedCardFocus
}: {
  card: CardInstance;
  match: AppMatchState;
  onRelatedCardFocus?: (cardInstanceId: string) => void;
}) {
  if (isCreature(match, card)) {
    const equipment = getFieldCardReferences(match)
      .filter(reference =>
        reference.zone === "MAGIC_SLOT" &&
        reference.card.attachedToInstanceId === card.instanceId
      );

    return (
      <div className="board-preview-3d__card-inspector-attachments" aria-label={`${getCardName(match, card)} equipment`}>
        <span>Equipped cards</span>
        {equipment.length > 0 ? (
          equipment.map(reference => (
            <button
              type="button"
              key={reference.card.instanceId}
              onClick={() => onRelatedCardFocus?.(reference.card.instanceId)}
              disabled={!onRelatedCardFocus}
            >
              <strong>{getCardName(match, reference.card)}</strong>
              <small>{reference.playerName}</small>
            </button>
          ))
        ) : (
          <small>No equipped cards</small>
        )}
      </div>
    );
  }

  if (isMagic(match, card) && card.attachedToInstanceId) {
    const attachedTarget = findFieldCardReference(match, card.attachedToInstanceId);

    return (
      <div className="board-preview-3d__card-inspector-attachments" aria-label={`${getCardName(match, card)} attachment`}>
        <span>Attachment</span>
        {attachedTarget ? (
          <button
            type="button"
            onClick={() => onRelatedCardFocus?.(attachedTarget.card.instanceId)}
            disabled={!onRelatedCardFocus}
          >
            <strong>Attached to {attachedTarget.playerName}'s {getCardName(match, attachedTarget.card)}</strong>
          </button>
        ) : (
          <small>Attached target not found</small>
        )}
      </div>
    );
  }

  return null;
}

export function BoardCardInspector({
  ariaLabel,
  card,
  className,
  detailsExpanded = false,
  extraHeader,
  match,
  onClose,
  onRelatedCardFocus,
  onToggleDetails,
  pinned = false,
  showDetails = true,
  children
}: BoardCardInspectorProps) {
  const creatureStats = getCreatureOverlayStats(match, card);
  const cardText = getCardText(match, card);
  const canShowDetails = showDetails && Boolean(creatureStats || isMagic(match, card) || cardText);
  const canShowAttachments = Boolean(onRelatedCardFocus);
  const classes = [
    "board-preview-3d__card-inspector",
    pinned ? "is-pinned" : "",
    className ?? ""
  ].filter(Boolean).join(" ");

  return (
    <aside className={classes} aria-label={ariaLabel}>
      {onClose ? (
        <button type="button" className="board-preview-3d__card-inspector-close" onClick={onClose} aria-label={`Close ${ariaLabel}`}>
          x
        </button>
      ) : null}
      <div className="board-preview-3d__card-inspector-header">
        <strong>{getCardName(match, card)}</strong>
        <span>{isCreature(match, card) ? "Creature" : isMagic(match, card) ? getMagicLine(match, card) : "Card"}</span>
        <BoardCardInspectorStats creatureStats={creatureStats} />
        {extraHeader}
      </div>
      <div className="board-preview-3d__card-inspector-art-wrap">
        <MatchCardImage match={match} card={card} className="board-preview-3d__card-inspector-art" />
      </div>
      {canShowAttachments ? (
        <BoardCardAttachmentSection card={card} match={match} onRelatedCardFocus={onRelatedCardFocus} />
      ) : null}
      {children}
      {canShowDetails && onToggleDetails ? (
        <button
          type="button"
          className="board-preview-3d__card-inspector-detail-toggle"
          aria-expanded={detailsExpanded}
          onClick={onToggleDetails}
        >
          {detailsExpanded ? "Hide details" : "Details"}
        </button>
      ) : null}
      {canShowDetails && detailsExpanded ? (
        <div className="board-preview-3d__card-inspector-copy">
          {isCreature(match, card) ? <span>{getCreatureStatsLine(match, card)}</span> : null}
          {isMagic(match, card) ? <span>{getMagicLine(match, card)}</span> : null}
          {cardText ? <p>{cardText}</p> : null}
        </div>
      ) : null}
    </aside>
  );
}
