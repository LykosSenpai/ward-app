import type { MatchState } from "@ward/shared";
import { calculateCemeteryCreatureHp } from "./cemetery.js";
import { moveAttachedMagicCardsToCemeteryForCreature } from "./attachments.js";
import { addEvent, cloneState, getCardDefinition, getPlayer } from "./engineRuntime.js";
import {
  ensureNoHandDiscardRequired,
  ensureNoOpenChain,
  ensureNoPendingManualEffects
} from "./actionGuards.js";

export function applyManualDamageToPrimaryCreature(
  state: MatchState,
  playerId: string,
  damageAmount: number
): MatchState {
  if (state.pendingPrompt) {
    throw new Error("Resolve the pending prompt before applying damage.");
  }

  ensureNoHandDiscardRequired(state);
  ensureNoOpenChain(state);
  ensureNoPendingManualEffects(state);

  if (state.setup.primaryReplacementRequiredForPlayerId) {
    throw new Error("Resolve the required primary creature replacement before applying damage.");
  }

  if (!Number.isFinite(damageAmount) || damageAmount <= 0) {
    throw new Error("Damage amount must be greater than 0.");
  }

  const nextState = cloneState(state);
  const player = getPlayer(nextState, playerId);

  const primaryCreature = player.field.primaryCreature;

  if (!primaryCreature) {
    throw new Error("Player has no primary creature.");
  }

  const definition = getCardDefinition(nextState, primaryCreature);

  if (definition.cardType !== "CREATURE") {
    throw new Error("Primary card is not a creature.");
  }

  const currentHp = primaryCreature.currentHp ?? primaryCreature.baseHp ?? definition.hp;
  const nextHp = Math.max(0, currentHp - damageAmount);

  primaryCreature.currentHp = nextHp;

  if (nextHp === 0) {
    primaryCreature.zone = "CEMETERY";

    player.field.primaryCreature = undefined;
    player.cemetery.push(primaryCreature);
    player.cemeteryCreatureHpTotal = calculateCemeteryCreatureHp(player);

    moveAttachedMagicCardsToCemeteryForCreature(
      nextState,
      primaryCreature.instanceId,
      addEvent
    );

    nextState.setup.primaryReplacementRequiredForPlayerId = playerId;
  }

  addEvent(nextState, "MANUAL_DAMAGE_APPLIED", playerId, {
    cardInstanceId: primaryCreature.instanceId,
    cardName: definition.name,
    damageAmount,
    remainingHp: nextHp,
    killed: nextHp === 0,
    cemeteryCreatureHpTotal: player.cemeteryCreatureHpTotal
  });

  return nextState;
}

export function applyManualHealToPrimaryCreature(
  state: MatchState,
  playerId: string,
  healAmount: number
): MatchState {
  if (state.pendingPrompt) {
    throw new Error("Resolve the pending prompt before applying healing.");
  }

  ensureNoHandDiscardRequired(state);
  ensureNoOpenChain(state);
  ensureNoPendingManualEffects(state);

  if (state.setup.primaryReplacementRequiredForPlayerId) {
    throw new Error("Resolve the required primary creature replacement before applying healing.");
  }

  if (!Number.isFinite(healAmount) || healAmount <= 0) {
    throw new Error("Heal amount must be greater than 0.");
  }

  const nextState = cloneState(state);
  const player = getPlayer(nextState, playerId);

  const primaryCreature = player.field.primaryCreature;

  if (!primaryCreature) {
    throw new Error("Player has no primary creature.");
  }

  const definition = getCardDefinition(nextState, primaryCreature);

  if (definition.cardType !== "CREATURE") {
    throw new Error("Primary card is not a creature.");
  }

  const maxHp = primaryCreature.baseHp ?? definition.hp;
  const currentHp = primaryCreature.currentHp ?? maxHp;
  const nextHp = Math.min(maxHp, currentHp + healAmount);

  primaryCreature.currentHp = nextHp;

  addEvent(nextState, "MANUAL_HEAL_APPLIED", playerId, {
    cardInstanceId: primaryCreature.instanceId,
    cardName: definition.name,
    healAmount,
    remainingHp: nextHp,
    maxHp
  });

  return nextState;
}
