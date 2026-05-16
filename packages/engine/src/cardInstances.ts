import { v4 as uuidv4 } from "uuid";
import type { CardDefinition, CardInstance } from "@ward/shared";

function normalizeCardArtKey(value: string | undefined): CardInstance["artKey"] {
  return value === "holo" || value === "zero-art" || value === "zero-art-holo"
    ? value
    : undefined;
}

export function createDeckFromCardIds(
  playerId: string,
  cardIds: string[],
  cardCatalog: Record<string, CardDefinition>,
  cardArtKeys?: string[]
): CardInstance[] {
  return cardIds.map((cardId, index) => {
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
    const artKey = normalizeCardArtKey(cardArtKeys?.[index]);
    if (artKey) card.artKey = artKey;

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
