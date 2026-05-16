import type { PointerGestureIntent } from "./boardInteractionIntents";
import type { BoardObject } from "./boardPreview3dAdapter";

export type BoardIntentCommand =
  | { kind: "FOCUS_SLOT"; slotId: string; playerId: string }
  | { kind: "FOCUS_PIECE"; pieceId: string; cardInstanceId?: string; playerId: string }
  | { kind: "NONE"; reason: string };

export function resolveBoardIntentCommand(intent: PointerGestureIntent, boardObjects: BoardObject[]): BoardIntentCommand {
  if (intent.kind === "NO_OP") {
    return { kind: "NONE", reason: intent.reason };
  }
  if (intent.kind === "SELECT_SLOT") {
    return {
      kind: "FOCUS_SLOT",
      slotId: intent.slotId,
      playerId: intent.playerId
    };
  }
  const piece = boardObjects.find(object => object.id === intent.pieceId);
  const pieceIdParts = piece?.id.split("-");
  const cardInstanceId = pieceIdParts?.[pieceIdParts.length - 1];
  return {
    kind: "FOCUS_PIECE",
    pieceId: intent.pieceId,
    cardInstanceId,
    playerId: intent.playerId
  };
}
