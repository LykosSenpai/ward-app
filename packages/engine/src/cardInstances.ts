import { v4 as uuidv4 } from "uuid";
import type { CardDefinition, CardInstance } from "@ward/shared";

export function createDeckFromCardIds(
  playerId: string,
  cardIds: string[],
  cardCatalog: Record<string, CardDefinition>
): CardInstance[] {
  return cardIds.map(cardId => {
    const definition = cardCatalog[cardId];

    if (!definition) {
      throw new Error(`Deck contains unknown card ID: ${cardId}`);
    }

    const card: CardInstance = {
      instanceId: uuidv4(),
      cardId,
      ownerPlayerId: playerId,
      controllerPlayerId: playerId,
      zone: "DECK"
    };

    if (definition.cardType === "CREATURE") {
      return {
        ...card,
        currentHp: definition.hp,
        baseHp: definition.hp
      };
    }

    return card;
  });
}