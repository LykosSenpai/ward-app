import type { BoardAffordance, BoardZoneKind, BoardZoneRef, CardInstance, EffectTargetOption, PendingEffectTargetPrompt, PlayerState } from "@ward/shared";
import type { AppMatchState } from "../clientTypes";
import {
  canSummonCreatureFromHand,
  getCardName,
  getRequiredSacrificesForCard,
  isCreature,
  isMagic
} from "../gameViewHelpers";

function toBoardZoneKind(zone: EffectTargetOption["zone"]): BoardZoneKind | null {
  switch (zone) {
    case "HAND":
    case "DECK":
    case "CEMETERY":
    case "REMOVED_FROM_GAME":
    case "PRIMARY_CREATURE":
    case "LIMITED_SUMMON":
      return zone;
    case "MAGIC_SLOT":
      return "MAGIC_SLOT";
    case "PLAYER":
      return null;
  }
}

function toTargetZoneRef(option: EffectTargetOption): BoardZoneRef | undefined {
  const zone = toBoardZoneKind(option.zone);
  if (!zone) return undefined;
  return {
    playerId: option.playerId,
    zone
  };
}

export function buildPendingEffectTargetAffordances(prompt: PendingEffectTargetPrompt | null | undefined): BoardAffordance[] {
  if (!prompt) return [];

  return prompt.options.flatMap(option => {
    const targetZoneRef = toTargetZoneRef(option);
    if (!option.cardInstanceId && !targetZoneRef) return [];

    return [{
      id: `${prompt.id}:${option.id}`,
      kind: option.cardInstanceId ? "VALID_TARGET_CARD" : "VALID_TARGET_ZONE",
      playerId: prompt.controllerPlayerId,
      sourceCardInstanceId: prompt.sourceCardInstanceId || undefined,
      targetCardInstanceId: option.cardInstanceId,
      targetZoneRef,
      promptId: prompt.id,
      actionId: option.id,
      label: option.label,
      highlightStyle: "TARGET"
    } satisfies BoardAffordance];
  });
}

type BuildHandPlacementAffordancesParams = {
  match: AppMatchState;
  playerId: string;
  controlledPlayerId?: string | null;
  selectedHandCardId?: string | null;
  selectedSacrificeIdsByCard?: Record<string, string[]>;
  occupiedMagicSlotIndexes?: number[];
};

type HandPlacementContext = {
  anyDiscardRequired: boolean;
  canControlThisPlayer: boolean;
  canPlayMagicNow: boolean;
  canPlayPrimaryNow: boolean;
  isActivePlayer: boolean;
  isMatchComplete: boolean;
  limitedSummonPromotionRequiredForThisPlayer: boolean;
  replacementRequiredForThisPlayer: boolean;
};

function buildHandPlacementContext(
  match: AppMatchState,
  player: PlayerState,
  controlledPlayerId?: string | null
): HandPlacementContext {
  const isMatchComplete = match.status === "COMPLETE";
  const canControlThisPlayer = !controlledPlayerId || controlledPlayerId === player.id;
  const isActivePlayer = match.turn.activePlayerId === player.id;
  const anyDiscardRequired = Boolean(match.setup.handDiscardRequiredForPlayerId);
  const replacementRequiredForThisPlayer =
    match.setup.primaryReplacementRequiredForPlayerId === player.id;
  const limitedSummonPromotionRequiredForThisPlayer =
    replacementRequiredForThisPlayer && player.field.limitedSummons.length > 0;

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

  return {
    anyDiscardRequired,
    canControlThisPlayer,
    canPlayMagicNow,
    canPlayPrimaryNow,
    isActivePlayer,
    isMatchComplete,
    limitedSummonPromotionRequiredForThisPlayer,
    replacementRequiredForThisPlayer
  };
}

function getGeneralPlayBlockedReason(match: AppMatchState, player: PlayerState, context: HandPlacementContext): string | null {
  if (context.isMatchComplete) return "Match is complete.";
  if (!context.canControlThisPlayer) return `You cannot control ${player.displayName ?? "this player"} right now.`;
  if (match.pendingPrompt) return "Resolve the pending prompt before playing cards.";
  if (match.pendingChain) return "Resolve the pending Magic Chain before playing cards.";
  if (context.anyDiscardRequired) {
    const discardPlayer = match.players.find(candidate => candidate.id === match.setup.handDiscardRequiredForPlayerId);
    return `${discardPlayer?.displayName ?? "A player"} must discard down to 8 cards before playing cards.`;
  }
  if (context.limitedSummonPromotionRequiredForThisPlayer) {
    return "A Limited Summon is available and must be promoted to primary before summoning a replacement from hand.";
  }
  if (match.setup.primaryReplacementRequiredForPlayerId && !context.replacementRequiredForThisPlayer) {
    return "A primary creature replacement is required before other cards can be played.";
  }
  return null;
}

function getCreaturePlayBlockedReason(match: AppMatchState, player: PlayerState, card: CardInstance, context: HandPlacementContext): string | null {
  const generalReason = getGeneralPlayBlockedReason(match, player, context);
  if (generalReason) return generalReason;
  if (!context.canPlayPrimaryNow) {
    if (!context.isActivePlayer && !context.replacementRequiredForThisPlayer) {
      return "Only the active player can normal summon a primary creature right now.";
    }
    if (match.turn.phase !== "SUMMON_MAGIC" && !context.replacementRequiredForThisPlayer) {
      return "Normal primary summons can only be performed during the Summoning/Magic Phase.";
    }
    if (player.turnFlags.normalSummonUsed && !context.replacementRequiredForThisPlayer) {
      return "This player has already normal summoned a primary creature this turn.";
    }
    return "This creature cannot be summoned right now.";
  }
  if (!canSummonCreatureFromHand(match, player, card)) {
    return "This creature needs a legal primary slot or enough legal sacrifices before it can be summoned.";
  }
  return null;
}

function getMagicPlayBlockedReason(match: AppMatchState, player: PlayerState, context: HandPlacementContext, hasOpenMagicSlot: boolean): string | null {
  const generalReason = getGeneralPlayBlockedReason(match, player, context);
  if (generalReason) return generalReason;
  if (!context.canPlayMagicNow) {
    if (!context.isActivePlayer) return "Only the active player can play magic with this action.";
    if (match.turn.phase !== "SUMMON_MAGIC" && match.turn.phase !== "SECOND_MAGIC") {
      return "Magic cards can only be played during the Summoning/Magic Phase or 2nd Magic Phase.";
    }
    return "Magic cannot be played right now.";
  }
  if (!hasOpenMagicSlot) return "No open Magic slot is available.";
  return null;
}

function magicSlotZoneRef(playerId: string, index: number): BoardZoneRef {
  return { playerId, zone: "MAGIC_SLOT", slotIndex: index };
}

function primaryZoneRef(playerId: string): BoardZoneRef {
  return { playerId, zone: "PRIMARY_CREATURE" };
}

export function buildHandPlacementAffordances({
  match,
  playerId,
  controlledPlayerId,
  selectedHandCardId,
  selectedSacrificeIdsByCard = {},
  occupiedMagicSlotIndexes = []
}: BuildHandPlacementAffordancesParams): BoardAffordance[] {
  const player = match.players.find(candidate => candidate.id === playerId);
  if (!player) return [];

  const context = buildHandPlacementContext(match, player, controlledPlayerId);
  const occupiedMagicSlots = new Set(occupiedMagicSlotIndexes);
  const openMagicSlotIndexes = Array.from({ length: 5 }, (_, index) => index)
    .filter(index => !occupiedMagicSlots.has(index));
  const hasOpenMagicSlot = openMagicSlotIndexes.length > 0;
  const selectedCard = selectedHandCardId
    ? player.hand.find(card => card.instanceId === selectedHandCardId) ?? null
    : null;

  const affordances: BoardAffordance[] = [];

  for (const card of player.hand) {
    const cardName = getCardName(match, card);
    const creaturePlayable =
      isCreature(match, card) &&
      !getCreaturePlayBlockedReason(match, player, card, context);
    const magicPlayable =
      isMagic(match, card) &&
      !getMagicPlayBlockedReason(match, player, context, hasOpenMagicSlot);

    if (creaturePlayable || magicPlayable) {
      affordances.push({
        id: `hand:${player.id}:${card.instanceId}:playable`,
        kind: "PLAYABLE_CARD",
        playerId: player.id,
        sourceCardInstanceId: card.instanceId,
        label: `Playable: ${cardName}`,
        highlightStyle: "VALID"
      });

      if (creaturePlayable) {
        const requiredSacrifices = getRequiredSacrificesForCard(match, card);
        const selectedSacrifices = selectedSacrificeIdsByCard[card.instanceId] ?? [];
        if (selectedSacrifices.length >= requiredSacrifices) {
          affordances.push({
            id: `hand:${player.id}:${card.instanceId}:primary:drop`,
            kind: "VALID_DROP_ZONE",
            playerId: player.id,
            sourceCardInstanceId: card.instanceId,
            targetZoneRef: primaryZoneRef(player.id),
            label: `Summon ${cardName} to Primary`,
            highlightStyle: "VALID"
          });
        }
      }

      if (magicPlayable) {
        for (const index of openMagicSlotIndexes) {
          affordances.push({
            id: `hand:${player.id}:${card.instanceId}:magic:${index}:drop`,
            kind: "VALID_DROP_ZONE",
            playerId: player.id,
            sourceCardInstanceId: card.instanceId,
            targetZoneRef: magicSlotZoneRef(player.id, index),
            label: `Play ${cardName} to Magic ${index + 1}`,
            highlightStyle: "VALID"
          });
        }
      }
      continue;
    }

    const disabledReason = isCreature(match, card)
      ? getCreaturePlayBlockedReason(match, player, card, context)
      : isMagic(match, card)
        ? getMagicPlayBlockedReason(match, player, context, hasOpenMagicSlot)
        : "This card cannot be played from hand right now.";

    if (disabledReason) {
      affordances.push({
        id: `hand:${player.id}:${card.instanceId}:disabled`,
        kind: "DISABLED_ACTION",
        playerId: player.id,
        sourceCardInstanceId: card.instanceId,
        label: `Cannot play ${cardName}`,
        highlightStyle: "LOCKED",
        disabledReason
      });
    }
  }

  if (!selectedCard) return affordances;

  const selectedCardName = getCardName(match, selectedCard);

  if (isCreature(match, selectedCard)) {
    const creatureBlockedReason = getCreaturePlayBlockedReason(match, player, selectedCard, context);
    const requiredSacrifices = getRequiredSacrificesForCard(match, selectedCard);
    const selectedSacrifices = selectedSacrificeIdsByCard[selectedCard.instanceId] ?? [];
    const hasEnoughSelectedSacrifices = selectedSacrifices.length >= requiredSacrifices;

    if (creatureBlockedReason || !hasEnoughSelectedSacrifices) {
      affordances.push({
        id: `hand:${player.id}:${selectedCard.instanceId}:primary:disabled`,
        kind: "DISABLED_ACTION",
        playerId: player.id,
        sourceCardInstanceId: selectedCard.instanceId,
        targetZoneRef: primaryZoneRef(player.id),
        label: `Cannot summon ${selectedCardName} to Primary`,
        highlightStyle: "LOCKED",
        disabledReason: creatureBlockedReason ?? `Select ${requiredSacrifices} required sacrifice${requiredSacrifices === 1 ? "" : "s"} before summoning.`
      });
    }
  }

  if (isMagic(match, selectedCard)) {
    const magicBlockedReason = getMagicPlayBlockedReason(match, player, context, hasOpenMagicSlot);
    for (const index of Array.from({ length: 5 }, (_, slotIndex) => slotIndex)) {
      if (!magicBlockedReason && !occupiedMagicSlots.has(index)) continue;
      affordances.push({
        id: `hand:${player.id}:${selectedCard.instanceId}:magic:${index}:disabled`,
        kind: "DISABLED_ACTION",
        playerId: player.id,
        sourceCardInstanceId: selectedCard.instanceId,
        targetZoneRef: magicSlotZoneRef(player.id, index),
        label: `Cannot play ${selectedCardName} to Magic ${index + 1}`,
        highlightStyle: "LOCKED",
        disabledReason: magicBlockedReason ?? "That Magic slot is already occupied."
      });
    }
  }

  return affordances;
}
