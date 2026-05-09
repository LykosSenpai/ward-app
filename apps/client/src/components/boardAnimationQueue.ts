import type { BoardRenderEvent } from "./boardRenderContracts";

export type BoardAnimationQueueState = {
  cursor: number;
  queue: BoardRenderEvent[];
  activeEvent: BoardRenderEvent | null;
};

export function createBoardAnimationQueueState(): BoardAnimationQueueState {
  return {
    cursor: 0,
    queue: [],
    activeEvent: null
  };
}

export function enqueueBoardRenderEvents(
  state: BoardAnimationQueueState,
  events: BoardRenderEvent[]
): BoardAnimationQueueState {
  const unseen = events.filter(event => event.sequenceNumber > state.cursor);
  const deduped = unseen.filter(
    event => !state.queue.some(queued => queued.eventId === event.eventId) && state.activeEvent?.eventId !== event.eventId
  );
  return {
    ...state,
    queue: [...state.queue, ...deduped].sort((a, b) => a.sequenceNumber - b.sequenceNumber)
  };
}

export function startNextBoardAnimation(state: BoardAnimationQueueState): BoardAnimationQueueState {
  if (state.activeEvent || state.queue.length === 0) return state;
  const [next, ...rest] = state.queue;
  return {
    ...state,
    queue: rest,
    activeEvent: next
  };
}

export function settleActiveBoardAnimation(state: BoardAnimationQueueState): BoardAnimationQueueState {
  if (!state.activeEvent) return state;
  return {
    ...state,
    cursor: Math.max(state.cursor, state.activeEvent.sequenceNumber),
    activeEvent: null
  };
}

export function resetBoardAnimationQueueToSequence(
  state: BoardAnimationQueueState,
  sequenceNumber: number
): BoardAnimationQueueState {
  return {
    ...state,
    cursor: sequenceNumber,
    queue: [],
    activeEvent: null
  };
}
