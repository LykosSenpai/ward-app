import type { AppMatchState } from "../clientTypes";
import type { BoardZoneKind, BoardZoneRef } from "@ward/shared";
import { buildBoardObjects } from "./boardPreview3dAdapter";
import type { BoardInteractionContext, BoardRenderCard, BoardRenderEvent, BoardRenderModel } from "./boardRenderContracts";
import type { BoardPlayerId } from "./boardPreview3dTypes";
import { getAdvanceBlockReason, getBattleBlockReason, getMatchStatus } from "../gameViewHelpers";

function resolveOwner(playerId: string): BoardPlayerId {
  return playerId === "player_1" ? "player_1" : "player_2";
}

type BoardRenderEventSemanticFields = Pick<
  BoardRenderEvent,
  | "type"
  | "playerId"
  | "cardInstanceId"
  | "sourceCardInstanceId"
  | "sourceCardId"
  | "sourceEffectId"
  | "actionType"
  | "reason"
  | "fromZoneRef"
  | "toZoneRef"
  | "promptId"
  | "targetCardInstanceId"
>;

function mapRawEventTypeFallback(rawType: string): BoardRenderEvent["type"] {
  if (rawType === "BATTLE_DAMAGE_APPLIED") return "BATTLE_DAMAGE_APPLIED";
  if (rawType.includes("BATTLE") && rawType.includes("START")) return "BATTLE_STARTED";
  if (rawType.includes("BATTLE") && (rawType.includes("RESOLVE") || rawType.includes("RESULT"))) return "BATTLE_RESOLVED";
  if (rawType.includes("PROMPT")) return "EFFECT_PROMPT_OPENED";
  if (rawType.includes("CHAIN") && rawType.includes("RESOLVE")) return "CHAIN_RESOLVED";
  if (rawType.includes("MOVE") || rawType.includes("DRAW") || rawType.includes("PLAY")) return "CARD_MOVED_ZONE";
  return "STATE_SYNCED";
}

function readPayload(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

function readString(data: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function readFirstString(data: Record<string, unknown>, ...keys: string[]): string | undefined {
  const direct = readString(data, ...keys);
  if (direct) return direct;

  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) {
      const first = value.find((item): item is string => typeof item === "string" && item.length > 0);
      if (first) return first;
    }
  }

  return undefined;
}

function normalizeZoneKind(value: unknown): BoardZoneKind | undefined {
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().toUpperCase();
  switch (normalized) {
    case "HAND":
    case "DECK":
    case "CEMETERY":
    case "PRIMARY_CREATURE":
    case "LIMITED_SUMMON":
    case "MAGIC_SLOT":
    case "CHAIN":
    case "BATTLE":
    case "PROMPT":
    case "REMOVED_FROM_GAME":
    case "ATTACHED_UNDER":
      return normalized;
    case "PRIMARY":
      return "PRIMARY_CREATURE";
    case "LIMITED":
      return "LIMITED_SUMMON";
    case "MAGIC":
      return "MAGIC_SLOT";
    default:
      return undefined;
  }
}

function buildZoneRef(playerId: string | undefined, zone: BoardZoneKind | undefined, slotIndex?: number): BoardZoneRef | undefined {
  if (!zone) return undefined;
  return {
    ...(playerId ? { playerId } : {}),
    zone,
    ...(slotIndex !== undefined ? { slotIndex } : {})
  };
}

function inferEventType(rawType: string, data: Record<string, unknown>): BoardRenderEvent["type"] | undefined {
  const actionType = readString(data, "actionType")?.toUpperCase();
  const normalizedRawType = rawType.toUpperCase();
  const combined = `${normalizedRawType} ${actionType ?? ""}`;

  if (combined.includes("PROMPT") && (combined.includes("RESOLVE") || combined.includes("COMPLETE") || combined.includes("DECLINED"))) {
    return "PROMPT_RESOLVED";
  }
  if (combined.includes("PROMPT") && (combined.includes("CREATED") || combined.includes("REQUESTED") || combined.includes("OPENED"))) {
    return "PROMPT_OPENED";
  }
  if (combined.includes("RETURN") && combined.includes("HAND")) return "CARD_RETURNED_TO_HAND";
  if (combined.includes("RETURN") && combined.includes("DECK")) return "CARD_RETURNED_TO_DECK";
  if (combined.includes("DISCARD")) return "CARD_DISCARDED";
  if (combined.includes("DESTROY") || combined.includes("KILLED")) return "CARD_DESTROYED";
  if (combined.includes("DRAW")) return "CARD_DRAWN";
  if (normalizedRawType.includes("PRIMARY_CREATURE_PLAYED") || combined.includes("PRIMARY_SUMMON")) return "CREATURE_SUMMONED_PRIMARY";
  if (combined.includes("LIMITED_SUMMON") && !combined.includes("PROMOTED")) return "CREATURE_SUMMONED_LIMITED";
  if (combined.includes("ATTACH") || combined.includes("EQUIP_MAGIC_ATTACHED")) return "MAGIC_ATTACHED";
  if (combined.includes("MOVE") || combined.includes("PLAY")) return "CARD_MOVED";

  return undefined;
}

function inferCardInstanceId(type: BoardRenderEvent["type"], data: Record<string, unknown>): string | undefined {
  if (type === "CARD_DRAWN") return readFirstString(data, "cardInstanceId", "drawnCardInstanceIds");
  if (type === "CARD_DESTROYED") return readFirstString(data, "destroyedCardInstanceId", "cardInstanceId", "targetCardInstanceId");
  if (type === "CARD_DISCARDED" || type === "CARD_RETURNED_TO_DECK" || type === "CARD_RETURNED_TO_HAND") {
    return readFirstString(data, "selectedCardInstanceId", "cardInstanceId", "targetCardInstanceId");
  }
  if (type === "CREATURE_SUMMONED_PRIMARY" || type === "CREATURE_SUMMONED_LIMITED") {
    return readFirstString(data, "summonedCardInstanceId", "cardInstanceId", "targetCardInstanceId");
  }
  if (type === "MAGIC_ATTACHED") return readFirstString(data, "magicCardInstanceId", "equippedMagicCardInstanceId", "cardInstanceId");
  return readFirstString(data, "cardInstanceId", "sourceCardInstanceId", "targetCardInstanceId");
}

function inferFromZoneRef(type: BoardRenderEvent["type"], playerId: string | undefined, data: Record<string, unknown>): BoardZoneRef | undefined {
  const sourcePlayerId = readString(data, "sourcePlayerId", "fieldOwnerPlayerId", "playerId") ?? playerId;
  const sourceZone = normalizeZoneKind(readString(data, "sourceZone", "fromZone"));

  if (sourceZone) return buildZoneRef(sourcePlayerId, sourceZone);
  if (type === "CARD_DRAWN") return buildZoneRef(playerId, "DECK");
  if (type === "CARD_DISCARDED") return buildZoneRef(sourcePlayerId, "HAND");
  if (type === "CARD_DESTROYED") return buildZoneRef(sourcePlayerId, "MAGIC_SLOT");
  if (type === "CARD_RETURNED_TO_DECK" || type === "CARD_RETURNED_TO_HAND") return undefined;
  if (type === "CREATURE_SUMMONED_PRIMARY" || type === "CREATURE_SUMMONED_LIMITED") return buildZoneRef(sourcePlayerId, "HAND");
  if (type === "MAGIC_ATTACHED") return buildZoneRef(sourcePlayerId, "MAGIC_SLOT");
  return undefined;
}

function inferToZoneRef(type: BoardRenderEvent["type"], playerId: string | undefined, data: Record<string, unknown>): BoardZoneRef | undefined {
  const destinationPlayerId = readString(data, "destinationPlayerId", "cardOwnerPlayerId", "controllerPlayerId", "targetPlayerId", "playerId") ?? playerId;
  const destinationZone = normalizeZoneKind(readString(data, "destinationZone", "toZone"));

  if (destinationZone) return buildZoneRef(destinationPlayerId, destinationZone);
  if (type === "CARD_DRAWN") return buildZoneRef(playerId, "HAND");
  if (type === "CARD_DISCARDED" || type === "CARD_DESTROYED") return buildZoneRef(destinationPlayerId, "CEMETERY");
  if (type === "CARD_RETURNED_TO_HAND") return buildZoneRef(destinationPlayerId, "HAND");
  if (type === "CARD_RETURNED_TO_DECK") return buildZoneRef(destinationPlayerId, "DECK");
  if (type === "CREATURE_SUMMONED_PRIMARY") return buildZoneRef(destinationPlayerId, "PRIMARY_CREATURE");
  if (type === "CREATURE_SUMMONED_LIMITED") return buildZoneRef(destinationPlayerId, "LIMITED_SUMMON");
  if (type === "MAGIC_ATTACHED") return buildZoneRef(destinationPlayerId, "ATTACHED_UNDER");
  return undefined;
}

function mapEventToSemanticFields(
  event: AppMatchState["eventLog"][number]
): BoardRenderEventSemanticFields {
  const data = readPayload(event.payload);
  const fallbackType = mapRawEventTypeFallback(event.type);
  const type = inferEventType(event.type, data) ?? fallbackType;
  const playerId = readString(data, "playerId", "controllerPlayerId") ?? event.playerId;
  const sourceEffectId = readString(data, "sourceEffectId", "effectId");
  const cardInstanceId = inferCardInstanceId(type, data);

  return {
    type,
    playerId,
    cardInstanceId,
    sourceCardInstanceId: readString(data, "sourceCardInstanceId"),
    sourceCardId: readString(data, "sourceCardId"),
    sourceEffectId,
    actionType: readString(data, "actionType"),
    reason: readString(data, "reason", "note"),
    fromZoneRef: inferFromZoneRef(type, playerId, data),
    toZoneRef: inferToZoneRef(type, playerId, data),
    promptId: readString(data, "promptId"),
    targetCardInstanceId: readString(data, "targetCardInstanceId", "targetCreatureInstanceId", "destroyedCardInstanceId", "attachedToInstanceId")
  };
}

function extractVisualTargets(payload: unknown): BoardRenderEvent["visualTargets"] {
  if (!payload || typeof payload !== "object") {
    return { slotIds: [], cardInstanceIds: [] };
  }
  const data = payload as Record<string, unknown>;
  const slotKeys = ["slotId", "sourceSlotId", "targetSlotId", "fromSlotId", "toSlotId"];
  const slotArrayKeys = ["slotIds", "sourceSlotIds", "targetSlotIds", "fromSlotIds", "toSlotIds"];
  const instanceKeys = ["cardInstanceId", "sourceCardInstanceId", "targetCardInstanceId", "attackerCreatureInstanceId", "defenderCreatureInstanceId", "targetCreatureInstanceId"];
  const instanceArrayKeys = ["cardInstanceIds", "sourceCardInstanceIds", "targetCardInstanceIds", "drawnCardInstanceIds"];
  const slotIds = slotKeys
    .map(key => data[key])
    .filter((value): value is string => typeof value === "string")
    .concat(slotArrayKeys.flatMap(key => Array.isArray(data[key]) ? data[key].filter((value): value is string => typeof value === "string") : []));
  const cardInstanceIds = instanceKeys
    .map(key => data[key])
    .filter((value): value is string => typeof value === "string")
    .concat(instanceArrayKeys.flatMap(key => Array.isArray(data[key]) ? data[key].filter((value): value is string => typeof value === "string") : []));
  return {
    slotIds: [...new Set(slotIds)],
    cardInstanceIds: [...new Set(cardInstanceIds)]
  };
}

function buildRenderCards(match: AppMatchState): BoardRenderCard[] {
  return match.players.flatMap(player => {
    const owner = resolveOwner(player.id);
    const primary = player.field.primaryCreature
      ? [{
        cardInstanceId: player.field.primaryCreature.instanceId,
        cardId: player.field.primaryCreature.cardId,
        owner,
        controller: owner,
        anchor: { zone: "PRIMARY" as const, slotId: `${owner}-primary`, owner }
      }]
      : [];

    const limited = player.field.limitedSummons.map((card, index) => ({
      cardInstanceId: card.instanceId,
      cardId: card.cardId,
      owner,
      controller: owner,
      anchor: { zone: "LIMITED" as const, slotId: `${owner}-limited-${index + 1}`, owner }
    }));

    const magic = player.field.magicSlots
      .filter((card): card is NonNullable<typeof card> => Boolean(card))
      .map((card, index) => ({
        cardInstanceId: card.instanceId,
        cardId: card.cardId,
        owner,
        controller: owner,
        anchor: { zone: "MAGIC" as const, slotId: `${owner}-magic-${index + 1}`, owner }
      }));

    return [...primary, ...limited, ...magic];
  });
}

type BuildBoardRenderModelOptions = {
  revealHandsForPlayerId?: BoardPlayerId | "all" | null;
};

export function buildBoardRenderModel(match: AppMatchState, options: BuildBoardRenderModelOptions = {}): BoardRenderModel {
  const lastEvent = match.eventLog.at(-1);
  return {
    matchId: match.matchId,
    sequenceNumber: lastEvent?.sequenceNumber ?? 0,
    activePlayerId: match.turn.activePlayerId,
    phase: match.turn.phase,
    cards: buildRenderCards(match),
    boardObjects: buildBoardObjects(match, { revealHandsForPlayerId: options.revealHandsForPlayerId }),
    pending: {
      battle: Boolean(match.pendingBattle),
      chain: Boolean(match.pendingChain),
      prompt: Boolean(match.pendingPrompt || match.pendingEffectTargetPrompt),
      manualEffects: match.manualEffectQueue.filter(effect => !effect.completed).length
    }
  };
}

export function translateGameEventsToBoardRenderEvents(
  match: AppMatchState,
  options: { afterSequenceNumber?: number; limit?: number } = {}
): BoardRenderEvent[] {
  const afterSequenceNumber = options.afterSequenceNumber ?? -1;
  const limit = options.limit ?? 24;
  const sourceEvents = match.eventLog
    .filter(event => event.sequenceNumber > afterSequenceNumber)
    .slice(-limit);

  return sourceEvents.map((event, index) => {
    const semanticFields = mapEventToSemanticFields(event);

    return {
      eventId: `${match.matchId}:${event.sequenceNumber}:${event.type}:${index}`,
      sequenceNumber: event.sequenceNumber,
      matchId: match.matchId,
      rawType: event.type,
      payload: event.payload,
      visualTargets: extractVisualTargets(event.payload),
      ...semanticFields
    };
  });
}

export function buildBoardInteractionContext(match: AppMatchState): BoardInteractionContext {
  const activePlayer = match.players.find(player => player.id === match.turn.activePlayerId);
  const matchComplete = getMatchStatus(match) === "COMPLETE";
  const advanceBlockReason = getAdvanceBlockReason(match);
  const battleBlockReason = getBattleBlockReason(match);
  const blocked = matchComplete || Boolean(match.pendingPrompt || match.pendingChain || match.pendingEffectTargetPrompt);
  const playerId = match.turn.activePlayerId;
  const hasPendingManualEffects = match.manualEffectQueue.some(effect => !effect.completed);
  return {
    activePlayerId: playerId,
    phase: match.turn.phase,
    blocked,
    actions: [
      {
        actionId: `${playerId}:draw`,
        kind: "DRAW",
        playerId,
        enabled: !blocked && !activePlayer?.turnFlags.drawnThisTurn && !match.setup.handDiscardRequiredForPlayerId,
        reason: blocked ? "input blocked by pending state" : undefined
      },
      {
        actionId: `${playerId}:advance`,
        kind: "ADVANCE_PHASE",
        playerId,
        enabled: !matchComplete && !advanceBlockReason,
        reason: advanceBlockReason || undefined
      },
      {
        actionId: `${playerId}:battle`,
        kind: "DECLARE_BATTLE",
        playerId,
        enabled: !matchComplete && !battleBlockReason,
        reason: battleBlockReason || undefined
      },
      {
        actionId: `${playerId}:manual`,
        kind: "OPEN_MANUAL_EFFECTS",
        playerId,
        enabled: hasPendingManualEffects,
        reason: hasPendingManualEffects ? undefined : "no pending manual effects"
      }
    ]
  };
}
