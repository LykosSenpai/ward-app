import type {
  ActiveStatModifier,
  ActiveCreatureStatus,
  ActiveEffectInstance,
  ActiveRecurringCreatureEffect,
  BoardEventType,
  CardDefinition,
  CardInstance,
  MatchState,
  WardEngineEffect
} from "@ward/shared";

type AddEventFn = (state: MatchState, type: string, playerId?: string, payload?: unknown) => void;

type BoardEventPayload = {
  type: BoardEventType;
  cardInstanceId?: string;
  playerId?: string;
  sourceCardInstanceId?: string;
  sourceCardId?: string;
  sourceEffectId?: string;
  actionType?: string;
  reason?: string;
  targetCardInstanceId?: string;
  status?: string;
  statusLabel?: string;
  effectType?: string;
  stat?: string;
  delta?: number;
  modifierId?: string;
  phase?: MatchState["turn"]["phase"];
  turnNumber?: number;
  turnCycleNumber?: number;
};

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

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function sourceEffectText(effect: WardEngineEffect): string {
  const duration = effect.duration ?? effect.params?.duration;

  return [
    effect.trigger,
    effect.actionType,
    effect.effectGroup,
    effect.actionText,
    effect.target,
    effect.value,
    effect.params?.target,
    effect.params?.valueText,
    effect.reusableFunction,
    effect.notes,
    typeof duration === "object" && duration ? duration.text : undefined,
    typeof duration === "object" && duration ? duration.type : undefined
  ].filter(Boolean).join(" ").toLowerCase();
}

function effectExpiresWhenSourceLeaves(effect: WardEngineEffect | undefined): boolean {
  if (!effect) return false;

  const duration = effect.duration ?? effect.params?.duration;
  if (effect.params?.sourceLinked === true || effect.params?.usesAnchoring === true) return true;
  if (effect.params?.expiresWhenSourceLeaves === true) return true;
  if (typeof duration === "object" && duration?.sourceLinked === true) return true;

  const text = sourceEffectText(effect);
  return /source(?:\/target)? leaves/.test(text) ||
    /source leaves/.test(text) ||
    /this card leaves/.test(text) ||
    /until .*source.*leaves/.test(text) ||
    /until .*this card.*leaves/.test(text);
}

function findSourceEffect(sourceDefinition: CardDefinition | undefined, sourceEffectId: string): WardEngineEffect | undefined {
  return sourceDefinition?.effects?.find(effect => effect.id === sourceEffectId);
}

function isWrappedStatus(status: ActiveCreatureStatus): boolean {
  return normalize(status.status) === "WRAPPED" || normalize(status.label) === "WRAPPED";
}

function statusExpiresWhenSourceLeaves(
  status: ActiveCreatureStatus,
  sourceDefinition: CardDefinition | undefined
): boolean {
  if (isWrappedStatus(status)) return true;
  return effectExpiresWhenSourceLeaves(findSourceEffect(sourceDefinition, status.sourceEffectId));
}

function recurringExpiresWhenSourceLeaves(
  recurring: ActiveRecurringCreatureEffect,
  sourceDefinition: CardDefinition | undefined
): boolean {
  return recurring.expiresWhenSourceLeaves === true ||
    effectExpiresWhenSourceLeaves(findSourceEffect(sourceDefinition, recurring.sourceEffectId));
}

function statModifierExpiresWhenSourceLeaves(
  modifier: ActiveStatModifier,
  sourceDefinition: CardDefinition | undefined
): boolean {
  return modifier.durationType === "PERMANENT_UNTIL_SOURCE_REMOVED" ||
    effectExpiresWhenSourceLeaves(findSourceEffect(sourceDefinition, modifier.sourceEffectId));
}

function instanceExpiresWhenSourceLeaves(
  instance: ActiveEffectInstance,
  sourceDefinition: CardDefinition | undefined
): boolean {
  return instance.expiresWhenSourceLeaves === true ||
    instance.sourceLinked === true ||
    effectExpiresWhenSourceLeaves(findSourceEffect(sourceDefinition, instance.sourceEffectId));
}

function collectFieldCreatures(state: MatchState): CardInstance[] {
  const cards: CardInstance[] = [];

  for (const player of state.players) {
    if (player.field.primaryCreature) {
      cards.push(player.field.primaryCreature);
    }
    cards.push(...player.field.limitedSummons);
  }

  return cards;
}

function findCardDefinitionBySourceInstance(
  state: MatchState,
  sourceCardInstanceId: string,
  sourceCardName?: string
): CardDefinition | undefined {
  for (const player of state.players) {
    const cards = [
      player.field.primaryCreature,
      ...player.field.limitedSummons,
      ...player.field.magicSlots,
      ...player.hand,
      ...player.deck,
      ...player.cemetery,
      ...player.removedFromGame
    ].filter((card): card is CardInstance => Boolean(card));

    const found = cards.find(card => card.instanceId === sourceCardInstanceId);
    if (found) {
      return state.cardCatalog[found.cardId];
    }
  }

  const chainCard = state.chainZone.find(card => card.instanceId === sourceCardInstanceId);
  if (chainCard) {
    return state.cardCatalog[chainCard.cardId];
  }

  const normalizedSourceName = sourceCardName?.trim().toLowerCase();
  if (normalizedSourceName) {
    return Object.values(state.cardCatalog).find(definition => definition.name.trim().toLowerCase() === normalizedSourceName);
  }

  return undefined;
}

function timingBoardEventFields(state: MatchState): {
  phase: MatchState["turn"]["phase"];
  turnNumber: number;
  turnCycleNumber: number;
} {
  return {
    phase: state.turn.phase,
    turnNumber: state.turn.turnNumber,
    turnCycleNumber: state.turn.turnCycleNumber
  };
}

export function removeSourceLinkedRuntimeEffectsFromSource(
  state: MatchState,
  args: {
    sourceCardInstanceId: string;
    sourceCardId?: string;
    sourceCardName?: string;
    sourceDefinition?: CardDefinition;
    causedByPlayerId?: string;
    reason?: string;
    addEvent?: AddEventFn;
  }
): number {
  const reason = args.reason ?? "SOURCE_REMOVED_FROM_FIELD";
  const sourceDefinition = args.sourceDefinition ?? findCardDefinitionBySourceInstance(
    state,
    args.sourceCardInstanceId,
    args.sourceCardName
  );
  const sourceCardId = args.sourceCardId ?? sourceDefinition?.id;
  let removedCount = 0;

  for (const card of collectFieldCreatures(state)) {
    const removedStatuses = (card.activeStatuses ?? []).filter(status =>
      status.sourceCardInstanceId === args.sourceCardInstanceId &&
      statusExpiresWhenSourceLeaves(status, sourceDefinition)
    );
    const removedStatusIds = new Set(removedStatuses.map(status => status.id));
    if (removedStatuses.length > 0) {
      card.activeStatuses = (card.activeStatuses ?? []).filter(status => !removedStatusIds.has(status.id));
    }

    const removedRecurring = (card.activeRecurringEffects ?? []).filter(effect =>
      effect.sourceCardInstanceId === args.sourceCardInstanceId &&
      recurringExpiresWhenSourceLeaves(effect, sourceDefinition)
    );
    const removedRecurringIds = new Set(removedRecurring.map(effect => effect.id));
    if (removedRecurring.length > 0) {
      card.activeRecurringEffects = (card.activeRecurringEffects ?? []).filter(effect => !removedRecurringIds.has(effect.id));
    }

    const removedStatModifiers = (card.activeStatModifiers ?? []).filter(modifier =>
      modifier.sourceCardInstanceId === args.sourceCardInstanceId &&
      statModifierExpiresWhenSourceLeaves(modifier, sourceDefinition)
    );
    const removedStatModifierIds = new Set(removedStatModifiers.map(modifier => modifier.id));
    if (removedStatModifiers.length > 0) {
      card.activeStatModifiers = (card.activeStatModifiers ?? []).filter(modifier => !removedStatModifierIds.has(modifier.id));
    }

    const removedInstances = (card.activeEffectInstances ?? []).filter(instance =>
      instance.sourceCardInstanceId === args.sourceCardInstanceId &&
      (
        removedStatusIds.has(instance.id) ||
        removedRecurringIds.has(instance.id) ||
        removedStatModifierIds.has(instance.id) ||
        instanceExpiresWhenSourceLeaves(instance, sourceDefinition)
      )
    );
    const removedInstanceIds = new Set(removedInstances.map(instance => instance.id));
    if (removedInstances.length > 0) {
      card.activeEffectInstances = (card.activeEffectInstances ?? []).filter(instance => !removedInstanceIds.has(instance.id));
    }

    const cardRemovedCount = removedStatuses.length + removedRecurring.length + removedStatModifiers.length + removedInstances.length;
    if (cardRemovedCount === 0) {
      continue;
    }

    removedCount += cardRemovedCount;
    const targetDefinition = state.cardCatalog[card.cardId];
    const targetCardName = targetDefinition?.name ?? card.cardId;
    const boardEvents: BoardEventPayload[] = [
      {
        type: "SOURCE_LINK_CLEANUP_TRIGGERED",
        playerId: args.causedByPlayerId,
        sourceCardInstanceId: args.sourceCardInstanceId,
        sourceCardId,
        actionType: "APPLY_SOURCE_LINKED_CLEANUP",
        reason,
        cardInstanceId: card.instanceId,
        targetCardInstanceId: card.instanceId,
        ...timingBoardEventFields(state)
      },
      ...removedStatuses.map(status => ({
        type: "STATUS_REMOVED" as BoardEventType,
        playerId: status.sourcePlayerId,
        sourceCardInstanceId: status.sourceCardInstanceId,
        sourceCardId,
        sourceEffectId: status.sourceEffectId,
        actionType: "APPLY_STATUS",
        reason,
        cardInstanceId: card.instanceId,
        targetCardInstanceId: card.instanceId,
        status: status.status,
        statusLabel: status.label,
        ...timingBoardEventFields(state)
      })),
      ...removedRecurring.map(effect => ({
        type: "STATUS_REMOVED" as BoardEventType,
        playerId: effect.sourcePlayerId,
        sourceCardInstanceId: effect.sourceCardInstanceId,
        sourceCardId,
        sourceEffectId: effect.sourceEffectId,
        actionType: effect.effectType === "HEAL_OVER_TIME" ? "APPLY_HEALING_OVER_TIME" : "APPLY_DAMAGE_OVER_TIME",
        reason,
        cardInstanceId: card.instanceId,
        targetCardInstanceId: card.instanceId,
        status: effect.effectType,
        statusLabel: effect.label,
        effectType: effect.effectType,
        ...timingBoardEventFields(state)
      })),
      ...removedStatModifiers.map(modifier => ({
        type: "STAT_MODIFIER_REMOVED" as BoardEventType,
        playerId: args.causedByPlayerId,
        sourceCardInstanceId: modifier.sourceCardInstanceId,
        sourceCardId,
        sourceEffectId: modifier.sourceEffectId,
        actionType: "APPLY_STAT_MODIFIER",
        reason,
        cardInstanceId: card.instanceId,
        targetCardInstanceId: card.instanceId,
        stat: modifier.stat,
        delta: modifier.delta,
        modifierId: modifier.id,
        ...timingBoardEventFields(state)
      }))
    ];

    args.addEvent?.(state, "SOURCE_LINKED_RUNTIME_EFFECTS_REMOVED", args.causedByPlayerId, {
      sourceCardInstanceId: args.sourceCardInstanceId,
      sourceCardId,
      sourceCardName: args.sourceCardName ?? sourceDefinition?.name,
      targetCardInstanceId: card.instanceId,
      targetCardName,
      reason,
      removedStatusCount: removedStatuses.length,
      removedRecurringEffectCount: removedRecurring.length,
      removedStatModifierCount: removedStatModifiers.length,
      removedEffectInstanceCount: removedInstances.length,
      removedStatuses: removedStatuses.map(status => ({
        id: status.id,
        sourceEffectId: status.sourceEffectId,
        status: status.status,
        label: status.label
      })),
      boardEvents
    });
  }

  return removedCount;
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
