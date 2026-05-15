import type { BoardAffordance, BoardZoneRef, PendingEffectTargetPrompt } from "@ward/shared";
import type { BoardObject } from "./boardPreview3dAdapter";
import type { BoardPlayerId, BoardSlotId } from "./boardPreview3dTypes";

export type EffectTargetBoardOption = { optionId: string; pieceId?: string; slotId?: string };

const RESOLVABLE_CARD_LANES = new Set(["primary", "limited", "magic", "hand", "cemetery"]);
const FALLBACK_CARD_LANES = new Set(["primary", "limited", "magic", "cemetery"]);

export function slotIdFromTargetZoneRef(zoneRef: BoardZoneRef | undefined): BoardSlotId | null {
  if (!zoneRef || (zoneRef.playerId !== "player_1" && zoneRef.playerId !== "player_2")) return null;

  switch (zoneRef.zone) {
    case "PRIMARY_CREATURE":
      return `${zoneRef.playerId}-primary` as BoardSlotId;
    case "DECK":
      return `${zoneRef.playerId}-deck` as BoardSlotId;
    case "CEMETERY":
      return `${zoneRef.playerId}-cemetery` as BoardSlotId;
    case "HAND":
      return typeof zoneRef.slotIndex === "number"
        ? `${zoneRef.playerId}-hand-${zoneRef.slotIndex + 1}` as BoardSlotId
        : null;
    case "LIMITED_SUMMON":
      return typeof zoneRef.slotIndex === "number"
        ? `${zoneRef.playerId}-limited-${zoneRef.slotIndex + 1}` as BoardSlotId
        : null;
    case "MAGIC_SLOT":
      return typeof zoneRef.slotIndex === "number"
        ? `${zoneRef.playerId}-magic-${zoneRef.slotIndex + 1}` as BoardSlotId
        : null;
    default:
      return null;
  }
}

export function buildEffectTargetBoardOptions(params: {
  pendingEffectTargetAffordances: BoardAffordance[];
  boardObjects: BoardObject[];
  prompt: PendingEffectTargetPrompt | null | undefined;
  controlledPlayerId?: BoardPlayerId | null;
}): EffectTargetBoardOption[] {
  const { pendingEffectTargetAffordances, boardObjects, prompt, controlledPlayerId } = params;

  const affordanceOptions: EffectTargetBoardOption[] = pendingEffectTargetAffordances.flatMap(affordance => {
    const optionId = affordance.actionId;
    if (!optionId || affordance.highlightStyle !== "TARGET") return [];

    if (
      (affordance.kind === "VALID_TARGET_CARD" || affordance.kind === "VALID_DISCARD_CARD" || affordance.kind === "REVEALED_HAND_CARD") &&
      affordance.targetCardInstanceId
    ) {
      const object = boardObjects.find(candidate => candidate.cardInstanceId === affordance.targetCardInstanceId);
      if (!object || !RESOLVABLE_CARD_LANES.has(object.lane)) return [];
      return [{ optionId, pieceId: object.id, slotId: object.slotId }];
    }

    if (affordance.kind === "VALID_TARGET_ZONE" || affordance.kind === "VALID_DECK_STACK") {
      const slotId = slotIdFromTargetZoneRef(affordance.targetZoneRef);
      return slotId ? [{ optionId, slotId }] : [];
    }

    return [];
  });

  if (affordanceOptions.length > 0) return affordanceOptions;
  if (!prompt) return [];
  if (controlledPlayerId && controlledPlayerId !== prompt.controllerPlayerId) return [];

  return prompt.options.flatMap(option => {
    if (!option.cardInstanceId) return [];
    const object = boardObjects.find(candidate => candidate.cardInstanceId === option.cardInstanceId);
    if (!object || !FALLBACK_CARD_LANES.has(object.lane)) return [];
    return [{ optionId: option.id, pieceId: object.id, slotId: object.slotId }];
  });
}
