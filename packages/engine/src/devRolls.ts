import { v4 as uuidv4 } from "uuid";
import type { DevForcedRoll, DevRollKind, MatchState } from "@ward/shared";
import { rollD6 } from "./dice.js";

type AddEventFn = (state: MatchState, type: string, playerId?: string, payload?: unknown) => void;

function normalizeDie(value: unknown): number | undefined {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 6) return undefined;
  return number;
}

export function ensureDevRollState(state: MatchState): void {
  state.devTools ??= { rolls: { forcedRollQueue: [] } };
  state.devTools.rolls ??= { forcedRollQueue: [] };
  state.devTools.rolls.forcedRollQueue ??= [];
}

export function forceNextDevRolls(
  state: MatchState,
  args: {
    kind: DevRollKind;
    dice: unknown[];
    label?: string;
  }
): MatchState {
  ensureDevRollState(state);

  const dice = args.dice.map(normalizeDie).filter((die): die is number => die !== undefined);

  if (dice.length === 0) {
    throw new Error("Enter at least one forced D6 result from 1 to 6.");
  }

  const item: DevForcedRoll = {
    id: uuidv4(),
    kind: args.kind,
    dice,
    label: args.label?.trim() || undefined,
    createdAt: new Date().toISOString()
  };

  state.devTools!.rolls.forcedRollQueue.push(item);
  return state;
}

export function clearForcedDevRolls(state: MatchState, kind?: DevRollKind): MatchState {
  ensureDevRollState(state);

  if (!kind) {
    state.devTools!.rolls.forcedRollQueue = [];
    return state;
  }

  state.devTools!.rolls.forcedRollQueue = state.devTools!.rolls.forcedRollQueue.filter(item => item.kind !== kind);
  return state;
}

function takeMatchingForcedRoll(state: MatchState, kind: DevRollKind, count: number): DevForcedRoll | undefined {
  ensureDevRollState(state);
  const queue = state.devTools!.rolls.forcedRollQueue;
  const index = queue.findIndex(item => item.kind === kind && item.dice.length >= count);

  if (index < 0) return undefined;

  const [item] = queue.splice(index, 1);
  return item;
}

export function rollD6WithDev(
  state: MatchState,
  args: {
    kind: DevRollKind;
    count: number;
    playerId?: string;
    label?: string;
    addEvent?: AddEventFn;
    context?: Record<string, unknown>;
  }
): number[] {
  const count = Math.floor(Number(args.count));
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("Roll at least 1 die.");
  }

  const forced = takeMatchingForcedRoll(state, args.kind, count);

  if (forced) {
    const dice = forced.dice.slice(0, count);
    const leftover = forced.dice.slice(count);

    if (leftover.length > 0) {
      state.devTools!.rolls.forcedRollQueue.unshift({
        ...forced,
        id: uuidv4(),
        dice: leftover,
        label: forced.label ? `${forced.label} (remaining)` : undefined
      });
    }

    args.addEvent?.(state, "DEV_FORCED_ROLL_USED", args.playerId, {
      kind: args.kind,
      dice,
      requestedCount: count,
      forcedRollId: forced.id,
      label: args.label ?? forced.label,
      context: args.context
    });

    return dice;
  }

  const dice = rollD6(count);
  args.addEvent?.(state, "DEV_RANDOM_ROLL_USED", args.playerId, {
    kind: args.kind,
    dice,
    requestedCount: count,
    label: args.label,
    context: args.context
  });

  return dice;
}
