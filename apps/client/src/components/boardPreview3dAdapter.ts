import type { AppMatchState } from "../clientTypes";
import { BOARD_SLOTS } from "./boardPreview3dLayout";
import type { BoardLayoutSnapshot, BoardPieceFocusEvent, BoardPreviewInteractionIntent, BoardSlotFocusEvent, BoardSlotId, BoardSlotOffsetMap } from "./boardPreview3dTypes";

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

export type BoardObject = {
  id: string;
  label: string;
  owner: "player_1" | "player_2";
  xPercent: number;
  zPercent: number;
  yDepth: number;
  lane: "primary" | "limited" | "magic";
  slotId: BoardSlotId;
};

export function buildBoardObjects(match: AppMatchState): BoardObject[] {
  return match.players.flatMap((player, playerIndex) => {
    const owner: "player_1" | "player_2" = player.id === "player_1" ? "player_1" : "player_2";
<<<<<<< ours
<<<<<<< ours
    const monsterZ = playerIndex === 0 ? 64 : 36;
    const magicZ = playerIndex === 0 ? 76 : 24;
    const limitedColumns = playerIndex === 0 ? [82, 66, 34, 18] : [18, 34, 66, 82];
    const magicColumns = playerIndex === 0 ? [82, 66, 50, 34, 18] : [18, 34, 50, 66, 82];
=======
    const ownerZ = playerIndex === 0 ? 74 : 26;
    const friendlyShift = playerIndex === 0 ? 1 : -1;
>>>>>>> theirs
=======
    const ownerZ = playerIndex === 0 ? 74 : 26;
    const friendlyShift = playerIndex === 0 ? 1 : -1;
>>>>>>> theirs

    const primary = player.field.primaryCreature
      ? [{
          id: `${owner}-primary`,
          label: `${player.displayName} Primary`,
          owner,
          xPercent: 50,
<<<<<<< ours
<<<<<<< ours
          zPercent: monsterZ,
=======
          zPercent: ownerZ,
>>>>>>> theirs
=======
          zPercent: ownerZ,
>>>>>>> theirs
          yDepth: 12,
          lane: "primary" as const,
          slotId: `${owner}-primary` as BoardSlotId
        }]
      : [];

<<<<<<< ours
<<<<<<< ours
=======
    const limitedOffsets = [28, 10, -10, -28];
>>>>>>> theirs
=======
    const limitedOffsets = [28, 10, -10, -28];
>>>>>>> theirs
    const limited = player.field.limitedSummons.map((card, index) => ({
      id: `${owner}-limited-${card.instanceId}`,
      label: `${player.displayName} Limited ${index + 1}`,
      owner,
<<<<<<< ours
<<<<<<< ours
      xPercent: limitedColumns[index] ?? 50,
      zPercent: monsterZ,
=======
      xPercent: 50 + friendlyShift * (limitedOffsets[index] ?? 0),
      zPercent: ownerZ + friendlyShift * -8,
>>>>>>> theirs
=======
      xPercent: 50 + friendlyShift * (limitedOffsets[index] ?? 0),
      zPercent: ownerZ + friendlyShift * -8,
>>>>>>> theirs
      yDepth: 8,
      lane: "limited" as const,
      slotId: `${owner}-limited-${index + 1}` as BoardSlotId
    }));

<<<<<<< ours
<<<<<<< ours
=======
    const magicOffsets = [40, 20, 0, -20, -40];
>>>>>>> theirs
=======
    const magicOffsets = [40, 20, 0, -20, -40];
>>>>>>> theirs
    const magic = player.field.magicSlots.filter(Boolean).map((card, index) => ({
      id: `${owner}-magic-${card.instanceId}`,
      label: `${player.displayName} Magic ${index + 1}`,
      owner,
<<<<<<< ours
<<<<<<< ours
      xPercent: magicColumns[index] ?? 50,
      zPercent: magicZ,
=======
      xPercent: 50 + friendlyShift * (magicOffsets[index] ?? 0),
      zPercent: ownerZ + friendlyShift * 4,
>>>>>>> theirs
=======
      xPercent: 50 + friendlyShift * (magicOffsets[index] ?? 0),
      zPercent: ownerZ + friendlyShift * 4,
>>>>>>> theirs
      yDepth: 5,
      lane: "magic" as const,
      slotId: `${owner}-magic-${index + 1}` as BoardSlotId
    }));

    return [...primary, ...limited, ...magic];
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
