import type {
  ActiveCreatureStatus,
  ActiveEffectInstance,
  ActiveRecurringCreatureEffect,
  CardInstance,
  MatchState
} from "@ward/shared";

export function ensureActiveEffectInstances(card: CardInstance): ActiveEffectInstance[] {
  card.activeEffectInstances ??= [];
  return card.activeEffectInstances;
}

export function addActiveEffectInstance(card: CardInstance, instance: ActiveEffectInstance): ActiveEffectInstance {
  const list = ensureActiveEffectInstances(card);
  const existingIndex = list.findIndex(item => item.id === instance.id);

  if (existingIndex >= 0) {
    list[existingIndex] = instance;
  } else {
    list.push(instance);
  }

  return instance;
}

export function removeActiveEffectInstance(card: CardInstance, instanceId: string): void {
  if (!card.activeEffectInstances) return;
  card.activeEffectInstances = card.activeEffectInstances.filter(item => item.id !== instanceId);
}

export function removeActiveEffectInstancesFromSource(card: CardInstance, sourceCardInstanceId: string): void {
  if (!card.activeEffectInstances) return;
  card.activeEffectInstances = card.activeEffectInstances.filter(item => item.sourceCardInstanceId !== sourceCardInstanceId);
}

export function syncStatusActiveEffectInstance(card: CardInstance, status: ActiveCreatureStatus): void {
  addActiveEffectInstance(card, {
    id: status.id,
    kind: "STATUS",
    sourceEffectId: status.sourceEffectId,
    sourceCardInstanceId: status.sourceCardInstanceId,
    sourceCardName: status.sourceCardName,
    sourcePlayerId: status.sourcePlayerId,
    targetCardInstanceId: card.instanceId,
    targetPlayerId: card.controllerPlayerId,
    actionType: "APPLY_STATUS",
    label: status.label,
    status: status.status,
    durationType: status.durationType,
    expiresOnPlayerId: status.expiresOnPlayerId,
    expiresAtPlayerTurnStartCount: status.expiresAtPlayerTurnStartCount,
    preventsAttackDamage: status.flags.canInflictAtkDamage === false,
    preventsSacrifice: status.flags.canBeSacrificed === false,
    preventsBattle: status.flags.canInitiateBattle === false,
    preventsHpDamage: status.flags.canReceiveDamage === false,
    preventsControlChange: status.flags.canChangeControl === false,
    preventsFieldRemoval: status.flags.canBeRemovedFromField === false,
    appliedTurnNumber: status.appliedTurnNumber,
    appliedTurnCycle: status.appliedTurnCycle,
    debug: [
      `Status ${status.status} applied by ${status.sourceCardName}.`,
      status.expiresOnPlayerId
        ? `Expires on ${status.expiresOnPlayerId} turn start #${status.expiresAtPlayerTurnStartCount}.`
        : "No turn-start expiration was assigned."
    ]
  });
}

export function syncRecurringActiveEffectInstance(card: CardInstance, recurring: ActiveRecurringCreatureEffect): void {
  addActiveEffectInstance(card, {
    id: recurring.id,
    kind: recurring.effectType,
    sourceEffectId: recurring.sourceEffectId,
    sourceCardInstanceId: recurring.sourceCardInstanceId,
    sourceCardName: recurring.sourceCardName,
    sourcePlayerId: recurring.sourcePlayerId,
    targetCardInstanceId: card.instanceId,
    targetPlayerId: card.controllerPlayerId,
    actionType: recurring.effectType,
    label: recurring.label,
    amount: recurring.amount,
    durationType: recurring.durationType,
    expiresOnPlayerId: recurring.expiresOnPlayerId,
    expiresAtPlayerTurnStartCount: recurring.expiresAtPlayerTurnStartCount,
    tickTiming: recurring.tickTiming,
    ticksRemaining: recurring.remainingTicks,
    nextTickPlayerId: recurring.nextTickPlayerId,
    nextTickTurnStartCount: recurring.nextTickTurnStartCount,
    appliedSequenceNumber: recurring.appliedSequenceNumber,
    refreshAtEndOfSourceOwnerTurn: recurring.refreshAtEndOfSourceOwnerTurn,
    refreshAmount: recurring.refreshAmount,
    maxRefreshCounter: recurring.maxRefreshCounter,
    expiresWhenSourceLeaves: recurring.expiresWhenSourceLeaves,
    healImmediatelyOnApply: recurring.healImmediatelyOnApply,
    appliedTurnNumber: recurring.appliedTurnNumber,
    appliedTurnCycle: recurring.appliedTurnCycle,
    debug: [
      `${recurring.effectType} ${recurring.amount} is active from ${recurring.sourceCardName}.`,
      `${recurring.remainingTicks} tick(s) remaining.`,
      recurring.healImmediatelyOnApply
        ? "Resolved an immediate heal when applied."
        : "No immediate heal on apply.",
      recurring.refreshAtEndOfSourceOwnerTurn
        ? `Refreshes +${recurring.refreshAmount ?? 1} at the end of the source owner's turn.`
        : "No end-turn counter refresh.",
      recurring.nextTickPlayerId
        ? `Next tick: ${recurring.nextTickPlayerId} ${recurring.tickTiming} at turn start #${recurring.nextTickTurnStartCount}.`
        : "Next tick is not scheduled."
    ]
  });
}

export function normalizeAllActiveEffectInstances(state: MatchState): void {
  for (const player of state.players) {
    const cards = [
      player.field.primaryCreature,
      ...player.field.limitedSummons
    ].filter((card): card is CardInstance => !!card);

    for (const card of cards) {
      card.activeEffectInstances = (card.activeEffectInstances ?? []).filter(item => !!item.id && !!item.sourceEffectId && !!item.sourceCardInstanceId);

      for (const status of card.activeStatuses ?? []) {
        if (!card.activeEffectInstances.some(item => item.id === status.id)) {
          syncStatusActiveEffectInstance(card, status);
        }
      }

      for (const recurring of card.activeRecurringEffects ?? []) {
        if (!card.activeEffectInstances.some(item => item.id === recurring.id)) {
          syncRecurringActiveEffectInstance(card, recurring);
        }
      }
    }
  }
}
