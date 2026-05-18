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
  | "phase"
  | "turnNumber"
  | "turnCycleNumber"
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

function readNumber(data: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
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

function readZoneRef(value: unknown): BoardZoneRef | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const data = value as Record<string, unknown>;
  const zone = normalizeZoneKind(data.zone);
  if (!zone) return undefined;
  const playerId = typeof data.playerId === "string" ? data.playerId : undefined;
  const slotIndex = typeof data.slotIndex === "number" && Number.isFinite(data.slotIndex)
    ? data.slotIndex
    : undefined;
  return buildZoneRef(playerId, zone, slotIndex);
}

function normalizeBoardRenderEventType(value: unknown): BoardRenderEvent["type"] | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  switch (normalized) {
    case "CARD_MOVED":
    case "CARD_DRAWN":
    case "CARD_DISCARDED":
    case "CARD_DESTROYED":
    case "CARD_RETURNED_TO_HAND":
    case "CARD_RETURNED_TO_DECK":
    case "CARD_SENT_TO_CEMETERY":
    case "CREATURE_SUMMONED_PRIMARY":
    case "CREATURE_SUMMONED_LIMITED":
    case "MAGIC_PLAYED_TO_CHAIN":
    case "MAGIC_RESOLVED":
    case "MAGIC_NEGATED":
    case "MAGIC_ATTACHED":
    case "ANCHOR_LINK_CREATED":
    case "SOURCE_LINK_CLEANUP_TRIGGERED":
    case "CARD_DAMAGED":
    case "CARD_HEALED":
    case "CARD_REVEALED":
    case "HAND_REVEALED":
    case "STATUS_APPLIED":
    case "STATUS_REMOVED":
    case "RECURRING_EFFECT_TICKED":
    case "SCHEDULED_EFFECT_RESOLVED":
    case "STAT_MODIFIER_APPLIED":
    case "STAT_MODIFIER_REMOVED":
    case "PLAYER_STAT_CHANGED":
    case "CEMETERY_HP_CHANGED":
    case "DICE_ROLLED":
    case "PLAYER_LOCK_APPLIED":
    case "PLAYER_LOCK_REMOVED":
    case "TURN_SKIPPED":
    case "PROMPT_OPENED":
    case "PROMPT_RESOLVED":
    case "CHAIN_LINK_ADDED":
    case "CHAIN_PRIORITY_PASSED":
    case "CHAIN_LINK_NEGATED":
    case "CHAIN_LINK_RESOLVED":
    case "MAGIC_STOLEN":
    case "STOLEN_MAGIC_PLAYED":
    case "STOLEN_MAGIC_SENT_TO_CEMETERY":
    case "TURN_STARTED":
    case "TURN_PHASE_CHANGED":
    case "CARD_MOVED_ZONE":
    case "BATTLE_STARTED":
    case "BATTLE_STRIKE_STARTED":
    case "BATTLE_HIT_ROLLED":
    case "BATTLE_DAMAGE_ROLLED":
    case "BATTLE_DAMAGE_PREVENTED":
    case "BATTLE_DAMAGE_APPLIED":
    case "BATTLE_RESOLVED":
    case "EFFECT_PROMPT_OPENED":
    case "CHAIN_RESOLVED":
    case "STATE_SYNCED":
      return normalized;
    default:
      return undefined;
  }
}

function inferEventType(rawType: string, data: Record<string, unknown>): BoardRenderEvent["type"] | undefined {
  const explicitType = normalizeBoardRenderEventType(data.type);
  if (explicitType) return explicitType;

  const actionType = readString(data, "actionType")?.toUpperCase();
  const normalizedRawType = rawType.toUpperCase();
  const combined = `${normalizedRawType} ${actionType ?? ""}`;

  if (normalizedRawType === "BATTLE_DAMAGE_APPLIED") return "BATTLE_DAMAGE_APPLIED";
  if (normalizedRawType === "BATTLE_DAMAGE_PREVENTED") return "BATTLE_DAMAGE_PREVENTED";
  if (normalizedRawType === "BATTLE_DAMAGE_ROLLED" || normalizedRawType === "BATTLE_DAMAGE_PIPELINE_RESOLVED") return "BATTLE_DAMAGE_ROLLED";
  if (normalizedRawType === "BATTLE_HIT_ROLLED") return "BATTLE_HIT_ROLLED";
  if (normalizedRawType === "BATTLE_STRIKE_STARTED") return "BATTLE_STRIKE_STARTED";
  if (normalizedRawType === "MANUAL_BATTLE_DECLARED") return "BATTLE_STARTED";
  if (normalizedRawType === "MANUAL_BATTLE_RESOLVED") return "BATTLE_RESOLVED";
  if (combined.includes("SOURCE_LINK_CLEANUP_TRIGGERED") || combined.includes("SOURCE_LINKED_SUMMONS_RETURNED")) return "SOURCE_LINK_CLEANUP_TRIGGERED";
  if (normalizedRawType === "TURN_STARTED") return "TURN_STARTED";
  if (normalizedRawType === "TURN_PHASE_CHANGED") return "TURN_PHASE_CHANGED";
  if (normalizedRawType === "TURN_SKIPPED" || combined.includes("TURN_SKIPPED")) return "TURN_SKIPPED";
  if (combined.includes("CEMETERY_HP_CHANGED") || combined.includes("CEMETERY_HP_ADJUST")) return "CEMETERY_HP_CHANGED";
  if (combined.includes("PLAYER_STAT_CHANGED")) return "PLAYER_STAT_CHANGED";
  if (combined.includes("DICE_ROLLED")) return "DICE_ROLLED";
  if (combined.includes("PLAYER_LOCK_APPLIED") || combined.includes("SKIP_TURN_FLAG_APPLIED")) return "PLAYER_LOCK_APPLIED";
  if (combined.includes("PLAYER_LOCK_REMOVED")) return "PLAYER_LOCK_REMOVED";
  if (combined.includes("RECURRING_EFFECT_TICKED")) return "RECURRING_EFFECT_TICKED";
  if (combined.includes("SCHEDULED_EFFECT_RESOLVED")) return "SCHEDULED_EFFECT_RESOLVED";
  if (combined.includes("ANCHOR_LINK_CREATED")) return "ANCHOR_LINK_CREATED";
  if (combined.includes("PROMPT") && (combined.includes("RESOLVE") || combined.includes("COMPLETE") || combined.includes("DECLINED"))) {
    return "PROMPT_RESOLVED";
  }
  if (combined.includes("PROMPT") && (combined.includes("CREATED") || combined.includes("REQUESTED") || combined.includes("OPENED"))) {
    return "PROMPT_OPENED";
  }
  if (combined.includes("CHAIN_LINK_NEGATED") || combined.includes("MAGIC_NEGATED")) return "CHAIN_LINK_NEGATED";
  if (combined.includes("CHAIN_LINK_ADDED") || normalizedRawType === "LIGHTNING_RESPONSE_ADDED" || normalizedRawType === "MAGIC_CHAIN_STARTED") return "CHAIN_LINK_ADDED";
  if (combined.includes("CHAIN_PRIORITY_PASSED") || normalizedRawType === "MAGIC_CHAIN_PRIORITY_PASSED") return "CHAIN_PRIORITY_PASSED";
  if (combined.includes("CHAIN_LINK_RESOLVED")) return "CHAIN_LINK_RESOLVED";
  if (combined.includes("MAGIC_STOLEN")) return "MAGIC_STOLEN";
  if (combined.includes("STOLEN_MAGIC_PLAYED")) return "STOLEN_MAGIC_PLAYED";
  if (combined.includes("STOLEN_MAGIC_SENT_TO_CEMETERY")) return "STOLEN_MAGIC_SENT_TO_CEMETERY";
  if (combined.includes("MAGIC_PLAYED_TO_CHAIN")) return "MAGIC_PLAYED_TO_CHAIN";
  if (combined.includes("MAGIC_RESOLVED")) return "MAGIC_RESOLVED";
  if (combined.includes("STATUS") && (combined.includes("REMOVED") || combined.includes("EXPIRED"))) return "STATUS_REMOVED";
  if (combined.includes("STATUS") && combined.includes("APPLIED")) return "STATUS_APPLIED";
  if (combined.includes("STAT_MODIFIER") && (combined.includes("REMOVED") || combined.includes("EXPIRED"))) return "STAT_MODIFIER_REMOVED";
  if ((combined.includes("STAT_MODIFIER") || combined.includes("DICE_LIMIT") || combined.includes("DICE_MODIFIER")) && combined.includes("APPLIED")) return "STAT_MODIFIER_APPLIED";
  if (combined.includes("HEAL") && (combined.includes("RESOLVED") || combined.includes("TICK"))) return "CARD_HEALED";
  if (combined.includes("DAMAGE") && (combined.includes("RESOLVED") || combined.includes("TICK") || combined.includes("APPLIED"))) return "CARD_DAMAGED";
  if (combined.includes("HAND_REVEALED") || combined.includes("REVEAL_HAND")) return "HAND_REVEALED";
  if (combined.includes("CARD_REVEALED") || combined.includes("REVEALED_CARD")) return "CARD_REVEALED";
  if (combined.includes("RETURN") && combined.includes("HAND")) return "CARD_RETURNED_TO_HAND";
  if (combined.includes("RETURN") && combined.includes("DECK")) return "CARD_RETURNED_TO_DECK";
  if (combined.includes("SENT_TO_CEMETERY") || combined.includes("SEND_TO_CEMETERY")) return "CARD_SENT_TO_CEMETERY";
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
  if (type === "CARD_SENT_TO_CEMETERY") {
    return readFirstString(data, "cardInstanceId", "magicCardInstanceId", "targetCardInstanceId");
  }
  if (type === "CREATURE_SUMMONED_PRIMARY" || type === "CREATURE_SUMMONED_LIMITED") {
    return readFirstString(data, "summonedCardInstanceId", "cardInstanceId", "targetCardInstanceId");
  }
  if (type === "CHAIN_LINK_ADDED" || type === "CHAIN_LINK_RESOLVED" || type === "MAGIC_PLAYED_TO_CHAIN" || type === "MAGIC_RESOLVED") {
    return readFirstString(data, "cardInstanceId", "sourceCardInstanceId");
  }
  if (type === "CHAIN_LINK_NEGATED" || type === "MAGIC_NEGATED") {
    return readFirstString(data, "targetCardInstanceId", "cardInstanceId");
  }
  if (type === "MAGIC_ATTACHED") return readFirstString(data, "magicCardInstanceId", "equippedMagicCardInstanceId", "cardInstanceId");
  if (type === "CARD_DAMAGED" || type === "CARD_HEALED" || type === "STATUS_APPLIED" || type === "STATUS_REMOVED" || type === "STAT_MODIFIER_APPLIED" || type === "STAT_MODIFIER_REMOVED") {
    return readFirstString(data, "cardInstanceId", "targetCardInstanceId", "targetCreatureInstanceId");
  }
  if (type === "CARD_REVEALED") return readFirstString(data, "cardInstanceId", "revealedCardInstanceId");
  if (type === "RECURRING_EFFECT_TICKED" || type === "SCHEDULED_EFFECT_RESOLVED") {
    return readFirstString(data, "cardInstanceId", "targetCardInstanceId", "targetCreatureInstanceId");
  }
  return readFirstString(data, "cardInstanceId", "sourceCardInstanceId", "targetCardInstanceId");
}

function inferFromZoneRef(type: BoardRenderEvent["type"], playerId: string | undefined, data: Record<string, unknown>): BoardZoneRef | undefined {
  const explicitZoneRef = readZoneRef(data.fromZoneRef);
  if (explicitZoneRef) return explicitZoneRef;

  const sourcePlayerId = readString(data, "sourcePlayerId", "fieldOwnerPlayerId", "playerId") ?? playerId;
  const sourceZone = normalizeZoneKind(readString(data, "sourceZone", "fromZone"));

  if (sourceZone) return buildZoneRef(sourcePlayerId, sourceZone);
  if (type === "CARD_DRAWN") return buildZoneRef(playerId, "DECK");
  if (type === "CARD_REVEALED") return buildZoneRef(sourcePlayerId, normalizeZoneKind(readString(data, "zone")) ?? "DECK");
  if (type === "HAND_REVEALED") return buildZoneRef(readString(data, "revealedPlayerId", "targetPlayerId") ?? playerId, "HAND");
  if (type === "CARD_DISCARDED") return buildZoneRef(sourcePlayerId, "HAND");
  if (type === "CARD_SENT_TO_CEMETERY") {
    if (readString(data, "magicCardInstanceId")) return buildZoneRef(sourcePlayerId, "MAGIC_SLOT");
    return buildZoneRef(sourcePlayerId, "CHAIN");
  }
  if (type === "CARD_DESTROYED") return buildZoneRef(sourcePlayerId, "MAGIC_SLOT");
  if (type === "CARD_RETURNED_TO_DECK" || type === "CARD_RETURNED_TO_HAND") return undefined;
  if (type === "CREATURE_SUMMONED_PRIMARY" || type === "CREATURE_SUMMONED_LIMITED") return buildZoneRef(sourcePlayerId, "HAND");
  if (type === "CHAIN_LINK_ADDED" || type === "MAGIC_PLAYED_TO_CHAIN") return buildZoneRef(sourcePlayerId, "HAND");
  if (type === "CHAIN_LINK_RESOLVED" || type === "MAGIC_RESOLVED" || type === "CHAIN_LINK_NEGATED" || type === "MAGIC_NEGATED") return buildZoneRef(sourcePlayerId, "CHAIN");
  if (type === "MAGIC_ATTACHED") return buildZoneRef(sourcePlayerId, "MAGIC_SLOT");
  return undefined;
}

function inferToZoneRef(type: BoardRenderEvent["type"], playerId: string | undefined, data: Record<string, unknown>): BoardZoneRef | undefined {
  const explicitZoneRef = readZoneRef(data.toZoneRef);
  if (explicitZoneRef) return explicitZoneRef;

  const destinationPlayerId = readString(data, "destinationPlayerId", "cardOwnerPlayerId", "controllerPlayerId", "targetPlayerId", "playerId") ?? playerId;
  const destinationZone = normalizeZoneKind(readString(data, "destinationZone", "toZone"));

  if (destinationZone) return buildZoneRef(destinationPlayerId, destinationZone);
  if (type === "CARD_DRAWN") return buildZoneRef(playerId, "HAND");
  if (type === "CARD_REVEALED") return buildZoneRef(readString(data, "revealedPlayerId", "targetPlayerId", "playerId") ?? playerId, normalizeZoneKind(readString(data, "zone")) ?? "PROMPT");
  if (type === "HAND_REVEALED") return buildZoneRef(readString(data, "viewerPlayerId", "playerId") ?? playerId, "PROMPT");
  if (type === "CARD_DISCARDED" || type === "CARD_DESTROYED" || type === "CARD_SENT_TO_CEMETERY") return buildZoneRef(destinationPlayerId, "CEMETERY");
  if (type === "CARD_RETURNED_TO_HAND") return buildZoneRef(destinationPlayerId, "HAND");
  if (type === "CARD_RETURNED_TO_DECK") return buildZoneRef(destinationPlayerId, "DECK");
  if (type === "CREATURE_SUMMONED_PRIMARY") return buildZoneRef(destinationPlayerId, "PRIMARY_CREATURE");
  if (type === "CREATURE_SUMMONED_LIMITED") return buildZoneRef(destinationPlayerId, "LIMITED_SUMMON");
  if (type === "CHAIN_LINK_ADDED" || type === "MAGIC_PLAYED_TO_CHAIN") return buildZoneRef(destinationPlayerId, "CHAIN");
  if (type === "CHAIN_LINK_RESOLVED" || type === "MAGIC_RESOLVED" || type === "CHAIN_LINK_NEGATED" || type === "MAGIC_NEGATED") return buildZoneRef(destinationPlayerId, "CEMETERY");
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
    targetCardInstanceId: readString(data, "targetCardInstanceId", "targetCreatureInstanceId", "destroyedCardInstanceId", "attachedToInstanceId"),
    phase: readString(data, "phase") as BoardRenderEvent["phase"],
    turnNumber: readNumber(data, "turnNumber"),
    turnCycleNumber: readNumber(data, "turnCycleNumber")
  };
}

function extractBoardEventPayloads(payload: unknown): Record<string, unknown>[] {
  const data = readPayload(payload);
  const boardEvents = data.boardEvents;
  if (!Array.isArray(boardEvents)) return [data];

  const structuredEvents = boardEvents
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));

  return structuredEvents.length > 0 ? structuredEvents : [data];
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
  const lastEvent = match.eventLog[match.eventLog.length - 1];
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

  return sourceEvents.flatMap((event, sourceIndex) => {
    const payloads = extractBoardEventPayloads(event.payload);

    return payloads.map((payload, payloadIndex) => {
      const semanticFields = mapEventToSemanticFields({
        ...event,
        payload
      });

      return {
      eventId: `${match.matchId}:${event.sequenceNumber}:${event.type}:${sourceIndex}:${payloadIndex}`,
      sequenceNumber: event.sequenceNumber,
      matchId: match.matchId,
      rawType: event.type,
      payload,
      visualTargets: extractVisualTargets(payload),
      ...semanticFields
      };
    });
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
