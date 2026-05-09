import type { BoardInteractionContext } from "./boardRenderContracts";

export type PointerGestureIntent =
  | { kind: "SELECT_SLOT"; slotId: string; playerId: string }
  | { kind: "SELECT_PIECE"; pieceId: string; playerId: string }
  | { kind: "NO_OP"; reason: string };

export function mapPointerGestureToIntent(params: {
  interaction: BoardInteractionContext;
  slotId?: string;
  pieceId?: string;
}): PointerGestureIntent {
  const { interaction, slotId, pieceId } = params;
  if (interaction.blocked) {
    return { kind: "NO_OP", reason: "interaction blocked by prompt/chain/complete state" };
  }
  if (slotId) {
    return { kind: "SELECT_SLOT", slotId, playerId: interaction.activePlayerId };
  }
  if (pieceId) {
    return { kind: "SELECT_PIECE", pieceId, playerId: interaction.activePlayerId };
  }
  return { kind: "NO_OP", reason: "no pointer target" };
}
