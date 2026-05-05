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
  "APPLY_BATTLE_LOCK",
  "APPLY_TEMPORARY_HIT_OVERRIDE",
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

function controllerScopePlayers(state: MatchState, controllerPlayerId: string, text: string): PlayerState[] {
  if (text.includes("all player") || text.includes("each player") || text.includes("both player")) {
    return state.players;
  }
  if (text.includes("opponent")) {
    return state.players.filter(player => player.id !== controllerPlayerId);
  }
  return [getPlayer(state, controllerPlayerId)];
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

  if (actionType === "ADJUST_CEMETERY_HP" || actionType === "ADD_CEMETERY_HP_ADJUSTMENT") {
    const amount = firstPositiveInteger(text) ?? 0;
    if (amount <= 0) return false;
    const sign = text.includes("reduce") || text.includes("lower") || text.includes("-") ? -1 : 1;
    const players = controllerScopePlayers(state, controllerPlayerId, text);
    for (const player of players) {
      const mutable = player as PlayerState & { cemeteryHpAdjustment?: number };
      mutable.cemeteryHpAdjustment = Number(mutable.cemeteryHpAdjustment ?? 0) + sign * amount;
      player.cemeteryCreatureHpTotal = player.cemeteryCreatureHpTotal + sign * amount;
    }
    addEvent(state, "AUTO_EFFECT_CEMETERY_HP_ADJUSTED", controllerPlayerId, {
      sourceCardName,
      sourceCardInstanceId: args.sourceCardInstanceId,
      effectId: effect.id,
      actionType: effect.actionType,
      amount: sign * amount,
      affectedPlayerIds: players.map(player => player.id),
      note: "Cemetery HP adjustments can go below 0."
    });
    return true;
  }

  if (actionType === "APPLY_SKIP_TURN") {
    const players = controllerScopePlayers(state, controllerPlayerId, text.includes("opponent") ? "opponent" : text);
    for (const player of players) {
      const mutable = player as PlayerState & { skipNextTurnCount?: number };
      mutable.skipNextTurnCount = Number(mutable.skipNextTurnCount ?? 0) + 1;
    }
    addEvent(state, "AUTO_EFFECT_SKIP_TURN_FLAG_APPLIED", controllerPlayerId, {
      sourceCardName,
      sourceCardInstanceId: args.sourceCardInstanceId,
      effectId: effect.id,
      actionType: effect.actionType,
      affectedPlayerIds: players.map(player => player.id),
      note: "The turn engine checks this flag at turn start in the handler foundation patch."
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
