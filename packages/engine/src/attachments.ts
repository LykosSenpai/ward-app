import type { MatchState } from "@ward/shared";
import { calculateCemeteryCreatureHp } from "./cemetery.js";
import { removeStatModifiersFromSourceCard } from "./effectiveStats.js";
import { removeActiveEffectInstancesFromSource } from "./activeEffectInstances.js";

type AddEventFn = (
  state: MatchState,
  type: string,
  playerId?: string,
  payload?: unknown
) => void;

function getPlayerOrThrow(state: MatchState, playerId: string) {
  const player = state.players.find(p => p.id === playerId);

  if (!player) {
    throw new Error(`Player not found: ${playerId}`);
  }

  return player;
}

export function moveAttachedMagicCardsToCemeteryForCreature(
  state: MatchState,
  creatureInstanceId: string,
  addEvent?: AddEventFn
): void {
  for (const fieldOwner of state.players) {
    const attachedMagicCards = fieldOwner.field.magicSlots.filter(
      card => card.attachedToInstanceId === creatureInstanceId
    );

    for (const magicCard of attachedMagicCards) {
      const magicSlotIndex = fieldOwner.field.magicSlots.findIndex(
        card => card.instanceId === magicCard.instanceId
      );

      if (magicSlotIndex === -1) {
        continue;
      }

      fieldOwner.field.magicSlots.splice(magicSlotIndex, 1);

      const ownerPlayer = getPlayerOrThrow(state, magicCard.ownerPlayerId);
      const definition = state.cardCatalog[magicCard.cardId];

      magicCard.zone = "CEMETERY";
      magicCard.attachedToInstanceId = undefined;

      ownerPlayer.cemetery.push(magicCard);
      ownerPlayer.cemeteryCreatureHpTotal =
        calculateCemeteryCreatureHp(ownerPlayer);

      removeStatModifiersFromSourceCard(state, magicCard.instanceId);
      for (const player of state.players) {
        if (player.field.primaryCreature) {
          removeActiveEffectInstancesFromSource(player.field.primaryCreature, magicCard.instanceId);
        }
        for (const creature of player.field.limitedSummons) {
          removeActiveEffectInstancesFromSource(creature, magicCard.instanceId);
        }
      }

      addEvent?.(state, "ATTACHED_MAGIC_SENT_TO_CEMETERY", fieldOwner.id, {
        magicCardInstanceId: magicCard.instanceId,
        magicCardName: definition?.name ?? magicCard.cardId,
        attachedCreatureInstanceId: creatureInstanceId,
        fieldOwnerPlayerId: fieldOwner.id,
        cardOwnerPlayerId: ownerPlayer.id
      });
    }
  }
}
