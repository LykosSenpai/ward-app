import type { AppMatchState } from "../clientTypes";
import { BOARD_SLOTS } from "./boardPreview3dLayout";
import type { BoardLayoutSnapshot, BoardPieceFocusEvent, BoardPlayerId, BoardPreviewInteractionIntent, BoardSlotFocusEvent, BoardSlotId, BoardSlotOffsetMap } from "./boardPreview3dTypes";

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

export type BoardObject = {
  id: string;
  cardInstanceId?: string;
  label: string;
  owner: BoardPlayerId;
  xPercent: number;
  zPercent: number;
  yDepth: number;
  lane: "primary" | "limited" | "magic" | "hand" | "deck" | "cemetery";
  slotId: BoardSlotId;
};

type BuildBoardObjectsOptions = {
  revealHandsForPlayerId?: BoardPlayerId | "all" | null;
};

const HAND_SLOT_COUNT = 10;

function isHandRevealed(owner: BoardPlayerId, options?: BuildBoardObjectsOptions): boolean {
  return options?.revealHandsForPlayerId === "all" || options?.revealHandsForPlayerId === owner;
}

function getSlotPoint(slotId: BoardSlotId, fallbackX: number, fallbackZ: number) {
  const slot = BOARD_SLOTS.find(item => item.id === slotId);
  return {
    xPercent: slot?.xPercent ?? fallbackX,
    zPercent: slot?.zPercent ?? fallbackZ
  };
}

export function buildBoardObjects(match: AppMatchState, options: BuildBoardObjectsOptions = {}): BoardObject[] {
  return match.players.flatMap((player, playerIndex) => {
    const owner: BoardPlayerId = player.id === "player_1" ? "player_1" : "player_2";
    const ownerZ = playerIndex === 0 ? 74 : 26;
    const friendlyShift = playerIndex === 0 ? 1 : -1;
    const handCards = player.hand ?? [];
    const deckCards = player.deck ?? [];
    const cemeteryCards = player.cemetery ?? [];


    const primary = player.field.primaryCreature
      ? (() => {
        const slotId = `${owner}-primary` as BoardSlotId;
        const point = getSlotPoint(slotId, 50, ownerZ);
        return [{
          id: `${owner}-primary`,
          cardInstanceId: player.field.primaryCreature.instanceId,
          label: `${player.displayName} Primary`,
          owner,
          xPercent: point.xPercent,
          zPercent: point.zPercent,

          yDepth: 12,
          lane: "primary" as const,
          slotId
        }];
      })()
      : [];

    const limitedOffsets = [28, 10, -10, -28];

    const limited = player.field.limitedSummons.map((card, index) => {
      const slotId = `${owner}-limited-${index + 1}` as BoardSlotId;
      const point = getSlotPoint(slotId, 50 + friendlyShift * (limitedOffsets[index] ?? 0), ownerZ + friendlyShift * -8);
      return {
        id: `${owner}-limited-${card.instanceId}`,
        cardInstanceId: card.instanceId,
        label: `${player.displayName} Limited ${index + 1}`,
        owner,
        xPercent: point.xPercent,
        zPercent: point.zPercent,

        yDepth: 8,
        lane: "limited" as const,
        slotId
      };
    });

    const magicOffsets = [40, 20, 0, -20, -40];

    const magic = player.field.magicSlots.filter(Boolean).map((card, index) => {
      const slotId = `${owner}-magic-${index + 1}` as BoardSlotId;
      const point = getSlotPoint(slotId, 50 + friendlyShift * (magicOffsets[index] ?? 0), ownerZ + friendlyShift * 4);
      return {
        id: `${owner}-magic-${card.instanceId}`,
        cardInstanceId: card.instanceId,
        label: `${player.displayName} Magic ${index + 1}`,
        owner,
        xPercent: point.xPercent,
        zPercent: point.zPercent,

        yDepth: 5,
        lane: "magic" as const,
        slotId
      };
    });

    const deckSlotId = `${owner}-deck` as BoardSlotId;
    const deckPoint = getSlotPoint(deckSlotId, owner === "player_1" ? 94 : 6, owner === "player_1" ? 88 : 12);

    const deck: BoardObject[] = [{
      id: `${owner}-deck-stack`,
      label: `Deck (${deckCards.length})`,
      owner,
      xPercent: deckPoint.xPercent,
      zPercent: deckPoint.zPercent,
      yDepth: 10,
      lane: "deck",
      slotId: deckSlotId
    }];

    const cemeteryTopCard = cemeteryCards.at(-1);
    const cemeterySlotId = `${owner}-cemetery` as BoardSlotId;
    const cemeteryPoint = getSlotPoint(cemeterySlotId, owner === "player_1" ? 6 : 94, owner === "player_1" ? 88 : 12);
    const cemetery: BoardObject[] = [{
      id: `${owner}-cemetery-stack`,
      cardInstanceId: cemeteryTopCard?.instanceId,
      label: `Cemetery (${cemeteryCards.length})`,
      owner,
      xPercent: cemeteryPoint.xPercent,
      zPercent: cemeteryPoint.zPercent,
      yDepth: 10,
      lane: "cemetery",
      slotId: cemeterySlotId
    }];

    const hand: BoardObject[] = isHandRevealed(owner, options)
      ? handCards.slice(0, HAND_SLOT_COUNT).map((card, index) => {
        const slotId = `${owner}-hand-${Math.min(index + 1, HAND_SLOT_COUNT)}` as BoardSlotId;
        const point = getSlotPoint(slotId, 15 + index * 8, owner === "player_1" ? 93 : 7);
        return {
            id: `${owner}-hand-${card.instanceId}`,
            cardInstanceId: card.instanceId,
            label: `${player.displayName} Hand ${index + 1}`,
            owner,
            xPercent: point.xPercent,
            zPercent: point.zPercent,
            yDepth: 14,
            lane: "hand" as const,
            slotId
          };
        })
      : [];

    return [...primary, ...limited, ...magic, ...deck, ...cemetery, ...hand];
  });
}

export function toLayoutSnapshot(offsets: BoardSlotOffsetMap): BoardLayoutSnapshot {
  return BOARD_SLOTS.map((slot) => {
    const offset = offsets[slot.id as BoardSlotId] ?? { x: 0, z: 0 };
    return {
      id: slot.id as BoardSlotId,
      xPercent: Number((slot.xPercent + offset.x).toFixed(2)),
      zPercent: Number((slot.zPercent + offset.z).toFixed(2))
    };
  });
}

export function parseLayoutSnapshotJson(raw: string): { ok: true; value: BoardLayoutSnapshot } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { ok: false, error: "Layout JSON must be an array." };
    }
    for (const item of parsed) {
      if (!item || typeof item.id !== "string" || typeof item.xPercent !== "number" || typeof item.zPercent !== "number") {
        return { ok: false, error: "Each layout entry must include id, xPercent, zPercent." };
      }
      if (!BOARD_SLOTS.some((slot) => slot.id === item.id)) {
        return { ok: false, error: `Unknown slot id: ${item.id}` };
      }
    }
    return { ok: true, value: parsed as BoardLayoutSnapshot };
  } catch {
    return { ok: false, error: "Layout JSON is not valid JSON." };
  }
}

export function resolveSlotPosition(
  slotId: string,
  slotOffsets: BoardSlotOffsetMap,
  fallbackX: number,
  fallbackZ: number
) {
  const slot = BOARD_SLOTS.find((item) => item.id === slotId);
  const offset = slotOffsets[slotId as BoardSlotId] ?? { x: 0, z: 0 };

  return {
    xPercent: clampPercent((slot?.xPercent ?? fallbackX) + offset.x),
    zPercent: clampPercent((slot?.zPercent ?? fallbackZ) + offset.z)
  };
}

export function buildInteractionIntentFromSlotFocus(event: BoardSlotFocusEvent): BoardPreviewInteractionIntent {
  const slot = BOARD_SLOTS.find((item) => item.id === event.slotId);
  return {
    source: event.source,
    slotId: event.slotId,
    owner: slot?.owner
  };
}

export function buildInteractionIntentFromPieceFocus(
  event: BoardPieceFocusEvent,
  boardObjects: BoardObject[]
): BoardPreviewInteractionIntent {
  const piece = boardObjects.find((item) => item.id === event.pieceId);
  return {
    source: event.source,
    pieceId: event.pieceId,
    slotId: piece?.slotId,
    owner: piece?.owner,
    lane: piece?.lane
  };
}

export function canDispatchSummon(params: {
  focusedSlotId?: string | null;
  focusedSlotOwner?: "player_1" | "player_2";
  summonPlayerId: "player_1" | "player_2";
  cardInstanceId: string;
  isSummonableCard: boolean;
}) {
  const { focusedSlotId, focusedSlotOwner, summonPlayerId, cardInstanceId, isSummonableCard } = params;
  return Boolean(
    focusedSlotId &&
      focusedSlotId.endsWith("-primary") &&
      focusedSlotOwner === summonPlayerId &&
      cardInstanceId.trim() &&
      isSummonableCard
  );
}

export function canDispatchMagic(params: {
  focusedSlotId?: string | null;
  focusedSlotOwner?: "player_1" | "player_2";
  summonPlayerId: "player_1" | "player_2";
  cardInstanceId: string;
  isPlayableMagicCard: boolean;
}) {
  const { focusedSlotId, focusedSlotOwner, summonPlayerId, cardInstanceId, isPlayableMagicCard } = params;
  return Boolean(
    focusedSlotId &&
      focusedSlotId.includes("-magic-") &&
      focusedSlotOwner === summonPlayerId &&
      cardInstanceId.trim() &&
      isPlayableMagicCard
  );
}

export function canDispatchBattle(params: {
  attackerInstanceId: string;
  defenderInstanceId?: string | null;
  canStartBattleNow: boolean;
  hasDefenderPrimary: boolean;
  hasValidAttacker: boolean;
}) {
  const { attackerInstanceId, defenderInstanceId, canStartBattleNow, hasDefenderPrimary, hasValidAttacker } = params;
  return Boolean(
    attackerInstanceId.trim() &&
      defenderInstanceId?.trim() &&
      canStartBattleNow &&
      hasDefenderPrimary &&
      hasValidAttacker
  );
}

export type DispatchPreflight =
  | { ok: true }
  | { ok: false; reason: string };

export function ensureDispatchReady(params: {
  hasFocusedSlot: boolean;
  allowedByGuard: boolean;
  isSocketConnected: boolean;
  blockedReason: string;
}): DispatchPreflight {
  const { hasFocusedSlot, allowedByGuard, isSocketConnected, blockedReason } = params;
  if (!hasFocusedSlot) {
    return { ok: false, reason: "focus a target slot first" };
  }
  if (!allowedByGuard) {
    return { ok: false, reason: blockedReason };
  }
  if (!isSocketConnected) {
    return { ok: false, reason: "socket disconnected" };
  }
  return { ok: true };
}

export function getDispatchBlockedReason(preflight: DispatchPreflight): string {
  return "reason" in preflight ? preflight.reason : "unknown dispatch block";
}
