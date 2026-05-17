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
    (definition.magicType === "INFINITE" || definition.magicType === "STANDARD") &&
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
  baseValue: number,
  match?: AppMatchState
): number {
  const countedPermanentModifiers = new Set<string>();
  const activeDelta = (card.activeStatModifiers ?? [])
    .filter(modifier => modifier.stat === stat)
    .reduce((total, modifier) => {
      if (modifier.durationType === "PERMANENT_UNTIL_SOURCE_REMOVED") {
        const key = [
          modifier.sourceCardInstanceId,
          modifier.sourceEffectId,
          modifier.stat
        ].join(":");

        if (countedPermanentModifiers.has(key)) {
          return total;
        }

        countedPermanentModifiers.add(key);
      }

      return total + modifier.delta;
    }, 0);
  const attachedStaticDelta = match
    ? match.players
      .flatMap(player => player.field.magicSlots)
      .filter(magic => magic.attachedToInstanceId === card.instanceId)
      .flatMap(magic => (match.cardCatalog[magic.cardId]?.effects ?? []).map(effect => ({ magic, effect })))
      .flatMap(({ magic, effect }) => {
        const trigger = String(effect.trigger ?? "").trim().toUpperCase();
        const durationType = String(effect.duration?.type ?? effect.params?.duration?.type ?? "").trim().toUpperCase();
        const targetText = [
          effect.target,
          effect.params?.target,
          effect.value,
          effect.params?.valueText,
          effect.actionText
        ].filter(Boolean).join(" ").toLowerCase();
        if (trigger !== "WHILE_EQUIPPED" && durationType !== "WHILE_EQUIPPED") return [];
        if (!targetText.includes("equipped creature")) return [];
        if ((card.activeStatModifiers ?? []).some(modifier =>
          modifier.sourceCardInstanceId === magic.instanceId &&
          modifier.sourceEffectId === effect.id &&
          modifier.stat === stat
        )) return [];
        return effect.params?.statChanges ?? [];
      })
      .reduce((total, change) => {
        const rawStat = String(change.stat ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
        const normalized =
          rawStat === "AL" || rawStat === "ARMOR" || rawStat === "ARMOR_LEVEL" ? "armorLevel" :
          rawStat === "SPD" || rawStat === "SPEED" ? "speed" :
          rawStat === "ATK_DICE" || rawStat === "ATK_DICE_ROLLS" || rawStat === "ATTACK_DICE" || rawStat === "ATTACK_DICE_ROLLS" ? "attackDice" :
          rawStat === "MOD" || rawStat === "MODIFIER" ? "modifier" :
          undefined;
        if (normalized !== stat) return total;
        const value = Number(change.value);
        if (!Number.isFinite(value)) return total;
        const operation = String(change.operation ?? "ADD").trim().toUpperCase();
        if (operation === "ADD") return total + value;
        if (operation === "SUBTRACT") return total - value;
        return total;
      }, 0)
    : 0;
  const totalDelta = activeDelta + attachedStaticDelta;

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

  const effectiveAl = getEffectiveCreatureStat(card, "armorLevel", definition.armorLevel, match);
  const effectiveSpeed = getEffectiveCreatureStat(card, "speed", definition.speed, match);
  const effectiveAttackDice = getEffectiveCreatureStat(card, "attackDice", definition.attackDice, match);
  const effectiveModifier = getEffectiveCreatureStat(card, "modifier", definition.modifier, match);

  return `AL ${effectiveAl} | SPD ${effectiveSpeed} | ATK ${effectiveAttackDice}D6 | MOD ${effectiveModifier} | HP ${definition.hp}`;
}

const OPTIONAL_ACTIVATED_ROLL_TRIGGERS = new Set([
  "ACTIVATED",
  "DURING_YOUR_TURN",
  "DURING_YOUR_TURN_ACTIVATED",
  "ONCE_PER_TURN_ACTIVATED",
  "REQUEST_BASED"
]);

function effectRollToken(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function effectRollTokenLooksCombatOrTriggered(value: string): boolean {
  return value.includes("BATTLE") ||
    value.includes("COMBAT") ||
    value.includes("HIT") ||
    value.includes("DAMAGE") ||
    value.includes("STATUS_TICK");
}

export function isPendingEffectRollPhaseBlocking(effectRoll?: AppMatchState["pendingEffectRoll"]): boolean {
  if (!effectRoll) return false;

  if (effectRoll.linkedBattleSessionId || effectRoll.linkedStrikeId) {
    return true;
  }

  const trigger = effectRollToken(effectRoll.trigger);
  const actionType = effectRollToken(effectRoll.actionType);
  const onSuccessActionType = effectRollToken(effectRoll.onSuccessActionType);

  if (
    effectRoll.targetStatusId ||
    actionType === "RESOLVE_STATUS_TICK" ||
    onSuccessActionType === "REMOVE_STATUS" ||
    effectRoll.onFailureActionType
  ) {
    return true;
  }

  if (OPTIONAL_ACTIVATED_ROLL_TRIGGERS.has(trigger)) {
    return false;
  }

  if (effectRollTokenLooksCombatOrTriggered(trigger) || effectRollTokenLooksCombatOrTriggered(actionType)) {
    return true;
  }

  return true;
}

export function getAdvanceBlockReason(match: AppMatchState): string {
  if (match.pendingBattle && match.pendingBattle.status !== "COMPLETE") {
    return "Finish the pending battle before advancing.";
  }

  if (match.pendingEffectRoll && isPendingEffectRollPhaseBlocking(match.pendingEffectRoll)) {
    return match.pendingEffectRoll.status === "AWAITING_ROLL"
      ? "Roll the pending effect dice before advancing."
      : "Resolve the pending effect roll before advancing.";
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
  battleUseCount: number;
  battleUseLimit: number;
  statusBattleSkipReason?: string;
};

const CABAL_WARCHIEF_CARD_ID = "gen3_026_cabal_warchief";

function getCreatureBattleUseLimit(card: CardInstance): number {
  const activeExtraBattles = (card.activeEffectInstances ?? [])
    .filter(instance => String(instance.actionType ?? "").trim().toUpperCase() === "APPLY_BATTLE_REQUIREMENT")
    .reduce((total, instance) => {
      const explicit = Number(instance.extraInitiatedBattles);
      if (Number.isFinite(explicit) && explicit > 0) return total + Math.trunc(explicit);

      const text = [
        instance.label,
        instance.durationText,
        ...(instance.debug ?? [])
      ].filter(Boolean).join(" ").toLowerCase();
      return total + (text.includes("battle twice") || text.includes("initiate battle twice") ? 1 : 0);
    }, 0);

  return 1 + Math.max(activeExtraBattles, card.cardId === CABAL_WARCHIEF_CARD_ID ? 1 : 0);
}

function getCreatureBattleUseCount(usedCreatureIds: string[], creatureInstanceId: string): number {
  return usedCreatureIds.filter(id => id === creatureInstanceId).length;
}

export function getPlayerBattleCreatureOptions(
  match: AppMatchState,
  player: PlayerState
): BattleCreatureOption[] {
  const usedCreatureIds = player.turnFlags.battleUsedCreatureInstanceIds ?? [];
  const options: BattleCreatureOption[] = [];

  if (player.field.primaryCreature) {
    const battleUseLimit = getCreatureBattleUseLimit(player.field.primaryCreature);
    const battleUseCount = getCreatureBattleUseCount(usedCreatureIds, player.field.primaryCreature.instanceId);
    options.push({
      id: player.field.primaryCreature.instanceId,
      kind: "PRIMARY_CREATURE",
      playerId: player.id,
      card: player.field.primaryCreature,
      label: `Primary: ${getCardName(match, player.field.primaryCreature)}`,
      usedThisCombat: battleUseCount >= battleUseLimit,
      battleUseCount,
      battleUseLimit,
      statusBattleSkipReason: getStatusBattleSkipReason(match, player.field.primaryCreature)
    });
  }

  for (const limitedSummon of player.field.limitedSummons) {
    const battleUseLimit = getCreatureBattleUseLimit(limitedSummon);
    const battleUseCount = getCreatureBattleUseCount(usedCreatureIds, limitedSummon.instanceId);
    options.push({
      id: limitedSummon.instanceId,
      kind: "LIMITED_SUMMON",
      playerId: player.id,
      card: limitedSummon,
      label: `Limited: ${getCardName(match, limitedSummon)}`,
      usedThisCombat: battleUseCount >= battleUseLimit,
      battleUseCount,
      battleUseLimit,
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
