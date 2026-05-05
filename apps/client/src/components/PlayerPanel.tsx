import { useEffect, useState, type ReactNode } from "react";
import type { PlayerState } from "@ward/shared";
import type { AppMatchState } from "../clientTypes";
import { socket } from "../socket";
import {
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

export function PlayerPanel({
  match,
  player
}: {
  match: AppMatchState;
  player: PlayerState;
}) {
  const [selectedSacrificesByCard, setSelectedSacrificesByCard] = useState<
    Record<string, string[]>
  >({});
  const [manualHpAmount, setManualHpAmount] = useState("10");

  const isActivePlayer = match.turn.activePlayerId === player.id;
  const isMatchComplete = getMatchStatus(match) === "COMPLETE";
  const replacementRequiredForThisPlayer =
    match.setup.primaryReplacementRequiredForPlayerId === player.id;
  const limitedSummonPromotionRequiredForThisPlayer =
    replacementRequiredForThisPlayer && player.field.limitedSummons.length > 0;
  const discardRequiredForThisPlayer =
    match.setup.handDiscardRequiredForPlayerId === player.id;
  const anyDiscardRequired = !!match.setup.handDiscardRequiredForPlayerId;

  const canPlayPrimaryNow =
    !isMatchComplete &&
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
    isActivePlayer &&
    !match.pendingPrompt &&
    !match.pendingChain &&
    !anyDiscardRequired &&
    !match.setup.primaryReplacementRequiredForPlayerId &&
    (match.turn.phase === "SUMMON_MAGIC" || match.turn.phase === "SECOND_MAGIC");

  const canPlayLightningResponse =
    !isMatchComplete &&
    !!match.pendingChain &&
    match.pendingChain.priorityPlayerId === player.id &&
    match.pendingChain.lastLinkPlayerId !== player.id &&
    !match.pendingPrompt &&
    !anyDiscardRequired;

  const currentBattleStrike = match.pendingBattle?.strikes[match.pendingBattle.currentStrikeIndex];
  const canPlayBattleResponse =
    !isMatchComplete &&
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
    socket.emit("match:shuffleDeck", {
      matchId: match.matchId,
      playerId: player.id
    });
  }

  function playLightningResponse(cardInstanceId: string) {
    socket.emit("match:playLightningResponse", {
      matchId: match.matchId,
      playerId: player.id,
      cardInstanceId
    });
  }

  function playBattleResponse(cardInstanceId: string) {
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
    socket.emit("match:discardFromHand", {
      matchId: match.matchId,
      playerId: player.id,
      cardInstanceId
    });
  }

  function applyManualDamage() {
    socket.emit("match:manualDamagePrimary", {
      matchId: match.matchId,
      playerId: player.id,
      amount: Number(manualHpAmount)
    });
  }

  function applyManualHeal() {
    socket.emit("match:manualHealPrimary", {
      matchId: match.matchId,
      playerId: player.id,
      amount: Number(manualHpAmount)
    });
  }

  function concedeAsPlayer() {
    socket.emit("match:concede", {
      matchId: match.matchId,
      concedingPlayerId: player.id
    });
  }

  function callCemeteryHpLossAgainstPlayer() {
    const callingPlayer = match.players.find(candidate => candidate.id !== player.id);

    if (!callingPlayer) return;

    socket.emit("match:callCemeteryHpLoss", {
      matchId: match.matchId,
      losingPlayerId: player.id,
      callingPlayerId: callingPlayer.id
    });
  }

  function destroyMagic(cardInstanceId: string) {
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
    socket.emit("match:playPrimaryCreature", {
      matchId: match.matchId,
      playerId: player.id,
      cardInstanceId,
      sacrificeCardInstanceIds: selectedSacrificesByCard[cardInstanceId] ?? []
    });
  }

  function playMagic(cardInstanceId: string) {
    socket.emit("match:playMagic", {
      matchId: match.matchId,
      playerId: player.id,
      cardInstanceId
    });
  }

  function activateCardEffect(sourceInstanceId: string, effectId: string) {
    socket.emit("match:activateCardEffect", {
      matchId: match.matchId,
      playerId: player.id,
      sourceInstanceId,
      effectId
    });
  }

  function primaryToCemetery() {
    socket.emit("match:primaryToCemetery", {
      matchId: match.matchId,
      playerId: player.id
    });
  }

  function killOwnPrimary() {
    socket.emit("match:killOwnPrimaryCreature", {
      matchId: match.matchId,
      playerId: player.id
    });
  }

  function requestNoCreatureRedraw() {
    socket.emit("match:requestNoCreatureRedrawReveal", {
      matchId: match.matchId,
      playerId: player.id
    });
  }

  function promoteLimitedSummonToPrimary(cardInstanceId: string) {
    socket.emit("match:promoteLimitedSummonToPrimary", {
      matchId: match.matchId,
      playerId: player.id,
      cardInstanceId
    });
  }

  const canPromoteLimitedSummonToPrimary =
    !isMatchComplete &&
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

  return (
    <div className={isActivePlayer ? "card player-card active-player-card" : "card player-card"}>
      <PlayerSummaryPanel
        match={match}
        player={player}
        isActivePlayer={isActivePlayer}
        isMatchComplete={isMatchComplete}
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

      <PrimaryCreatureZone
        match={match}
        player={player}
        isActivePlayer={isActivePlayer}
        anyDiscardRequired={anyDiscardRequired}
        replacementRequiredForThisPlayer={replacementRequiredForThisPlayer}
        manualHpAmount={manualHpAmount}
        setManualHpAmount={setManualHpAmount}
        onApplyManualDamage={applyManualDamage}
        onApplyManualHeal={applyManualHeal}
        onPrimaryToCemetery={primaryToCemetery}
        onKillOwnPrimary={killOwnPrimary}
      />

      <AvailableEffectsPanel
        match={match}
        player={player}
        onActivateEffect={activateCardEffect}
      />

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
    </div>
  );
}
