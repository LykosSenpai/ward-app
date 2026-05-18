import { getEffectiveCreatureStats } from "./effectiveStats.js";
import { sumDice } from "./dice.js";
import { rollD6WithDev } from "./devRolls.js";
import { v4 as uuidv4 } from "uuid";
import type {
  ActiveRecurringCreatureEffect,
  BattleCreatureKind,
  BattleParticipantSnapshot,
  BattleResult,
  BattleSpeedTieRound,
  BattleStrikeResult,
  CardDefinition,
  CardInstance,
  EffectTargetOption,
  ManualBattleSpeedModifiers,
  ManualBattleStrike,
  ManualBattleStrikeModifiers,
  MatchState,
  PendingBattleSession,
  PendingEffectRollSession,
  PlayerState,
  WardEngineEffect
} from "@ward/shared";
import { moveFieldCreatureToCemetery } from "./fieldRemoval.js";
import { applyDamageToCreatureTarget, moveMagicSlotCardToCemetery } from "./cardMovement.js";
import { processCombatPhaseEndInPlace } from "./turns.js";
import {
  collectBattleEffectSuggestions,
  getSuggestedSpeedModifiers,
  getSuggestedStrikeModifiers
} from "./battleEffectAdapter.js";
import { runBattleTimingTriggers } from "./triggers.js";
import {
  creatureCannotInflictAttackDamage,
  creatureCannotReceiveDamage,
  resolveBattleTriggeredRuntimeEffects
} from "./creatureRuntimeEffects.js";
import {
  applyPendingEffectRollStatusInPlace,
  detectPendingEffectRollForStrike,
  rollPendingEffectRollInPlace,
  skipPendingEffectRollInPlace
} from "./effectRollActions.js";
import { syncRecurringActiveEffectInstance } from "./activeEffectInstances.js";
import {
  getNextRecurringEffectTickSchedule,
  getTurnCycleExpiration,
  normalizeRecurringTickTiming
} from "./effectTiming.js";

type CreatureDefinition = Extract<CardDefinition, { cardType: "CREATURE" }>;
const HOGGAN_CARD_ID = "gen3_009_hoggan";
const HOGGAN_BATTLE_INTERCEPT_ACTION = "HOGGAN_BATTLE_INTERCEPT";
const CABAL_WARCHIEF_CARD_ID = "gen3_026_cabal_warchief";
const CABAL_RETALIATION_CHOICE_ACTION = "CABAL_RETALIATION_CHOICE";

function handBoardZoneRef(playerId: string) {
  return { playerId, zone: "HAND" as const };
}

function cemeteryBoardZoneRef(playerId: string) {
  return { playerId, zone: "CEMETERY" as const };
}

type BattleCreatureRef = {
  playerId: string;
  kind: BattleCreatureKind;
  card: CardInstance;
};

const DEFAULT_STRIKE_MODIFIERS: ManualBattleStrikeModifiers = {
  hitDiceDelta: 0,
  hitFlatBonus: 0,
  hitRollMultiplier: 1,
  forceHitResult: "AUTO",
  damageDiceDelta: 0,
  damageFlatBonus: 0,
  damageMultiplier: 1,
  preventAttackDamage: false
};

const DEFAULT_SPEED_MODIFIERS: ManualBattleSpeedModifiers = {
  attackingSpeedDelta: 0,
  defendingSpeedDelta: 0,
  override: "AUTO"
};

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.trunc(numeric)));
}

function clampOptionalInteger(value: unknown, min: number, max: number): number | undefined {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  return Math.max(min, Math.min(max, Math.trunc(numeric)));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, numeric));
}

function normalizeStrikeModifiers(
  modifiers?: Partial<ManualBattleStrikeModifiers>
): ManualBattleStrikeModifiers {
  const forceHitResult = modifiers?.forceHitResult === "FORCE_HIT" || modifiers?.forceHitResult === "FORCE_MISS"
    ? modifiers.forceHitResult
    : "AUTO";

  return {
    hitDiceDelta: clampInteger(modifiers?.hitDiceDelta, -1, 10, DEFAULT_STRIKE_MODIFIERS.hitDiceDelta),
    hitDiceLimit: clampOptionalInteger(modifiers?.hitDiceLimit, 1, 20),
    hitFlatBonus: clampInteger(modifiers?.hitFlatBonus, -50, 50, DEFAULT_STRIKE_MODIFIERS.hitFlatBonus),
    hitRollMultiplier: clampNumber(modifiers?.hitRollMultiplier, 0, 25, DEFAULT_STRIKE_MODIFIERS.hitRollMultiplier),
    forceHitResult,
    damageDiceDelta: clampInteger(modifiers?.damageDiceDelta, -20, 20, DEFAULT_STRIKE_MODIFIERS.damageDiceDelta),
    damageFlatBonus: clampInteger(modifiers?.damageFlatBonus, -500, 500, DEFAULT_STRIKE_MODIFIERS.damageFlatBonus),
    damageMultiplier: clampNumber(modifiers?.damageMultiplier, 0, 25, DEFAULT_STRIKE_MODIFIERS.damageMultiplier),
    preventAttackDamage: Boolean(modifiers?.preventAttackDamage),
    note: typeof modifiers?.note === "string" && modifiers.note.trim()
      ? modifiers.note.trim().slice(0, 500)
      : undefined
  };
}

function normalizeSpeedModifiers(
  modifiers?: Partial<ManualBattleSpeedModifiers>
): ManualBattleSpeedModifiers {
  const override = modifiers?.override === "ATTACKER_FIRST" || modifiers?.override === "DEFENDER_FIRST"
    ? modifiers.override
    : "AUTO";

  return {
    attackingSpeedDelta: clampInteger(modifiers?.attackingSpeedDelta, -50, 50, DEFAULT_SPEED_MODIFIERS.attackingSpeedDelta),
    defendingSpeedDelta: clampInteger(modifiers?.defendingSpeedDelta, -50, 50, DEFAULT_SPEED_MODIFIERS.defendingSpeedDelta),
    override,
    note: typeof modifiers?.note === "string" && modifiers.note.trim()
      ? modifiers.note.trim().slice(0, 500)
      : undefined
  };
}

function getActiveHitDiceLimit(card?: CardInstance): { limit?: number; sourceNames: string[] } {
  const sourceNames: string[] = [];
  const limits: number[] = [];

  for (const instance of card?.activeEffectInstances ?? []) {
    const actionType = String(instance.actionType ?? "").trim().toUpperCase();
    const rollKind = String(instance.rollKind ?? "").trim().toUpperCase();
    const label = String(instance.label ?? "").toLowerCase();

    if (actionType !== "APPLY_DICE_LIMIT") continue;
    if (rollKind && rollKind !== "HIT_ROLL") continue;
    if (!rollKind && !label.includes("hit")) continue;

    const limit = Number(instance.diceLimitValue ?? instance.amount);
    if (!Number.isFinite(limit)) continue;

    limits.push(Math.max(1, Math.trunc(limit)));
    sourceNames.push(instance.sourceCardName);
  }

  if (limits.length === 0) {
    return { sourceNames };
  }

  return { limit: Math.min(...limits), sourceNames };
}

function getHitDiceCount(modifiers: ManualBattleStrikeModifiers, attackerCard?: CardInstance): number {
  const baseCount = Math.max(1, 2 + modifiers.hitDiceDelta);
  const activeLimit = getActiveHitDiceLimit(attackerCard).limit;
  const manualLimit = modifiers.hitDiceLimit;
  const limits = [activeLimit, manualLimit].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );

  if (limits.length === 0) {
    return baseCount;
  }

  return Math.max(1, Math.min(baseCount, ...limits));
}

function getDamageDiceCount(
  baseAttackDice: number,
  modifiers: ManualBattleStrikeModifiers
): number {
  return Math.max(1, baseAttackDice + modifiers.damageDiceDelta);
}

function getEffectiveSpeedWithModifier(
  baseSpeed: number,
  delta: number
): number {
  return Math.max(0, baseSpeed + delta);
}

function modifiersAreEqual(
  left: ManualBattleStrikeModifiers,
  right: ManualBattleStrikeModifiers
): boolean {
  return left.hitDiceDelta === right.hitDiceDelta &&
    left.hitDiceLimit === right.hitDiceLimit &&
    left.hitFlatBonus === right.hitFlatBonus &&
    left.hitRollMultiplier === right.hitRollMultiplier &&
    left.forceHitResult === right.forceHitResult &&
    left.damageDiceDelta === right.damageDiceDelta &&
    left.damageFlatBonus === right.damageFlatBonus &&
    left.damageMultiplier === right.damageMultiplier &&
    left.preventAttackDamage === right.preventAttackDamage &&
    (left.note ?? "") === (right.note ?? "");
}

function speedModifiersAreEqual(
  left: ManualBattleSpeedModifiers,
  right: ManualBattleSpeedModifiers
): boolean {
  return left.attackingSpeedDelta === right.attackingSpeedDelta &&
    left.defendingSpeedDelta === right.defendingSpeedDelta &&
    left.override === right.override &&
    (left.note ?? "") === (right.note ?? "");
}

function cloneState(state: MatchState): MatchState {
  return JSON.parse(JSON.stringify(state)) as MatchState;
}

function addEvent(
  state: MatchState,
  type: string,
  playerId?: string,
  payload?: unknown
): void {
  state.eventLog.push({
    id: uuidv4(),
    sequenceNumber: state.eventLog.length + 1,
    timestamp: new Date().toISOString(),
    type,
    playerId,
    payload
  });
}

function clearCurrentBattleEffectInstancesInPlace(
  state: MatchState,
  session: PendingBattleSession
): void {
  const battleCreatureIds = new Set([
    session.declaredAttacker.creatureInstanceId,
    session.declaredDefender.creatureInstanceId,
    ...session.strikes.flatMap(strike => [
      strike.attacker.creatureInstanceId,
      strike.defender.creatureInstanceId
    ])
  ]);

  for (const player of state.players) {
    const creatures = [
      player.field.primaryCreature,
      ...player.field.limitedSummons
    ].filter((card): card is CardInstance => Boolean(card));

    for (const creature of creatures) {
      if (!battleCreatureIds.has(creature.instanceId)) continue;
      const beforeCount = creature.activeEffectInstances?.length ?? 0;
      if (beforeCount === 0) continue;

      creature.activeEffectInstances = (creature.activeEffectInstances ?? []).filter(instance => {
        const durationType = String(instance.durationType ?? "").trim().toUpperCase();
        return durationType !== "CURRENT_BATTLE";
      });

      const removedCount = beforeCount - (creature.activeEffectInstances?.length ?? 0);
      if (removedCount > 0) {
        addEvent(state, "CURRENT_BATTLE_EFFECTS_EXPIRED", player.id, {
          battleSessionId: session.id,
          creatureInstanceId: creature.instanceId,
          removedCount
        });
      }
    }
  }
}

function getCannotInflictAttackDamageBattlePolicy(state: MatchState): "DAMAGE_ONLY" | "SKIP_BATTLE" {
  return state.settings?.cannotInflictAttackDamageBattlePolicy === "DAMAGE_ONLY"
    ? "DAMAGE_ONLY"
    : "SKIP_BATTLE";
}

function getCannotInitiateBattleReason(
  card: CardInstance,
  policy: "DAMAGE_ONLY" | "SKIP_BATTLE"
): string | undefined {
  const statuses = card.activeStatuses ?? [];

  if (statuses.some(status => status.flags.canInitiateBattle === false)) {
    return "This creature cannot initiate battle because of an active card effect/status.";
  }

  if (policy === "SKIP_BATTLE" && statuses.some(status => status.flags.canInflictAtkDamage === false)) {
    return "This creature cannot enter battle because it cannot inflict attack damage under the current match ruling toggle.";
  }

  return undefined;
}

function markBattleSkippedForCreature(
  state: MatchState,
  player: PlayerState,
  creature: BattleCreatureRef,
  reason: string
): void {
  markCreatureBattleUsed(player, creature.card.instanceId, getCreatureBattleUseLimit(creature.card));
  expireConsumedTemporaryBattleEquip(state, player, creature.card.instanceId);

  addEvent(state, "BATTLE_TURN_SKIPPED_BY_STATUS", player.id, {
    playerId: player.id,
    creatureInstanceId: creature.card.instanceId,
    creatureCardId: creature.card.cardId,
    battlePolicy: getCannotInflictAttackDamageBattlePolicy(state),
    reason
  });
}

function getPlayer(state: MatchState, playerId: string): PlayerState {
  const player = state.players.find(p => p.id === playerId);

  if (!player) {
    throw new Error(`Player not found: ${playerId}`);
  }

  return player;
}

function getOpponentPlayer(state: MatchState, playerId: string): PlayerState {
  const opponent = state.players.find(p => p.id !== playerId);

  if (!opponent) {
    throw new Error(`Opponent not found for player: ${playerId}`);
  }

  return opponent;
}

function getCreatureDefinition(
  state: MatchState,
  card: CardInstance
): CreatureDefinition {
  const definition = state.cardCatalog[card.cardId];

  if (!definition) {
    throw new Error(`Card definition not found: ${card.cardId}`);
  }

  if (definition.cardType !== "CREATURE") {
    throw new Error(`${definition.name} is not a creature.`);
  }

  return definition;
}

function getCardName(state: MatchState, card: CardInstance): string {
  return state.cardCatalog[card.cardId]?.name ?? card.cardId;
}

function ensureBattleUsedList(player: PlayerState): string[] {
  player.turnFlags.battleUsedCreatureInstanceIds ??= [];
  return player.turnFlags.battleUsedCreatureInstanceIds;
}

function isCabalWarchief(card: CardInstance): boolean {
  return card.cardId === CABAL_WARCHIEF_CARD_ID;
}

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

  return 1 + Math.max(activeExtraBattles, isCabalWarchief(card) ? 1 : 0);
}

function getReturnAttackLimit(card: CardInstance): number | undefined {
  const activeLimits = (card.activeEffectInstances ?? [])
    .filter(instance => String(instance.actionType ?? "").trim().toUpperCase() === "APPLY_BATTLE_REQUIREMENT")
    .flatMap(instance => {
      const explicit = Number(instance.maxReturnAttacksAgainstThisEffect);
      if (Number.isFinite(explicit) && explicit >= 0) return [Math.trunc(explicit)];

      const text = [
        instance.label,
        instance.durationText,
        ...(instance.debug ?? [])
      ].filter(Boolean).join(" ").toLowerCase();
      return text.includes("only return attack for 1") || text.includes("only return attack for one") ? [1] : [];
    });

  if (isCabalWarchief(card)) activeLimits.push(1);
  return activeLimits.length > 0 ? Math.min(...activeLimits) : undefined;
}

function limitsReturnAttacksAcrossExtraBattles(card: CardInstance): boolean {
  return getCreatureBattleUseLimit(card) > 1 && getReturnAttackLimit(card) === 1;
}

function getCreatureBattleUseCount(player: PlayerState, creatureInstanceId: string): number {
  return ensureBattleUsedList(player).filter(id => id === creatureInstanceId).length;
}

function ensureRetaliationSavedList(player: PlayerState): string[] {
  player.turnFlags.retaliationSavedCreatureInstanceIds ??= [];
  return player.turnFlags.retaliationSavedCreatureInstanceIds;
}

function canCreatureBattleThisCombat(player: PlayerState, creature: BattleCreatureRef): boolean {
  return getCreatureBattleUseCount(player, creature.card.instanceId) < getCreatureBattleUseLimit(creature.card);
}

function shouldSuppressRetaliationForBattle(player: PlayerState, creature: BattleCreatureRef): boolean {
  return limitsReturnAttacksAcrossExtraBattles(creature.card) &&
    getCreatureBattleUseCount(player, creature.card.instanceId) >= 1;
}

function getPlayerBattleCreatures(player: PlayerState): BattleCreatureRef[] {
  const creatures: BattleCreatureRef[] = [];

  if (player.field.primaryCreature) {
    creatures.push({
      playerId: player.id,
      kind: "PRIMARY_CREATURE",
      card: player.field.primaryCreature
    });
  }

  for (const limitedSummon of player.field.limitedSummons) {
    creatures.push({
      playerId: player.id,
      kind: "LIMITED_SUMMON",
      card: limitedSummon
    });
  }

  return creatures;
}

function getAttackingCreatureRef(
  player: PlayerState,
  attackerCreatureInstanceId: string
): BattleCreatureRef {
  const creature = getPlayerBattleCreatures(player).find(
    candidate => candidate.card.instanceId === attackerCreatureInstanceId
  );

  if (!creature) {
    throw new Error("Selected attacker is not on the active player's field.");
  }

  return creature;
}

function getPrimaryCreatureRef(player: PlayerState): BattleCreatureRef {
  if (!player.field.primaryCreature) {
    throw new Error(`${player.displayName} has no primary creature.`);
  }

  return {
    playerId: player.id,
    kind: "PRIMARY_CREATURE",
    card: player.field.primaryCreature
  };
}

function findBattleCreatureRef(
  state: MatchState,
  playerId: string,
  creatureInstanceId: string
): BattleCreatureRef {
  const player = getPlayer(state, playerId);
  const creature = getPlayerBattleCreatures(player).find(
    candidate => candidate.card.instanceId === creatureInstanceId
  );

  if (!creature) {
    throw new Error("Battle creature is no longer on the field.");
  }

  return creature;
}

function tryFindBattleCreatureRef(
  state: MatchState,
  playerId: string,
  creatureInstanceId: string
): BattleCreatureRef | undefined {
  const player = state.players.find(candidate => candidate.id === playerId);
  if (!player) return undefined;

  return getPlayerBattleCreatures(player).find(
    candidate => candidate.card.instanceId === creatureInstanceId
  );
}

function findCardInstanceInPlayerZones(player: PlayerState, creatureInstanceId: string): CardInstance | undefined {
  return [
    player.field.primaryCreature,
    ...player.field.limitedSummons,
    ...player.hand,
    ...player.deck,
    ...player.cemetery,
    ...player.removedFromGame
  ].find(card => card?.instanceId === creatureInstanceId);
}

function markCreatureBattleUsed(
  player: PlayerState,
  creatureInstanceId: string,
  battleUseLimit = getCreatureBattleUseLimit(findCardInstanceInPlayerZones(player, creatureInstanceId) ?? {
    instanceId: creatureInstanceId,
    cardId: "",
    ownerPlayerId: player.id,
    controllerPlayerId: player.id,
    zone: "PRIMARY_CREATURE"
  })
): void {
  const usedIds = ensureBattleUsedList(player);
  const usedCount = getCreatureBattleUseCount(player, creatureInstanceId);

  if (usedCount < battleUseLimit) {
    usedIds.push(creatureInstanceId);
  }

  const remainingAvailableCreature = getPlayerBattleCreatures(player).some(
    creature => getCreatureBattleUseCount(player, creature.card.instanceId) < getCreatureBattleUseLimit(creature.card)
  );

  player.turnFlags.hasBattledThisCombat = !remainingAvailableCreature;
}

function expireConsumedTemporaryBattleEquip(
  state: MatchState,
  player: PlayerState,
  creatureInstanceId: string
): void {
  const creature = findCardInstanceInPlayerZones(player, creatureInstanceId);
  if (!creature) return;

  const battleUseLimit = getCreatureBattleUseLimit(creature);
  if (battleUseLimit <= 1 || getCreatureBattleUseCount(player, creatureInstanceId) < battleUseLimit) return;

  const consumedSourceIds = new Set(
    (creature.activeEffectInstances ?? [])
      .filter(instance =>
        String(instance.actionType ?? "").trim().toUpperCase() === "APPLY_BATTLE_REQUIREMENT" &&
        instance.sourcePlacement === "TEMP_EQUIP"
      )
      .map(instance => instance.sourceCardInstanceId)
  );

  for (const sourceCardInstanceId of consumedSourceIds) {
    const fieldOwner = state.players.find(candidate =>
      candidate.field.magicSlots.some(card =>
        card.instanceId === sourceCardInstanceId &&
        card.attachedToInstanceId === creatureInstanceId
      )
    );
    const sourceMagic = fieldOwner?.field.magicSlots.find(card => card.instanceId === sourceCardInstanceId);
    const sourceDefinition = sourceMagic ? state.cardCatalog[sourceMagic.cardId] : undefined;

    if (!fieldOwner || !sourceMagic || sourceDefinition?.cardType !== "MAGIC" || sourceDefinition.magicType !== "STANDARD") {
      continue;
    }

    moveMagicSlotCardToCemetery(
      state,
      fieldOwner.id,
      sourceCardInstanceId,
      addEvent,
      "TEMP_EQUIP_BATTLE_REQUIREMENT_CONSUMED"
    );

    addEvent(state, "TEMP_EQUIP_BATTLE_REQUIREMENT_CONSUMED", sourceMagic.controllerPlayerId, {
      sourceCardInstanceId,
      sourceCardName: sourceDefinition.name,
      targetCreatureInstanceId: creatureInstanceId,
      targetCreatureName: getCardName(state, creature),
      battleUseCount: getCreatureBattleUseCount(player, creatureInstanceId),
      battleUseLimit,
      note: "Temporary Equip Magic was sent to the cemetery after its extra initiated battle was consumed."
    });
  }
}

function applyDamageToPrimaryCreature(
  state: MatchState,
  playerId: string,
  damage: number
): {
  remainingHp: number;
  killed: boolean;
} {
  const player = getPlayer(state, playerId);
  const primary = player.field.primaryCreature;

  if (!primary) {
    throw new Error(`${player.displayName} has no primary creature.`);
  }

  const currentHp = primary.currentHp ?? primary.baseHp ?? 0;
  const nextHp = Math.max(0, currentHp - damage);

  primary.currentHp = nextHp;

  if (nextHp > 0) {
    return {
      remainingHp: nextHp,
      killed: false
    };
  }

  moveFieldCreatureToCemetery(state, {
    fieldOwnerPlayerId: playerId,
    creatureInstanceId: primary.instanceId,
    removedFromZone: "PRIMARY_CREATURE",
    causedByPlayerId: playerId,
    reason: "PRIMARY_CREATURE_KILLED_BY_BATTLE_DAMAGE",
    requirePrimaryReplacement: true,
    autoPromoteSingleLimitedSummon: true,
    addEvent
  });

  return {
    remainingHp: 0,
    killed: true
  };
}

function getCurrentHp(card: CardInstance): number {
  return card.currentHp ?? card.baseHp ?? 0;
}

function applyDamageToBattleCreature(
  state: MatchState,
  target: BattleCreatureRef,
  damage: number
): {
  remainingHp: number;
  killed: boolean;
  damagePreventedReason?: string;
} {
  if (target.kind === "LIMITED_SUMMON") {
    return {
      remainingHp: getCurrentHp(target.card),
      killed: false,
      damagePreventedReason: "Limited Summons cannot receive HP damage."
    };
  }

  if (creatureCannotReceiveDamage(target.card)) {
    return {
      remainingHp: getCurrentHp(target.card),
      killed: false,
      damagePreventedReason: "This creature cannot receive HP damage because of an active card effect/status."
    };
  }

  return applyDamageToPrimaryCreature(state, target.playerId, damage);
}

function snapshotParticipant(
  state: MatchState,
  creature: BattleCreatureRef
): BattleParticipantSnapshot {
  const definition = getCreatureDefinition(state, creature.card);
  const stats = getEffectiveCreatureStats(state, creature.card);

  return {
    playerId: creature.playerId,
    creatureInstanceId: creature.card.instanceId,
    creatureKind: creature.kind,
    creatureName: definition.name,
    armorLevel: stats.armorLevel,
    speed: stats.speed,
    attackDice: stats.attackDice,
    modifier: stats.modifier,
    currentHp: getCurrentHp(creature.card),
    baseHp: creature.card.baseHp ?? definition.hp
  };
}

function createManualStrike(
  state: MatchState,
  role: "FIRST_STRIKE" | "RETALIATION",
  attacker: BattleCreatureRef,
  defender: BattleCreatureRef,
  suggestedEffects = state.pendingBattle?.suggestedEffects ?? []
): ManualBattleStrike {
  const suggestedModifiers = getSuggestedStrikeModifiers(
    suggestedEffects,
    attacker.card.instanceId,
    defender.card.instanceId
  );
  const activeHitDiceLimit = getActiveHitDiceLimit(attacker.card);

  if (activeHitDiceLimit.limit !== undefined) {
    suggestedModifiers.hitDiceLimit = suggestedModifiers.hitDiceLimit === undefined
      ? activeHitDiceLimit.limit
      : Math.min(suggestedModifiers.hitDiceLimit, activeHitDiceLimit.limit);
    suggestedModifiers.note = [
      suggestedModifiers.note,
      `Hit Dice limited to ${activeHitDiceLimit.limit} by ${activeHitDiceLimit.sourceNames.join(", ")}`
    ].filter(Boolean).join("; ");
  }

  return {
    id: uuidv4(),
    role,
    status: "AWAITING_HIT_ROLL",
    modifiers: normalizeStrikeModifiers(suggestedModifiers),
    attacker: snapshotParticipant(state, attacker),
    defender: snapshotParticipant(state, defender),
    damageTarget: "NONE",
    message: "Roll 2D6 + Modifier to check if this creature hits."
  };
}

function getCurrentManualStrike(session: PendingBattleSession): ManualBattleStrike {
  const strike = session.strikes[session.currentStrikeIndex];

  if (!strike) {
    throw new Error("No active battle strike found.");
  }

  return strike;
}

function pauseBattleForPendingEffectRoll(
  state: MatchState,
  session: PendingBattleSession,
  strike: ManualBattleStrike,
  message: string
): boolean {
  const pending = state.pendingEffectRoll;
  if (!pending || pending.linkedBattleSessionId !== session.id || pending.linkedStrikeId !== strike.id) {
    return false;
  }

  strike.status = "AWAITING_EFFECT_ROLL";
  session.status = "AWAITING_EFFECT_ROLL";
  setSessionUpdated(session, message);
  return true;
}

type AutomatedBattleResponseRole = "ATTACKER" | "DEFENDER";

type AutomatedBattleResponse = {
  effect: WardEngineEffect;
  role: AutomatedBattleResponseRole;
};

function normalizeEffectToken(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function battleResponseEffectText(effect: WardEngineEffect): string {
  return [
    effect.trigger,
    effect.actionType,
    effect.effectGroup,
    effect.actionText,
    effect.target,
    effect.value,
    effect.params?.target,
    effect.params?.valueText,
    effect.reusableFunction,
    effect.notes
  ].filter(Boolean).join(" ").toLowerCase();
}

function effectIsBattleResponseTrigger(effect: WardEngineEffect): boolean {
  const trigger = normalizeEffectToken(effect.trigger);
  return trigger === "DURING_BATTLE_FROM_HAND" ||
    trigger === "ON_HIT_FROM_HAND" ||
    trigger === "WHEN_OPPONENT_FINISHES_ATTACK" ||
    trigger.includes("ATTACK_HITS");
}

function effectNegatesAttackDamage(effect: WardEngineEffect): boolean {
  const actionType = normalizeEffectToken(effect.actionType);
  return actionType === "NEGATE_ATTACK_DAMAGE" ||
    actionType === "PREVENT_ATTACK_DAMAGE" ||
    actionType === "NEGATE_ATTACK_OR_MAGIC" ||
    actionType === "NEGATE_ATTACK" ||
    actionType === "PREVENT_ATTACK";
}

function effectAppliesBattleDiceModifier(effect: WardEngineEffect): boolean {
  const actionType = normalizeEffectToken(effect.actionType);
  return actionType === "APPLY_DICE_MODIFIER" || actionType === "APPLY_STAT_MODIFIER";
}

function effectDealsDirectBattleDamage(effect: WardEngineEffect): boolean {
  const actionType = normalizeEffectToken(effect.actionType);
  return actionType === "DEAL_INSTANT_DAMAGE" ||
    actionType === "DAMAGE" ||
    actionType === "DAMAGE_CREATURE";
}

function getAutomatedBattleResponse(definition: CardDefinition): AutomatedBattleResponse | undefined {
  if (definition.cardType !== "MAGIC") return undefined;
  if (definition.magicType !== "BATTLE_LIGHTNING" && definition.magicType !== "LIGHTNING") return undefined;

  const effect = definition.effects?.find(candidate => {
    if (!effectIsBattleResponseTrigger(candidate)) return false;
    return effectNegatesAttackDamage(candidate) ||
      effectAppliesBattleDiceModifier(candidate) ||
      effectDealsDirectBattleDamage(candidate);
  });

  if (!effect) return undefined;

  const trigger = normalizeEffectToken(effect.trigger);
  const role: AutomatedBattleResponseRole =
    trigger === "ON_HIT_FROM_HAND" && !effectNegatesAttackDamage(effect)
      ? "ATTACKER"
      : "DEFENDER";

  return { effect, role };
}

function isBattleAttackNegationResponseDefinition(definition: CardDefinition): boolean {
  return definition.cardType === "MAGIC" &&
    (definition.magicType === "BATTLE_LIGHTNING" || definition.magicType === "LIGHTNING") &&
    !!getBattleAttackNegationResponseEffect(definition);
}

function getBattleAttackNegationResponseEffect(definition: CardDefinition) {
  return definition.effects?.find(effect =>
    effectIsBattleResponseTrigger(effect) && effectNegatesAttackDamage(effect)
  );
}

function battleCreatureTargetOption(
  state: MatchState,
  target: BattleCreatureRef
): EffectTargetOption {
  const definition = getCreatureDefinition(state, target.card);
  return {
    id: `${target.playerId}:${target.kind}:${target.card.instanceId}`,
    label: `${getPlayer(state, target.playerId).displayName}: ${definition.name}`,
    targetKind: target.kind,
    playerId: target.playerId,
    cardInstanceId: target.card.instanceId,
    cardId: target.card.cardId,
    cardName: definition.name,
    zone: target.kind
  };
}

function firstPositiveEffectNumber(effect: WardEngineEffect): number | undefined {
  const explicit = Number(effect.params?.amount ?? effect.params?.damageAmount ?? effect.params?.healAmount);
  if (Number.isFinite(explicit) && explicit > 0) return Math.trunc(explicit);

  const match = battleResponseEffectText(effect).match(/(\d+)/);
  const value = Number(match?.[1]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;
}

function responseCanPlayForStrike(
  session: PendingBattleSession,
  strike: ManualBattleStrike,
  playerId: string,
  response: AutomatedBattleResponse
): string | null {
  if (response.role === "ATTACKER") {
    if (strike.attacker.playerId !== playerId) {
      return "Only the attacking creature's controller can play this battle response.";
    }
    if (session.status !== "AWAITING_DAMAGE_ROLL" || strike.status !== "AWAITING_DAMAGE_ROLL") {
      return "This battle response can only be played after your creature hits and before damage is rolled.";
    }
    return null;
  }

  if (strike.defender.playerId !== playerId) {
    return "Only the defender of the current strike can play this battle response.";
  }

  const trigger = normalizeEffectToken(response.effect.trigger);
  if (trigger === "WHEN_OPPONENT_FINISHES_ATTACK") {
    if (session.status !== "AWAITING_DAMAGE_APPLICATION" || strike.status !== "AWAITING_DAMAGE_APPLICATION") {
      return "This response can only be played after attack damage is rolled and before it is applied.";
    }
    return null;
  }

  if (
    (session.status !== "AWAITING_DAMAGE_ROLL" && session.status !== "AWAITING_DAMAGE_APPLICATION") ||
    (strike.status !== "AWAITING_DAMAGE_ROLL" && strike.status !== "AWAITING_DAMAGE_APPLICATION")
  ) {
    return "Battle responses can only be played after a hit and before damage is applied.";
  }

  return null;
}

function applyBattleResponseNegation(
  definition: CardDefinition,
  effect: WardEngineEffect,
  strike: ManualBattleStrike
): void {
  const modifiers = normalizeStrikeModifiers(strike.modifiers);
  modifiers.preventAttackDamage = true;
  modifiers.note = [
    modifiers.note,
    `${definition.name} ${effect.id ?? ""}: incoming attack damage negated`.trim()
  ].filter(Boolean).join("; ").slice(0, 500);
  strike.modifiers = modifiers;

  if (strike.status === "AWAITING_DAMAGE_APPLICATION") {
    strike.damageDealt = 0;
    strike.damagePreventedReason = `${definition.name} negated the Atk damage meant for this creature.`;
  }
}

function applyBattleResponseDiceModifier(
  definition: CardDefinition,
  effect: WardEngineEffect,
  strike: ManualBattleStrike
): number {
  const statChanges = Array.isArray(effect.params?.statChanges) ? effect.params?.statChanges : [];
  let diceDelta = 0;

  for (const change of statChanges) {
    if (!change || typeof change !== "object") continue;
    const data = change as { stat?: unknown; operation?: unknown; value?: unknown };
    const stat = String(data.stat ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
    const operation = String(data.operation ?? "ADD").trim().toUpperCase();
    const value = Number(data.value);
    if (!Number.isFinite(value)) continue;
    if (stat !== "ATK_DICE_ROLLS" && stat !== "ATTACK_DICE_ROLLS" && stat !== "ATK_DICE" && stat !== "ATTACK_DICE") continue;
    diceDelta += operation === "SUBTRACT" ? -Math.trunc(value) : Math.trunc(value);
  }

  if (diceDelta === 0) {
    diceDelta = firstPositiveEffectNumber(effect) ?? 0;
  }

  if (diceDelta === 0) return 0;

  const modifiers = normalizeStrikeModifiers(strike.modifiers);
  modifiers.damageDiceDelta += diceDelta;
  modifiers.note = [
    modifiers.note,
    `${definition.name} ${effect.id ?? ""}: Atk Dice Rolls ${diceDelta > 0 ? "+" : ""}${diceDelta}`.trim()
  ].filter(Boolean).join("; ").slice(0, 500);
  strike.modifiers = modifiers;
  return diceDelta;
}

function addRecurringEffectFromBattleResponse(
  state: MatchState,
  sourcePlayerId: string,
  sourceCard: CardInstance,
  sourceDefinition: CardDefinition,
  target: BattleCreatureRef,
  effect: WardEngineEffect
): ActiveRecurringCreatureEffect | undefined {
  const amount = firstPositiveEffectNumber(effect);
  if (!amount) return undefined;

  const effectType: ActiveRecurringCreatureEffect["effectType"] = normalizeEffectToken(effect.actionType).includes("HEAL")
    ? "HEAL_OVER_TIME"
    : "DAMAGE_OVER_TIME";
  const stackRule = String(effect.params?.stackRule ?? effect.duration?.stackRule ?? "DO_NOT_STACK");
  target.card.activeRecurringEffects ??= [];

  if (stackRule === "DO_NOT_STACK" && target.card.activeRecurringEffects.some(item =>
    item.effectType === effectType &&
    item.sourceCardName === sourceDefinition.name
  )) {
    return undefined;
  }

  const totalTicksValue = Number(effect.params?.durationAmount ?? effect.params?.startingTicks ?? effect.duration?.amount ?? 1);
  const totalTicks = Number.isFinite(totalTicksValue) && totalTicksValue > 0 ? Math.trunc(totalTicksValue) : 1;
  const tickTiming = normalizeRecurringTickTiming(
    typeof effect.params?.tickTiming === "string"
      ? effect.params.tickTiming
      : effect.duration?.tickTiming
  );
  const expiration = getTurnCycleExpiration({
    state,
    sourcePlayerId,
    targetPlayerId: target.playerId,
    effect,
    fallbackDuration: totalTicks
  });
  const nextTick = getNextRecurringEffectTickSchedule(state, sourcePlayerId, tickTiming);

  const recurring: ActiveRecurringCreatureEffect = {
    id: uuidv4(),
    sourceEffectId: effect.id,
    sourceCardInstanceId: sourceCard.instanceId,
    sourceCardName: sourceDefinition.name,
    sourcePlayerId,
    effectType,
    amount,
    label: effect.value ?? effect.actionText ?? effect.params?.valueText ?? `${amount}`,
    tickTiming,
    stackRule,
    remainingTicks: totalTicks,
    nextTickPlayerId: nextTick.nextTickPlayerId,
    nextTickTurnStartCount: nextTick.nextTickTurnStartCount,
    durationType: "TARGET_PLAYER_TURN_STARTS",
    appliedTurnNumber: state.turn.turnNumber,
    appliedTurnCycle: state.turn.turnCycleNumber,
    appliedSequenceNumber: state.eventLog.length + 1,
    expiresWhenSourceLeaves: true,
    expiresOnPlayerId: expiration.expiresOnPlayerId,
    expiresAtPlayerTurnStartCount: expiration.expiresAtPlayerTurnStartCount
  };

  target.card.activeRecurringEffects.push(recurring);
  syncRecurringActiveEffectInstance(target.card, recurring);
  return recurring;
}

function moveBattleResponseToCemetery(player: PlayerState, handIndex: number, card: CardInstance): void {
  player.hand.splice(handIndex, 1);
  card.zone = "CEMETERY";
  card.controllerPlayerId = player.id;
  card.attachedToInstanceId = undefined;
  player.cemetery.push(card);
}

function moveBattleResponseToMagicSlot(
  player: PlayerState,
  handIndex: number,
  card: CardInstance,
  attachedToInstanceId: string
): void {
  if (player.field.magicSlots.length >= 5) {
    throw new Error(`${player.displayName} already has 5 Magic Slot cards.`);
  }

  player.hand.splice(handIndex, 1);
  card.zone = "MAGIC_SLOT";
  card.controllerPlayerId = player.id;
  card.attachedToInstanceId = attachedToInstanceId;
  player.field.magicSlots.push(card);
}

function createHogganBattleInterceptPrompt(
  state: MatchState,
  defendingPlayer: PlayerState,
  battleSessionId: string
): void {
  if (state.pendingEffectTargetPrompt || defendingPlayer.field.limitedSummons.length >= 4) return;

  const options: EffectTargetOption[] = defendingPlayer.hand
    .filter(card => card.cardId === HOGGAN_CARD_ID)
    .map(card => ({
      id: `hoggan-${card.instanceId}`,
      label: "Play Hoggan as the battle target",
      targetKind: "CARD_IN_HAND",
      playerId: defendingPlayer.id,
      cardInstanceId: card.instanceId,
      cardId: card.cardId,
      cardName: "Hoggan",
      zone: "HAND"
    }));

  if (options.length === 0) return;

  const sourceCardInstanceId = options[0].cardInstanceId;
  if (!sourceCardInstanceId) return;

  state.pendingEffectTargetPrompt = {
    id: uuidv4(),
    sourceCardInstanceId,
    sourceCardId: HOGGAN_CARD_ID,
    sourceCardName: "Hoggan",
    controllerPlayerId: defendingPlayer.id,
    effectId: "009-E01",
    actionType: HOGGAN_BATTLE_INTERCEPT_ACTION,
    effectGroup: "Battle Intercept",
    actionText: "Play Hoggan from hand as a Limited Summon in place of your primary creature.",
    effectValue: "Opponent must battle Hoggan instead of your primary creature.",
    promptText: "Your opponent declared battle. You may play Hoggan from your hand as a Limited Summon and make the attacker battle Hoggan instead.",
    targetKind: "CARD_IN_HAND",
    options: [
      ...options,
      {
        id: "hoggan-battle-intercept-skip",
        label: "Do not play Hoggan",
        targetKind: "PLAYER",
        playerId: defendingPlayer.id,
        zone: "PLAYER"
      }
    ]
  };

  addEvent(state, "HOGGAN_BATTLE_INTERCEPT_PROMPT_CREATED", defendingPlayer.id, {
    battleSessionId,
    optionCount: options.length,
    note: "Hoggan can be played from hand at the beginning of the opponent's battle."
  });
}

function createCabalRetaliationChoicePrompt(
  state: MatchState,
  defendingPlayer: PlayerState,
  attackingCreature: BattleCreatureRef,
  battleSessionId: string
): void {
  if (state.pendingEffectTargetPrompt) return;
  if (!limitsReturnAttacksAcrossExtraBattles(attackingCreature.card)) return;

  const attackingPlayer = getPlayer(state, attackingCreature.playerId);
  if (getCreatureBattleUseCount(attackingPlayer, attackingCreature.card.instanceId) > 0) return;
  const attackingDefinition = getCreatureDefinition(state, attackingCreature.card);

  state.pendingEffectTargetPrompt = {
    id: uuidv4(),
    sourceCardInstanceId: attackingCreature.card.instanceId,
    sourceCardId: attackingCreature.card.cardId,
    sourceCardName: attackingDefinition.name,
    controllerPlayerId: defendingPlayer.id,
    effectId: "CABAL-RETALIATION-CHOICE",
    actionType: CABAL_RETALIATION_CHOICE_ACTION,
    effectGroup: "Battle Retaliation",
    actionText: "Choose whether to return attack now or save the single return attack.",
    effectValue: `${attackingDefinition.name} can battle more than once, but the opponent only gets one return attack.`,
    promptText: `${attackingDefinition.name} can battle more than once this Combat Phase. Choose whether to return attack in this battle or save your return attack for its next battle.`,
    targetKind: "PLAYER",
    options: [
      {
        id: "cabal-retaliate-now",
        label: "Return attack in this battle",
        targetKind: "PLAYER",
        playerId: defendingPlayer.id,
        zone: "PLAYER"
      },
      {
        id: "cabal-save-retaliation",
        label: "Save return attack for Cabal Warchief's next battle",
        targetKind: "PLAYER",
        playerId: defendingPlayer.id,
        zone: "PLAYER"
      }
    ]
  };

  addEvent(state, "CABAL_RETALIATION_CHOICE_PROMPT_CREATED", defendingPlayer.id, {
    battleSessionId,
    cabalCreatureInstanceId: attackingCreature.card.instanceId,
    sourceCardName: attackingDefinition.name,
    note: "Defender chooses which extra-battle window gets the single return attack."
  });
}

function sendBattleInterceptHogganToCemetery(state: MatchState, session: PendingBattleSession): void {
  const defender = session.declaredDefender;
  if (defender.creatureKind !== "LIMITED_SUMMON") return;

  const defendingPlayer = getPlayer(state, defender.playerId);
  const hoggan = defendingPlayer.field.limitedSummons.find(
    card => card.instanceId === defender.creatureInstanceId && card.cardId === HOGGAN_CARD_ID
  );

  if (!hoggan) return;

  moveFieldCreatureToCemetery(state, {
    fieldOwnerPlayerId: defendingPlayer.id,
    creatureInstanceId: hoggan.instanceId,
    causedByPlayerId: session.attackingPlayerId,
    reason: "HOGGAN_SENT_TO_CEMETERY_AFTER_BATTLE",
    addEvent
  });

  addEvent(state, "HOGGAN_SENT_TO_CEMETERY_AFTER_BATTLE", defender.playerId, {
    battleSessionId: session.id,
    cardInstanceId: hoggan.instanceId,
    cardName: "Hoggan"
  });
}

function setSessionUpdated(session: PendingBattleSession, message?: string): void {
  session.updatedAt = new Date().toISOString();

  if (message) {
    session.message = message;
  }
}

function getPendingBattleSessionForUpdate(
  state: MatchState,
  battleSessionId: string
): PendingBattleSession {
  const session = state.pendingBattle;

  if (!session || session.id !== battleSessionId) {
    throw new Error("Pending battle session not found.");
  }

  return session;
}

export function updateManualBattleSpeedModifiers(
  state: MatchState,
  battleSessionId: string,
  modifiers: Partial<ManualBattleSpeedModifiers>
): MatchState {
  const nextState = cloneState(state);
  const session = getPendingBattleSessionForUpdate(nextState, battleSessionId);

  if (session.status !== "AWAITING_SPEED_CHECK") {
    throw new Error("Speed modifiers can only be changed before the speed check is run.");
  }

  session.speedModifiers = normalizeSpeedModifiers(modifiers);
  setSessionUpdated(session, "Speed modifiers updated. Run the speed check when ready.");

  addEvent(nextState, "MANUAL_BATTLE_SPEED_MODIFIERS_UPDATED", session.attackingPlayerId, {
    battleSessionId,
    modifiers: session.speedModifiers
  });

  return nextState;
}

export function updateManualBattleStrikeModifiers(
  state: MatchState,
  battleSessionId: string,
  strikeId: string,
  modifiers: Partial<ManualBattleStrikeModifiers>
): MatchState {
  const nextState = cloneState(state);
  const session = getPendingBattleSessionForUpdate(nextState, battleSessionId);
  const strike = session.strikes.find(candidate => candidate.id === strikeId);

  if (!strike) {
    throw new Error("Battle strike not found.");
  }

  if (strike.status === "RESOLVED") {
    throw new Error("Cannot change modifiers after this strike has resolved.");
  }

  const normalized = normalizeStrikeModifiers(modifiers);
  const current = normalizeStrikeModifiers(strike.modifiers);

  if (strike.hitRollDice?.length) {
    const hitFieldsChanged = normalized.hitDiceDelta !== current.hitDiceDelta ||
      normalized.hitDiceLimit !== current.hitDiceLimit ||
      normalized.hitFlatBonus !== current.hitFlatBonus ||
      normalized.forceHitResult !== current.forceHitResult;

    if (hitFieldsChanged) {
      throw new Error("Hit modifiers cannot be changed after the hit roll is made.");
    }
  }

  if (strike.damageRollDice?.length) {
    const damageFieldsChanged = normalized.damageDiceDelta !== current.damageDiceDelta ||
      normalized.damageFlatBonus !== current.damageFlatBonus ||
      normalized.damageMultiplier !== current.damageMultiplier;

    if (damageFieldsChanged) {
      throw new Error("Damage roll modifiers cannot be changed after the damage roll is made.");
    }
  }

  if (modifiersAreEqual(normalized, current)) {
    return nextState;
  }

  strike.modifiers = normalized;
  setSessionUpdated(session, `Modifiers updated for ${strike.attacker.creatureName}.`);

  addEvent(nextState, "MANUAL_BATTLE_STRIKE_MODIFIERS_UPDATED", strike.attacker.playerId, {
    battleSessionId,
    strikeId,
    attackerCreatureName: strike.attacker.creatureName,
    defenderCreatureName: strike.defender.creatureName,
    modifiers: normalized
  });

  return nextState;
}

function buildBattleResultFromSession(session: PendingBattleSession): BattleResult {
  const firstStrike = session.strikes[0];
  const secondStrike = session.strikes[1];

  const strikes: BattleStrikeResult[] = session.strikes.map(strike => ({
    attackerPlayerId: strike.attacker.playerId,
    defenderPlayerId: strike.defender.playerId,

    attackerCreatureInstanceId: strike.attacker.creatureInstanceId,
    defenderCreatureInstanceId: strike.defender.creatureInstanceId,
    attackerCreatureKind: strike.attacker.creatureKind,
    defenderCreatureKind: strike.defender.creatureKind,
    attackerCreatureName: strike.attacker.creatureName,
    defenderCreatureName: strike.defender.creatureName,

    hitRollDice: strike.hitRollDice ?? [],
    hitRollModifier: strike.hitRollModifier ?? 0,
    hitRollTotal: strike.hitRollTotal ?? 0,
    hitDiceCount: strike.hitDiceCount,
    modifiers: normalizeStrikeModifiers(strike.modifiers),

    hit: Boolean(strike.hit),
    criticalHit: Boolean(strike.criticalHit),
    criticalMiss: Boolean(strike.criticalMiss),

    selfDamageDice: strike.selfDamageDice,
    selfDamageDealt: strike.selfDamageDealt,
    attackerRemainingHp: strike.attackerRemainingHp,
    attackerKilledByCriticalMiss: strike.attackerKilledByCriticalMiss,
    selfDamagePreventedReason: strike.selfDamagePreventedReason,

    damageRollDice: strike.damageRollDice,
    attackDamageModifier: strike.attackDamageModifier,
    damageDiceCount: strike.damageDiceCount,
    damageBeforeCritical: strike.damageBeforeCritical,
    damageAfterCritical: strike.damageAfterCritical,
    damageAfterModifiers: strike.damageAfterModifiers,
    damageDealt: strike.damageDealt ?? 0,
    damagePreventedReason: strike.damagePreventedReason,

    defenderRemainingHp: strike.defenderRemainingHp ?? strike.defender.currentHp,
    defenderKilled: Boolean(strike.defenderKilled)
  }));

  return {
    id: session.id,
    timestamp: session.updatedAt,

    attackingPlayerId: session.attackingPlayerId,
    defendingPlayerId: session.defendingPlayerId,
    attackingCreatureInstanceId: session.declaredAttacker.creatureInstanceId,
    defendingCreatureInstanceId: session.declaredDefender.creatureInstanceId,
    attackingCreatureKind: session.declaredAttacker.creatureKind,
    defendingCreatureKind: session.declaredDefender.creatureKind,

    firstStrikePlayerId: firstStrike?.attacker.playerId ?? session.attackingPlayerId,
    secondStrikePlayerId: secondStrike?.attacker.playerId,

    speedTie: session.speedTie,
    speedTieRolls: session.speedTieRolls.length > 0
      ? {
          [session.attackingPlayerId]: session.speedTieRolls.map(round => round.attackingCreatureRoll),
          [session.defendingPlayerId]: session.speedTieRolls.map(round => round.defendingCreatureRoll)
        }
      : undefined,

    strikes,

    combatPhaseEnded: session.combatPhaseEnded,
    message: session.message
  };
}

function completeManualBattleSessionInPlace(
  state: MatchState,
  session: PendingBattleSession,
  message: string
): void {
  const attackingPlayer = getPlayer(state, session.attackingPlayerId);
  const attackingCard = findCardInstanceInPlayerZones(
    attackingPlayer,
    session.declaredAttacker.creatureInstanceId
  );

  markCreatureBattleUsed(
    attackingPlayer,
    session.declaredAttacker.creatureInstanceId,
    attackingCard ? getCreatureBattleUseLimit(attackingCard) : 1
  );
  expireConsumedTemporaryBattleEquip(state, attackingPlayer, session.declaredAttacker.creatureInstanceId);

  session.status = "COMPLETE";
  setSessionUpdated(session, message);

  runBattleTimingTriggers(state, {
    timing: "END_OF_COMBAT_PHASE",
    battleSession: session,
    addEvent
  });

  const result = buildBattleResultFromSession(session);
  state.lastBattle = result;

  clearCurrentBattleEffectInstancesInPlace(state, session);

  addEvent(state, "MANUAL_BATTLE_RESOLVED", session.attackingPlayerId, {
    ...result,
    boardEvents: [
      {
        type: "BATTLE_RESOLVED",
        playerId: session.attackingPlayerId,
        sourceCardInstanceId: session.declaredAttacker.creatureInstanceId,
        targetCardInstanceId: session.declaredDefender.creatureInstanceId,
        actionType: "RESOLVE_BATTLE",
        battleId: session.id,
        metadata: {
          combatPhaseEnded: session.combatPhaseEnded
        }
      }
    ]
  });
}

function getBattleStrikeSkipReason(state: MatchState, attacker: BattleCreatureRef): string | undefined {
  return getCannotInitiateBattleReason(
    attacker.card,
    getCannotInflictAttackDamageBattlePolicy(state)
  );
}

function resolveSkippedBattleStrikeInPlace(
  state: MatchState,
  session: PendingBattleSession,
  strike: ManualBattleStrike,
  attacker: BattleCreatureRef,
  defender: BattleCreatureRef,
  reason: string
): void {
  strike.attacker = snapshotParticipant(state, attacker);
  strike.defender = snapshotParticipant(state, defender);
  strike.hit = false;
  strike.criticalHit = false;
  strike.criticalMiss = false;
  strike.damageTarget = "NONE";
  strike.damageDealt = 0;
  strike.defenderRemainingHp = getCurrentHp(defender.card);
  strike.defenderKilled = false;
  strike.status = "RESOLVED";
  strike.message = reason;

  addEvent(state, "BATTLE_STRIKE_SKIPPED_BY_STATUS", attacker.playerId, {
    battleSessionId: session.id,
    strikeId: strike.id,
    role: strike.role,
    attackerCreatureInstanceId: attacker.card.instanceId,
    attackerCreatureName: strike.attacker.creatureName,
    defenderCreatureInstanceId: defender.card.instanceId,
    defenderCreatureName: strike.defender.creatureName,
    reason
  });
}

function advanceManualBattleAfterResolvedStrike(
  state: MatchState,
  session: PendingBattleSession,
  resolvedStrike?: ManualBattleStrike
): void {
  const primaryKilledInStrike = Boolean(
    resolvedStrike?.defenderKilled || resolvedStrike?.attackerKilledByCriticalMiss
  );

  if (primaryKilledInStrike || state.setup.primaryReplacementRequiredForPlayerId) {
    session.combatPhaseEnded = true;
    processCombatPhaseEndInPlace(state, "PRIMARY_CREATURE_KILLED_DURING_BATTLE");
    state.turn.phase = "SECOND_MAGIC";

    completeManualBattleSessionInPlace(
      state,
      session,
      state.setup.primaryReplacementRequiredForPlayerId
        ? "A primary creature was killed. Combat Phase ended and replacement is required."
        : "A primary creature was killed. Combat Phase ended. A Limited Summon was promoted automatically if available."
    );
    return;
  }

  const nextStrikeIndex = session.currentStrikeIndex + 1;
  const nextStrike = session.strikes[nextStrikeIndex];

  if (!nextStrike) {
    completeManualBattleSessionInPlace(
      state,
      session,
      session.limitedSummonNoRetaliation
        ? "Battle resolved. The defending primary creature does not make a return attack."
        : "Manual battle resolved."
    );
    return;
  }

  let nextAttacker: BattleCreatureRef;
  let nextDefender: BattleCreatureRef;

  try {
    nextAttacker = findBattleCreatureRef(
      state,
      nextStrike.attacker.playerId,
      nextStrike.attacker.creatureInstanceId
    );
    nextDefender = findBattleCreatureRef(
      state,
      nextStrike.defender.playerId,
      nextStrike.defender.creatureInstanceId
    );
  } catch {
    completeManualBattleSessionInPlace(
      state,
      session,
      "Battle resolved before retaliation because one of the required creatures left the field."
    );
    return;
  }

  const skipReason = getBattleStrikeSkipReason(state, nextAttacker);

  if (nextStrike.role === "RETALIATION" && skipReason) {
    session.currentStrikeIndex = nextStrikeIndex;
    resolveSkippedBattleStrikeInPlace(
      state,
      session,
      nextStrike,
      nextAttacker,
      nextDefender,
      skipReason
    );
    completeManualBattleSessionInPlace(
      state,
      session,
      `${nextStrike.attacker.creatureName}'s retaliation was skipped. ${skipReason}`
    );
    return;
  }

  session.currentStrikeIndex = nextStrikeIndex;
  session.status = "AWAITING_HIT_ROLL";
  nextStrike.status = "AWAITING_HIT_ROLL";
  setSessionUpdated(session, "Retaliation is legal. Roll hit for the slower creature.");
  addEvent(state, "BATTLE_STRIKE_STARTED", nextAttacker.playerId, {
    battleSessionId: session.id,
    strikeId: nextStrike.id,
    attackerCreatureInstanceId: nextAttacker.card.instanceId,
    defenderCreatureInstanceId: nextDefender.card.instanceId,
    boardEvents: [
      {
        type: "BATTLE_STRIKE_STARTED",
        playerId: nextAttacker.playerId,
        sourceCardInstanceId: nextAttacker.card.instanceId,
        targetCardInstanceId: nextDefender.card.instanceId,
        actionType: "BATTLE_STRIKE",
        battleId: session.id,
        strikeId: nextStrike.id
      }
    ]
  });
}

function resolveStrike(
  state: MatchState,
  attacker: BattleCreatureRef,
  defender: BattleCreatureRef
): BattleStrikeResult {
  const attackerDefinition = getCreatureDefinition(state, attacker.card);
  const defenderDefinition = getCreatureDefinition(state, defender.card);

  const attackerStats = getEffectiveCreatureStats(state, attacker.card);
  const defenderStats = getEffectiveCreatureStats(state, defender.card);

  const hitRollDice = rollD6WithDev(state, {
    kind: "HIT_ROLL",
    count: 2,
    playerId: attacker.playerId,
    label: `${attackerDefinition.name} hit roll`,
    context: { attackerCreatureInstanceId: attacker.card.instanceId, defenderCreatureInstanceId: defender.card.instanceId }
  });
  const hitRollModifier = attackerStats.modifier;
  const hitRollTotal = sumDice(hitRollDice) + hitRollModifier;

  const criticalHit = hitRollDice.length > 1 && hitRollDice.every(die => die === 6);
  const criticalMiss = hitRollDice.length > 1 && hitRollDice.every(die => die === 1);

  const baseStrike = {
    attackerPlayerId: attacker.playerId,
    defenderPlayerId: defender.playerId,

    attackerCreatureInstanceId: attacker.card.instanceId,
    defenderCreatureInstanceId: defender.card.instanceId,
    attackerCreatureKind: attacker.kind,
    defenderCreatureKind: defender.kind,
    attackerCreatureName: attackerDefinition.name,
    defenderCreatureName: defenderDefinition.name,

    hitRollDice,
    hitRollModifier,
    hitRollTotal
  };

  if (criticalMiss) {
    const selfDamageDice = rollD6WithDev(state, {
      kind: "SELF_DAMAGE_ROLL",
      count: 1,
      playerId: attacker.playerId,
      label: `${attackerDefinition.name} critical miss self-damage`,
      context: { attackerCreatureInstanceId: attacker.card.instanceId }
    });
    const selfDamageDealt = sumDice(selfDamageDice);
    const selfDamageResult = applyDamageToBattleCreature(
      state,
      attacker,
      selfDamageDealt
    );

    return {
      ...baseStrike,

      hit: false,
      criticalHit: false,
      criticalMiss: true,

      selfDamageDice,
      selfDamageDealt: selfDamageResult.damagePreventedReason ? 0 : selfDamageDealt,
      attackerRemainingHp: selfDamageResult.remainingHp,
      attackerKilledByCriticalMiss: selfDamageResult.killed,
      selfDamagePreventedReason: selfDamageResult.damagePreventedReason,

      damageDealt: 0,
      defenderRemainingHp: getCurrentHp(defender.card),
      defenderKilled: false
    };
  }

  const hit = criticalHit || hitRollTotal >= defenderStats.armorLevel;

  if (!hit) {
    return {
      ...baseStrike,

      hit: false,
      criticalHit: false,
      criticalMiss: false,

      damageDealt: 0,
      defenderRemainingHp: getCurrentHp(defender.card),
      defenderKilled: false
    };
  }

  const damageRollDice = rollD6WithDev(state, {
    kind: "ATTACK_DAMAGE_ROLL",
    count: attackerStats.attackDice,
    playerId: attacker.playerId,
    label: `${attackerDefinition.name} attack damage roll`,
    context: { attackerCreatureInstanceId: attacker.card.instanceId, defenderCreatureInstanceId: defender.card.instanceId }
  });
  const attackDamageModifier = attackerStats.modifier;
  const damageBeforeCritical = Math.max(
    0,
    sumDice(damageRollDice) + attackDamageModifier
  );

  const damageDealt = criticalHit
    ? damageBeforeCritical * 2
    : damageBeforeCritical;

  const damageResult = applyDamageToBattleCreature(
    state,
    defender,
    damageDealt
  );

  return {
    ...baseStrike,

    hit: true,
    criticalHit,
    criticalMiss: false,

    damageRollDice,
    attackDamageModifier,
    damageBeforeCritical,
    damageDealt: damageResult.damagePreventedReason ? 0 : damageDealt,
    damagePreventedReason: damageResult.damagePreventedReason,

    defenderRemainingHp: damageResult.remainingHp,
    defenderKilled: damageResult.killed
  };
}

function determinePrimaryStrikeOrder(
  state: MatchState,
  attackingCreature: BattleCreatureRef,
  defendingCreature: BattleCreatureRef
): {
  firstStrike: BattleCreatureRef;
  secondStrike?: BattleCreatureRef;
  speedTie: boolean;
  speedTieRolls?: Record<string, number[]>;
} {
  const attackingStats = getEffectiveCreatureStats(state, attackingCreature.card);
  const defendingStats = getEffectiveCreatureStats(state, defendingCreature.card);

  if (attackingStats.speed > defendingStats.speed) {
    return {
      firstStrike: attackingCreature,
      secondStrike: defendingCreature,
      speedTie: false
    };
  }

  if (defendingStats.speed > attackingStats.speed) {
    return {
      firstStrike: defendingCreature,
      secondStrike: attackingCreature,
      speedTie: false
    };
  }

  const speedTieRolls: Record<string, number[]> = {
    [attackingCreature.playerId]: [],
    [defendingCreature.playerId]: []
  };

  let attackerTieRoll = 0;
  let defenderTieRoll = 0;

  do {
    attackerTieRoll = rollD6WithDev(state, {
      kind: "SPEED_TIE_ROLL",
      count: 1,
      playerId: attackingCreature.playerId,
      label: "Attacking creature speed tie roll",
      context: { attackerCreatureInstanceId: attackingCreature.card.instanceId, defenderCreatureInstanceId: defendingCreature.card.instanceId }
    })[0];
    defenderTieRoll = rollD6WithDev(state, {
      kind: "SPEED_TIE_ROLL",
      count: 1,
      playerId: defendingCreature.playerId,
      label: "Defending creature speed tie roll",
      context: { attackerCreatureInstanceId: attackingCreature.card.instanceId, defenderCreatureInstanceId: defendingCreature.card.instanceId }
    })[0];

    speedTieRolls[attackingCreature.playerId].push(attackerTieRoll);
    speedTieRolls[defendingCreature.playerId].push(defenderTieRoll);
  } while (attackerTieRoll === defenderTieRoll);

  return {
    firstStrike:
      attackerTieRoll > defenderTieRoll
        ? attackingCreature
        : defendingCreature,
    secondStrike:
      attackerTieRoll > defenderTieRoll
        ? defendingCreature
        : attackingCreature,
    speedTie: true,
    speedTieRolls
  };
}

function validateBattleCanStart(state: MatchState, playerId: string): void {
  if (state.pendingBattle && state.pendingBattle.status !== "COMPLETE") {
    throw new Error("Finish the pending battle before starting another battle.");
  }

  if (state.pendingPrompt) {
    throw new Error("Resolve the pending prompt before battling.");
  }

  if (state.manualEffectQueue.some(effect => !effect.completed)) {
    throw new Error("Complete all pending Magic effects before battling.");
  }

  if (state.pendingChain) {
    throw new Error("Resolve the pending Magic Chain before battling.");
  }

  if (state.pendingEffectTargetPrompt) {
    throw new Error("Resolve the pending effect target selection before battling.");
  }

  if (state.pendingEffectRoll) {
    throw new Error("Resolve the pending effect roll before battling.");
  }

  if (state.setup.handDiscardRequiredForPlayerId) {
    throw new Error("A player must discard down to 8 cards before battle can continue.");
  }

  if (state.setup.primaryReplacementRequiredForPlayerId) {
    throw new Error("A primary creature replacement is required before battle can continue.");
  }

  if (state.turn.activePlayerId !== playerId) {
    throw new Error("Only the active player can declare battle.");
  }

  if (state.turn.phase !== "COMBAT") {
    throw new Error("Battle can only be declared during the Combat Phase.");
  }

  if (!state.turn.firstTurnCycleComplete) {
    throw new Error("The Battle Phase is skipped during the first turn cycle.");
  }
}

export function startManualBattleSession(
  state: MatchState,
  playerId: string,
  attackerCreatureInstanceId: string,
  defenderCreatureInstanceId?: string
): MatchState {
  validateBattleCanStart(state, playerId);

  const nextState = cloneState(state);
  const attackingPlayer = getPlayer(nextState, playerId);
  const defendingPlayer = getOpponentPlayer(nextState, playerId);

  const attackingCreature = getAttackingCreatureRef(
    attackingPlayer,
    attackerCreatureInstanceId
  );
  const defendingCreature = defenderCreatureInstanceId
    ? findBattleCreatureRef(nextState, defendingPlayer.id, defenderCreatureInstanceId)
    : getPrimaryCreatureRef(defendingPlayer);

  if (defendingCreature.kind !== "PRIMARY_CREATURE") {
    throw new Error("Only primary creatures can be targeted by battle right now.");
  }

  if (!canCreatureBattleThisCombat(attackingPlayer, attackingCreature)) {
    throw new Error("This creature has already battled during this Combat Phase.");
  }

  const cannotInitiateReason = getCannotInitiateBattleReason(
    attackingCreature.card,
    getCannotInflictAttackDamageBattlePolicy(nextState)
  );

  if (cannotInitiateReason) {
    markBattleSkippedForCreature(nextState, attackingPlayer, attackingCreature, cannotInitiateReason);
    return nextState;
  }

  const now = new Date().toISOString();

  const savedRetaliationIds = ensureRetaliationSavedList(attackingPlayer);
  const hasSavedRetaliation =
    limitsReturnAttacksAcrossExtraBattles(attackingCreature.card) &&
    getCreatureBattleUseCount(attackingPlayer, attackingCreature.card.instanceId) >= 1 &&
    savedRetaliationIds.includes(attackingCreature.card.instanceId);

  if (hasSavedRetaliation) {
    attackingPlayer.turnFlags.retaliationSavedCreatureInstanceIds = savedRetaliationIds.filter(
      id => id !== attackingCreature.card.instanceId
    );
  }

  const suppressesRetaliation =
    attackingCreature.kind === "LIMITED_SUMMON" ||
    (shouldSuppressRetaliationForBattle(attackingPlayer, attackingCreature) && !hasSavedRetaliation);

  nextState.pendingBattle = {
    id: uuidv4(),
    startedAt: now,
    updatedAt: now,
    status: "AWAITING_SPEED_CHECK",
    attackingPlayerId: attackingPlayer.id,
    defendingPlayerId: defendingPlayer.id,
    declaredAttacker: snapshotParticipant(nextState, attackingCreature),
    declaredDefender: snapshotParticipant(nextState, defendingCreature),
    limitedSummonNoRetaliation: suppressesRetaliation,
    speedModifiers: normalizeSpeedModifiers(),
    suggestedEffects: [],
    speedTie: false,
    speedTieRolls: [],
    strikes: [],
    currentStrikeIndex: 0,
    combatPhaseEnded: false,
    message: "Battle declared. Run the speed check to determine first strike."
  };

  nextState.pendingBattle.suggestedEffects = collectBattleEffectSuggestions(
    nextState,
    nextState.pendingBattle
  );
  nextState.pendingBattle.speedModifiers = normalizeSpeedModifiers(
    getSuggestedSpeedModifiers(nextState.pendingBattle.suggestedEffects)
  );

  runBattleTimingTriggers(nextState, {
    timing: "WHEN_BATTLE_DECLARED",
    battleSession: nextState.pendingBattle,
    addEvent
  });

  createHogganBattleInterceptPrompt(nextState, defendingPlayer, nextState.pendingBattle.id);
  createCabalRetaliationChoicePrompt(nextState, defendingPlayer, attackingCreature, nextState.pendingBattle.id);

  addEvent(nextState, "MANUAL_BATTLE_DECLARED", playerId, {
    battleSessionId: nextState.pendingBattle.id,
    attackerCreatureInstanceId: attackingCreature.card.instanceId,
    defenderCreatureInstanceId: defendingCreature.card.instanceId,
    boardEvents: [
      {
        type: "BATTLE_STARTED",
        playerId,
        sourceCardInstanceId: attackingCreature.card.instanceId,
        targetCardInstanceId: defendingCreature.card.instanceId,
        actionType: "DECLARE_BATTLE",
        battleId: nextState.pendingBattle.id,
        metadata: {
          attackerPlayerId: attackingPlayer.id,
          defenderPlayerId: defendingPlayer.id
        }
      }
    ]
  });

  return nextState;
}

export function runManualBattleSpeedCheck(
  state: MatchState,
  battleSessionId: string
): MatchState {
  const nextState = cloneState(state);
  const session = nextState.pendingBattle;

  if (!session || session.id !== battleSessionId) {
    throw new Error("Pending battle session not found.");
  }

  if (session.status !== "AWAITING_SPEED_CHECK") {
    throw new Error("This battle is not waiting for a speed check.");
  }

  if (nextState.pendingEffectTargetPrompt) {
    throw new Error("Resolve the pending battle response prompt before running the speed check.");
  }

  const attackingCreature = findBattleCreatureRef(
    nextState,
    session.declaredAttacker.playerId,
    session.declaredAttacker.creatureInstanceId
  );
  const defendingCreature = findBattleCreatureRef(
    nextState,
    session.declaredDefender.playerId,
    session.declaredDefender.creatureInstanceId
  );

  const previousSuggestedEffects = session.suggestedEffects ?? [];
  const previousAutoSpeedModifiers = normalizeSpeedModifiers(
    getSuggestedSpeedModifiers(previousSuggestedEffects)
  );
  const currentSpeedModifiers = normalizeSpeedModifiers(session.speedModifiers);

  session.suggestedEffects = collectBattleEffectSuggestions(nextState, session);

  runBattleTimingTriggers(nextState, {
    timing: "BEFORE_SPEED_CHECK",
    battleSession: session,
    addEvent
  });

  if (session.limitedSummonNoRetaliation) {
    const attackingStats = getEffectiveCreatureStats(nextState, attackingCreature.card);
    const defendingStats = getEffectiveCreatureStats(nextState, defendingCreature.card);

    session.effectiveAttackingSpeed = attackingStats.speed;
    session.effectiveDefendingSpeed = defendingStats.speed;
    session.firstStrikeCreatureInstanceId = attackingCreature.card.instanceId;
    session.strikes = [
      createManualStrike(nextState, "FIRST_STRIKE", attackingCreature, defendingCreature, session.suggestedEffects)
    ];
    session.currentStrikeIndex = 0;
    session.status = "AWAITING_HIT_ROLL";
    setSessionUpdated(
      session,
      attackingCreature.kind === "LIMITED_SUMMON"
        ? "Limited Summons perform a one-way battle into the opponent primary. Roll hit for the Limited Summon."
        : `${attackingStats.name}'s extra battle does not allow a return attack. Roll hit.`
    );
    addEvent(nextState, "BATTLE_STRIKE_STARTED", attackingCreature.playerId, {
      battleSessionId: session.id,
      strikeId: session.strikes[0]?.id,
      attackerCreatureInstanceId: attackingCreature.card.instanceId,
      defenderCreatureInstanceId: defendingCreature.card.instanceId,
      boardEvents: [
        {
          type: "BATTLE_STRIKE_STARTED",
          playerId: attackingCreature.playerId,
          sourceCardInstanceId: attackingCreature.card.instanceId,
          targetCardInstanceId: defendingCreature.card.instanceId,
          actionType: "BATTLE_STRIKE",
          battleId: session.id,
          strikeId: session.strikes[0]?.id
        }
      ]
    });
    return nextState;
  }

  const attackingStats = getEffectiveCreatureStats(nextState, attackingCreature.card);
  const defendingStats = getEffectiveCreatureStats(nextState, defendingCreature.card);
  const suggestedSpeedModifiers = normalizeSpeedModifiers(
    getSuggestedSpeedModifiers(session.suggestedEffects)
  );
  const speedModifiers = speedModifiersAreEqual(currentSpeedModifiers, previousAutoSpeedModifiers)
    ? suggestedSpeedModifiers
    : currentSpeedModifiers;
  const attackingEffectiveSpeed = getEffectiveSpeedWithModifier(
    attackingStats.speed,
    speedModifiers.attackingSpeedDelta
  );
  const defendingEffectiveSpeed = getEffectiveSpeedWithModifier(
    defendingStats.speed,
    speedModifiers.defendingSpeedDelta
  );

  session.speedModifiers = speedModifiers;
  session.effectiveAttackingSpeed = attackingEffectiveSpeed;
  session.effectiveDefendingSpeed = defendingEffectiveSpeed;

  let firstStrike = attackingCreature;
  let secondStrike: BattleCreatureRef | undefined = defendingCreature;

  if (speedModifiers.override === "ATTACKER_FIRST") {
    firstStrike = attackingCreature;
    secondStrike = defendingCreature;
  } else if (speedModifiers.override === "DEFENDER_FIRST") {
    firstStrike = defendingCreature;
    secondStrike = attackingCreature;
  } else if (defendingEffectiveSpeed > attackingEffectiveSpeed) {
    firstStrike = defendingCreature;
    secondStrike = attackingCreature;
  } else if (attackingEffectiveSpeed === defendingEffectiveSpeed) {
    const speedTieRolls: BattleSpeedTieRound[] = [];
    let attackerTieRoll = 0;
    let defenderTieRoll = 0;

    do {
      attackerTieRoll = rollD6WithDev(nextState, {
        kind: "SPEED_TIE_ROLL",
        count: 1,
        playerId: attackingCreature.playerId,
        label: "Attacking creature speed tie roll",
        addEvent,
        context: { battleSessionId: session.id, attackerCreatureInstanceId: attackingCreature.card.instanceId, defenderCreatureInstanceId: defendingCreature.card.instanceId }
      })[0];
      defenderTieRoll = rollD6WithDev(nextState, {
        kind: "SPEED_TIE_ROLL",
        count: 1,
        playerId: defendingCreature.playerId,
        label: "Defending creature speed tie roll",
        addEvent,
        context: { battleSessionId: session.id, attackerCreatureInstanceId: attackingCreature.card.instanceId, defenderCreatureInstanceId: defendingCreature.card.instanceId }
      })[0];
      speedTieRolls.push({
        attackingCreatureRoll: attackerTieRoll,
        defendingCreatureRoll: defenderTieRoll
      });
    } while (attackerTieRoll === defenderTieRoll);

    session.speedTie = true;
    session.speedTieRolls = speedTieRolls;
    firstStrike = attackerTieRoll > defenderTieRoll ? attackingCreature : defendingCreature;
    secondStrike = attackerTieRoll > defenderTieRoll ? defendingCreature : attackingCreature;
  }

  session.firstStrikeCreatureInstanceId = firstStrike.card.instanceId;
  session.secondStrikeCreatureInstanceId = secondStrike?.card.instanceId;
  session.strikes = [
    createManualStrike(nextState, "FIRST_STRIKE", firstStrike, secondStrike ?? defendingCreature, session.suggestedEffects)
  ];

  if (secondStrike) {
    session.strikes.push(
      createManualStrike(nextState, "RETALIATION", secondStrike, firstStrike, session.suggestedEffects)
    );
  }

  session.currentStrikeIndex = 0;
  session.status = "AWAITING_HIT_ROLL";
  setSessionUpdated(
    session,
    `${firstStrike.card.instanceId === attackingCreature.card.instanceId ? session.declaredAttacker.creatureName : session.declaredDefender.creatureName} has first strike. ${speedModifiers.override === "AUTO" ? "Speed check complete." : "Speed order was manually overridden."} Roll hit.`
  );
  addEvent(nextState, "BATTLE_STRIKE_STARTED", firstStrike.playerId, {
    battleSessionId: session.id,
    strikeId: session.strikes[0]?.id,
    attackerCreatureInstanceId: firstStrike.card.instanceId,
    defenderCreatureInstanceId: (secondStrike ?? defendingCreature).card.instanceId,
    boardEvents: [
      {
        type: "BATTLE_STRIKE_STARTED",
        playerId: firstStrike.playerId,
        sourceCardInstanceId: firstStrike.card.instanceId,
        targetCardInstanceId: (secondStrike ?? defendingCreature).card.instanceId,
        actionType: "BATTLE_STRIKE",
        battleId: session.id,
        strikeId: session.strikes[0]?.id
      }
    ]
  });

  return nextState;
}

export function playBattleResponseFromHand(
  state: MatchState,
  args: {
    playerId: string;
    cardInstanceId: string;
    battleSessionId: string;
    strikeId?: string;
  }
): MatchState {
  const nextState = cloneState(state);
  const session = nextState.pendingBattle;

  if (!session || session.id !== args.battleSessionId) {
    throw new Error("Pending battle session not found.");
  }

  const strike = args.strikeId
    ? session.strikes.find(candidate => candidate.id === args.strikeId)
    : getCurrentManualStrike(session);

  if (!strike) {
    throw new Error("Battle strike not found.");
  }

  const player = getPlayer(nextState, args.playerId);
  const handIndex = player.hand.findIndex(card => card.instanceId === args.cardInstanceId);

  if (handIndex === -1) {
    throw new Error("Card is not in this player's hand.");
  }

  const card = player.hand[handIndex];
  const definition = nextState.cardCatalog[card.cardId];

  if (!definition) {
    throw new Error("Card definition not found.");
  }

  const response = getAutomatedBattleResponse(definition);

  if (!response) {
    throw new Error("This card does not have an automated battle response effect.");
  }

  const disabledReason = responseCanPlayForStrike(session, strike, args.playerId, response);
  if (disabledReason) {
    throw new Error(disabledReason);
  }

  const effect = response.effect;
  const boardEvents: Record<string, unknown>[] = [];
  let destination: "CEMETERY" | "MAGIC_SLOT" = "CEMETERY";
  let directDamageResult: ReturnType<typeof applyDamageToCreatureTarget> | undefined;
  let recurring: ActiveRecurringCreatureEffect | undefined;

  if (effectNegatesAttackDamage(effect)) {
    applyBattleResponseNegation(definition, effect, strike);
  }

  if (effectAppliesBattleDiceModifier(effect)) {
    const diceDelta = applyBattleResponseDiceModifier(definition, effect, strike);
    boardEvents.push({
      type: "BATTLE_MODIFIER_APPLIED",
      playerId: args.playerId,
      sourceCardInstanceId: card.instanceId,
      sourceCardId: card.cardId,
      sourceEffectId: effect.id,
      actionType: effect.actionType,
      targetCardInstanceId: strike.attacker.creatureInstanceId,
      battleId: session.id,
      strikeId: strike.id,
      metadata: { damageDiceDelta: diceDelta }
    });
  }

  if (effectDealsDirectBattleDamage(effect)) {
    const target = findBattleCreatureRef(nextState, strike.defender.playerId, strike.defender.creatureInstanceId);
    const amount = firstPositiveEffectNumber(effect) ?? 0;
    if (amount <= 0) {
      throw new Error(`${definition.name} has no automated damage amount.`);
    }
    directDamageResult = applyDamageToCreatureTarget(nextState, battleCreatureTargetOption(nextState, target), amount);
    strike.defenderRemainingHp = directDamageResult.remainingHp;
    strike.defenderKilled = directDamageResult.killed;
    boardEvents.push({
      type: "CREATURE_DAMAGED",
      playerId: directDamageResult.playerId,
      sourceCardInstanceId: card.instanceId,
      sourceCardId: card.cardId,
      sourceEffectId: effect.id,
      actionType: effect.actionType,
      targetCardInstanceId: strike.defender.creatureInstanceId,
      damageAmount: directDamageResult.damageAmount,
      remainingHp: directDamageResult.remainingHp,
      killed: directDamageResult.killed,
      battleId: session.id,
      strikeId: strike.id,
      reason: "BATTLE_RESPONSE"
    });
  }

  const shouldAttachToAttacker =
    definition.cardType === "MAGIC" &&
    definition.magicSubType === "EQUIP" &&
    (Boolean((definition as { isEquip?: boolean }).isEquip) || Boolean(effect.params?.usesAnchoring) || battleResponseEffectText(effect).includes("equip"));

  if (shouldAttachToAttacker) {
    const attacker = findBattleCreatureRef(nextState, strike.attacker.playerId, strike.attacker.creatureInstanceId);
    moveBattleResponseToMagicSlot(player, handIndex, card, attacker.card.instanceId);
    destination = "MAGIC_SLOT";
    const recurringEffect = definition.effects?.find(candidate => {
      const actionType = normalizeEffectToken(candidate.actionType);
      return actionType === "APPLY_DAMAGE_OVER_TIME" || actionType === "APPLY_HEAL_OVER_TIME";
    });
    if (recurringEffect) {
      recurring = addRecurringEffectFromBattleResponse(
        nextState,
        args.playerId,
        card,
        definition,
        attacker,
        recurringEffect
      );
      if (recurring) {
        boardEvents.push({
          type: "STATUS_APPLIED",
          playerId: attacker.playerId,
          sourceCardInstanceId: card.instanceId,
          sourceCardId: card.cardId,
          sourceEffectId: recurringEffect.id,
          actionType: recurringEffect.actionType,
          targetCardInstanceId: attacker.card.instanceId,
          status: recurring.effectType,
          statusLabel: recurring.label,
          amount: recurring.amount,
          battleId: session.id,
          strikeId: strike.id
        });
      }
    }
  } else {
    moveBattleResponseToCemetery(player, handIndex, card);
  }

  boardEvents.unshift({
    type: "CARD_MOVED",
    playerId: args.playerId,
    cardInstanceId: card.instanceId,
    sourceCardInstanceId: card.instanceId,
    sourceCardId: card.cardId,
    sourceEffectId: effect.id,
    actionType: effect.actionType,
    reason: "BATTLE_RESPONSE",
    fromZoneRef: handBoardZoneRef(args.playerId),
    toZoneRef: destination === "MAGIC_SLOT"
      ? { playerId: args.playerId, zone: "MAGIC_SLOT" }
      : cemeteryBoardZoneRef(card.ownerPlayerId),
    battleId: session.id,
    strikeId: strike.id
  });

  if (effectNegatesAttackDamage(effect)) {
    boardEvents.push({
      type: "BATTLE_DAMAGE_PREVENTED",
      playerId: args.playerId,
      sourceCardInstanceId: card.instanceId,
      sourceCardId: card.cardId,
      sourceEffectId: effect.id,
      actionType: effect.actionType,
      reason: "BATTLE_RESPONSE",
      targetCardInstanceId: strike.defender.creatureInstanceId,
      battleId: session.id,
      strikeId: strike.id,
      metadata: {
        protectedCreatureName: strike.defender.creatureName
      }
    });
  }

  if (directDamageResult?.killed) {
    strike.damageTarget = "NONE";
    strike.damageDealt = 0;
    strike.status = "RESOLVED";
    strike.message = `${definition.name} destroyed ${strike.defender.creatureName} before attack damage was rolled.`;
    advanceManualBattleAfterResolvedStrike(nextState, session, strike);
  }

  setSessionUpdated(
    session,
    directDamageResult?.killed
      ? `${definition.name} was played from hand and destroyed ${strike.defender.creatureName}.`
      : effectAppliesBattleDiceModifier(effect)
        ? `${definition.name} was played from hand. This strike's attack damage dice were modified.`
        : effectNegatesAttackDamage(effect)
          ? `${definition.name} was played from hand. This strike's attack damage is negated.`
          : `${definition.name} was played from hand.`
  );

  addEvent(nextState, "BATTLE_RESPONSE_FROM_HAND_PLAYED", args.playerId, {
    battleSessionId: session.id,
    strikeId: strike.id,
    sourceCardInstanceId: card.instanceId,
    sourceCardName: definition.name,
    effectId: effect.id,
    actionType: effect.actionType,
    responseRole: response.role,
    protectedCreatureInstanceId: strike.defender.creatureInstanceId,
    protectedCreatureName: strike.defender.creatureName,
    directDamage: directDamageResult
      ? {
          damageAmount: directDamageResult.damageAmount,
          remainingHp: directDamageResult.remainingHp,
          killed: directDamageResult.killed
        }
      : undefined,
    recurringEffect: recurring
      ? {
          id: recurring.id,
          effectType: recurring.effectType,
          amount: recurring.amount,
          remainingTicks: recurring.remainingTicks,
          nextTickPlayerId: recurring.nextTickPlayerId,
          nextTickTurnStartCount: recurring.nextTickTurnStartCount
        }
      : undefined,
    destination,
    boardEvents
  });

  return nextState;
}

export function resolveBattleResponseChainLinkInPlace(
  state: MatchState,
  link: {
    playerId: string;
    cardInstanceId: string;
    cardName: string;
    battleResponse?: {
      battleSessionId: string;
      strikeId: string;
      actionType: string;
      effectId?: string;
    };
  }
): boolean {
  const battleResponse = link.battleResponse;

  if (!battleResponse) {
    return false;
  }

  const session = state.pendingBattle;

  if (!session || session.id !== battleResponse.battleSessionId) {
    addEvent(state, "BATTLE_RESPONSE_RESOLUTION_SKIPPED", link.playerId, {
      sourceCardInstanceId: link.cardInstanceId,
      sourceCardName: link.cardName,
      battleSessionId: battleResponse.battleSessionId,
      strikeId: battleResponse.strikeId,
      reason: "The linked battle session is no longer pending."
    });
    return true;
  }

  const strike = session.strikes.find(candidate => candidate.id === battleResponse.strikeId);

  if (!strike) {
    addEvent(state, "BATTLE_RESPONSE_RESOLUTION_SKIPPED", link.playerId, {
      sourceCardInstanceId: link.cardInstanceId,
      sourceCardName: link.cardName,
      battleSessionId: battleResponse.battleSessionId,
      strikeId: battleResponse.strikeId,
      reason: "The linked battle strike is no longer pending."
    });
    return true;
  }

  const modifiers = normalizeStrikeModifiers(strike.modifiers);
  modifiers.preventAttackDamage = true;
  modifiers.note = [
    modifiers.note,
    `${link.cardName} ${battleResponse.effectId ?? ""}: incoming attack damage negated`.trim()
  ].filter(Boolean).join("; ").slice(0, 500);
  strike.modifiers = modifiers;

  if (strike.status === "AWAITING_DAMAGE_APPLICATION") {
    strike.damageDealt = 0;
    strike.damagePreventedReason = `${link.cardName} negated the Atk damage meant for this creature.`;
  }

  setSessionUpdated(session, `${link.cardName} resolved. This strike's attack damage is negated.`);

  addEvent(state, "BATTLE_RESPONSE_DAMAGE_PREVENTION_RESOLVED", link.playerId, {
    battleSessionId: session.id,
    strikeId: strike.id,
    sourceCardInstanceId: link.cardInstanceId,
    sourceCardName: link.cardName,
    effectId: battleResponse.effectId,
    actionType: battleResponse.actionType,
    protectedCreatureInstanceId: strike.defender.creatureInstanceId,
    protectedCreatureName: strike.defender.creatureName
  });

  return true;
}

export function rollManualBattleHit(
  state: MatchState,
  battleSessionId: string
): MatchState {
  const nextState = cloneState(state);
  const session = nextState.pendingBattle;

  if (!session || session.id !== battleSessionId) {
    throw new Error("Pending battle session not found.");
  }

  if (session.status !== "AWAITING_HIT_ROLL") {
    throw new Error("This battle is not waiting for a hit roll.");
  }

  const strike = getCurrentManualStrike(session);

  if (strike.status !== "AWAITING_HIT_ROLL") {
    throw new Error("The active strike is not waiting for a hit roll.");
  }

  const attacker = findBattleCreatureRef(
    nextState,
    strike.attacker.playerId,
    strike.attacker.creatureInstanceId
  );
  const defender = findBattleCreatureRef(
    nextState,
    strike.defender.playerId,
    strike.defender.creatureInstanceId
  );

  const previousSuggestedEffects = session.suggestedEffects ?? [];
  const previousAutoStrikeModifiers = normalizeStrikeModifiers(
    getSuggestedStrikeModifiers(
      previousSuggestedEffects,
      strike.attacker.creatureInstanceId,
      strike.defender.creatureInstanceId
    )
  );
  const currentStrikeModifiers = normalizeStrikeModifiers(strike.modifiers);
  session.suggestedEffects = collectBattleEffectSuggestions(nextState, session);

  if (modifiersAreEqual(currentStrikeModifiers, previousAutoStrikeModifiers)) {
    strike.modifiers = normalizeStrikeModifiers(
      getSuggestedStrikeModifiers(
        session.suggestedEffects,
        strike.attacker.creatureInstanceId,
        strike.defender.creatureInstanceId
      )
    );
  }

  runBattleTimingTriggers(nextState, {
    timing: "BEFORE_HIT_ROLL",
    battleSession: session,
    strike,
    addEvent
  });

  resolveBattleTriggeredRuntimeEffects(nextState, {
    timing: "BEFORE_HIT_ROLL",
    battleSession: session,
    strike,
    addEvent
  });

  const attackerStats = getEffectiveCreatureStats(nextState, attacker.card);
  const defenderStats = getEffectiveCreatureStats(nextState, defender.card);

  const modifiers = normalizeStrikeModifiers(strike.modifiers);
  const hitDiceLimit = getActiveHitDiceLimit(attacker.card);
  const uncappedHitDiceCount = Math.max(1, 2 + modifiers.hitDiceDelta);
  const hitDiceCount = getHitDiceCount(modifiers, attacker.card);

  if (hitDiceLimit.limit !== undefined) {
    modifiers.hitDiceLimit = modifiers.hitDiceLimit === undefined
      ? hitDiceLimit.limit
      : Math.min(modifiers.hitDiceLimit, hitDiceLimit.limit);
  }

  if (hitDiceLimit.limit !== undefined && hitDiceCount < uncappedHitDiceCount) {
    addEvent(nextState, "HIT_DICE_LIMIT_APPLIED", attacker.playerId, {
      battleSessionId: session.id,
      strikeId: strike.id,
      attackerCreatureInstanceId: attacker.card.instanceId,
      attackerCreatureName: attackerStats.name,
      uncappedHitDiceCount,
      hitDiceLimit: hitDiceLimit.limit,
      finalHitDiceCount: hitDiceCount,
      sourceNames: hitDiceLimit.sourceNames
    });
  }

  const hitRollDice = rollD6WithDev(nextState, {
    kind: "HIT_ROLL",
    count: hitDiceCount,
    playerId: attacker.playerId,
    label: `${attackerStats.name} hit roll`,
    addEvent,
    context: { battleSessionId: session.id, strikeId: strike.id, attackerCreatureInstanceId: attacker.card.instanceId, defenderCreatureInstanceId: defender.card.instanceId }
  });
  const hitRollModifier = attackerStats.modifier + modifiers.hitFlatBonus;
  const hitRollTotal = Math.ceil((sumDice(hitRollDice) + hitRollModifier) * modifiers.hitRollMultiplier);
  let criticalHit = hitRollDice.length > 1 && hitRollDice.every(die => die === 6);
  let criticalMiss = hitRollDice.length > 1 && hitRollDice.every(die => die === 1);
  let hit = criticalHit || (!criticalMiss && hitRollTotal >= defenderStats.armorLevel);

  if (modifiers.forceHitResult === "FORCE_HIT") {
    hit = true;
    criticalMiss = false;
  } else if (modifiers.forceHitResult === "FORCE_MISS") {
    hit = false;
    criticalHit = false;
  }

  strike.modifiers = modifiers;
  strike.attacker = snapshotParticipant(nextState, attacker);
  strike.defender = snapshotParticipant(nextState, defender);
  strike.hitRollDice = hitRollDice;
  strike.hitDiceCount = hitDiceCount;
  strike.hitRollModifier = hitRollModifier;
  strike.hitRollTotal = hitRollTotal;
  strike.defenderArmorLevel = defenderStats.armorLevel;
  strike.hit = hit;
  strike.criticalHit = criticalHit;
  strike.criticalMiss = criticalMiss;

  addEvent(nextState, "BATTLE_HIT_ROLLED", attacker.playerId, {
    battleSessionId: session.id,
    strikeId: strike.id,
    attackerCreatureInstanceId: attacker.card.instanceId,
    defenderCreatureInstanceId: defender.card.instanceId,
    hitRollDice,
    hitRollModifier,
    hitRollTotal,
    defenderArmorLevel: defenderStats.armorLevel,
    hit,
    criticalHit,
    criticalMiss,
    boardEvents: [
      {
        type: "BATTLE_HIT_ROLLED",
        playerId: attacker.playerId,
        sourceCardInstanceId: attacker.card.instanceId,
        targetCardInstanceId: defender.card.instanceId,
        actionType: "BATTLE_HIT_ROLL",
        battleId: session.id,
        strikeId: strike.id,
        values: hitRollDice,
        metadata: {
          hit,
          criticalHit,
          criticalMiss,
          total: hitRollTotal
        }
      }
    ]
  });

  runBattleTimingTriggers(nextState, {
    timing: "AFTER_HIT_ROLL",
    battleSession: session,
    strike,
    addEvent
  });

  if (hit) {
    runBattleTimingTriggers(nextState, {
      timing: "ON_HIT",
      battleSession: session,
      strike,
      addEvent
    });

    resolveBattleTriggeredRuntimeEffects(nextState, {
      timing: "ON_HIT",
      battleSession: session,
      strike,
      addEvent
    });

    if (pauseBattleForPendingEffectRoll(
      nextState,
      session,
      strike,
      "Hit confirmed. Resolve the pending effect roll before rolling attack damage."
    )) {
      return nextState;
    }

    if (strike.role === "FIRST_STRIKE") {
      runBattleTimingTriggers(nextState, {
        timing: "ON_HIT_FIRST",
        battleSession: session,
        strike,
        addEvent
      });

      resolveBattleTriggeredRuntimeEffects(nextState, {
        timing: "ON_HIT_FIRST",
        battleSession: session,
        strike,
        addEvent
      });

      if (pauseBattleForPendingEffectRoll(
        nextState,
        session,
        strike,
        "First hit confirmed. Resolve the pending effect roll before rolling attack damage."
      )) {
        return nextState;
      }
    }

    const attackerAfterHitEffects = tryFindBattleCreatureRef(
      nextState,
      strike.attacker.playerId,
      strike.attacker.creatureInstanceId
    );
    const defenderAfterHitEffects = tryFindBattleCreatureRef(
      nextState,
      strike.defender.playerId,
      strike.defender.creatureInstanceId
    );

    if (!attackerAfterHitEffects || !defenderAfterHitEffects) {
      strike.damageTarget = "NONE";
      strike.damageDealt = 0;
      strike.attackerKilledByCriticalMiss = !attackerAfterHitEffects;
      strike.defenderKilled = !defenderAfterHitEffects;
      strike.attackerRemainingHp = attackerAfterHitEffects ? getCurrentHp(attackerAfterHitEffects.card) : 0;
      strike.defenderRemainingHp = defenderAfterHitEffects ? getCurrentHp(defenderAfterHitEffects.card) : 0;
      strike.status = "RESOLVED";
      strike.message = "A triggered effect removed a battle creature before attack damage could be rolled.";

      addEvent(nextState, "BATTLE_STRIKE_RESOLVED_BY_TRIGGERED_EFFECT", attacker.playerId, {
        battleSessionId: session.id,
        strikeId: strike.id,
        attackerStillOnField: Boolean(attackerAfterHitEffects),
        defenderStillOnField: Boolean(defenderAfterHitEffects),
        attackerCreatureInstanceId: strike.attacker.creatureInstanceId,
        defenderCreatureInstanceId: strike.defender.creatureInstanceId
      });

      advanceManualBattleAfterResolvedStrike(nextState, session, strike);
      return nextState;
    }
  } else {
    runBattleTimingTriggers(nextState, {
      timing: "ON_MISS",
      battleSession: session,
      strike,
      addEvent
    });
  }

  if (criticalMiss) {
    const selfDamageDice = rollD6WithDev(nextState, {
      kind: "SELF_DAMAGE_ROLL",
      count: 1,
      playerId: attacker.playerId,
      label: `${attackerStats.name} critical miss self-damage`,
      addEvent,
      context: { battleSessionId: session.id, strikeId: strike.id, attackerCreatureInstanceId: attacker.card.instanceId }
    });
    const selfDamageDealt = sumDice(selfDamageDice);

    strike.selfDamageDice = selfDamageDice;
    strike.selfDamageDealt = selfDamageDealt;
    strike.damageDealt = selfDamageDealt;
    strike.damageTarget = "ATTACKER";
    strike.status = "AWAITING_DAMAGE_APPLICATION";
    session.status = "AWAITING_DAMAGE_APPLICATION";
    setSessionUpdated(
      session,
      "Critical miss. Apply the 1D6 flat self-damage."
    );
    return nextState;
  }

  if (!hit) {
    strike.damageTarget = "NONE";
    strike.damageDealt = 0;
    strike.defenderRemainingHp = getCurrentHp(defender.card);
    strike.defenderKilled = false;
    strike.status = "RESOLVED";
    strike.message = "Miss. No damage roll is made.";
    advanceManualBattleAfterResolvedStrike(nextState, session, strike);
    return nextState;
  }

  const pendingEffectRoll = detectPendingEffectRollForStrike({
    state: nextState,
    battleSession: session,
    strike,
    addEvent
  });

  if (pendingEffectRoll) {
    nextState.pendingEffectRoll = pendingEffectRoll;
    strike.status = "AWAITING_EFFECT_ROLL";
    session.status = "AWAITING_EFFECT_ROLL";
    setSessionUpdated(
      session,
      "Hit confirmed. Resolve the pending effect roll before rolling attack damage."
    );
    return nextState;
  }

  strike.status = "AWAITING_DAMAGE_ROLL";
  session.status = "AWAITING_DAMAGE_ROLL";
  setSessionUpdated(
    session,
    criticalHit
      ? "Critical hit. Roll attack damage; the final damage will be doubled."
      : "Hit confirmed. Roll attack damage."
  );

  return nextState;
}

export function rollManualBattleDamage(
  state: MatchState,
  battleSessionId: string
): MatchState {
  const nextState = cloneState(state);
  const session = nextState.pendingBattle;

  if (!session || session.id !== battleSessionId) {
    throw new Error("Pending battle session not found.");
  }

  if (session.status !== "AWAITING_DAMAGE_ROLL") {
    throw new Error("This battle is not waiting for a damage roll.");
  }

  const strike = getCurrentManualStrike(session);

  if (strike.status !== "AWAITING_DAMAGE_ROLL") {
    throw new Error("The active strike is not waiting for a damage roll.");
  }

  const attacker = findBattleCreatureRef(
    nextState,
    strike.attacker.playerId,
    strike.attacker.creatureInstanceId
  );

  const previousSuggestedEffects = session.suggestedEffects ?? [];
  const previousAutoStrikeModifiers = normalizeStrikeModifiers(
    getSuggestedStrikeModifiers(
      previousSuggestedEffects,
      strike.attacker.creatureInstanceId,
      strike.defender.creatureInstanceId
    )
  );
  const currentStrikeModifiers = normalizeStrikeModifiers(strike.modifiers);
  session.suggestedEffects = collectBattleEffectSuggestions(nextState, session);

  if (modifiersAreEqual(currentStrikeModifiers, previousAutoStrikeModifiers)) {
    strike.modifiers = normalizeStrikeModifiers(
      getSuggestedStrikeModifiers(
        session.suggestedEffects,
        strike.attacker.creatureInstanceId,
        strike.defender.creatureInstanceId
      )
    );
  }

  runBattleTimingTriggers(nextState, {
    timing: "BEFORE_DAMAGE_ROLL",
    battleSession: session,
    strike,
    addEvent
  });

  resolveBattleTriggeredRuntimeEffects(nextState, {
    timing: "BEFORE_DAMAGE_ROLL",
    battleSession: session,
    strike,
    addEvent
  });

  const attackerStats = getEffectiveCreatureStats(nextState, attacker.card);
  let modifiers = normalizeStrikeModifiers(strike.modifiers);
  const damageDiceCount = getDamageDiceCount(attackerStats.attackDice, modifiers);

  const damageRollDice = rollD6WithDev(nextState, {
    kind: "ATTACK_DAMAGE_ROLL",
    count: damageDiceCount,
    playerId: attacker.playerId,
    label: `${attackerStats.name} attack damage roll`,
    addEvent,
    context: { battleSessionId: session.id, strikeId: strike.id, attackerCreatureInstanceId: attacker.card.instanceId }
  });

  // Store damage dice before DURING_DAMAGE_CALC triggers run so conditional
  // effects can inspect the actual Atk Dice Roll results. Example: Orc only
  // doubles damage when at least one attack damage die is a 6.
  strike.damageRollDice = damageRollDice;
  strike.damageDiceCount = damageDiceCount;

  runBattleTimingTriggers(nextState, {
    timing: "DURING_DAMAGE_CALC",
    battleSession: session,
    strike,
    addEvent
  });

  resolveBattleTriggeredRuntimeEffects(nextState, {
    timing: "DURING_DAMAGE_CALC",
    battleSession: session,
    strike,
    addEvent
  });

  modifiers = normalizeStrikeModifiers(strike.modifiers);
  const attackDamageModifier = attackerStats.modifier + modifiers.damageFlatBonus;
  const damageBeforeCritical = Math.max(0, sumDice(damageRollDice) + attackDamageModifier);
  const damageAfterModifiers = Math.max(0, Math.ceil(damageBeforeCritical * modifiers.damageMultiplier));
  const damageAfterCritical = strike.criticalHit ? damageAfterModifiers * 2 : damageAfterModifiers;
  const activeStatusPreventsAttackDamage = creatureCannotInflictAttackDamage(attacker.card);
  const damageDealt = modifiers.preventAttackDamage || activeStatusPreventsAttackDamage ? 0 : damageAfterCritical;

  addEvent(nextState, "BATTLE_DAMAGE_PIPELINE_RESOLVED", attacker.playerId, {
    battleSessionId: session.id,
    strikeId: strike.id,
    attackerCreatureInstanceId: attacker.card.instanceId,
    attackerCreatureName: attackerStats.name,
    defenderCreatureInstanceId: strike.defender.creatureInstanceId,
    defenderCreatureName: strike.defender.creatureName,
    damageRollDice,
    printedAndFlatModifier: attackDamageModifier,
    damageBeforeCritical,
    effectAndManualDamageMultiplier: modifiers.damageMultiplier,
    damageAfterModifiers,
    criticalHit: Boolean(strike.criticalHit),
    criticalMultiplier: strike.criticalHit ? 2 : 1,
    damageAfterCritical,
    prevented: Boolean(modifiers.preventAttackDamage || activeStatusPreventsAttackDamage),
    finalDamage: damageDealt,
    note: modifiers.note
  });

  addEvent(nextState, "BATTLE_DAMAGE_ROLLED", attacker.playerId, {
    battleSessionId: session.id,
    strikeId: strike.id,
    attackerCreatureInstanceId: attacker.card.instanceId,
    attackerCreatureName: attackerStats.name,
    defenderCreatureInstanceId: strike.defender.creatureInstanceId,
    defenderCreatureName: strike.defender.creatureName,
    damageRollDice,
    damageAmount: damageDealt,
    prevented: Boolean(modifiers.preventAttackDamage || activeStatusPreventsAttackDamage),
    boardEvents: [
      {
        type: "BATTLE_DAMAGE_ROLLED",
        playerId: attacker.playerId,
        sourceCardInstanceId: attacker.card.instanceId,
        targetCardInstanceId: strike.defender.creatureInstanceId,
        actionType: "BATTLE_DAMAGE_ROLL",
        battleId: session.id,
        strikeId: strike.id,
        values: damageRollDice,
        amount: damageDealt,
        metadata: {
          damageBeforeCritical,
          damageAfterModifiers,
          damageAfterCritical,
          prevented: Boolean(modifiers.preventAttackDamage || activeStatusPreventsAttackDamage)
        }
      }
    ]
  });

  if (modifiers.preventAttackDamage || activeStatusPreventsAttackDamage) {
    addEvent(nextState, "BATTLE_DAMAGE_PREVENTED", attacker.playerId, {
      battleSessionId: session.id,
      strikeId: strike.id,
      attackerCreatureInstanceId: attacker.card.instanceId,
      defenderCreatureInstanceId: strike.defender.creatureInstanceId,
      reason: modifiers.preventAttackDamage
        ? "BATTLE_RESPONSE"
        : "ACTIVE_STATUS",
      boardEvents: [
        {
          type: "BATTLE_DAMAGE_PREVENTED",
          playerId: attacker.playerId,
          sourceCardInstanceId: attacker.card.instanceId,
          targetCardInstanceId: strike.defender.creatureInstanceId,
          actionType: "PREVENT_ATTACK_DAMAGE",
          reason: modifiers.preventAttackDamage ? "BATTLE_RESPONSE" : "ACTIVE_STATUS",
          battleId: session.id,
          strikeId: strike.id
        }
      ]
    });
  }

  strike.modifiers = modifiers;
  strike.attacker = snapshotParticipant(nextState, attacker);
  strike.damageRollDice = damageRollDice;
  strike.damageDiceCount = damageDiceCount;
  strike.attackDamageModifier = attackDamageModifier;
  strike.damageBeforeCritical = damageBeforeCritical;
  strike.damageAfterCritical = damageAfterCritical;
  strike.damageAfterModifiers = damageAfterModifiers;
  strike.damageDealt = damageDealt;
  strike.damagePreventedReason = modifiers.preventAttackDamage
    ? "Attack damage was manually prevented by a battle modifier."
    : activeStatusPreventsAttackDamage
      ? "Attack damage was prevented by an active card effect/status."
      : undefined;
  strike.damageTarget = "DEFENDER";
  strike.status = "AWAITING_DAMAGE_APPLICATION";
  session.status = "AWAITING_DAMAGE_APPLICATION";

  setSessionUpdated(session, "Damage rolled. Apply the damage to continue.");

  return nextState;
}

export function applyManualBattleDamage(
  state: MatchState,
  battleSessionId: string
): MatchState {
  const nextState = cloneState(state);
  const session = nextState.pendingBattle;

  if (!session || session.id !== battleSessionId) {
    throw new Error("Pending battle session not found.");
  }

  if (session.status !== "AWAITING_DAMAGE_APPLICATION") {
    throw new Error("This battle is not waiting for damage application.");
  }

  const strike = getCurrentManualStrike(session);

  if (strike.status !== "AWAITING_DAMAGE_APPLICATION") {
    throw new Error("The active strike is not waiting for damage application.");
  }

  if (strike.damageTarget === "NONE") {
    strike.status = "RESOLVED";
    advanceManualBattleAfterResolvedStrike(nextState, session, strike);
    return nextState;
  }

  const targetSnapshot = strike.damageTarget === "ATTACKER"
    ? strike.attacker
    : strike.defender;
  const target = findBattleCreatureRef(
    nextState,
    targetSnapshot.playerId,
    targetSnapshot.creatureInstanceId
  );
  const damageAmount = strike.damageDealt ?? 0;
  const existingDamagePreventedReason = strike.damageTarget === "DEFENDER"
    ? strike.damagePreventedReason
    : strike.selfDamagePreventedReason;
  const damageResult = applyDamageToBattleCreature(nextState, target, damageAmount);

  if (strike.damageTarget === "ATTACKER") {
    strike.selfDamagePreventedReason = existingDamagePreventedReason ?? damageResult.damagePreventedReason;
    strike.selfDamageDealt = strike.selfDamagePreventedReason || damageResult.damagePreventedReason ? 0 : damageAmount;
    strike.attackerRemainingHp = damageResult.remainingHp;
    strike.attackerKilledByCriticalMiss = damageResult.killed;
  } else {
    strike.damagePreventedReason = existingDamagePreventedReason ?? damageResult.damagePreventedReason;
    strike.damageDealt = strike.damagePreventedReason || damageResult.damagePreventedReason ? 0 : damageAmount;
    strike.defenderRemainingHp = damageResult.remainingHp;
    strike.defenderKilled = damageResult.killed;
  }

  addEvent(nextState, "BATTLE_DAMAGE_APPLIED", target.playerId, {
    battleSessionId: session.id,
    strikeId: strike.id,
    attackerCreatureInstanceId: strike.attacker.creatureInstanceId,
    attackerCreatureName: strike.attacker.creatureName,
    defenderCreatureInstanceId: strike.defender.creatureInstanceId,
    defenderCreatureName: strike.defender.creatureName,
    targetCreatureInstanceId: target.card.instanceId,
    targetCreatureName: targetSnapshot.creatureName,
    targetPlayerId: target.playerId,
    damageTarget: strike.damageTarget,
    damageAmount,
    remainingHp: damageResult.remainingHp,
    killed: damageResult.killed,
    damageRollDice: strike.damageRollDice ?? strike.selfDamageDice ?? [],
    boardEvents: [
      {
        type: "BATTLE_DAMAGE_APPLIED",
        playerId: target.playerId,
        sourceCardInstanceId: strike.attacker.creatureInstanceId,
        targetCardInstanceId: target.card.instanceId,
        actionType: "APPLY_BATTLE_DAMAGE",
        battleId: session.id,
        strikeId: strike.id,
        amount: damageAmount,
        values: strike.damageRollDice ?? strike.selfDamageDice ?? [],
        metadata: {
          remainingHp: damageResult.remainingHp,
          killed: damageResult.killed,
          damageTarget: strike.damageTarget
        }
      }
    ]
  });

  runBattleTimingTriggers(nextState, {
    timing: "AFTER_DAMAGE_APPLIED",
    battleSession: session,
    strike,
    addEvent
  });

  resolveBattleTriggeredRuntimeEffects(nextState, {
    timing: "AFTER_DAMAGE_APPLIED",
    battleSession: session,
    strike,
    addEvent
  });

  if (pauseBattleForPendingEffectRoll(
    nextState,
    session,
    strike,
    "Damage applied. Resolve the pending effect roll before finishing the strike."
  )) {
    return nextState;
  }

  finishManualBattleDamageAfterTriggeredEffects(nextState, session, strike);

  return nextState;
}

function finishManualBattleDamageAfterTriggeredEffects(
  state: MatchState,
  session: PendingBattleSession,
  strike: ManualBattleStrike
): void {
  if (strike.defenderKilled || strike.attackerKilledByCriticalMiss) {
    runBattleTimingTriggers(state, {
      timing: "WHEN_CREATURE_KILLED_IN_BATTLE",
      battleSession: session,
      strike,
      addEvent
    });

    resolveBattleTriggeredRuntimeEffects(state, {
      timing: "WHEN_CREATURE_KILLED_IN_BATTLE",
      battleSession: session,
      strike,
      addEvent
    });

    if (pauseBattleForPendingEffectRoll(
      state,
      session,
      strike,
      "A creature was killed. Resolve the pending effect roll before finishing the battle."
    )) {
      return;
    }
  }

  strike.status = "RESOLVED";
  strike.message = strike.message ?? "Damage applied.";

  advanceManualBattleAfterResolvedStrike(state, session, strike);
}

export function rollAndApplyManualBattleDamage(
  state: MatchState,
  battleSessionId: string
): MatchState {
  const rolledState = rollManualBattleDamage(state, battleSessionId);
  return applyManualBattleDamage(rolledState, battleSessionId);
}

export function rollPendingEffectRoll(
  state: MatchState,
  effectRollSessionId: string
): MatchState {
  const nextState = cloneState(state);
  const session = rollPendingEffectRollInPlace(nextState, effectRollSessionId, addEvent);

  if (shouldAutoApplyStandaloneStatusTickEffectRoll(session)) {
    applyPendingEffectRollStatusInPlace(nextState, effectRollSessionId, addEvent);
  }

  return nextState;
}

function shouldAutoApplyStandaloneStatusTickEffectRoll(session: ReturnType<typeof rollPendingEffectRollInPlace>): boolean {
  if (session.linkedBattleSessionId || session.linkedStrikeId) {
    return false;
  }

  return normalizeEffectToken(session.actionType) === "RESOLVE_STATUS_TICK" ||
    normalizeEffectToken(session.onSuccessActionType) === "REMOVE_STATUS" ||
    Boolean(session.targetStatusId);
}

function continueBattleAfterPendingEffectRoll(
  state: MatchState,
  linkedBattleSessionId?: string,
  linkedStrikeId?: string,
  resumeBattleAfterEffectRoll?: PendingEffectRollSession["resumeBattleAfterEffectRoll"]
): void {
  if (!linkedBattleSessionId || !linkedStrikeId) {
    return;
  }

  const session = state.pendingBattle;

  if (!session || session.id !== linkedBattleSessionId) {
    return;
  }

  const strike = session.strikes.find(candidate => candidate.id === linkedStrikeId);

  if (!strike) {
    return;
  }

  if (session.status !== "AWAITING_EFFECT_ROLL" && strike.status !== "AWAITING_EFFECT_ROLL") {
    return;
  }

  if (resumeBattleAfterEffectRoll === "RESOLVE_STRIKE") {
    finishManualBattleDamageAfterTriggeredEffects(state, session, strike);
    return;
  }

  if (strike.defenderKilled || strike.attackerKilledByCriticalMiss || strike.status === "RESOLVED") {
    strike.status = "RESOLVED";
    strike.message = strike.message ?? "A triggered effect resolved this strike before attack damage.";
    advanceManualBattleAfterResolvedStrike(state, session, strike);
    return;
  }

  strike.status = "AWAITING_DAMAGE_ROLL";
  session.status = "AWAITING_DAMAGE_ROLL";
  setSessionUpdated(session, "Effect roll resolved. Roll attack damage.");
}

export function applyPendingEffectRoll(
  state: MatchState,
  effectRollSessionId: string
): MatchState {
  const nextState = cloneState(state);
  const pending = nextState.pendingEffectRoll;

  if (!pending || pending.id !== effectRollSessionId) {
    throw new Error("Pending effect roll session not found.");
  }

  const linkedBattleSessionId = pending.linkedBattleSessionId;
  const linkedStrikeId = pending.linkedStrikeId;
  const resumeBattleAfterEffectRoll = pending.resumeBattleAfterEffectRoll;

  applyPendingEffectRollStatusInPlace(nextState, effectRollSessionId, addEvent);
  continueBattleAfterPendingEffectRoll(nextState, linkedBattleSessionId, linkedStrikeId, resumeBattleAfterEffectRoll);

  return nextState;
}

export function skipPendingEffectRoll(
  state: MatchState,
  effectRollSessionId: string
): MatchState {
  const nextState = cloneState(state);
  const pending = nextState.pendingEffectRoll;

  if (!pending || pending.id !== effectRollSessionId) {
    throw new Error("Pending effect roll session not found.");
  }

  const linkedBattleSessionId = pending.linkedBattleSessionId;
  const linkedStrikeId = pending.linkedStrikeId;
  const resumeBattleAfterEffectRoll = pending.resumeBattleAfterEffectRoll;

  skipPendingEffectRollInPlace(nextState, effectRollSessionId, addEvent);
  continueBattleAfterPendingEffectRoll(nextState, linkedBattleSessionId, linkedStrikeId, resumeBattleAfterEffectRoll);

  return nextState;
}

export function finishManualBattleSession(
  state: MatchState,
  battleSessionId: string
): MatchState {
  const nextState = cloneState(state);

  if (!nextState.pendingBattle || nextState.pendingBattle.id !== battleSessionId) {
    throw new Error("Pending battle session not found.");
  }

  if (nextState.pendingBattle.status !== "COMPLETE") {
    throw new Error("Battle is not complete yet.");
  }

  sendBattleInterceptHogganToCemetery(nextState, nextState.pendingBattle);

  nextState.pendingBattle = undefined;

  return nextState;
}

export function cancelManualBattleSession(
  state: MatchState,
  battleSessionId: string
): MatchState {
  const nextState = cloneState(state);

  if (!nextState.pendingBattle || nextState.pendingBattle.id !== battleSessionId) {
    throw new Error("Pending battle session not found.");
  }

  if (nextState.pendingBattle.strikes.some(strike => strike.hitRollDice?.length)) {
    throw new Error("Cannot cancel a battle after dice have been rolled.");
  }

  nextState.pendingBattle = undefined;

  return nextState;
}

export function battleWithCreature(
  state: MatchState,
  playerId: string,
  attackerCreatureInstanceId: string
): MatchState {
  validateBattleCanStart(state, playerId);

  const nextState = cloneState(state);
  const attackingPlayer = getPlayer(nextState, playerId);
  const defendingPlayer = getOpponentPlayer(nextState, playerId);

  const attackingCreature = getAttackingCreatureRef(
    attackingPlayer,
    attackerCreatureInstanceId
  );
  const defendingCreature = getPrimaryCreatureRef(defendingPlayer);

  const suppressesRetaliation = shouldSuppressRetaliationForBattle(attackingPlayer, attackingCreature);

  if (!canCreatureBattleThisCombat(attackingPlayer, attackingCreature)) {
    throw new Error("This creature has already battled during this Combat Phase.");
  }

  const cannotInitiateReason = getCannotInitiateBattleReason(
    attackingCreature.card,
    getCannotInflictAttackDamageBattlePolicy(nextState)
  );

  if (cannotInitiateReason) {
    markBattleSkippedForCreature(nextState, attackingPlayer, attackingCreature, cannotInitiateReason);
    return nextState;
  }

  if (!defendingPlayer.field.primaryCreature) {
    throw new Error("The defending player has no primary creature.");
  }

  markCreatureBattleUsed(
    attackingPlayer,
    attackingCreature.card.instanceId,
    getCreatureBattleUseLimit(attackingCreature.card)
  );

  const order = attackingCreature.kind === "LIMITED_SUMMON" || suppressesRetaliation
    ? {
        firstStrike: attackingCreature,
        secondStrike: undefined,
        speedTie: false,
        speedTieRolls: undefined
      }
    : determinePrimaryStrikeOrder(nextState, attackingCreature, defendingCreature);

  const strikes: BattleStrikeResult[] = [];

  const firstStrike = resolveStrike(
    nextState,
    order.firstStrike,
    order.secondStrike ?? defendingCreature
  );

  strikes.push(firstStrike);

  const battleStoppedAfterFirstStrike =
    firstStrike.defenderKilled ||
    firstStrike.attackerKilledByCriticalMiss ||
    !!nextState.setup.primaryReplacementRequiredForPlayerId ||
    !getPlayer(nextState, order.firstStrike.playerId).field.primaryCreature ||
    !defendingPlayer.field.primaryCreature;

  if (!battleStoppedAfterFirstStrike && order.secondStrike) {
    const secondStrike = resolveStrike(
      nextState,
      order.secondStrike,
      order.firstStrike
    );

    strikes.push(secondStrike);
  }

  const combatPhaseEnded =
    strikes.some(strike => strike.defenderKilled || strike.attackerKilledByCriticalMiss) ||
    !!nextState.setup.primaryReplacementRequiredForPlayerId;

  if (combatPhaseEnded) {
    nextState.turn.phase = "SECOND_MAGIC";
  }

  const result: BattleResult = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),

    attackingPlayerId: attackingPlayer.id,
    defendingPlayerId: defendingPlayer.id,
    attackingCreatureInstanceId: attackingCreature.card.instanceId,
    defendingCreatureInstanceId: defendingCreature.card.instanceId,
    attackingCreatureKind: attackingCreature.kind,
    defendingCreatureKind: defendingCreature.kind,

    firstStrikePlayerId: order.firstStrike.playerId,
    secondStrikePlayerId: order.secondStrike?.playerId,

    speedTie: order.speedTie,
    speedTieRolls: order.speedTieRolls,

    strikes,

    combatPhaseEnded,
    message: combatPhaseEnded
      ? nextState.setup.primaryReplacementRequiredForPlayerId
        ? "A primary creature was killed. Combat Phase ended and replacement is required."
        : "A primary creature was killed. Combat Phase ended. A Limited Summon was promoted automatically if available."
      : attackingCreature.kind === "LIMITED_SUMMON" || suppressesRetaliation
        ? "Battle resolved. The defending primary creature does not make a return attack."
        : "Battle resolved."
  };

  nextState.lastBattle = result;

  addEvent(nextState, "CREATURE_BATTLE_RESOLVED", playerId, result);
  expireConsumedTemporaryBattleEquip(nextState, attackingPlayer, attackingCreature.card.instanceId);

  return nextState;
}

export function battlePrimaryCreatures(
  state: MatchState,
  playerId: string
): MatchState {
  const player = getPlayer(state, playerId);
  const primaryCreature = player.field.primaryCreature;

  if (!primaryCreature) {
    throw new Error("The active player has no primary creature.");
  }

  return battleWithCreature(state, playerId, primaryCreature.instanceId);
}
