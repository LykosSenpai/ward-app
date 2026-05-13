import type { BoardAffordance, BoardZoneKind, BoardZoneRef, CardInstance, CardDefinition, EffectTargetOption, MagicChainLink, PendingEffectTargetPrompt, PlayerState, WardEngineEffect } from "@ward/shared";
import type { AppMatchState } from "../clientTypes";
import {
  canSummonCreatureFromHand,
  getCardName,
  getBattleBlockReason,
  getPlayerBattleCreatureOptions,
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

function battleZoneRef(playerId: string): BoardZoneRef {
  return { playerId, zone: "BATTLE" };
}

function effectText(effect: WardEngineEffect): string {
  return [
    effect.actionType,
    effect.effectGroup,
    effect.actionText,
    effect.target,
    effect.value,
    effect.params?.target,
    effect.params?.valueText,
    effect.notes
  ].filter(Boolean).join(" ").toLowerCase();
}

function effectNegatesMagicChainLink(effect: WardEngineEffect): boolean {
  const actionType = effect.actionType.trim().toUpperCase();
  const text = effectText(effect);

  if (actionType.includes("NEGATE_ATTACK") && !actionType.includes("MAGIC")) {
    return text.includes("magic");
  }

  return (
    actionType.includes("NEGATE_MAGIC") ||
    actionType.includes("NEGATE_CARD") ||
    actionType.includes("NEGATE_EFFECT") ||
    actionType.includes("NEGATE_LIGHTNING") ||
    (text.includes("negate") && (text.includes("magic") || text.includes("lightning") || text.includes("card") || text.includes("effect")))
  );
}

function conditionType(value: unknown): string {
  return value && typeof value === "object" && "type" in value
    ? String((value as { type?: unknown }).type ?? "").trim().toUpperCase()
    : "";
}

function effectRespondsToOpponentMagic(effect: WardEngineEffect): boolean {
  const trigger = String(effect.trigger ?? "").trim().toUpperCase();
  const text = effectText(effect);
  return (
    trigger.includes("OPPONENT_PLAYS_MAGIC") ||
    conditionType(effect.condition).includes("OPPONENT_PLAYS_MAGIC") ||
    conditionType(effect.params?.condition).includes("OPPONENT_PLAYS_MAGIC") ||
    text.includes("opponent plays a magic") ||
    text.includes("opponent magic card")
  );
}

function effectRequiresOpponentLightning(effect: WardEngineEffect): boolean {
  const trigger = String(effect.trigger ?? "").trim().toUpperCase();
  return (
    trigger.includes("OPPONENT_PLAYS_LIGHTNING") ||
    conditionType(effect.condition).includes("OPPONENT_PLAYS_LIGHTNING") ||
    conditionType(effect.params?.condition).includes("OPPONENT_PLAYS_LIGHTNING")
  );
}

function effectIsBattleAttackDamageResponse(effect: WardEngineEffect): boolean {
  const actionType = String(effect.actionType ?? "").trim().toUpperCase();
  const trigger = String(effect.trigger ?? "").trim().toUpperCase();

  return (
    (trigger === "DURING_BATTLE_FROM_HAND" || trigger.includes("ATTACK_HITS")) &&
    (
      actionType === "NEGATE_ATTACK_DAMAGE" ||
      actionType === "PREVENT_ATTACK_DAMAGE" ||
      actionType === "NEGATE_ATTACK_OR_MAGIC" ||
      actionType === "NEGATE_ATTACK" ||
      actionType === "PREVENT_ATTACK"
    )
  );
}

function cardIsBattleAttackDamageResponse(definition: CardDefinition | undefined): boolean {
  return Boolean(
    definition?.cardType === "MAGIC" &&
    (definition.magicType === "BATTLE_LIGHTNING" || definition.magicType === "LIGHTNING") &&
    definition.effects?.some(effectIsBattleAttackDamageResponse)
  );
}

function getBattleResponseDisabledReason(
  match: AppMatchState,
  player: PlayerState,
  card: CardInstance
): string | null {
  const battle = match.pendingBattle;
  const definition = match.cardCatalog[card.cardId] as CardDefinition | undefined;

  if (!battle) return "Battle responses can only be played during a pending battle.";
  if (match.pendingPrompt) return "Resolve the pending prompt before playing a battle response.";
  if (match.pendingEffectTargetPrompt) return "Choose the pending effect target before playing a battle response.";
  if (match.pendingChain) return "Resolve the pending Magic Chain before playing a battle response.";

  const strike = battle.strikes[battle.currentStrikeIndex];
  if (!strike) return "No active battle strike is available.";
  if (strike.defender.playerId !== player.id) {
    return "Only the defender of the current strike can play this battle response.";
  }
  if (battle.status !== "AWAITING_DAMAGE_ROLL" && battle.status !== "AWAITING_DAMAGE_APPLICATION") {
    return "Battle responses can only be played after a hit and before damage is applied.";
  }
  if (strike.status !== "AWAITING_DAMAGE_ROLL" && strike.status !== "AWAITING_DAMAGE_APPLICATION") {
    return "This strike is not waiting for attack damage prevention.";
  }
  if (!cardIsBattleAttackDamageResponse(definition)) {
    return "This card is not a battle-only attack damage response.";
  }

  return null;
}

export function buildBattleAffordances(match: AppMatchState, controlledPlayerId?: string | null): BoardAffordance[] {
  const affordances: BoardAffordance[] = [];
  const battle = match.pendingBattle;

  if (battle) {
    const strike = battle.strikes[battle.currentStrikeIndex];
    for (const player of match.players) {
      if (controlledPlayerId && controlledPlayerId !== player.id) continue;

      for (const card of player.hand) {
        const definition = match.cardCatalog[card.cardId] as CardDefinition | undefined;
        if (definition?.cardType !== "MAGIC" || (definition.magicType !== "BATTLE_LIGHTNING" && definition.magicType !== "LIGHTNING")) continue;
        if (!cardIsBattleAttackDamageResponse(definition)) continue;

        const disabledReason = getBattleResponseDisabledReason(match, player, card);
        const cardName = getCardName(match, card);

        affordances.push({
          id: `battle:${battle.id}:${strike?.id ?? "no-strike"}:${player.id}:${card.instanceId}:${disabledReason ? "disabled" : "response"}`,
          kind: disabledReason ? "DISABLED_ACTION" : "VALID_BATTLE_RESPONSE",
          playerId: player.id,
          sourceCardInstanceId: card.instanceId,
          targetCardInstanceId: strike?.defender.creatureInstanceId,
          targetZoneRef: battleZoneRef(player.id),
          actionId: disabledReason ? undefined : "PLAY_BATTLE_RESPONSE",
          label: disabledReason ? `Cannot play ${cardName}` : `Battle response: ${cardName}`,
          highlightStyle: disabledReason ? "LOCKED" : "BATTLE_RESPONSE",
          disabledReason: disabledReason ?? undefined
        });
      }
    }

    return affordances;
  }

  const activePlayer = match.players.find(player => player.id === match.turn.activePlayerId);
  for (const player of match.players) {
    if (controlledPlayerId && controlledPlayerId !== player.id) continue;

    for (const card of player.hand) {
      const definition = match.cardCatalog[card.cardId] as CardDefinition | undefined;
      if (!cardIsBattleAttackDamageResponse(definition)) continue;

      const cardName = getCardName(match, card);
      affordances.push({
        id: `battle:no-session:${player.id}:${card.instanceId}:disabled`,
        kind: "DISABLED_ACTION",
        playerId: player.id,
        sourceCardInstanceId: card.instanceId,
        actionId: undefined,
        label: `Cannot play ${cardName}`,
        highlightStyle: "LOCKED",
        disabledReason: getBattleResponseDisabledReason(match, player, card) ?? "Battle response is not playable right now."
      });
    }
  }

  if (!activePlayer || (controlledPlayerId && controlledPlayerId !== activePlayer.id)) return affordances;

  const battleBlockReason = getBattleBlockReason(match);
  if (battleBlockReason) return affordances;

  const defender = match.players.find(player => player.id !== activePlayer.id);
  const defenderCard = defender?.field.primaryCreature;

  for (const option of getPlayerBattleCreatureOptions(match, activePlayer)) {
    if (option.usedThisCombat || option.statusBattleSkipReason) continue;

    affordances.push({
      id: `battle:${activePlayer.id}:${option.card.instanceId}:attacker`,
      kind: "VALID_BATTLE_ATTACKER",
      playerId: activePlayer.id,
      sourceCardInstanceId: option.card.instanceId,
      actionId: "DECLARE_BATTLE_ATTACKER",
      label: `Battle with ${getCardName(match, option.card)}`,
      highlightStyle: "VALID"
    });

    if (defender && defenderCard) {
      affordances.push({
        id: `battle:${activePlayer.id}:${option.card.instanceId}:${defenderCard.instanceId}:defender`,
        kind: "VALID_BATTLE_DEFENDER",
        playerId: activePlayer.id,
        sourceCardInstanceId: option.card.instanceId,
        targetCardInstanceId: defenderCard.instanceId,
        targetZoneRef: primaryZoneRef(defender.id),
        actionId: "DECLARE_BATTLE_DEFENDER",
        label: `Target ${getCardName(match, defenderCard)}`,
        highlightStyle: "TARGET"
      });
    }
  }

  return affordances;
}

function effectCanRespondToChainLink(effect: WardEngineEffect, previousLink: MagicChainLink): boolean {
  if (!effectNegatesMagicChainLink(effect)) return false;
  if (effectRequiresOpponentLightning(effect)) {
    return previousLink.magicType === "LIGHTNING" || previousLink.isLightningResponse;
  }
  return effectRespondsToOpponentMagic(effect);
}

function getMagicPlayLockReason(match: AppMatchState, playerId: string): string | null {
  const blocked = match.players
    .flatMap(player => [
      ...player.hand,
      ...player.deck,
      ...player.cemetery,
      ...player.removedFromGame,
      ...player.field.magicSlots,
      ...(player.field.primaryCreature ? [player.field.primaryCreature] : []),
      ...player.field.limitedSummons,
      ...match.chainZone
    ])
    .flatMap(card => card.activeEffectInstances ?? [])
    .find(instance =>
      instance.targetPlayerId === playerId &&
      (
        instance.actionType === "APPLY_OPPONENT_MAGIC_PLAY_LOCK" ||
        instance.actionType === "APPLY_PLAY_RESTRICTION"
      )
    );

  return blocked?.label ?? null;
}

function getLightningChainResponseDisabledReason(
  match: AppMatchState,
  player: PlayerState,
  card: CardInstance
): string | null {
  if (match.pendingPrompt) return "Resolve the pending prompt before playing a Lightning response.";
  if (match.setup.handDiscardRequiredForPlayerId) return "A hand discard is required before any Magic Chain response.";
  if (!match.pendingChain) return "Lightning responses can only be played during an active Magic Chain.";

  const definition = match.cardCatalog[card.cardId] as CardDefinition | undefined;
  if (definition?.cardType !== "MAGIC" || definition.magicType !== "LIGHTNING") {
    return "Only Lightning Magic cards can be played as a chain response.";
  }

  const magicPlayLockReason = getMagicPlayLockReason(match, player.id);
  if (magicPlayLockReason) {
    return magicPlayLockReason;
  }

  const chain = match.pendingChain;
  const previousLink = chain.links.at(-1);
  if (!previousLink) return "Magic Chain has no link to respond to.";
  if (chain.priorityPlayerId && chain.priorityPlayerId !== player.id) {
    return "Only the current Magic Chain priority player can respond.";
  }
  if (previousLink.playerId === player.id) {
    return "A player cannot respond to their own chain link.";
  }

  const effects = definition.effects ?? [];
  if (effects.length === 0) {
    return "This Lightning card has no parsed chain-response effect.";
  }
  if (!effects.some(effect => effectCanRespondToChainLink(effect, previousLink))) {
    const lightningOnly = effects.some(effectRequiresOpponentLightning);
    return lightningOnly && previousLink.magicType !== "LIGHTNING" && !previousLink.isLightningResponse
      ? "This Lightning card can only respond when the opponent plays Lightning."
      : "This Lightning card's trigger or condition does not match the current chain link.";
  }

  return null;
}

export function buildMagicChainAffordances(match: AppMatchState, controlledPlayerId?: string | null): BoardAffordance[] {
  const chain = match.pendingChain;
  if (!chain) return [];

  const affordances: BoardAffordance[] = [];

  if (chain.priorityPlayerId && (!controlledPlayerId || controlledPlayerId === chain.priorityPlayerId)) {
    affordances.push({
      id: `chain:${chain.id}:${chain.priorityPlayerId}:pass`,
      kind: "VALID_CHAIN_RESPONSE",
      playerId: chain.priorityPlayerId,
      actionId: "PASS_MAGIC_CHAIN_PRIORITY",
      label: "Pass Magic Chain priority",
      highlightStyle: "CHAIN"
    });
  }

  for (const player of match.players) {
    if (controlledPlayerId && controlledPlayerId !== player.id) continue;

    for (const card of player.hand) {
      const definition = match.cardCatalog[card.cardId];
      if (definition?.cardType !== "MAGIC" || definition.magicType !== "LIGHTNING") continue;

      const disabledReason = getLightningChainResponseDisabledReason(match, player, card);
      const cardName = getCardName(match, card);

      affordances.push({
        id: `chain:${chain.id}:${player.id}:${card.instanceId}:${disabledReason ? "disabled" : "response"}`,
        kind: disabledReason ? "DISABLED_ACTION" : "VALID_CHAIN_RESPONSE",
        playerId: player.id,
        sourceCardInstanceId: card.instanceId,
        actionId: disabledReason ? undefined : "PLAY_LIGHTNING_RESPONSE",
        label: disabledReason ? `Cannot chain ${cardName}` : `Chain ${cardName}`,
        highlightStyle: disabledReason ? "LOCKED" : "CHAIN",
        disabledReason: disabledReason ?? undefined
      });
    }
  }

  return affordances;
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
