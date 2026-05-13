import type { CardInstance } from "@ward/shared";
import type { AppMatchState } from "../clientTypes";
import type { BoardAttackAnimation } from "./boardPreview3d/BoardPreview3DTable";
import type { BoardObject } from "./boardPreview3dAdapter";
import { BOARD_SLOTS } from "./boardPreview3dLayout";
import type { BoardRenderEvent } from "./boardRenderContracts";

export type BoardAnimationHighlights = {
  slotIds: string[];
  pieceIds: string[];
};

function getAttackAnimationTheme(creatureType: string | undefined): BoardAttackAnimation["theme"] {
  switch ((creatureType ?? "").toLowerCase()) {
    case "beast":
    case "dinosaur":
      return "beast";
    case "bug":
      return "bug";
    case "cosmic":
      return "cosmic";
    case "demon":
      return "demon";
    case "dragon":
      return "dragon";
    case "elemental":
      return "elemental";
    case "humanoid":
    case "human":
      return "humanoid";
    case "mechanical":
      return "mechanical";
    case "undead":
      return "undead";
    default:
      return "generic";
  }
}

export function planBoardAttackAnimation(params: {
  activeEvent: BoardRenderEvent | null | undefined;
  boardObjects: BoardObject[];
  cardByInstanceId: Map<string, CardInstance>;
  cardCatalog: AppMatchState["cardCatalog"];
}): BoardAttackAnimation | null {
  const { activeEvent, boardObjects, cardByInstanceId, cardCatalog } = params;
  if (activeEvent?.type !== "BATTLE_DAMAGE_APPLIED" || !activeEvent.payload || typeof activeEvent.payload !== "object") {
    return null;
  }

  const payload = activeEvent.payload as Record<string, unknown>;
  const attackerCreatureInstanceId = typeof payload.attackerCreatureInstanceId === "string" ? payload.attackerCreatureInstanceId : null;
  const targetCreatureInstanceId = typeof payload.targetCreatureInstanceId === "string" ? payload.targetCreatureInstanceId : null;
  if (!attackerCreatureInstanceId || !targetCreatureInstanceId) return null;

  const sourceObject = boardObjects.find(object => object.cardInstanceId === attackerCreatureInstanceId);
  const targetObject = boardObjects.find(object => object.cardInstanceId === targetCreatureInstanceId);
  if (!sourceObject || !targetObject) return null;

  const attackerCard = cardByInstanceId.get(attackerCreatureInstanceId);
  const attackerDefinition = attackerCard ? cardCatalog[attackerCard.cardId] : undefined;
  const creatureType = attackerDefinition?.cardType === "CREATURE"
    ? attackerDefinition.creatureType
    : "Creature";
  const rawDamageAmount = payload.damageAmount;
  const damageAmount = typeof rawDamageAmount === "number" ? rawDamageAmount : 0;
  const damageRollDice = Array.isArray(payload.damageRollDice)
    ? payload.damageRollDice.filter((value): value is number => typeof value === "number")
    : [];

  return {
    id: activeEvent.eventId,
    sourcePieceId: sourceObject.id,
    targetPieceId: targetObject.id,
    creatureType,
    theme: getAttackAnimationTheme(creatureType),
    damageAmount,
    damageRollDice,
    killed: payload.killed === true
  };
}

export function getBoardAnimationHighlights(params: {
  activeEvent: BoardRenderEvent | null | undefined;
  boardObjects: BoardObject[];
}): BoardAnimationHighlights {
  const { activeEvent, boardObjects } = params;
  if (!activeEvent) return { slotIds: [], pieceIds: [] };
  const candidateSlotIds = activeEvent.visualTargets.slotIds.filter(value =>
    BOARD_SLOTS.some(slot => slot.id === value)
  );
  const instanceIds = activeEvent.visualTargets.cardInstanceIds;
  const pieceIds = boardObjects
    .filter(object => instanceIds.some(instanceId => object.id.includes(instanceId)))
    .map(object => object.id);
  return { slotIds: [...new Set(candidateSlotIds)], pieceIds: [...new Set(pieceIds)] };
}
