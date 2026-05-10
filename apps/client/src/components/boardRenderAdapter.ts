import type { AppMatchState } from "../clientTypes";
import { buildBoardObjects } from "./boardPreview3dAdapter";
import type { BoardInteractionContext, BoardRenderCard, BoardRenderEvent, BoardRenderModel } from "./boardRenderContracts";
import type { BoardPlayerId } from "./boardPreview3dTypes";
import { getAdvanceBlockReason, getBattleBlockReason, getMatchStatus } from "../gameViewHelpers";

function resolveOwner(playerId: string): BoardPlayerId {
  return playerId === "player_1" ? "player_1" : "player_2";
}

function mapRawEventType(rawType: string): BoardRenderEvent["type"] {
  if (rawType.includes("BATTLE") && rawType.includes("START")) return "BATTLE_STARTED";
  if (rawType.includes("BATTLE") && (rawType.includes("RESOLVE") || rawType.includes("RESULT"))) return "BATTLE_RESOLVED";
  if (rawType.includes("PROMPT")) return "EFFECT_PROMPT_OPENED";
  if (rawType.includes("CHAIN") && rawType.includes("RESOLVE")) return "CHAIN_RESOLVED";
  if (rawType.includes("MOVE") || rawType.includes("DRAW") || rawType.includes("PLAY")) return "CARD_MOVED_ZONE";
  return "STATE_SYNCED";
}

function extractVisualTargets(payload: unknown): BoardRenderEvent["visualTargets"] {
  if (!payload || typeof payload !== "object") {
    return { slotIds: [], cardInstanceIds: [] };
  }
  const data = payload as Record<string, unknown>;
  const slotKeys = ["slotId", "sourceSlotId", "targetSlotId", "fromSlotId", "toSlotId"];
  const instanceKeys = ["cardInstanceId", "sourceCardInstanceId", "targetCardInstanceId", "attackerCreatureInstanceId", "defenderCreatureInstanceId"];
  const slotIds = slotKeys
    .map(key => data[key])
    .filter((value): value is string => typeof value === "string");
  const cardInstanceIds = instanceKeys
    .map(key => data[key])
    .filter((value): value is string => typeof value === "string");
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

export function translateGameEventsToBoardRenderEvents(match: AppMatchState): BoardRenderEvent[] {
  return match.eventLog.map((event, index) => ({
    eventId: `${match.matchId}:${event.sequenceNumber}:${event.type}:${index}`,
    sequenceNumber: event.sequenceNumber,
    matchId: match.matchId,
    type: mapRawEventType(event.type),
    rawType: event.type,
    payload: event.payload,
    visualTargets: extractVisualTargets(event.payload)
  }));
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
