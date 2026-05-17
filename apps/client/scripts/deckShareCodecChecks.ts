import assert from "node:assert/strict";
import type { CardLibraryCardSummary } from "../src/clientTypes";
import { decodeWardDeckString, encodeWardDeckString } from "../src/deckShare";

function buildCard(id: string, generation: number, cardNumber: number): CardLibraryCardSummary {
  return {
    id,
    name: id,
    packId: `gen-${generation}`,
    cardType: "CREATURE",
    generation: String(generation),
    cardNumber: String(cardNumber),
    deckLimit: 3
  };
}

function buildDeck(uniqueIds: string[], copiesPerCard: number): string[] {
  return uniqueIds.flatMap(cardId => Array.from({ length: copiesPerCard }, () => cardId));
}

const packedLibrary = [
  buildCard("gen1-001", 1, 1),
  buildCard("gen1-002", 1, 2),
  buildCard("gen1-003", 1, 3),
  buildCard("gen1-004", 1, 4),
  buildCard("gen1-005", 1, 5),
  buildCard("gen2-006", 2, 6),
  buildCard("gen2-007", 2, 7),
  buildCard("gen2-008", 2, 8),
  buildCard("gen3-009", 3, 9),
  buildCard("gen3-010", 3, 10)
];

const packedCardIds = buildDeck(packedLibrary.map(card => card.id), 3);
const packedCode = encodeWardDeckString({
  cardIds: packedCardIds
}, { cardLibrary: packedLibrary });
const packedDecoded = decodeWardDeckString(packedCode, { cardLibrary: packedLibrary });

assert.equal(packedCode.startsWith("WARDDECK4:"), true);
assert.equal(packedDecoded.cardIds.length, 30);
assert.deepEqual(packedDecoded.cardIds.toSorted(), packedCardIds.toSorted());

const namedPackedCode = encodeWardDeckString({
  name: "Thirty Card Packed Deck",
  deckId: "thirty-card-packed-deck",
  cardIds: packedCardIds,
  format: "TOURNAMENT",
  startingHandSize: 5,
  notes: "Shared deck notes"
}, { cardLibrary: packedLibrary });
const namedPackedDecoded = decodeWardDeckString(namedPackedCode, { cardLibrary: packedLibrary });

assert.equal(namedPackedCode.startsWith("WARDDECK4:"), true);
assert.equal(namedPackedDecoded.name, "Thirty Card Packed Deck");
assert.equal(namedPackedDecoded.deckId, "thirty-card-packed-deck");
assert.equal(namedPackedDecoded.format, "TOURNAMENT");
assert.equal(namedPackedDecoded.startingHandSize, 5);
assert.equal(namedPackedDecoded.notes, "Shared deck notes");
assert.equal(namedPackedDecoded.cardIds.length, 30);
assert.deepEqual(namedPackedDecoded.cardIds.toSorted(), packedCardIds.toSorted());

const highGenerationPackedLibrary = [
  buildCard("gen9-001", 9, 1),
  buildCard("gen9-002", 9, 2),
  buildCard("gen9-003", 9, 3),
  buildCard("gen9-004", 9, 4),
  buildCard("gen9-005", 9, 5),
  buildCard("gen9-006", 9, 6),
  buildCard("gen9-007", 9, 7),
  buildCard("gen9-008", 9, 8),
  buildCard("gen9-009", 9, 9),
  buildCard("gen9-010", 9, 10)
];

const highGenerationPackedCardIds = buildDeck(highGenerationPackedLibrary.map(card => card.id), 3);
const highGenerationPackedCode = encodeWardDeckString({
  cardIds: highGenerationPackedCardIds
}, { cardLibrary: highGenerationPackedLibrary });
const highGenerationPackedDecoded = decodeWardDeckString(highGenerationPackedCode, { cardLibrary: highGenerationPackedLibrary });

assert.equal(highGenerationPackedCode.startsWith("WARDDECK4:"), true);
assert.equal(highGenerationPackedDecoded.cardIds.length, 30);
assert.deepEqual(highGenerationPackedDecoded.cardIds.toSorted(), highGenerationPackedCardIds.toSorted());

assert.throws(
  () => decodeWardDeckString("WARDDECK4SYM:!ae*Tl!@6De@#PQ#", { cardLibrary: packedLibrary }),
  /Deck code must start with WARDDECK4:/
);

console.log("deck share codec checks passed");
