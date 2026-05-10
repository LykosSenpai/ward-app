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
  onToggleDetails?: () => void;
  pinned?: boolean;
  showDetails?: boolean;
  children?: ReactNode;
};

export function BoardCardInspector({
  ariaLabel,
  card,
  className,
  detailsExpanded = false,
  extraHeader,
  match,
  onClose,
  onToggleDetails,
  pinned = false,
  showDetails = true,
  children
}: BoardCardInspectorProps) {
  const creatureStats = getCreatureOverlayStats(match, card);
  const cardText = getCardText(match, card);
  const canShowDetails = showDetails && Boolean(creatureStats || isMagic(match, card) || cardText);
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
