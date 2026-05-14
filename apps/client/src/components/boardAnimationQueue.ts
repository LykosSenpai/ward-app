import type { BoardRenderEvent } from "./boardRenderContracts";
import { planBoardAnimationSteps, type BoardAnimationStep } from "./boardAnimationPlanner";

const MAX_BOARD_ANIMATION_QUEUE_LENGTH = 12;

export type BoardAnimationQueueItem = BoardRenderEvent & {
  animationSteps: BoardAnimationStep[];
  usesPlannerOutput: boolean;
};

export type BoardAnimationQueueState = {
  cursor: number;
  queue: BoardAnimationQueueItem[];
  activeEvent: BoardAnimationQueueItem | null;
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
  const planned = unseen.map(event => {
    const animationSteps = planBoardAnimationSteps(event);
    return {
      ...event,
      animationSteps,
      usesPlannerOutput: animationSteps.length > 0
    };
  });
  const dedupedPlanned = planned.filter(
    event => !state.queue.some(queued => queued.eventId === event.eventId) && state.activeEvent?.eventId !== event.eventId
  );

  const priorityDamageEvent = dedupedPlanned.find(event => event.type === "BATTLE_DAMAGE_APPLIED");
  if (priorityDamageEvent && state.activeEvent?.type !== "BATTLE_DAMAGE_APPLIED") {
    const queue = [
      priorityDamageEvent,
      ...dedupedPlanned.filter(event =>
        event.eventId !== priorityDamageEvent.eventId &&
        event.sequenceNumber > priorityDamageEvent.sequenceNumber
      )
    ].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    return {
      ...state,
      activeEvent: null,
      cursor: Math.max(state.cursor, priorityDamageEvent.sequenceNumber - 1),
      queue: queue.slice(-MAX_BOARD_ANIMATION_QUEUE_LENGTH)
    };
  }

  const queue = [...state.queue, ...dedupedPlanned].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  return {
    ...state,
    queue: queue.slice(-MAX_BOARD_ANIMATION_QUEUE_LENGTH)
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
