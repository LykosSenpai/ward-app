import type { BattleCreatureKind, CardInstance, PlayerState } from "@ward/shared";
import type { AppMatchState } from "./clientTypes";

export function getActivePlayerName(match: AppMatchState): string {
  const activePlayer = match.players.find(
    player => player.id === match.turn.activePlayerId
  );

  return activePlayer?.displayName ?? "Unknown Player";
}

export function getPlayerName(match: AppMatchState, playerId: string): string {
  return match.players.find(player => player.id === playerId)?.displayName ?? playerId;
}

export function getMatchStatus(match: AppMatchState): "ACTIVE" | "COMPLETE" {
  return match.status ?? "ACTIVE";
}

export function getWinnerName(match: AppMatchState): string {
  if (!match.winnerPlayerId) return "None";
  return getPlayerName(match, match.winnerPlayerId);
}

export function getLoserName(match: AppMatchState): string {
  if (!match.losingPlayerId) return "None";
  return getPlayerName(match, match.losingPlayerId);
}

export function getCardName(match: AppMatchState, card: CardInstance): string {
  return match.cardCatalog[card.cardId]?.name ?? card.cardId;
}

export function getCardText(match: AppMatchState, card: CardInstance): string {
  const definition = match.cardCatalog[card.cardId] as
    | { text?: string }
    | undefined;

  return definition?.text ?? "";
}

export function isCreature(match: AppMatchState, card: CardInstance): boolean {
  return match.cardCatalog[card.cardId]?.cardType === "CREATURE";
}

export function isMagic(match: AppMatchState, card: CardInstance): boolean {
  return match.cardCatalog[card.cardId]?.cardType === "MAGIC";
}

export function getDisplayMagicType(magicType?: string): string {
  return magicType === "BATTLE_LIGHTNING" ? "LIGHTNING" : magicType ?? "";
}

export function getMagicLine(match: AppMatchState, card: CardInstance): string {
  const definition = match.cardCatalog[card.cardId];

  if (!definition || definition.cardType !== "MAGIC") {
    return "";
  }

  return `${getDisplayMagicType(definition.magicType)} | ${definition.magicSubType}`;
}

export function isEquipMagic(match: AppMatchState, card: CardInstance): boolean {
  const definition = match.cardCatalog[card.cardId];

  return (
    definition?.cardType === "MAGIC" &&
    definition.magicType === "INFINITE" &&
    definition.magicSubType === "EQUIP"
  );
}

export function getAttachedCreatureLabel(match: AppMatchState, attachedToInstanceId?: string): string {
  if (!attachedToInstanceId) {
    return "Not attached";
  }

  for (const player of match.players) {
    if (player.field.primaryCreature?.instanceId === attachedToInstanceId) {
      return `${player.displayName}'s ${getCardName(match, player.field.primaryCreature)}`;
    }

    const limited = player.field.limitedSummons.find(
      card => card.instanceId === attachedToInstanceId
    );

    if (limited) {
      return `${player.displayName}'s ${getCardName(match, limited)}`;
    }
  }

  return "Attached target not found";
}

export function isLightningMagic(match: AppMatchState, card: CardInstance): boolean {
  const definition = match.cardCatalog[card.cardId];

  return definition?.cardType === "MAGIC" &&
    (definition.magicType === "LIGHTNING" || definition.magicType === "BATTLE_LIGHTNING");
}

export function isChainLightningMagic(match: AppMatchState, card: CardInstance): boolean {
  const definition = match.cardCatalog[card.cardId];

  return definition?.cardType === "MAGIC" && definition.magicType === "LIGHTNING";
}

export function isBattleLightningMagic(match: AppMatchState, card: CardInstance): boolean {
  const definition = match.cardCatalog[card.cardId];

  return definition?.cardType === "MAGIC" && definition.magicType === "BATTLE_LIGHTNING";
}

export function getRequiredSacrificesForCard(
  match: AppMatchState,
  card: CardInstance
): number {
  const definition = match.cardCatalog[card.cardId];

  if (!definition || definition.cardType !== "CREATURE") {
    return 0;
  }

  if (definition.armorLevel >= 1 && definition.armorLevel <= 6) return 0;
  if (definition.armorLevel >= 7 && definition.armorLevel <= 11) return 1;
  if (definition.armorLevel === 12) return 2;

  return 0;
}

export function creatureCannotBeSacrificed(card: CardInstance): boolean {
  return (card.activeStatuses ?? []).some(
    status => status.flags?.canBeSacrificed === false
  );
}

export function getPrimarySummonSacrificeCandidates(
  match: AppMatchState,
  player: PlayerState,
  targetCard: CardInstance
): CardInstance[] {
  const handCandidates = player.hand.filter(candidate => {
    return (
      candidate.instanceId !== targetCard.instanceId &&
      isCreature(match, candidate) &&
      !creatureCannotBeSacrificed(candidate)
    );
  });

  const primaryCreature = player.field.primaryCreature;

  if (!primaryCreature || !isCreature(match, primaryCreature)) {
    return handCandidates;
  }

  if (creatureCannotBeSacrificed(primaryCreature)) {
    return handCandidates;
  }

  return [primaryCreature, ...handCandidates];
}

export function canSummonCreatureFromHand(
  match: AppMatchState,
  player: PlayerState,
  card: CardInstance
): boolean {
  if (!isCreature(match, card)) return false;

  const requiredSacrifices = getRequiredSacrificesForCard(match, card);
  const primaryCreature = player.field.primaryCreature;

  const primaryCannotBeSacrificed = primaryCreature
    ? creatureCannotBeSacrificed(primaryCreature)
    : false;

  if (primaryCreature && requiredSacrifices === 0 && !primaryCannotBeSacrificed) {
    return false;
  }

  const availableSacrifices = getPrimarySummonSacrificeCandidates(
    match,
    player,
    card
  );

  if (
    primaryCreature &&
    !primaryCannotBeSacrificed &&
    !availableSacrifices.some(
      candidate => candidate.instanceId === primaryCreature.instanceId
    )
  ) {
    return false;
  }

  return availableSacrifices.length >= requiredSacrifices;
}

export function playerHasSummonableCreatureInHand(
  match: AppMatchState,
  player: PlayerState
): boolean {
  return player.hand.some(card => canSummonCreatureFromHand(match, player, card));
}

export function getEffectiveCreatureStat(
  card: CardInstance,
  stat: "armorLevel" | "speed" | "attackDice" | "modifier",
  baseValue: number
): number {
  const totalDelta = (card.activeStatModifiers ?? [])
    .filter(modifier => modifier.stat === stat)
    .reduce((total, modifier) => total + modifier.delta, 0);

  if (stat === "armorLevel") {
    return Math.min(12, Math.max(1, baseValue + totalDelta));
  }

  if (stat === "attackDice") {
    return Math.max(1, baseValue + totalDelta);
  }

  if (stat === "speed") {
    return Math.max(0, baseValue + totalDelta);
  }

  return baseValue + totalDelta;
}

export function getCreatureStatsLine(match: AppMatchState, card: CardInstance): string {
  const definition = match.cardCatalog[card.cardId];

  if (!definition || definition.cardType !== "CREATURE") {
    return "";
  }

  const effectiveAl = getEffectiveCreatureStat(card, "armorLevel", definition.armorLevel);
  const effectiveSpeed = getEffectiveCreatureStat(card, "speed", definition.speed);
  const effectiveAttackDice = getEffectiveCreatureStat(card, "attackDice", definition.attackDice);
  const effectiveModifier = getEffectiveCreatureStat(card, "modifier", definition.modifier);

  return `AL ${effectiveAl} | SPD ${effectiveSpeed} | ATK ${effectiveAttackDice}D6 | MOD ${effectiveModifier} | HP ${definition.hp}`;
}

export function getAdvanceBlockReason(match: AppMatchState): string {
  if (match.pendingBattle && match.pendingBattle.status !== "COMPLETE") {
    return "Finish the pending battle before advancing.";
  }

  if (match.pendingPrompt) {
    return "Resolve the pending prompt before advancing.";
  }

  if (match.pendingChain) {
    return "Resolve the pending Magic Chain before advancing.";
  }

  if (match.pendingEffectTargetPrompt) {
    return "Choose the pending effect target before advancing.";
  }

  if (match.manualEffectQueue.some(effect => !effect.completed)) {
    return "Complete all pending Magic effects before advancing.";
  }

  if (match.setup.handDiscardRequiredForPlayerId) {
    const discardPlayer = match.players.find(
      player => player.id === match.setup.handDiscardRequiredForPlayerId
    );

    return `${discardPlayer?.displayName ?? "A player"} must discard down to 8 cards before continuing.`;
  }

  if (match.setup.primaryReplacementRequiredForPlayerId) {
    const replacementPlayer = match.players.find(
      player => player.id === match.setup.primaryReplacementRequiredForPlayerId
    );

    if (replacementPlayer && replacementPlayer.field.limitedSummons.length > 0) {
      return `${replacementPlayer.displayName} must promote one Limited Summon to primary before the game can continue.`;
    }

    if (
      replacementPlayer &&
      !playerHasSummonableCreatureInHand(match, replacementPlayer)
    ) {
      return `${replacementPlayer.displayName} has no summonable creature in hand and must request a hand reveal/redraw.`;
    }

    return `${replacementPlayer?.displayName ?? "A player"} must replace their primary creature before the game can continue.`;
  }

  const activePlayer = match.players.find(
    player => player.id === match.turn.activePlayerId
  );

  if (!activePlayer) {
    return "Active player was not found.";
  }

  const activeLock = getPlayerActionLockReason(activePlayer);
  if (activeLock) return activeLock;

  if (match.turn.phase === "DRAW" && !activePlayer.turnFlags.drawnThisTurn) {
    return "Draw for turn before leaving Draw Phase.";
  }

  if (
    match.turn.phase === "SUMMON_MAGIC" &&
    !activePlayer.turnFlags.hasTakenFirstTurn &&
    !activePlayer.field.primaryCreature
  ) {
    if (!playerHasSummonableCreatureInHand(match, activePlayer)) {
      return "First turn requires a primary creature. No summonable creature is in hand, so use reveal/redraw.";
    }

    return "First turn requires a primary creature.";
  }

  return "";
}

function getPlayerActionLockReason(player: PlayerState): string {
  if (Number(player.skipNextTurnCount ?? 0) > 0) {
    const skipLock = player.playerLocks?.find(lock => lock.kind === "SKIP_TURN");
    return skipLock?.reason ?? skipLock?.label ?? `${player.displayName} must skip their next turn.`;
  }

  const actionLock = player.playerLocks?.find(lock => lock.kind === "ACTION_LOCK");
  return actionLock?.reason ?? actionLock?.label ?? "";
}



function getStatusBattleSkipReason(match: AppMatchState, card: CardInstance): string | undefined {
  const statuses = card.activeStatuses ?? [];

  if (statuses.some(status => status.flags?.canInitiateBattle === false)) {
    return "cannot initiate battle";
  }

  if (
    (match.settings.cannotInflictAttackDamageBattlePolicy ?? "SKIP_BATTLE") === "SKIP_BATTLE" &&
    statuses.some(status => status.flags?.canInflictAtkDamage === false)
  ) {
    return "cannot inflict attack damage";
  }

  return undefined;
}

export type BattleCreatureOption = {
  id: string;
  kind: BattleCreatureKind;
  playerId: string;
  card: CardInstance;
  label: string;
  usedThisCombat: boolean;
  statusBattleSkipReason?: string;
};

export function getPlayerBattleCreatureOptions(
  match: AppMatchState,
  player: PlayerState
): BattleCreatureOption[] {
  const usedCreatureIds = player.turnFlags.battleUsedCreatureInstanceIds ?? [];
  const options: BattleCreatureOption[] = [];

  if (player.field.primaryCreature) {
    options.push({
      id: player.field.primaryCreature.instanceId,
      kind: "PRIMARY_CREATURE",
      playerId: player.id,
      card: player.field.primaryCreature,
      label: `Primary: ${getCardName(match, player.field.primaryCreature)}`,
      usedThisCombat: usedCreatureIds.includes(player.field.primaryCreature.instanceId),
      statusBattleSkipReason: getStatusBattleSkipReason(match, player.field.primaryCreature)
    });
  }

  for (const limitedSummon of player.field.limitedSummons) {
    options.push({
      id: limitedSummon.instanceId,
      kind: "LIMITED_SUMMON",
      playerId: player.id,
      card: limitedSummon,
      label: `Limited: ${getCardName(match, limitedSummon)}`,
      usedThisCombat: usedCreatureIds.includes(limitedSummon.instanceId),
      statusBattleSkipReason: getStatusBattleSkipReason(match, limitedSummon)
    });
  }

  return options;
}

export function getBattleBlockReason(match: AppMatchState): string {
  const matchStatus = getMatchStatus(match);

  if (matchStatus === "COMPLETE") return "The match is complete.";
  if (match.pendingBattle && match.pendingBattle.status !== "COMPLETE") return "Finish the pending battle before starting another battle.";
  if (match.turn.phase !== "COMBAT") return "Battles can only be declared during the Combat Phase.";
  if (!match.turn.firstTurnCycleComplete) return "Battle and damage are locked during the first turn cycle.";
  if (match.pendingPrompt) return "Resolve the pending prompt before battling.";
  if (match.pendingChain) return "Resolve the pending Magic Chain before battling.";
  if (match.pendingEffectTargetPrompt) return "Choose the pending effect target before battling.";
  if (match.manualEffectQueue.some(effect => !effect.completed)) return "Complete all pending Magic effects before battling.";
  if (match.setup.handDiscardRequiredForPlayerId) return "A player must discard down to 8 cards before battling.";
  if (match.setup.primaryReplacementRequiredForPlayerId) return "A primary creature replacement is required before battling.";

  const activePlayer = match.players.find(player => player.id === match.turn.activePlayerId);
  const defendingPlayer = match.players.find(player => player.id !== match.turn.activePlayerId);

  if (!activePlayer) return "Active player was not found.";
  const activeLock = getPlayerActionLockReason(activePlayer);
  if (activeLock) return activeLock;
  if (!activePlayer.field.primaryCreature && activePlayer.field.limitedSummons.length === 0) {
    return "The active player has no creature that can declare battle.";
  }
  if (!defendingPlayer?.field.primaryCreature) return "The defending player has no primary creature to battle.";

  const hasUnusedAttacker = getPlayerBattleCreatureOptions(match, activePlayer).some(
    option => !option.usedThisCombat
  );

  if (!hasUnusedAttacker) return "Every active creature has already battled this Combat Phase.";

  return "";
}
