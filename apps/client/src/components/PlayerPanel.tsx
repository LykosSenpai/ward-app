import { useEffect, useState, type DragEvent, type ReactNode } from "react";
import type { CardInstance, PlayerState } from "@ward/shared";
import type { AppMatchState } from "../clientTypes";
import { socket } from "../socket";
import {
  getCardName,
  getBattleBlockReason,
  getCreatureStatsLine,
  getEffectiveCreatureStat,
  getAttachedCreatureLabel,
  getMagicLine,
  getMatchStatus,
  getRequiredSacrificesForCard,
  playerHasSummonableCreatureInHand,
  canSummonCreatureFromHand,
  creatureCannotBeSacrificed,
  isCreature,
  isMagic
} from "../gameViewHelpers";
import { PlayerSummaryPanel } from "./player/PlayerSummaryPanel";
import { PrimaryCreatureZone } from "./player/PrimaryCreatureZone";
import { LimitedSummonsZone } from "./player/LimitedSummonsZone";
import { HandZone } from "./player/HandZone";
import { MagicSlotsZone } from "./player/MagicSlotsZone";
import { CemeteryZone } from "./player/CemeteryZone";
import { AvailableEffectsPanel } from "./AvailableEffectsPanel";
import { MatchCardImage } from "./MatchCardImage";

type ZoneDetailsProps = {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
};

function ZoneDetails({
  title,
  badge,
  defaultOpen = false,
  children
}: ZoneDetailsProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  useEffect(() => {
    if (defaultOpen) {
      setIsOpen(true);
    }
  }, [defaultOpen]);

  return (
    <details
      className="zone-details"
      open={isOpen}
      onToggle={event => setIsOpen(event.currentTarget.open)}
    >
      <summary>
        <span>{title}</span>
        {badge && <span className="zone-details-badge">{badge}</span>}
      </summary>

      <div className="zone-details-body">{children}</div>
    </details>
  );
}

function PlaymatCard({
  match,
  card,
  emptyLabel,
  kind,
  actionLabel,
  onAction,
  clickLabel,
  onCardClick
}: {
  match: AppMatchState;
  card?: CardInstance;
  emptyLabel: string;
  kind: "creature" | "magic" | "stack";
  actionLabel?: string;
  onAction?: () => void;
  clickLabel?: string;
  onCardClick?: () => void;
}) {
  if (!card) {
    return (
      <div className={`playmat-card empty ${kind}`}>
        <span>{emptyLabel}</span>
      </div>
    );
  }

  const definition = match.cardCatalog[card.cardId];
  const isCreatureCard = definition?.cardType === "CREATURE";
  const isMagicCard = definition?.cardType === "MAGIC";
  const baseHp = isCreatureCard ? Number(card.baseHp ?? definition.hp) : 0;
  const currentHp = isCreatureCard ? Number(card.currentHp ?? baseHp) : 0;
  const hpPercent = baseHp > 0 ? Math.max(0, Math.min(100, (currentHp / baseHp) * 100)) : 0;
  const hpTone = hpPercent <= 30 ? "danger" : hpPercent <= 60 ? "warn" : "healthy";
  const statuses = card.activeStatuses ?? [];
  const recurringEffects = card.activeRecurringEffects ?? [];
  const activeEffects = card.activeEffectInstances ?? [];
  const detail = isMagicCard
    ? getMagicLine(match, card)
    : getCreatureStatsLine(match, card);
  const statChips = isCreatureCard
    ? [
      ["AL", getEffectiveCreatureStat(card, "armorLevel", definition.armorLevel)],
      ["SPD", getEffectiveCreatureStat(card, "speed", definition.speed)],
      ["ATK", `${getEffectiveCreatureStat(card, "attackDice", definition.attackDice)}D6`],
      ["MOD", getEffectiveCreatureStat(card, "modifier", definition.modifier)]
    ]
    : [];
  const attachmentLabel = isMagicCard ? getAttachedCreatureLabel(match, card.attachedToInstanceId) : "";

  return (
    <div
      className={[
        "playmat-card",
        "occupied",
        kind,
        hpTone,
        onCardClick ? "clickable" : ""
      ].filter(Boolean).join(" ")}
      role={onCardClick ? "button" : undefined}
      tabIndex={onCardClick ? 0 : undefined}
      onClick={onCardClick}
      onKeyDown={event => {
        if (!onCardClick) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onCardClick();
        }
      }}
      title={clickLabel}
    >
      <div className="playmat-card-art-shell">
        <MatchCardImage match={match} card={card} />
        {isCreatureCard && <span className="playmat-card-hp">{currentHp}/{baseHp}</span>}
      </div>

      <div className="playmat-card-title-row">
        <strong>{getCardName(match, card)}</strong>
      </div>

      {isCreatureCard && (
        <>
          <div className="playmat-hp-bar" aria-label={`${getCardName(match, card)} HP`}>
            <span style={{ width: `${hpPercent}%` }} />
          </div>

          <div className="playmat-stat-chip-row">
            {statChips.map(([label, value]) => (
              <span className="playmat-stat-chip" key={label}>
                {label} <strong>{value}</strong>
              </span>
            ))}
          </div>
        </>
      )}

      {!isCreatureCard && <span>{detail}</span>}

      {isMagicCard && card.attachedToInstanceId && (
        <small className="playmat-attachment-label">{attachmentLabel}</small>
      )}

      {(statuses.length > 0 || recurringEffects.length > 0 || activeEffects.length > 0) && (
        <div className="playmat-effect-badges" aria-label={`${getCardName(match, card)} active effects`}>
          {statuses.slice(0, 3).map(status => (
            <span className="playmat-effect-badge status" key={status.id}>{status.label || status.status}</span>
          ))}
          {recurringEffects.slice(0, 2).map(effect => (
            <span className="playmat-effect-badge recurring" key={effect.id}>{effect.label}</span>
          ))}
          {activeEffects.slice(0, 2).map(effect => (
            <span className="playmat-effect-badge active" key={effect.id}>{effect.label}</span>
          ))}
        </div>
      )}

      {actionLabel && onAction && (
        <button type="button" onClick={event => {
          event.stopPropagation();
          onAction();
        }}>
          {actionLabel}
        </button>
      )}

      {clickLabel && <small className="playmat-card-click-hint">{clickLabel}</small>}
    </div>
  );
}

function PlayerPlaymat({
  match,
  player,
  isActivePlayer,
  canControlThisPlayer,
  canPromoteLimitedSummonToPrimary,
  onPromoteLimitedSummonToPrimary,
  onDestroyMagic,
  onShuffleDeck,
  onStartBattle,
  dragOverZone,
  onPlaymatDragOver,
  onPlaymatDragLeave,
  onPlaymatDrop
}: {
  match: AppMatchState;
  player: PlayerState;
  isActivePlayer: boolean;
  canControlThisPlayer: boolean;
  canPromoteLimitedSummonToPrimary: boolean;
  onPromoteLimitedSummonToPrimary: (cardInstanceId: string) => void;
  onDestroyMagic: (cardInstanceId: string) => void;
  onShuffleDeck: () => void;
  onStartBattle?: (cardInstanceId: string) => void;
  dragOverZone?: "primary" | "magic" | "cemetery" | null;
  onPlaymatDragOver: (event: DragEvent<HTMLElement>, zone: "primary" | "magic" | "cemetery") => void;
  onPlaymatDragLeave: () => void;
  onPlaymatDrop: (event: DragEvent<HTMLElement>, zone: "primary" | "magic" | "cemetery") => void;
}) {
  const limitedSlots = Array.from({ length: 4 }, (_, index) => player.field.limitedSummons[index]);
  const magicSlots = Array.from({ length: 5 }, (_, index) => player.field.magicSlots[index]);
  const deckCount = player.deck.length;
  const cemeteryCount = player.cemetery.length;
  const battleBlockReason = getBattleBlockReason(match);
  const usedBattleCreatureIds = player.turnFlags.battleUsedCreatureInstanceIds ?? [];
  const canBattleWithCard = (card?: CardInstance) =>
    !!card &&
    !!onStartBattle &&
    canControlThisPlayer &&
    isActivePlayer &&
    !battleBlockReason &&
    !usedBattleCreatureIds.includes(card.instanceId);
  const dragClass = (zone: "primary" | "magic" | "cemetery") => dragOverZone === zone ? " drag-over" : "";

  return (
    <section className={`player-playmat ${isActivePlayer ? "active" : ""}`} aria-label={`${player.displayName} play mat`}>
      <div className="playmat-brand">
        <span>WARD</span>
        <strong>{player.displayName}</strong>
      </div>

      <div
        className={`playmat-zone playmat-primary-zone${dragClass("primary")}`}
        onDragOver={event => onPlaymatDragOver(event, "primary")}
        onDragLeave={onPlaymatDragLeave}
        onDrop={event => onPlaymatDrop(event, "primary")}
      >
        <span className="playmat-zone-label">Primary Creature</span>
        <PlaymatCard
          match={match}
          card={player.field.primaryCreature}
          emptyLabel="No primary"
          kind="creature"
          clickLabel={canBattleWithCard(player.field.primaryCreature) ? "Click to battle" : undefined}
          onCardClick={canBattleWithCard(player.field.primaryCreature)
            ? () => {
              if (player.field.primaryCreature) {
                onStartBattle?.(player.field.primaryCreature.instanceId);
              }
            }
            : undefined}
        />
      </div>

      <div className="playmat-limited-row" aria-label="Limited summon area">
        {limitedSlots.map((card, index) => (
          <div className="playmat-zone playmat-limited-zone" key={card?.instanceId ?? `limited-${index}`}>
            <span className="playmat-zone-label">Limited Summon</span>
            <PlaymatCard
              match={match}
              card={card}
              emptyLabel={`Slot ${index + 1}`}
              kind="creature"
              actionLabel={card && canPromoteLimitedSummonToPrimary ? "Promote" : undefined}
              onAction={card && canPromoteLimitedSummonToPrimary ? () => onPromoteLimitedSummonToPrimary(card.instanceId) : undefined}
              clickLabel={canBattleWithCard(card) && !canPromoteLimitedSummonToPrimary ? "Click to battle" : undefined}
              onCardClick={canBattleWithCard(card) && card && !canPromoteLimitedSummonToPrimary
                ? () => onStartBattle?.(card.instanceId)
                : undefined}
            />
          </div>
        ))}
      </div>

      <div
        className={`playmat-magic-row${dragClass("magic")}`}
        aria-label="Magic slots"
        onDragOver={event => onPlaymatDragOver(event, "magic")}
        onDragLeave={onPlaymatDragLeave}
        onDrop={event => onPlaymatDrop(event, "magic")}
      >
        {magicSlots.map((card, index) => (
          <div className="playmat-zone playmat-magic-zone" key={card?.instanceId ?? `magic-${index}`}>
            <span className="playmat-zone-label">Magic Slot</span>
            <PlaymatCard
              match={match}
              card={card}
              emptyLabel={`Slot ${index + 1}`}
              kind="magic"
              actionLabel={card && canControlThisPlayer ? "Remove" : undefined}
              onAction={card && canControlThisPlayer ? () => onDestroyMagic(card.instanceId) : undefined}
            />
          </div>
        ))}
      </div>

      <div className="playmat-stack-rail" aria-label="Deck and cemetery">
        <button
          className="playmat-stack-zone deck"
          disabled={!canControlThisPlayer || deckCount === 0 || player.hand.length > 0 || !!match.pendingPrompt}
          onClick={onShuffleDeck}
          type="button"
        >
          <span>Deck</span>
          <strong>{deckCount}</strong>
        </button>

        <div
          className={`playmat-stack-zone cemetery${dragClass("cemetery")}`}
          onDragOver={event => onPlaymatDragOver(event, "cemetery")}
          onDragLeave={onPlaymatDragLeave}
          onDrop={event => onPlaymatDrop(event, "cemetery")}
        >
          <span>Card Cemetery</span>
          <strong>{cemeteryCount}</strong>
          <small>{player.cemeteryCreatureHpTotal} HP</small>
        </div>
      </div>
    </section>
  );
}

export function PlayerPanel({
  match,
  player,
  controlledPlayerId,
  boardMode = false,
  onStartManualBattle
}: {
  match: AppMatchState;
  player: PlayerState;
  controlledPlayerId?: string;
  boardMode?: boolean;
  onStartManualBattle?: (attackerCreatureInstanceId: string) => void;
}) {
  const [selectedSacrificesByCard, setSelectedSacrificesByCard] = useState<
    Record<string, string[]>
  >({});
  const [manualHpAmount, setManualHpAmount] = useState("10");
  const [dragOverZone, setDragOverZone] = useState<"primary" | "magic" | "cemetery" | null>(null);

  const isActivePlayer = match.turn.activePlayerId === player.id;
  const isMatchComplete = getMatchStatus(match) === "COMPLETE";
  const canControlThisPlayer = !controlledPlayerId || controlledPlayerId === player.id;
  const replacementRequiredForThisPlayer =
    match.setup.primaryReplacementRequiredForPlayerId === player.id;
  const limitedSummonPromotionRequiredForThisPlayer =
    replacementRequiredForThisPlayer && player.field.limitedSummons.length > 0;
  const discardRequiredForThisPlayer =
    match.setup.handDiscardRequiredForPlayerId === player.id;
  const anyDiscardRequired = !!match.setup.handDiscardRequiredForPlayerId;

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
        !player.turnFlags.normalSummonUsed));

  const canPlayMagicNow =
    !isMatchComplete &&
    canControlThisPlayer &&
    isActivePlayer &&
    !match.pendingPrompt &&
    !match.pendingChain &&
    !anyDiscardRequired &&
    !match.setup.primaryReplacementRequiredForPlayerId &&
    (match.turn.phase === "SUMMON_MAGIC" || match.turn.phase === "SECOND_MAGIC");

  const canPlayLightningResponse =
    !isMatchComplete &&
    canControlThisPlayer &&
    !!match.pendingChain &&
    match.pendingChain.priorityPlayerId === player.id &&
    match.pendingChain.lastLinkPlayerId !== player.id &&
    !match.pendingPrompt &&
    !anyDiscardRequired;

  const currentBattleStrike = match.pendingBattle?.strikes[match.pendingBattle.currentStrikeIndex];
  const canPlayBattleResponse =
    !isMatchComplete &&
    canControlThisPlayer &&
    !!match.pendingBattle &&
    !match.pendingChain &&
    !match.pendingPrompt &&
    !anyDiscardRequired &&
    (match.pendingBattle.status === "AWAITING_DAMAGE_ROLL" ||
      match.pendingBattle.status === "AWAITING_DAMAGE_APPLICATION") &&
    currentBattleStrike?.defender.playerId === player.id &&
    (currentBattleStrike.status === "AWAITING_DAMAGE_ROLL" ||
      currentBattleStrike.status === "AWAITING_DAMAGE_APPLICATION");

  const hasSummonableCreature = playerHasSummonableCreatureInHand(match, player);

  function shuffleDeck() {
    if (!canControlThisPlayer) return;
    socket.emit("match:shuffleDeck", {
      matchId: match.matchId,
      playerId: player.id
    });
  }

  function playLightningResponse(cardInstanceId: string) {
    if (!canControlThisPlayer) return;
    socket.emit("match:playLightningResponse", {
      matchId: match.matchId,
      playerId: player.id,
      cardInstanceId
    });
  }

  function playBattleResponse(cardInstanceId: string) {
    if (!canControlThisPlayer) return;
    if (!match.pendingBattle || !currentBattleStrike) return;

    socket.emit("match:playBattleResponseFromHand", {
      matchId: match.matchId,
      playerId: player.id,
      cardInstanceId,
      battleSessionId: match.pendingBattle.id,
      strikeId: currentBattleStrike.id
    });
  }

  function discardFromHand(cardInstanceId: string) {
    if (!canControlThisPlayer) return;
    socket.emit("match:discardFromHand", {
      matchId: match.matchId,
      playerId: player.id,
      cardInstanceId
    });
  }

  function applyManualDamage() {
    if (!canControlThisPlayer) return;
    socket.emit("match:manualDamagePrimary", {
      matchId: match.matchId,
      playerId: player.id,
      amount: Number(manualHpAmount)
    });
  }

  function applyManualHeal() {
    if (!canControlThisPlayer) return;
    socket.emit("match:manualHealPrimary", {
      matchId: match.matchId,
      playerId: player.id,
      amount: Number(manualHpAmount)
    });
  }

  function concedeAsPlayer() {
    if (!canControlThisPlayer) return;
    socket.emit("match:concede", {
      matchId: match.matchId,
      concedingPlayerId: player.id
    });
  }

  function callCemeteryHpLossAgainstPlayer() {
    if (controlledPlayerId && controlledPlayerId === player.id) return;
    const callingPlayer = match.players.find(candidate => candidate.id !== player.id);

    if (!callingPlayer) return;

    socket.emit("match:callCemeteryHpLoss", {
      matchId: match.matchId,
      losingPlayerId: player.id,
      callingPlayerId: callingPlayer.id
    });
  }

  function destroyMagic(cardInstanceId: string) {
    if (!canControlThisPlayer) return;
    socket.emit("match:destroyMagicSlotCard", {
      matchId: match.matchId,
      fieldOwnerPlayerId: player.id,
      cardInstanceId
    });
  }

  function attachEquipMagic(
    magicCardInstanceId: string,
    targetPlayerId: string,
    targetCreatureInstanceId: string,
    targetKind: "PRIMARY_CREATURE" | "LIMITED_SUMMON"
  ) {
    if (!canControlThisPlayer) return;
    socket.emit("match:attachEquipMagicToCreature", {
      matchId: match.matchId,
      fieldOwnerPlayerId: player.id,
      magicCardInstanceId,
      targetPlayerId,
      targetCreatureInstanceId,
      targetKind
    });
  }

  function toggleSacrifice(targetCardId: string, sacrificeCardId: string) {
    setSelectedSacrificesByCard(current => {
      const currentSelected = current[targetCardId] ?? [];
      const targetCard = player.hand.find(card => card.instanceId === targetCardId);
      const requiredSacrifices = targetCard
        ? getRequiredSacrificesForCard(match, targetCard)
        : 0;

      if (currentSelected.includes(sacrificeCardId)) {
        return {
          ...current,
          [targetCardId]: currentSelected.filter(id => id !== sacrificeCardId)
        };
      }

      if (currentSelected.length >= requiredSacrifices) {
        return current;
      }

      return {
        ...current,
        [targetCardId]: [...currentSelected, sacrificeCardId]
      };
    });
  }

  function playPrimary(cardInstanceId: string) {
    if (!canControlThisPlayer) return;
    socket.emit("match:playPrimaryCreature", {
      matchId: match.matchId,
      playerId: player.id,
      cardInstanceId,
      sacrificeCardInstanceIds: selectedSacrificesByCard[cardInstanceId] ?? []
    });
  }

  function playMagic(cardInstanceId: string) {
    if (!canControlThisPlayer) return;
    socket.emit("match:playMagic", {
      matchId: match.matchId,
      playerId: player.id,
      cardInstanceId
    });
  }

  function getDraggedHandCard(event: DragEvent<HTMLElement>): CardInstance | undefined {
    const payload = event.dataTransfer.getData("application/x-ward-hand-card");
    if (!payload) return undefined;

    try {
      const data = JSON.parse(payload) as { playerId?: string; cardInstanceId?: string };
      if (data.playerId !== player.id || !data.cardInstanceId) return undefined;

      return player.hand.find(card => card.instanceId === data.cardInstanceId);
    } catch {
      return undefined;
    }
  }

  function canDropHandCardOnZone(card: CardInstance | undefined, zone: "primary" | "magic" | "cemetery"): boolean {
    if (!card || !canControlThisPlayer) return false;

    if (zone === "cemetery") {
      return discardRequiredForThisPlayer;
    }

    if (zone === "magic") {
      return canPlayMagicNow && isMagic(match, card);
    }

    if (!canPlayPrimaryNow || !isCreature(match, card) || !canSummonCreatureFromHand(match, player, card)) {
      return false;
    }

    const requiredSacrifices = getRequiredSacrificesForCard(match, card);
    const primaryCreature = player.field.primaryCreature;
    const primarySacrificeRequired = !!primaryCreature && !creatureCannotBeSacrificed(primaryCreature);
    const selectedSacrifices = selectedSacrificesByCard[card.instanceId] ?? [];
    const selectedPrimarySacrifice =
      !primarySacrificeRequired ||
      (primaryCreature ? selectedSacrifices.includes(primaryCreature.instanceId) : true);

    return selectedPrimarySacrifice && selectedSacrifices.length === requiredSacrifices;
  }

  function handlePlaymatDragOver(event: DragEvent<HTMLElement>, zone: "primary" | "magic" | "cemetery") {
    const card = getDraggedHandCard(event);
    if (!canDropHandCardOnZone(card, zone)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverZone(zone);
  }

  function handlePlaymatDragLeave() {
    setDragOverZone(null);
  }

  function handlePlaymatDrop(event: DragEvent<HTMLElement>, zone: "primary" | "magic" | "cemetery") {
    const card = getDraggedHandCard(event);
    setDragOverZone(null);

    if (!canDropHandCardOnZone(card, zone) || !card) return;

    event.preventDefault();

    if (zone === "cemetery") {
      discardFromHand(card.instanceId);
      return;
    }

    if (zone === "magic") {
      playMagic(card.instanceId);
      return;
    }

    playPrimary(card.instanceId);
  }

  function activateCardEffect(sourceInstanceId: string, effectId: string) {
    if (!canControlThisPlayer) return;
    socket.emit("match:activateCardEffect", {
      matchId: match.matchId,
      playerId: player.id,
      sourceInstanceId,
      effectId
    });
  }

  function primaryToCemetery() {
    if (!canControlThisPlayer) return;
    socket.emit("match:primaryToCemetery", {
      matchId: match.matchId,
      playerId: player.id
    });
  }

  function killOwnPrimary() {
    if (!canControlThisPlayer) return;
    socket.emit("match:killOwnPrimaryCreature", {
      matchId: match.matchId,
      playerId: player.id
    });
  }

  function requestNoCreatureRedraw() {
    if (!canControlThisPlayer) return;
    socket.emit("match:requestNoCreatureRedrawReveal", {
      matchId: match.matchId,
      playerId: player.id
    });
  }

  function promoteLimitedSummonToPrimary(cardInstanceId: string) {
    if (!canControlThisPlayer) return;
    socket.emit("match:promoteLimitedSummonToPrimary", {
      matchId: match.matchId,
      playerId: player.id,
      cardInstanceId
    });
  }

  const canPromoteLimitedSummonToPrimary =
    !isMatchComplete &&
    canControlThisPlayer &&
    limitedSummonPromotionRequiredForThisPlayer &&
    !match.pendingPrompt &&
    !match.pendingChain &&
    !anyDiscardRequired &&
    player.field.limitedSummons.length > 0;

  const handShouldOpen =
    isActivePlayer ||
    discardRequiredForThisPlayer ||
    replacementRequiredForThisPlayer ||
    canPlayPrimaryNow ||
    canPlayMagicNow ||
    canPlayLightningResponse ||
    canPlayBattleResponse;

  const summaryPanel = (
    <PlayerSummaryPanel
      match={match}
      player={player}
      isActivePlayer={isActivePlayer}
      isMatchComplete={isMatchComplete}
      canControlThisPlayer={canControlThisPlayer}
      normalSummonUsed={player.turnFlags.normalSummonUsed}
      discardRequiredForThisPlayer={discardRequiredForThisPlayer}
      replacementRequiredForThisPlayer={replacementRequiredForThisPlayer}
      canPlayPrimaryNow={canPlayPrimaryNow}
      hasSummonableCreature={hasSummonableCreature}
      onShuffleDeck={shuffleDeck}
      onConcede={concedeAsPlayer}
      onCallCemeteryHpLoss={callCemeteryHpLossAgainstPlayer}
      onRequestNoCreatureRedraw={requestNoCreatureRedraw}
    />
  );

  const playmatPanel = (
    <PlayerPlaymat
      match={match}
      player={player}
      isActivePlayer={isActivePlayer}
      canControlThisPlayer={canControlThisPlayer}
      canPromoteLimitedSummonToPrimary={canPromoteLimitedSummonToPrimary}
      onPromoteLimitedSummonToPrimary={promoteLimitedSummonToPrimary}
      onDestroyMagic={destroyMagic}
      onShuffleDeck={shuffleDeck}
      onStartBattle={onStartManualBattle}
      dragOverZone={dragOverZone}
      onPlaymatDragOver={handlePlaymatDragOver}
      onPlaymatDragLeave={handlePlaymatDragLeave}
      onPlaymatDrop={handlePlaymatDrop}
    />
  );

  const primaryPanel = (
    <PrimaryCreatureZone
      match={match}
      player={player}
      isActivePlayer={isActivePlayer}
      canControlThisPlayer={canControlThisPlayer}
      anyDiscardRequired={anyDiscardRequired}
      replacementRequiredForThisPlayer={replacementRequiredForThisPlayer}
      manualHpAmount={manualHpAmount}
      setManualHpAmount={setManualHpAmount}
      onApplyManualDamage={applyManualDamage}
      onApplyManualHeal={applyManualHeal}
      onPrimaryToCemetery={primaryToCemetery}
      onKillOwnPrimary={killOwnPrimary}
    />
  );

  const effectsPanel = (
    <AvailableEffectsPanel
      match={match}
      player={player}
      canControlThisPlayer={canControlThisPlayer}
      onActivateEffect={activateCardEffect}
    />
  );

  const handPanel = (
    <HandZone
      match={match}
      player={player}
      discardRequiredForThisPlayer={discardRequiredForThisPlayer}
      canPlayPrimaryNow={canPlayPrimaryNow}
      canPlayMagicNow={canPlayMagicNow}
      canPlayLightningResponse={canPlayLightningResponse}
      canPlayBattleResponse={canPlayBattleResponse}
      selectedSacrificesByCard={selectedSacrificesByCard}
      onDiscardFromHand={discardFromHand}
      onToggleSacrifice={toggleSacrifice}
      onPlayPrimary={playPrimary}
      onPlayMagic={playMagic}
      onPlayLightningResponse={playLightningResponse}
      onPlayBattleResponse={playBattleResponse}
    />
  );

  const limitedSummonsPanel = (
    <LimitedSummonsZone
      match={match}
      player={player}
      canPromoteToPrimary={canPromoteLimitedSummonToPrimary}
      onPromoteToPrimary={promoteLimitedSummonToPrimary}
    />
  );

  const magicSlotsPanel = (
    <MagicSlotsZone
      match={match}
      player={player}
      anyDiscardRequired={anyDiscardRequired}
      onAttachEquipMagic={attachEquipMagic}
      onDestroyMagic={destroyMagic}
    />
  );

  const cemeteryPanel = (
    <CemeteryZone match={match} player={player} />
  );

  const zoneAccordion = (
    <div className="player-zone-accordion">
      <ZoneDetails
        title="Hand"
        badge={`${player.hand.length} cards`}
        defaultOpen={handShouldOpen}
      >
        {handPanel}
      </ZoneDetails>

      <ZoneDetails
        title="Limited Summons"
        badge={`${player.field.limitedSummons.length}/4`}
        defaultOpen={player.field.limitedSummons.length > 0}
      >
        {limitedSummonsPanel}
      </ZoneDetails>

      <ZoneDetails
        title="Magic Slots"
        badge={`${player.field.magicSlots.length}/5`}
        defaultOpen={player.field.magicSlots.length > 0}
      >
        {magicSlotsPanel}
      </ZoneDetails>

      <ZoneDetails
        title="Cemetery"
        badge={`${player.cemetery.length} cards / ${player.cemeteryCreatureHpTotal} HP`}
      >
        {cemeteryPanel}
      </ZoneDetails>
    </div>
  );

  if (boardMode) {
    return (
      <div className={isActivePlayer ? "card player-card active-player-card board-mode-player-card" : "card player-card board-mode-player-card"}>
        {playmatPanel}

        <details className="table-player-drawer">
          <summary>
            <span>{canControlThisPlayer ? "Your Options" : "Field Options"}</span>
            <strong>{player.hand.length} hand</strong>
            <strong>{player.field.magicSlots.length}/5 magic</strong>
            <strong>{player.field.limitedSummons.length}/4 limited</strong>
          </summary>

          <div className="table-player-drawer-grid">
            <div className="board-live-zone board-live-zone-hand">{handPanel}</div>
            <div className="board-command-panel">{primaryPanel}</div>
            {effectsPanel && <div className="board-live-zone">{effectsPanel}</div>}
            <div className="board-live-zone">{magicSlotsPanel}</div>
            <div className="board-live-zone">{limitedSummonsPanel}</div>
            <div className="board-live-zone">{cemeteryPanel}</div>
          </div>
        </details>
      </div>
    );
  }

  return (
    <div className={isActivePlayer ? "card player-card active-player-card" : "card player-card"}>
      {summaryPanel}
      {playmatPanel}
      {primaryPanel}
      {effectsPanel}
      {zoneAccordion}
    </div>
  );
}
