import type { BoardAffordance, BoardZoneKind, BoardZoneRef, CardInstance } from "@ward/shared";
import type { AppMatchState } from "../clientTypes";
import { canSummonCreatureFromHand, getRequiredSacrificesForCard, isCreature, isMagic } from "../gameViewHelpers";
import type { BoardObject } from "./boardPreview3dAdapter";
import type { BoardPlayerId } from "./boardPreview3dTypes";

export type BoardEffectTargetOption = {
  optionId: string;
  pieceId?: string;
  slotId?: string;
};

type PendingEffectTargetOption = NonNullable<AppMatchState["pendingEffectTargetPrompt"]>["options"][number];

type HandCardSlotParams = {
  match: AppMatchState;
  handCards: CardInstance[];
  focusedPlayer: AppMatchState["players"][number] | null;
  focusedPlayerId: BoardPlayerId;
  controlledPlayerId: BoardPlayerId | null;
  occupiedSlotIds: Set<string>;
  selectedSacrificeIdsByCard: Record<string, string[]>;
  canDiscardHandCardToCemetery: boolean;
};

function canControlPlayer(controlledPlayerId: BoardPlayerId | null, playerId: string): boolean {
  return !controlledPlayerId || controlledPlayerId === playerId;
}

function mapEffectTargetZoneToBoardZoneKind(zone: PendingEffectTargetOption["zone"]): BoardZoneKind {
  switch (zone) {
    case "HAND":
      return "HAND";
    case "DECK":
      return "DECK";
    case "CEMETERY":
      return "CEMETERY";
    case "REMOVED_FROM_GAME":
      return "REMOVED_FROM_GAME";
    case "PRIMARY_CREATURE":
      return "PRIMARY_CREATURE";
    case "LIMITED_SUMMON":
      return "LIMITED_SUMMON";
    case "MAGIC_SLOT":
      return "MAGIC_SLOT";
    case "PLAYER":
    default:
      return "PROMPT";
  }
}

function getEffectTargetZoneRef(option: PendingEffectTargetOption): BoardZoneRef {
  return {
    playerId: option.playerId,
    zone: mapEffectTargetZoneToBoardZoneKind(option.zone)
  };
}

function getHandCardPlayContext(params: HandCardSlotParams) {
  const { match, focusedPlayer, focusedPlayerId, controlledPlayerId, canDiscardHandCardToCemetery } = params;
  if (!focusedPlayer) return null;

  const isMatchComplete = match.status === "COMPLETE";
  const anyDiscardRequired = Boolean(match.setup.handDiscardRequiredForPlayerId);
  const replacementRequiredForThisPlayer =
    match.setup.primaryReplacementRequiredForPlayerId === focusedPlayer.id;
  const limitedSummonPromotionRequiredForThisPlayer =
    replacementRequiredForThisPlayer && focusedPlayer.field.limitedSummons.length > 0;
  const canControlThisPlayer = canControlPlayer(controlledPlayerId, focusedPlayer.id);

  if (
    match.setup.handDiscardRequiredForPlayerId === focusedPlayer.id &&
    canControlThisPlayer &&
    canDiscardHandCardToCemetery
  ) {
    return {
      discardSlotIds: [`${focusedPlayerId}-cemetery`],
      canPlayPrimaryNow: false,
      canPlayMagicNow: false
    };
  }

  const isActivePlayer = match.turn.activePlayerId === focusedPlayer.id;
  return {
    discardSlotIds: [] as string[],
    canPlayPrimaryNow:
      !isMatchComplete &&
      canControlThisPlayer &&
      !match.pendingPrompt &&
      !match.pendingChain &&
      !anyDiscardRequired &&
      !limitedSummonPromotionRequiredForThisPlayer &&
      (replacementRequiredForThisPlayer ||
        (isActivePlayer &&
          match.turn.phase === "SUMMON_MAGIC" &&
          !focusedPlayer.turnFlags.normalSummonUsed)),
    canPlayMagicNow:
      !isMatchComplete &&
      canControlThisPlayer &&
      isActivePlayer &&
      !match.pendingPrompt &&
      !match.pendingChain &&
      !anyDiscardRequired &&
      !match.setup.primaryReplacementRequiredForPlayerId &&
      (match.turn.phase === "SUMMON_MAGIC" || match.turn.phase === "SECOND_MAGIC")
  };
}

export function getLegalTargetSlotIdsForHandCard(params: HandCardSlotParams & { cardInstanceId: string }): string[] {
  const selectedCard = params.handCards.find(card => card.instanceId === params.cardInstanceId);
  const context = getHandCardPlayContext(params);
  if (!selectedCard || !params.focusedPlayer || !context) return [];
  if (context.discardSlotIds.length > 0) return context.discardSlotIds;

  if (isCreature(params.match, selectedCard)) {
    const requiredSacrifices = getRequiredSacrificesForCard(params.match, selectedCard);
    const selectedSacrifices = params.selectedSacrificeIdsByCard[params.cardInstanceId] ?? [];
    const hasEnoughSelectedSacrifices = selectedSacrifices.length >= requiredSacrifices;
    return context.canPlayPrimaryNow &&
      hasEnoughSelectedSacrifices &&
      canSummonCreatureFromHand(params.match, params.focusedPlayer, selectedCard)
      ? [`${params.focusedPlayerId}-primary`]
      : [];
  }

  if (isMagic(params.match, selectedCard)) {
    return context.canPlayMagicNow
      ? Array.from({ length: 5 }, (_, index) => `${params.focusedPlayerId}-magic-${index + 1}`)
        .filter(slotId => !params.occupiedSlotIds.has(slotId))
      : [];
  }

  return [];
}

export function getVisualTargetSlotIdsForHandCard(params: HandCardSlotParams & { cardInstanceId: string }): string[] {
  const selectedCard = params.handCards.find(card => card.instanceId === params.cardInstanceId);
  const context = getHandCardPlayContext(params);
  if (!selectedCard || !params.focusedPlayer || !context) return [];
  if (context.discardSlotIds.length > 0) return context.discardSlotIds;

  if (
    isCreature(params.match, selectedCard) &&
    context.canPlayPrimaryNow &&
    canSummonCreatureFromHand(params.match, params.focusedPlayer, selectedCard)
  ) {
    return [`${params.focusedPlayerId}-primary`];
  }

  return getLegalTargetSlotIdsForHandCard(params);
}

export function getBoardEffectTargetOptions(params: {
  match: AppMatchState;
  boardObjects: BoardObject[];
  controlledPlayerId: BoardPlayerId | null;
}): BoardEffectTargetOption[] {
  const { match, boardObjects, controlledPlayerId } = params;
  const affordanceOptions = getBoardEffectTargetOptionsFromAffordances({
    affordances: buildBoardAffordances({ match, controlledPlayerId }),
    boardObjects
  });
  if (affordanceOptions.length > 0) return affordanceOptions;

  const prompt = match.pendingEffectTargetPrompt;
  if (!prompt) return [];
  if (controlledPlayerId && controlledPlayerId !== prompt.controllerPlayerId) return [];

  return prompt.options.flatMap(option => {
    if (!option.cardInstanceId) return [];
    const object = boardObjects.find(candidate => candidate.cardInstanceId === option.cardInstanceId);
    if (!object || !["primary", "limited", "magic"].includes(object.lane)) return [];
    return [{
      optionId: option.id,
      pieceId: object.id,
      slotId: object.slotId
    }];
  });
}

export function buildBoardAffordances(params: {
  match: AppMatchState;
  controlledPlayerId: BoardPlayerId | null;
}): BoardAffordance[] {
  return buildPendingEffectTargetAffordances(params);
}

export function buildPendingEffectTargetAffordances(params: {
  match: AppMatchState;
  controlledPlayerId: BoardPlayerId | null;
}): BoardAffordance[] {
  const prompt = params.match.pendingEffectTargetPrompt;
  if (!prompt) return [];
  if (params.controlledPlayerId && params.controlledPlayerId !== prompt.controllerPlayerId) return [];

  return prompt.options.map(option => ({
    id: `${prompt.id}:${option.id}`,
    kind: option.cardInstanceId ? "VALID_TARGET_CARD" : "VALID_TARGET_ZONE",
    playerId: prompt.controllerPlayerId,
    sourceCardInstanceId: prompt.sourceCardInstanceId,
    targetCardInstanceId: option.cardInstanceId,
    targetZoneRef: getEffectTargetZoneRef(option),
    promptId: prompt.id,
    actionId: option.id,
    label: option.label,
    highlightStyle: "TARGET"
  }));
}

export function getBoardEffectTargetOptionsFromAffordances(params: {
  affordances: BoardAffordance[];
  boardObjects: BoardObject[];
}): BoardEffectTargetOption[] {
  return params.affordances.flatMap(affordance => {
    if (
      affordance.kind !== "VALID_TARGET_CARD" ||
      !affordance.targetCardInstanceId ||
      !affordance.actionId
    ) {
      return [];
    }

    const object = params.boardObjects.find(candidate => candidate.cardInstanceId === affordance.targetCardInstanceId);
    if (!object || !["primary", "limited", "magic"].includes(object.lane)) return [];
    return [{
      optionId: affordance.actionId,
      pieceId: object.id,
      slotId: object.slotId
    }];
  });
}

export function getUniqueEffectTargetSlotIds(options: BoardEffectTargetOption[]): string[] {
  return [...new Set(options.map(option => option.slotId).filter((slotId): slotId is string => Boolean(slotId)))];
}

export function getUniqueEffectTargetPieceIds(options: BoardEffectTargetOption[]): string[] {
  return [...new Set(options.map(option => option.pieceId).filter((pieceId): pieceId is string => Boolean(pieceId)))];
}

export function getEffectSourcePieceIds(params: {
  match: AppMatchState;
  boardObjects: BoardObject[];
}): string[] {
  const prompt = params.match.pendingEffectTargetPrompt;
  if (!prompt) return [];
  const sourceObject = params.boardObjects.find(object => object.cardInstanceId === prompt.sourceCardInstanceId);
  return sourceObject ? [sourceObject.id] : [];
}

export function getEffectTargetOptionByCardId(params: {
  match: AppMatchState;
  controlledPlayerId: BoardPlayerId | null;
}): Map<string, string> {
  const prompt = params.match.pendingEffectTargetPrompt;
  const options = new Map<string, string>();
  if (!prompt) return options;
  if (params.controlledPlayerId && params.controlledPlayerId !== prompt.controllerPlayerId) return options;
  for (const option of prompt.options) {
    if (option.cardInstanceId) options.set(option.cardInstanceId, option.id);
  }
  return options;
}

export function getEffectTargetOptionByCardIdFromAffordances(affordances: BoardAffordance[]): Map<string, string> {
  const options = new Map<string, string>();
  for (const affordance of affordances) {
    if (
      affordance.kind === "VALID_TARGET_CARD" &&
      affordance.targetCardInstanceId &&
      affordance.actionId
    ) {
      options.set(affordance.targetCardInstanceId, affordance.actionId);
    }
  }
  return options;
}
