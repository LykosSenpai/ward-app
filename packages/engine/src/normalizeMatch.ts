import type {
  ActiveCreatureStatus,
  ActiveEffectInstance,
  ActiveRecurringCreatureEffect,
  ActiveStatModifier,
  CardInstance,
  CannotInflictAttackDamageBattlePolicy,
  DevForcedRoll,
  MatchState,
  PendingEffectRollSession,
  PlayerField,
  PlayerState
} from "@ward/shared";
import { calculateCemeteryCreatureHp } from "./cemetery.js";
import { normalizeAllActiveEffectInstances } from "./activeEffectInstances.js";

type PartialRecord = Record<string, unknown>;

const DEFAULT_CEMETERY_HP_LIMIT = 300;
const DEFAULT_CANNOT_INFLICT_ATTACK_DAMAGE_BATTLE_POLICY: CannotInflictAttackDamageBattlePolicy = "SKIP_BATTLE";

function normalizeCannotInflictAttackDamageBattlePolicy(value: unknown): CannotInflictAttackDamageBattlePolicy {
  return value === "DAMAGE_ONLY" || value === "SKIP_BATTLE"
    ? value
    : DEFAULT_CANNOT_INFLICT_ATTACK_DAMAGE_BATTLE_POLICY;
}

function asRecord(value: unknown): PartialRecord {
  return value && typeof value === "object" ? (value as PartialRecord) : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeActiveStatModifier(modifier: unknown): ActiveStatModifier | undefined {
  const data = asRecord(modifier);

  if (!data.id || !data.sourceEffectId || !data.sourceCardInstanceId) {
    return undefined;
  }

  const stat = data.stat;

  if (
    stat !== "armorLevel" &&
    stat !== "speed" &&
    stat !== "attackDice" &&
    stat !== "modifier"
  ) {
    return undefined;
  }

  const durationType =
    data.durationType === "PERMANENT_UNTIL_SOURCE_REMOVED"
      ? "PERMANENT_UNTIL_SOURCE_REMOVED"
      : "TARGET_PLAYER_TURN_STARTS";

  return {
    id: String(data.id),
    sourceEffectId: String(data.sourceEffectId),
    sourceCardInstanceId: String(data.sourceCardInstanceId),
    sourceCardName: String(data.sourceCardName ?? "Unknown Source"),
    stat,
    delta: Number(data.delta ?? 0),
    durationType,
    appliedTurnNumber: Number(data.appliedTurnNumber ?? 0),
    appliedTurnCycle: Number(data.appliedTurnCycle ?? 0),
    expiresOnPlayerId:
      typeof data.expiresOnPlayerId === "string"
        ? data.expiresOnPlayerId
        : undefined,
    expiresAtPlayerTurnStartCount:
      typeof data.expiresAtPlayerTurnStartCount === "number"
        ? data.expiresAtPlayerTurnStartCount
        : undefined
  };
}

function normalizeRecurringTickTimingValue(tickTiming: string | undefined): ActiveRecurringCreatureEffect["tickTiming"] {
  if (tickTiming === "BEGINNING_OF_TURN") return "BEGINNING_OF_TURN";
  if (tickTiming === "BEGINNING_OF_COMBAT_PHASE") return "BEGINNING_OF_COMBAT_PHASE";
  return "END_OF_COMBAT_PHASE";
}

function normalizeActiveRecurringEffect(effect: ActiveRecurringCreatureEffect): ActiveRecurringCreatureEffect {
  return {
    ...effect,
    tickTiming: effect.effectType === "DAMAGE_OVER_TIME" || effect.effectType === "HEAL_OVER_TIME"
      ? "END_OF_COMBAT_PHASE"
      : normalizeRecurringTickTimingValue(effect.tickTiming)
  };
}

function normalizeActiveEffectInstance(instance: ActiveEffectInstance): ActiveEffectInstance {
  if (instance.tickTiming !== undefined) {
    return {
      ...instance,
      tickTiming: instance.kind === "DAMAGE_OVER_TIME" || instance.kind === "HEAL_OVER_TIME"
        ? "END_OF_COMBAT_PHASE"
        : normalizeRecurringTickTimingValue(instance.tickTiming)
    };
  }

  return instance;
}

function normalizeCardInstance(card: CardInstance): CardInstance {
  card.activeStatModifiers = asArray<ActiveStatModifier>(
    card.activeStatModifiers
  )
    .map(normalizeActiveStatModifier)
    .filter((modifier): modifier is ActiveStatModifier => !!modifier);

  card.activeStatuses = asArray<ActiveCreatureStatus>(card.activeStatuses).filter(
    status => !!status.id && !!status.sourceEffectId && !!status.sourceCardInstanceId
  );

  card.activeRecurringEffects = asArray<ActiveRecurringCreatureEffect>(
    card.activeRecurringEffects
  )
    .filter(effect =>
      !!effect.id &&
      !!effect.sourceEffectId &&
      !!effect.sourceCardInstanceId &&
      Number(effect.remainingTicks ?? 0) > 0
    )
    .map(normalizeActiveRecurringEffect);

  card.activeEffectInstances = asArray<ActiveEffectInstance>(card.activeEffectInstances)
    .filter(instance =>
      !!instance.id &&
      !!instance.sourceEffectId &&
      !!instance.sourceCardInstanceId
    )
    .map(normalizeActiveEffectInstance);

  card.attachedUnder = asArray<CardInstance>(card.attachedUnder).map(
    normalizeCardInstance
  );

  return card;
}

function normalizeField(field: unknown): PlayerField {
  const data = asRecord(field);

  const primaryCreature = data.primaryCreature as CardInstance | undefined;

  return {
    primaryCreature: primaryCreature
      ? normalizeCardInstance(primaryCreature)
      : undefined,
    limitedSummons: asArray<CardInstance>(data.limitedSummons).map(
      normalizeCardInstance
    ),
    magicSlots: asArray<CardInstance>(data.magicSlots).map(normalizeCardInstance)
  };
}

function normalizePlayer(player: PlayerState): PlayerState {
  player.deck = asArray<CardInstance>(player.deck).map(normalizeCardInstance);
  player.hand = asArray<CardInstance>(player.hand).map(normalizeCardInstance);
  player.cemetery = asArray<CardInstance>(player.cemetery).map(
    normalizeCardInstance
  );
  player.removedFromGame = asArray<CardInstance>(player.removedFromGame).map(
    normalizeCardInstance
  );

  player.field = normalizeField(player.field);

  player.turnFlags = {
    hasTakenFirstTurn: Boolean(player.turnFlags?.hasTakenFirstTurn),
    drawnThisTurn: Boolean(player.turnFlags?.drawnThisTurn),
    playedCreatureThisTurn: Boolean(player.turnFlags?.playedCreatureThisTurn),
    normalSummonUsed: Boolean(player.turnFlags?.normalSummonUsed),
    killedOwnCreatureThisTurn: Boolean(player.turnFlags?.killedOwnCreatureThisTurn),
    hasBattledThisCombat: Boolean(player.turnFlags?.hasBattledThisCombat),
    battleUsedCreatureInstanceIds: asArray<string>(
      player.turnFlags?.battleUsedCreatureInstanceIds
    )
  };

  player.hasLost = Boolean(player.hasLost);
  player.cemeteryCreatureHpTotal = calculateCemeteryCreatureHp(player);

  return player;
}

function normalizePendingChain(match: MatchState): void {
  const pendingChain = match.pendingChain;

  if (!pendingChain) {
    return;
  }

  pendingChain.links = asArray(pendingChain.links);
  pendingChain.respondedPlayerIds = asArray<string>(
    pendingChain.respondedPlayerIds
  );

  const lastLink = pendingChain.links[pendingChain.links.length - 1];
  pendingChain.lastLinkPlayerId =
    typeof pendingChain.lastLinkPlayerId === "string"
      ? pendingChain.lastLinkPlayerId
      : lastLink?.playerId;

  if (typeof pendingChain.priorityPlayerId !== "string") {
    const opponent = match.players.find(
      player => player.id !== pendingChain.lastLinkPlayerId
    );
    pendingChain.priorityPlayerId = opponent?.id;
  }

  pendingChain.passesSinceLastResponse = Number(
    pendingChain.passesSinceLastResponse ?? 0
  );
}

function normalizePendingEffectTargetPrompt(match: MatchState): void {
  if (!match.pendingEffectTargetPrompt) {
    return;
  }

  match.pendingEffectTargetPrompt.options = asArray(
    match.pendingEffectTargetPrompt.options
  );

  if (match.pendingEffectTargetPrompt.options.length === 0) {
    match.pendingEffectTargetPrompt = undefined;
  }
}


function normalizePendingBattle(match: MatchState): void {
  if (!match.pendingBattle) {
    return;
  }

  match.pendingBattle.speedTieRolls = asArray(match.pendingBattle.speedTieRolls);
  match.pendingBattle.strikes = asArray(match.pendingBattle.strikes);
  match.pendingBattle.suggestedEffects = asArray(match.pendingBattle.suggestedEffects);
  match.pendingBattle.speedModifiers = {
    attackingSpeedDelta: Number(match.pendingBattle.speedModifiers?.attackingSpeedDelta ?? 0),
    defendingSpeedDelta: Number(match.pendingBattle.speedModifiers?.defendingSpeedDelta ?? 0),
    override:
      match.pendingBattle.speedModifiers?.override === "ATTACKER_FIRST" ||
      match.pendingBattle.speedModifiers?.override === "DEFENDER_FIRST"
        ? match.pendingBattle.speedModifiers.override
        : "AUTO",
    note: typeof match.pendingBattle.speedModifiers?.note === "string"
      ? match.pendingBattle.speedModifiers.note
      : undefined
  };
  match.pendingBattle.strikes = match.pendingBattle.strikes.map(strike => ({
    ...strike,
    modifiers: {
      hitDiceDelta: Number(strike.modifiers?.hitDiceDelta ?? 0),
      hitDiceLimit: Number.isFinite(Number(strike.modifiers?.hitDiceLimit))
        ? Math.max(1, Math.trunc(Number(strike.modifiers?.hitDiceLimit)))
        : undefined,
      hitFlatBonus: Number(strike.modifiers?.hitFlatBonus ?? 0),
      hitRollMultiplier: Number(strike.modifiers?.hitRollMultiplier ?? 1),
      forceHitResult:
        strike.modifiers?.forceHitResult === "FORCE_HIT" ||
        strike.modifiers?.forceHitResult === "FORCE_MISS"
          ? strike.modifiers.forceHitResult
          : "AUTO",
      damageDiceDelta: Number(strike.modifiers?.damageDiceDelta ?? 0),
      damageFlatBonus: Number(strike.modifiers?.damageFlatBonus ?? 0),
      damageMultiplier: Number(strike.modifiers?.damageMultiplier ?? 1),
      preventAttackDamage: Boolean(strike.modifiers?.preventAttackDamage),
      note: typeof strike.modifiers?.note === "string" ? strike.modifiers.note : undefined
    }
  }));

  if (match.pendingBattle.status === "COMPLETE") {
    return;
  }

  if (!match.pendingBattle.id || !match.pendingBattle.declaredAttacker || !match.pendingBattle.declaredDefender) {
    match.pendingBattle = undefined;
  }
}


function normalizePendingEffectRoll(match: MatchState): void {
  const pending = match.pendingEffectRoll as PendingEffectRollSession | undefined;

  if (!pending) {
    return;
  }

  if (!pending.id || !pending.sourcePlayerId || !pending.sourceCardInstanceId || !pending.effectId) {
    match.pendingEffectRoll = undefined;
    return;
  }

  if (pending.status === "APPLIED" || pending.status === "SKIPPED") {
    match.pendingEffectRoll = undefined;
    return;
  }

  pending.status = pending.status === "ROLLED" ? "ROLLED" : "AWAITING_ROLL";
  pending.createdAt = pending.createdAt ?? new Date().toISOString();
  pending.updatedAt = pending.updatedAt ?? pending.createdAt;
  pending.diceKind = "EFFECT_ROLL";
  pending.diceCount = Math.max(1, Math.trunc(Number(pending.diceCount ?? 1)));
  pending.successRanges = asArray<{ min?: unknown; max?: unknown }>(pending.successRanges).filter(range =>
    Number.isInteger(Number(range.min)) && Number.isInteger(Number(range.max))
  ).map(range => ({
    min: Math.max(1, Math.min(6, Number(range.min))),
    max: Math.max(1, Math.min(6, Number(range.max)))
  }));

  if (pending.successRanges.length === 0) {
    pending.successRanges = [{ min: 4, max: 6 }];
  }

  pending.rolledDice = asArray<number>(pending.rolledDice).filter(die =>
    Number.isInteger(Number(die)) && Number(die) >= 1 && Number(die) <= 6
  );

  if (pending.status === "ROLLED" && pending.rolledDice.length === 0) {
    pending.status = "AWAITING_ROLL";
    pending.rollTotal = undefined;
    pending.success = undefined;
  }

  pending.message = pending.message ?? "Resolve the pending effect roll.";
}

function normalizeEventLog(match: MatchState): void {
  match.eventLog = asArray(match.eventLog);

  match.eventLog = match.eventLog.map((event, index) => ({
    ...event,
    id: event.id ?? `normalized-event-${index + 1}`,
    sequenceNumber: Number(event.sequenceNumber ?? index + 1),
    timestamp: event.timestamp ?? new Date().toISOString(),
    type: event.type ?? "NORMALIZED_EVENT"
  }));
}

export function normalizeMatch(match: MatchState): MatchState {
  match.status = match.status ?? "ACTIVE";
  match.rulesetIds = asArray<string>(match.rulesetIds);
  match.cardCatalog = match.cardCatalog ?? {};

  match.players = asArray<PlayerState>(match.players).map(normalizePlayer);
  match.chainZone = asArray<CardInstance>(match.chainZone).map(normalizeCardInstance);
  match.manualEffectQueue = asArray(match.manualEffectQueue);

  match.setup = {
    decksShuffled: Boolean(match.setup?.decksShuffled),
    firstTurnDrawsByPlayer: match.setup?.firstTurnDrawsByPlayer ?? {},
    primaryReplacementRequiredForPlayerId:
      match.setup?.primaryReplacementRequiredForPlayerId,
    handDiscardRequiredForPlayerId: match.setup?.handDiscardRequiredForPlayerId,
    deckValidation: match.setup?.deckValidation ?? {}
  };

  const fallbackActivePlayerId = match.players[0]?.id ?? "player_1";

  match.turn = {
    activePlayerId: match.turn?.activePlayerId ?? fallbackActivePlayerId,
    turnNumber: Number(match.turn?.turnNumber ?? 1),
    turnCycleNumber: Number(match.turn?.turnCycleNumber ?? 1),
    phase: match.turn?.phase ?? "DRAW",
    firstTurnCycleComplete: Boolean(match.turn?.firstTurnCycleComplete),
    currentTurnOrder:
      asArray<string>(match.turn?.currentTurnOrder).length > 0
        ? asArray<string>(match.turn?.currentTurnOrder)
        : match.players.map(player => player.id),
    currentTurnIndex: Number(match.turn?.currentTurnIndex ?? 0),
    turnStartCountsByPlayer: match.turn?.turnStartCountsByPlayer ?? {}
  };

  for (const player of match.players) {
    match.setup.firstTurnDrawsByPlayer[player.id] ??= false;
    match.turn.turnStartCountsByPlayer[player.id] ??= 0;
  }

  match.devTools = {
    rolls: {
      forcedRollQueue: asArray<DevForcedRoll>(match.devTools?.rolls?.forcedRollQueue).filter(item =>
        !!item &&
        typeof item.kind === "string" &&
        Array.isArray(item.dice)
      )
    }
  };

  match.settings = {
    cemeteryHpLimit:
      Number(match.settings?.cemeteryHpLimit) || DEFAULT_CEMETERY_HP_LIMIT,
    eliminationMode: match.settings?.eliminationMode ?? "called_out",
    tournamentMode: Boolean(match.settings?.tournamentMode),
    cannotInflictAttackDamageBattlePolicy: normalizeCannotInflictAttackDamageBattlePolicy(
      match.settings?.cannotInflictAttackDamageBattlePolicy
    )
  };

  normalizePendingChain(match);
  normalizePendingEffectTargetPrompt(match);
  normalizePendingBattle(match);
  normalizePendingEffectRoll(match);
  normalizeEventLog(match);
  normalizeAllActiveEffectInstances(match);

  return match;
}
