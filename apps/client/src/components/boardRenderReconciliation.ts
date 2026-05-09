import type { BoardRenderModel } from "./boardRenderContracts";

export type ReconciliationDecision = {
  shouldResetQueue: boolean;
  reason: string;
};

export function decideBoardReconciliation(params: {
  previousModel?: BoardRenderModel | null;
  nextModel: BoardRenderModel;
  queueCursor: number;
}): ReconciliationDecision {
  const { previousModel, nextModel, queueCursor } = params;
  if (!previousModel) {
    return { shouldResetQueue: false, reason: "initial-model" };
  }
  if (nextModel.sequenceNumber < queueCursor) {
    return { shouldResetQueue: true, reason: "sequence-rewind" };
  }
  if (nextModel.cards.length !== previousModel.cards.length && nextModel.sequenceNumber === previousModel.sequenceNumber) {
    return { shouldResetQueue: true, reason: "snapshot-diverged-same-sequence" };
  }
  if (nextModel.matchId !== previousModel.matchId) {
    return { shouldResetQueue: true, reason: "match-changed" };
  }
  return { shouldResetQueue: false, reason: "append-only" };
}
