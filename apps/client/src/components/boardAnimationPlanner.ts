import type { BoardZoneRef } from "@ward/shared";
import type { BoardRenderEvent } from "./boardRenderContracts";
import { getBoardAnimationProfile } from "./boardAnimationProfiles";

export type BoardAnimationStep =
  | {
      type: "MOVE_CARD";
      cardInstanceId: string;
      toZoneRef: BoardZoneRef;
      durationMs: number;
    }
  | {
      type: "GLOW_CARD";
      cardInstanceId: string;
      glowKind: "VALID" | "TARGET" | "COST" | "CHAIN" | "DAMAGE" | "HEAL" | "LOCKED";
      durationMs: number;
    }
  | {
      type: "GLOW_ZONE";
      zoneRef: BoardZoneRef;
      glowKind: "VALID_DROP" | "TARGET" | "COST" | "LOCKED";
      durationMs: number;
    }
  | {
      type: "DAMAGE_NUMBER";
      cardInstanceId: string;
      amount: number;
    }
  | {
      type: "HEAL_NUMBER";
      cardInstanceId: string;
      amount: number;
    }
  | {
      type: "ATTACH_CARD";
      attachmentInstanceId: string;
      targetInstanceId: string;
      durationMs: number;
    }
  | {
      type: "DESTROY_CARD";
      cardInstanceId: string;
      durationMs: number;
    }
  | {
      type: "ROLL_DICE";
      values: number[];
      rollKind: string;
      durationMs: number;
    }
  | {
      type: "SHOW_STATUS_CHIP";
      cardInstanceId?: string;
      playerId?: string;
      label: string;
      durationMs: number;
    };

function readPayload(payload: BoardRenderEvent["payload"]): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

function readString(data: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function readNumber(data: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function readNumberArray(data: Record<string, unknown>, ...keys: string[]): number[] {
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) {
      const values = value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
      if (values.length > 0) return values;
    }
  }
  return [];
}

function readBoolean(data: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function addMoveStep(steps: BoardAnimationStep[], event: BoardRenderEvent, durationMs: number): void {
  if (!event.cardInstanceId || !event.toZoneRef) return;
  steps.push({
    type: "MOVE_CARD",
    cardInstanceId: event.cardInstanceId,
    toZoneRef: event.toZoneRef,
    durationMs
  });
}

function addCardGlow(
  steps: BoardAnimationStep[],
  cardInstanceId: string | undefined,
  glowKind: Extract<BoardAnimationStep, { type: "GLOW_CARD" }>["glowKind"],
  durationMs: number
): void {
  if (!cardInstanceId) return;
  steps.push({ type: "GLOW_CARD", cardInstanceId, glowKind, durationMs });
}

function addZoneGlow(
  steps: BoardAnimationStep[],
  zoneRef: BoardZoneRef | undefined,
  glowKind: Extract<BoardAnimationStep, { type: "GLOW_ZONE" }>["glowKind"],
  durationMs: number
): void {
  if (!zoneRef) return;
  steps.push({ type: "GLOW_ZONE", zoneRef, glowKind, durationMs });
}

function addDamageOrHealSteps(
  steps: BoardAnimationStep[],
  event: BoardRenderEvent,
  data: Record<string, unknown>,
  durationMs: number
): void {
  const actionType = event.actionType?.toUpperCase();
  const targetCardInstanceId = event.targetCardInstanceId ?? event.cardInstanceId ?? readString(data, "targetCreatureInstanceId");
  const amount = readNumber(data, "amount", "damageAmount", "healingAmount", "healAmount");

  if (actionType?.includes("HEAL")) {
    addCardGlow(steps, targetCardInstanceId, "HEAL", durationMs);
    if (targetCardInstanceId && amount !== undefined) {
      steps.push({ type: "HEAL_NUMBER", cardInstanceId: targetCardInstanceId, amount });
    }
    return;
  }

  if (actionType?.includes("DAMAGE") || event.type === "BATTLE_DAMAGE_APPLIED") {
    addCardGlow(steps, targetCardInstanceId, "DAMAGE", durationMs);
    if (targetCardInstanceId && amount !== undefined) {
      steps.push({ type: "DAMAGE_NUMBER", cardInstanceId: targetCardInstanceId, amount });
    }
  }
}

export function planBoardAnimationSteps(event: BoardRenderEvent): BoardAnimationStep[] {
  const profile = getBoardAnimationProfile(event.type);
  const durationMs = profile.durationMs;
  const data = readPayload(event.payload);
  const steps: BoardAnimationStep[] = [];

  switch (event.type) {
    case "CARD_MOVED":
    case "CARD_MOVED_ZONE":
    case "CARD_DRAWN":
    case "CARD_DISCARDED":
    case "CARD_RETURNED_TO_HAND":
    case "CARD_RETURNED_TO_DECK":
    case "CARD_SENT_TO_CEMETERY":
    case "CREATURE_SUMMONED_PRIMARY":
    case "CREATURE_SUMMONED_LIMITED":
    case "MAGIC_PLAYED_TO_CHAIN":
    case "CHAIN_LINK_ADDED":
      addMoveStep(steps, event, durationMs);
      if (event.type === "CREATURE_SUMMONED_PRIMARY" || event.type === "CREATURE_SUMMONED_LIMITED") {
        addZoneGlow(steps, event.toZoneRef, "VALID_DROP", Math.min(durationMs, 260));
      }
      if (event.type === "MAGIC_PLAYED_TO_CHAIN" || event.type === "CHAIN_LINK_ADDED") {
        addCardGlow(steps, event.cardInstanceId, "CHAIN", Math.min(durationMs, 260));
      }
      if (event.type === "CARD_MOVED" && event.reason === "BATTLE_RESPONSE") {
        addCardGlow(steps, event.cardInstanceId, "LOCKED", Math.min(durationMs, 260));
        steps.push({ type: "SHOW_STATUS_CHIP", cardInstanceId: event.cardInstanceId, playerId: event.playerId, label: "Battle response", durationMs });
      }
      break;

    case "CARD_DESTROYED":
    case "MAGIC_NEGATED":
    case "CHAIN_LINK_NEGATED":
      addCardGlow(steps, event.cardInstanceId, "DAMAGE", Math.min(durationMs, 220));
      if (event.cardInstanceId) {
        steps.push({ type: "DESTROY_CARD", cardInstanceId: event.cardInstanceId, durationMs });
      }
      addMoveStep(steps, event, durationMs);
      break;

    case "CHAIN_LINK_RESOLVED":
    case "MAGIC_RESOLVED":
      addCardGlow(steps, event.cardInstanceId, "CHAIN", Math.min(durationMs, 240));
      addMoveStep(steps, event, durationMs);
      steps.push({ type: "SHOW_STATUS_CHIP", cardInstanceId: event.cardInstanceId, playerId: event.playerId, label: "Resolved", durationMs });
      break;

    case "MAGIC_ATTACHED":
      if (event.cardInstanceId && event.targetCardInstanceId) {
        steps.push({
          type: "ATTACH_CARD",
          attachmentInstanceId: event.cardInstanceId,
          targetInstanceId: event.targetCardInstanceId,
          durationMs
        });
      } else {
        addMoveStep(steps, event, durationMs);
      }
      addCardGlow(steps, event.targetCardInstanceId, "VALID", Math.min(durationMs, 220));
      break;

    case "ANCHOR_LINK_CREATED":
      addCardGlow(steps, event.sourceCardInstanceId, "VALID", Math.min(durationMs, 220));
      addCardGlow(steps, event.targetCardInstanceId ?? event.cardInstanceId, "VALID", Math.min(durationMs, 220));
      break;

    case "SOURCE_LINK_CLEANUP_TRIGGERED":
      addCardGlow(steps, event.sourceCardInstanceId, "LOCKED", Math.min(durationMs, 220));
      addCardGlow(steps, event.targetCardInstanceId ?? event.cardInstanceId, "DAMAGE", Math.min(durationMs, 220));
      steps.push({
        type: "SHOW_STATUS_CHIP",
        cardInstanceId: event.targetCardInstanceId ?? event.cardInstanceId,
        playerId: event.playerId,
        label: "Source cleanup",
        durationMs
      });
      break;

    case "BATTLE_STARTED":
      addCardGlow(steps, event.sourceCardInstanceId, "TARGET", Math.min(durationMs, 260));
      addCardGlow(steps, event.targetCardInstanceId, "TARGET", Math.min(durationMs, 260));
      break;

    case "BATTLE_STRIKE_STARTED":
      addCardGlow(steps, event.sourceCardInstanceId, "TARGET", Math.min(durationMs, 300));
      addCardGlow(steps, event.targetCardInstanceId, "TARGET", Math.min(durationMs, 300));
      steps.push({ type: "SHOW_STATUS_CHIP", cardInstanceId: event.sourceCardInstanceId, playerId: event.playerId, label: "Strike", durationMs });
      break;

    case "BATTLE_HIT_ROLLED": {
      const diceValues = readNumberArray(data, "values", "hitRollDice", "diceValues");
      if (diceValues.length > 0) {
        steps.push({ type: "ROLL_DICE", values: diceValues, rollKind: "BATTLE_HIT", durationMs: Math.min(durationMs, 700) });
      }
      const hit = readBoolean(data, "hit");
      addCardGlow(steps, event.targetCardInstanceId, hit === false ? "LOCKED" : "DAMAGE", Math.min(durationMs, 260));
      steps.push({ type: "SHOW_STATUS_CHIP", cardInstanceId: event.targetCardInstanceId, playerId: event.playerId, label: hit === false ? "Miss" : "Hit", durationMs });
      break;
    }

    case "BATTLE_DAMAGE_ROLLED": {
      const diceValues = readNumberArray(data, "values", "damageRollDice", "diceValues");
      if (diceValues.length > 0) {
        steps.push({ type: "ROLL_DICE", values: diceValues, rollKind: "BATTLE_DAMAGE", durationMs: Math.min(durationMs, 700) });
      }
      break;
    }

    case "BATTLE_DAMAGE_PREVENTED":
      addCardGlow(steps, event.targetCardInstanceId ?? event.cardInstanceId, "LOCKED", Math.min(durationMs, 360));
      steps.push({
        type: "SHOW_STATUS_CHIP",
        cardInstanceId: event.targetCardInstanceId ?? event.cardInstanceId,
        playerId: event.playerId,
        label: "Damage prevented",
        durationMs
      });
      break;

    case "BATTLE_DAMAGE_APPLIED": {
      const diceValues = readNumberArray(data, "damageRollDice", "diceValues", "values");
      if (diceValues.length > 0) {
        steps.push({ type: "ROLL_DICE", values: diceValues, rollKind: "BATTLE_DAMAGE", durationMs: Math.min(durationMs, 700) });
      }
      addDamageOrHealSteps(steps, event, data, durationMs);
      const killedCardInstanceId = data.killed === true
        ? event.targetCardInstanceId ?? readString(data, "targetCreatureInstanceId")
        : undefined;
      if (killedCardInstanceId) {
        steps.push({ type: "DESTROY_CARD", cardInstanceId: killedCardInstanceId, durationMs: Math.min(durationMs, 420) });
      }
      break;
    }

    case "CARD_DAMAGED":
      addDamageOrHealSteps(steps, event, data, durationMs);
      break;

    case "CARD_HEALED":
      addDamageOrHealSteps(steps, { ...event, actionType: event.actionType ?? "HEAL" }, data, durationMs);
      break;

    case "STATUS_APPLIED":
    case "STATUS_REMOVED": {
      const label = readString(data, "statusLabel", "label", "status", "effectType") ?? (event.type === "STATUS_REMOVED" ? "Status removed" : "Status");
      addCardGlow(steps, event.cardInstanceId ?? event.targetCardInstanceId, event.type === "STATUS_REMOVED" ? "LOCKED" : "VALID", Math.min(durationMs, 260));
      steps.push({
        type: "SHOW_STATUS_CHIP",
        cardInstanceId: event.cardInstanceId ?? event.targetCardInstanceId,
        playerId: event.playerId,
        label,
        durationMs
      });
      break;
    }

    case "STAT_MODIFIER_APPLIED":
    case "STAT_MODIFIER_REMOVED": {
      const stat = readString(data, "stat", "rollKind") ?? "Stat";
      const delta = readNumber(data, "delta", "amount", "diceLimitValue");
      const label = delta !== undefined ? `${stat} ${delta > 0 ? "+" : ""}${delta}` : stat;
      addCardGlow(steps, event.cardInstanceId ?? event.targetCardInstanceId, event.type === "STAT_MODIFIER_REMOVED" ? "LOCKED" : "VALID", Math.min(durationMs, 260));
      steps.push({
        type: "SHOW_STATUS_CHIP",
        cardInstanceId: event.cardInstanceId ?? event.targetCardInstanceId,
        playerId: event.playerId,
        label,
        durationMs
      });
      break;
    }

    case "PROMPT_OPENED":
    case "EFFECT_PROMPT_OPENED":
      addCardGlow(steps, event.sourceCardInstanceId ?? event.cardInstanceId, "TARGET", durationMs);
      addZoneGlow(steps, event.toZoneRef, "TARGET", durationMs);
      if (event.promptId) {
        steps.push({
          type: "SHOW_STATUS_CHIP",
          cardInstanceId: event.sourceCardInstanceId ?? event.cardInstanceId,
          playerId: event.playerId,
          label: "Prompt",
          durationMs
        });
      }
      break;

    case "PROMPT_RESOLVED":
      addDamageOrHealSteps(steps, event, data, durationMs);
      if (steps.length === 0 && event.promptId) {
        steps.push({
          type: "SHOW_STATUS_CHIP",
          cardInstanceId: event.targetCardInstanceId ?? event.cardInstanceId,
          playerId: event.playerId,
          label: "Resolved",
          durationMs
        });
      }
      break;

    case "CHAIN_RESOLVED":
      steps.push({ type: "SHOW_STATUS_CHIP", playerId: event.playerId, label: "Chain resolved", durationMs });
      break;

    case "CHAIN_PRIORITY_PASSED":
      steps.push({ type: "SHOW_STATUS_CHIP", playerId: event.playerId, label: "Priority passed", durationMs });
      break;

    case "MAGIC_STOLEN":
    case "STOLEN_MAGIC_PLAYED":
    case "STOLEN_MAGIC_SENT_TO_CEMETERY":
      addCardGlow(steps, event.cardInstanceId ?? event.targetCardInstanceId, "CHAIN", Math.min(durationMs, 260));
      addMoveStep(steps, event, durationMs);
      break;

    case "BATTLE_RESOLVED":
      steps.push({ type: "SHOW_STATUS_CHIP", playerId: event.playerId, label: "Battle resolved", durationMs });
      break;

    case "STATE_SYNCED":
      break;
  }

  return steps;
}
