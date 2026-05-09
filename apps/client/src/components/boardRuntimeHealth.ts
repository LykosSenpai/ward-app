import type { BoardAnimationQueueState } from "./boardAnimationQueue";

export type BoardRuntimeMode = "ANIMATED" | "FAST_FORWARD";

export function resolveBoardRuntimeMode(params: {
  queue: BoardAnimationQueueState;
  isDocumentHidden: boolean;
}): BoardRuntimeMode {
  const { queue, isDocumentHidden } = params;
  if (isDocumentHidden) return "FAST_FORWARD";
  if (queue.queue.length > 18) return "FAST_FORWARD";
  return "ANIMATED";
}
