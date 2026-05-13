import { v4 as uuidv4 } from "uuid";
import type {
  ActiveEffectInstance,
  CardInstance,
  MatchState,
  PlayerState,
  WardEngineEffect
} from "@ward/shared";
import { getRuntimeBlockActionType, getRuntimeBlockDurationText, getRuntimeBlockText } from "./effectBlockRuntime.js";

type FringeAddEventFn = (
  state: MatchState,
  type: string,
  playerId?: string,
  payload?: unknown
) => void;

const FRINGE_AUTOMATIC_ACTIONS = new Set([
  "SHUFFLE_DECK",
  "ADJUST_CEMETERY_HP",
  "ADD_CEMETERY_HP_ADJUSTMENT",
  "MODIFY_CEMETERY_HP",
  "PLAYER_TARGET_EFFECT",
  "APPLY_BATTLE_LOCK",
  "APPLY_TEMPORARY_HIT_OVERRIDE",
  "ADD_NEXT_ATTACK_SHIELD",
  "APPLY_GLOBAL_CREATURE_EFFECT_NEGATION",
  "APPLY_SCOPED_CREATURE_EFFECT_NEGATION",
  "APPLY_ZONE_RESTRICTION",
  "APPLY_ZONE_RETURN_RESTRICTION",
  "APPLY_ZONE_LOCK",
  "APPLY_MAGIC_IMMUNITY",
  "APPLY_EFFECT_IMMUNITY",
  "APPLY_IMMUNITY",
  "APPLY_DAMAGE_TYPE_IMMUNITY",
  "APPLY_NEGATION_WINDOW_RESTRICTION",
  "APPLY_PERMANENT_CREATURE_FLAG",
  "APPLY_SKIP_TURN",
  "RESET_CURRENT_TURN",
  "DESTROY_SELF",
  "SET_TEMPORARY_CARD_BEHAVIOR",
  "SET_CARD_TYPE"
]);

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function getPlayer(state: MatchState, playerId: string): PlayerState {
  const player = state.players.find(item => item.id === playerId);
  if (!player) throw new Error(`Player not found: ${playerId}`);
  return player;
}

function getCardName(state: MatchState, card: CardInstance): string {
  return state.cardCatalog[card.cardId]?.name ?? card.cardId;
}

function firstPositiveInteger(text: string): number | undefined {
  const match = text.match(/(\d+)/);
  const value = Number(match?.[1]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;
}

function getEffectAmount(effect: WardEngineEffect, text: string): number | undefined {
  const rawAmount = effect.params?.amount ?? effect.params?.value ?? effect.value;
  const numeric = Number(rawAmount);
  if (Number.isFinite(numeric) && numeric !== 0) {
    return Math.trunc(numeric);
  }

  return firstPositiveInteger(text);
}

function controllerScopePlayers(state: MatchState, controllerPlayerId: string, text: string): PlayerState[] {
  if (text.includes("all player") || text.includes("each player") || text.includes("both player")) {
    return state.players;
  }
  if (text.includes("opponent")) {
    return state.players.filter(player => player.id !== controllerPlayerId);
  }
  return [getPlayer(state, controllerPlayerId)];
}

function playerLockId(effect: WardEngineEffect, playerId: string, actionType: string): string {
  return `${actionType}:${effect.id}:${playerId}`;
}

function applyPlayerLock(
  state: MatchState,
  player: PlayerState,
  args: {
    effect: WardEngineEffect;
    controllerPlayerId: string;
    sourceCardName: string;
    sourceCardInstanceId?: string;
    actionType: string;
    label: string;
    remainingTurns?: number;
  }
): string {
  const id = playerLockId(args.effect, player.id, args.actionType);
  player.playerLocks = (player.playerLocks ?? []).filter(lock => lock.id !== id);
  player.playerLocks.push({
    id,
    kind: args.actionType === "APPLY_SKIP_TURN" ? "SKIP_TURN" : "ACTION_LOCK",
    label: args.label,
    reason: args.label,
    sourceEffectId: args.effect.id,
    sourceCardInstanceId: args.sourceCardInstanceId,
    sourceCardName: args.sourceCardName,
    sourcePlayerId: args.controllerPlayerId,
    remainingTurns: args.remainingTurns,
    appliedTurnNumber: state.turn.turnNumber,
    appliedTurnCycle: state.turn.turnCycleNumber
  });
  return id;
}

function shuffleInPlace<T>(items: T[]): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
}

function findSourceCard(state: MatchState, sourceCardInstanceId?: string): { player: PlayerState; card: CardInstance } | undefined {
  if (!sourceCardInstanceId) return undefined;
  for (const player of state.players) {
    const zones = [
      player.hand,
      player.deck,
      player.cemetery,
      player.removedFromGame,
      player.field.magicSlots,
      player.field.limitedSummons,
      player.field.primaryCreature ? [player.field.primaryCreature] : []
    ];
    for (const zone of zones) {
      const card = zone.find(item => item.instanceId === sourceCardInstanceId);
      if (card) return { player, card };
    }
  }
  return undefined;
}

function attachSourceInstanceMarker(
  state: MatchState,
  args: {
    effect: WardEngineEffect;
    controllerPlayerId: string;
    sourceCardName: string;
    sourceCardInstanceId?: string;
    label: string;
    kind?: ActiveEffectInstance["kind"];
    addEvent: FringeAddEventFn;
  }
): boolean {
  const source = findSourceCard(state, args.sourceCardInstanceId);
  if (!source) return false;

  source.card.activeEffectInstances ??= [];
  source.card.activeEffectInstances = source.card.activeEffectInstances.filter(instance => !(
    instance.sourceCardInstanceId === args.sourceCardInstanceId &&
    instance.sourceEffectId === args.effect.id &&
    instance.actionType === getRuntimeBlockActionType(args.effect)
  ));

  const actionType = getRuntimeBlockActionType(args.effect).trim().toUpperCase();
  const durationText = getRuntimeBlockDurationText(args.effect) ?? args.effect.duration?.text ?? args.effect.params?.duration?.text;
  const activeInstance: ActiveEffectInstance = {
    id: uuidv4(),
    kind: args.kind ?? "OTHER",
    sourceEffectId: args.effect.id,
    sourceCardInstanceId: args.sourceCardInstanceId ?? `${args.effect.id}:source`,
    sourceCardName: args.sourceCardName,
    sourcePlayerId: args.controllerPlayerId,
    targetPlayerId: source.player.id,
    targetCardInstanceId: source.card.instanceId,
    targetCardName: getCardName(state, source.card),
    actionType,
    label: args.label,
    durationType: args.effect.duration?.type ?? args.effect.params?.duration?.type ?? "STATIC_RULE",
    durationText,
    appliedTurnNumber: state.turn.turnNumber,
    appliedTurnCycle: state.turn.turnCycleNumber,
    debug: [
      "Fringe handler marker created by the block runtime bridge.",
      "This marker allows the UI/runtime scanners to see that the effect has a reusable handler route."
    ]
  };

  source.card.activeEffectInstances.push(activeInstance);
  args.addEvent(state, "FRINGE_EFFECT_MARKER_APPLIED", args.controllerPlayerId, {
    sourceCardName: args.sourceCardName,
    sourceCardInstanceId: args.sourceCardInstanceId,
    effectId: args.effect.id,
    actionType,
    label: args.label,
    durationText
  });

  return true;
}

export function isFringeAutomaticMagicEffectSupported(effect: WardEngineEffect): boolean {
  return FRINGE_AUTOMATIC_ACTIONS.has(normalize(getRuntimeBlockActionType(effect)));
}

export function tryResolveFringeAutomaticMagicEffect(
  state: MatchState,
  args: {
    effect: WardEngineEffect;
    controllerPlayerId: string;
    sourceCardName: string;
    sourceCardInstanceId?: string;
    addEvent: FringeAddEventFn;
  }
): boolean {
  const { effect, controllerPlayerId, sourceCardName, addEvent } = args;
  const actionType = normalize(getRuntimeBlockActionType(effect));
  const text = getRuntimeBlockText(effect).toLowerCase();

  if (actionType === "SHUFFLE_DECK") {
    const players = controllerScopePlayers(state, controllerPlayerId, text);
    const results = players.map(player => {
      shuffleInPlace(player.deck);
      return { playerId: player.id, playerName: player.displayName, deckSize: player.deck.length };
    });
    addEvent(state, "AUTO_EFFECT_SHUFFLE_DECK_RESOLVED", controllerPlayerId, {
      sourceCardName,
      sourceCardInstanceId: args.sourceCardInstanceId,
      effectId: effect.id,
      actionType: effect.actionType,
      results,
      note: "Opponent cut is not modeled in the local test app yet."
    });
    return true;
  }

  if (actionType === "ADJUST_CEMETERY_HP" || actionType === "ADD_CEMETERY_HP_ADJUSTMENT" || actionType === "MODIFY_CEMETERY_HP") {
    const parsedAmount = getEffectAmount(effect, text) ?? 0;
    if (parsedAmount === 0) return false;
    const sign = parsedAmount < 0 || text.includes("reduce") || text.includes("lower") || text.includes("-") ? -1 : 1;
    const amount = Math.abs(parsedAmount) * sign;
    const players = controllerScopePlayers(state, controllerPlayerId, text);
    const results: Array<{
      playerId: string;
      playerName: string;
      previousAdjustment: number;
      cemeteryHpAdjustment: number;
      previousCemeteryHpTotal: number;
      cemeteryCreatureHpTotal: number;
    }> = [];
    for (const player of players) {
      const previousAdjustment = Number(player.cemeteryHpAdjustment ?? 0);
      const previousTotal = Number(player.cemeteryCreatureHpTotal ?? 0);
      player.cemeteryHpAdjustment = previousAdjustment + amount;
      player.cemeteryCreatureHpTotal = player.cemeteryCreatureHpTotal + amount;
      results.push({
        playerId: player.id,
        playerName: player.displayName,
        previousAdjustment,
        cemeteryHpAdjustment: player.cemeteryHpAdjustment,
        previousCemeteryHpTotal: previousTotal,
        cemeteryCreatureHpTotal: player.cemeteryCreatureHpTotal
      });
    }
    addEvent(state, "AUTO_EFFECT_CEMETERY_HP_ADJUSTED", controllerPlayerId, {
      sourceCardName,
      sourceCardInstanceId: args.sourceCardInstanceId,
      effectId: effect.id,
      actionType: effect.actionType,
      amount,
      affectedPlayerIds: players.map(player => player.id),
      results,
      boardEvents: players.flatMap(player => [
        {
          type: "CEMETERY_HP_CHANGED",
          playerId: player.id,
          sourceCardInstanceId: args.sourceCardInstanceId,
          sourceEffectId: effect.id,
          actionType: effect.actionType,
          reason: "CEMETERY_HP_ADJUSTMENT",
          amount,
          playerStat: "cemeteryCreatureHpTotal",
          previousValue: results.find(result => result.playerId === player.id)?.previousCemeteryHpTotal,
          newValue: player.cemeteryCreatureHpTotal
        },
        {
          type: "PLAYER_STAT_CHANGED",
          playerId: player.id,
          sourceCardInstanceId: args.sourceCardInstanceId,
          sourceEffectId: effect.id,
          actionType: effect.actionType,
          reason: "CEMETERY_HP_ADJUSTMENT",
          amount,
          playerStat: "cemeteryHpAdjustment",
          previousValue: results.find(result => result.playerId === player.id)?.previousAdjustment,
          newValue: player.cemeteryHpAdjustment
        }
      ]),
      note: "Cemetery HP adjustments can go below 0."
    });
    return true;
  }

  if (actionType === "APPLY_SKIP_TURN") {
    const players = controllerScopePlayers(state, controllerPlayerId, text.includes("opponent") ? "opponent" : text);
    const affected = [];
    for (const player of players) {
      const previousSkipCount = Number(player.skipNextTurnCount ?? 0);
      player.skipNextTurnCount = previousSkipCount + 1;
      const lockId = applyPlayerLock(state, player, {
        effect,
        controllerPlayerId,
        sourceCardName,
        sourceCardInstanceId: args.sourceCardInstanceId,
        actionType,
        label: effect.value ?? effect.actionText ?? "Skip next turn",
        remainingTurns: player.skipNextTurnCount
      });
      affected.push({ playerId: player.id, previousSkipCount, skipNextTurnCount: player.skipNextTurnCount, lockId });
    }
    addEvent(state, "AUTO_EFFECT_SKIP_TURN_FLAG_APPLIED", controllerPlayerId, {
      sourceCardName,
      sourceCardInstanceId: args.sourceCardInstanceId,
      effectId: effect.id,
      actionType: effect.actionType,
      affectedPlayerIds: players.map(player => player.id),
      affected,
      boardEvents: affected.map(item => ({
        type: "PLAYER_LOCK_APPLIED",
        playerId: item.playerId,
        sourceCardInstanceId: args.sourceCardInstanceId,
        sourceEffectId: effect.id,
        actionType: effect.actionType,
        reason: "SKIP_TURN",
        status: "SKIP_TURN",
        statusLabel: "Skip next turn",
        lockId: item.lockId
      })),
      note: "The turn engine checks this flag at turn start in the handler foundation patch."
    });
    return true;
  }

  if (actionType === "RESET_CURRENT_TURN") {
    const activePlayer = getPlayer(state, state.turn.activePlayerId);
    addEvent(state, "AUTO_EFFECT_RESET_CURRENT_TURN_REQUIRES_MANUAL_SNAPSHOT", controllerPlayerId, {
      sourceCardName,
      sourceCardInstanceId: args.sourceCardInstanceId,
      effectId: effect.id,
      actionType: effect.actionType,
      targetPlayerId: activePlayer.id,
      reason: "TURN_RESET_REQUIRES_SNAPSHOT",
      boardEvents: [
        {
          type: "PLAYER_STAT_CHANGED",
          playerId: activePlayer.id,
          sourceCardInstanceId: args.sourceCardInstanceId,
          sourceEffectId: effect.id,
          actionType: effect.actionType,
          reason: "TURN_RESET_REQUIRES_SNAPSHOT",
          playerStat: "turnResetRequested"
        }
      ],
      note: "Resetting all events in the current turn requires a turn snapshot and remains manual."
    });
    return true;
  }

  if (actionType === "PLAYER_TARGET_EFFECT") {
    const players = controllerScopePlayers(state, controllerPlayerId, text);
    addEvent(state, "AUTO_EFFECT_PLAYER_TARGET_RESOLVED", controllerPlayerId, {
      sourceCardName,
      sourceCardInstanceId: args.sourceCardInstanceId,
      effectId: effect.id,
      actionType: effect.actionType,
      affectedPlayerIds: players.map(player => player.id),
      boardEvents: players.map(player => ({
        type: "PLAYER_STAT_CHANGED",
        playerId: player.id,
        sourceCardInstanceId: args.sourceCardInstanceId,
        sourceEffectId: effect.id,
        actionType: effect.actionType,
        reason: "PLAYER_TARGET_EFFECT",
        playerStat: "playerTarget"
      })),
      note: "Generic player-target effect resolved as a player-side board event; specific stat changes should use dedicated action types."
    });
    return true;
  }

  if (actionType === "ADD_NEXT_ATTACK_SHIELD") {
    const source = findSourceCard(state, args.sourceCardInstanceId);
    if (!source) return false;

    source.card.activeStatuses ??= [];
    source.card.activeStatuses = source.card.activeStatuses.filter(status => !(
      status.sourceCardInstanceId === args.sourceCardInstanceId &&
      status.sourceEffectId === effect.id
    ));

    source.card.activeStatuses.push({
      id: uuidv4(),
      sourceEffectId: effect.id,
      sourceCardInstanceId: args.sourceCardInstanceId ?? `${effect.id}:source`,
      sourceCardName,
      sourcePlayerId: controllerPlayerId,
      status: "NEXT_ATTACK_SHIELD",
      label: effect.value ?? effect.actionText ?? "Next attack negated",
      flags: { canReceiveDamage: false },
      durationType: "PERMANENT_UNTIL_SOURCE_REMOVED",
      appliedTurnNumber: state.turn.turnNumber,
      appliedTurnCycle: state.turn.turnCycleNumber
    });

    addEvent(state, "AUTO_EFFECT_NEXT_ATTACK_SHIELD_APPLIED", controllerPlayerId, {
      sourceCardName,
      sourceCardInstanceId: args.sourceCardInstanceId,
      effectId: effect.id,
      actionType: effect.actionType,
      targetCreatureInstanceId: source.card.instanceId,
      targetCreatureName: getCardName(state, source.card),
      note: "The shield is represented as a damage-prevention status for the next incoming attack."
    });
    return true;
  }

  if (actionType === "DESTROY_SELF") {
    return attachSourceInstanceMarker(state, {
      ...args,
      label: "Destroy this card when its trigger condition resolves.",
      kind: "SOURCE_LINK"
    });
  }

  if (
    actionType === "APPLY_BATTLE_LOCK" ||
    actionType === "APPLY_TEMPORARY_HIT_OVERRIDE" ||
    actionType === "APPLY_GLOBAL_CREATURE_EFFECT_NEGATION" ||
    actionType === "APPLY_SCOPED_CREATURE_EFFECT_NEGATION" ||
    actionType === "APPLY_ZONE_RESTRICTION" ||
    actionType === "APPLY_ZONE_RETURN_RESTRICTION" ||
    actionType === "APPLY_ZONE_LOCK" ||
    actionType === "APPLY_MAGIC_IMMUNITY" ||
    actionType === "APPLY_EFFECT_IMMUNITY" ||
    actionType === "APPLY_IMMUNITY" ||
    actionType === "APPLY_DAMAGE_TYPE_IMMUNITY" ||
    actionType === "APPLY_NEGATION_WINDOW_RESTRICTION" ||
    actionType === "APPLY_PERMANENT_CREATURE_FLAG" ||
    actionType === "SET_TEMPORARY_CARD_BEHAVIOR" ||
    actionType === "SET_CARD_TYPE"
  ) {
    return attachSourceInstanceMarker(state, {
      ...args,
      label: effect.value ?? effect.actionText ?? actionType,
      kind: actionType.includes("IMMUNITY") || actionType.includes("RESTRICTION") || actionType.includes("LOCK") ? "STATIC_MODIFIER" : "OTHER"
    });
  }

  return false;
}
