import { useEffect, useState, type ReactNode } from "react";
import type { CardInstance, PlayerState } from "@ward/shared";
import type { AppMatchState } from "../clientTypes";
import { socket } from "../socket";
import {
  getCardName,
  getCreatureStatsLine,
  getMagicLine,
  getMatchStatus,
  getRequiredSacrificesForCard,
  playerHasSummonableCreatureInHand
} from "../gameViewHelpers";
import { PlayerSummaryPanel } from "./player/PlayerSummaryPanel";
import { PrimaryCreatureZone } from "./player/PrimaryCreatureZone";
import { LimitedSummonsZone } from "./player/LimitedSummonsZone";
import { HandZone } from "./player/HandZone";
import { MagicSlotsZone } from "./player/MagicSlotsZone";
import { CemeteryZone } from "./player/CemeteryZone";
import { AvailableEffectsPanel } from "./AvailableEffectsPanel";

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
  onAction
}: {
  match: AppMatchState;
  card?: CardInstance;
  emptyLabel: string;
  kind: "creature" | "magic" | "stack";
  actionLabel?: string;
  onAction?: () => void;
}) {
  if (!card) {
    return (
      <div className={`playmat-card empty ${kind}`}>
        <span>{emptyLabel}</span>
      </div>
    );
  }

  const detail = kind === "magic"
    ? getMagicLine(match, card)
    : getCreatureStatsLine(match, card);

  return (
    <div className={`playmat-card occupied ${kind}`}>
      <strong>{getCardName(match, card)}</strong>
      <span>{detail}</span>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      )}
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
  onShuffleDeck
}: {
  match: AppMatchState;
  player: PlayerState;
  isActivePlayer: boolean;
  canControlThisPlayer: boolean;
  canPromoteLimitedSummonToPrimary: boolean;
  onPromoteLimitedSummonToPrimary: (cardInstanceId: string) => void;
  onDestroyMagic: (cardInstanceId: string) => void;
  onShuffleDeck: () => void;
}) {
  const limitedSlots = Array.from({ length: 4 }, (_, index) => player.field.limitedSummons[index]);
  const magicSlots = Array.from({ length: 5 }, (_, index) => player.field.magicSlots[index]);
  const deckCount = player.deck.length;
  const cemeteryCount = player.cemetery.length;

  return (
    <section className={`player-playmat ${isActivePlayer ? "active" : ""}`} aria-label={`${player.displayName} play mat`}>
      <div className="playmat-brand">
        <span>WARD</span>
        <strong>{player.displayName}</strong>
      </div>

      <div className="playmat-zone playmat-primary-zone">
        <span className="playmat-zone-label">Primary Creature</span>
        <PlaymatCard
          match={match}
          card={player.field.primaryCreature}
          emptyLabel="No primary"
          kind="creature"
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
            />
          </div>
        ))}
      </div>

      <div className="playmat-magic-row" aria-label="Magic slots">
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

        <div className="playmat-stack-zone cemetery">
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
  boardMode = false
}: {
  match: AppMatchState;
  player: PlayerState;
  controlledPlayerId?: string;
  boardMode?: boolean;
}) {
  const [selectedSacrificesByCard, setSelectedSacrificesByCard] = useState<
    Record<string, string[]>
  >({});
  const [manualHpAmount, setManualHpAmount] = useState("10");

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

  const zoneAccordion = (
    <div className="player-zone-accordion">
      <ZoneDetails
        title="Hand"
        badge={`${player.hand.length} cards`}
        defaultOpen={handShouldOpen}
      >
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
      </ZoneDetails>

      <ZoneDetails
        title="Limited Summons"
        badge={`${player.field.limitedSummons.length}/4`}
        defaultOpen={player.field.limitedSummons.length > 0}
      >
        <LimitedSummonsZone
          match={match}
          player={player}
          canPromoteToPrimary={canPromoteLimitedSummonToPrimary}
          onPromoteToPrimary={promoteLimitedSummonToPrimary}
        />
      </ZoneDetails>

      <ZoneDetails
        title="Magic Slots"
        badge={`${player.field.magicSlots.length}/5`}
        defaultOpen={player.field.magicSlots.length > 0}
      >
        <MagicSlotsZone
          match={match}
          player={player}
          anyDiscardRequired={anyDiscardRequired}
          onAttachEquipMagic={attachEquipMagic}
          onDestroyMagic={destroyMagic}
        />
      </ZoneDetails>

      <ZoneDetails
        title="Cemetery"
        badge={`${player.cemetery.length} cards / ${player.cemeteryCreatureHpTotal} HP`}
      >
        <CemeteryZone match={match} player={player} />
      </ZoneDetails>
    </div>
  );

  if (boardMode) {
    return (
      <div className={isActivePlayer ? "card player-card active-player-card board-mode-player-card" : "card player-card board-mode-player-card"}>
        {playmatPanel}

        <div className="player-zone-accordion board-mode-accordion">
          <ZoneDetails
            title="Player Status & Controls"
            badge={isActivePlayer ? "Active" : `${player.hand.length} hand`}
            defaultOpen={isActivePlayer || discardRequiredForThisPlayer || replacementRequiredForThisPlayer}
          >
            {summaryPanel}
          </ZoneDetails>

          <ZoneDetails
            title="Primary Details"
            badge={player.field.primaryCreature ? getCardName(match, player.field.primaryCreature) : "Empty"}
            defaultOpen={false}
          >
            {primaryPanel}
          </ZoneDetails>
        </div>

        {effectsPanel}
        {zoneAccordion}
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
