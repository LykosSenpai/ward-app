import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const PACK_IDS = (process.env.WARD_QA_TEST_PACK_IDS ?? "ward-gen1,ward-gen2,ward-gen3")
  .split(",")
  .map(packId => packId.trim())
  .filter(Boolean);
const DECK_SIZE = Number(process.env.WARD_QA_TEST_DECK_SIZE ?? "30");
const DECK_ID_PREFIX = process.env.WARD_QA_TEST_DECK_ID_PREFIX?.trim() || "qa-test";
const DECK_NAME_PREFIX = process.env.WARD_QA_TEST_DECK_NAME_PREFIX?.trim() || "QA test";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function byCardId(left, right) {
  return left.id.localeCompare(right.id, undefined, { numeric: true });
}

function chunk(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

if (!Number.isInteger(DECK_SIZE) || DECK_SIZE <= 0) {
  throw new Error("WARD_QA_TEST_DECK_SIZE must be a positive integer.");
}

const cards = PACK_IDS.flatMap(packId => {
  const packPath = path.join(ROOT_DIR, "data", "cards", "packs", `${packId}.json`);
  const pack = readJson(packPath);

  return pack.cards.map(card => ({
    id: card.id,
    name: card.name,
    cardType: card.cardType,
    packId
  }));
}).sort(byCardId);

const duplicateCardIds = cards
  .map(card => card.id)
  .filter((cardId, index, cardIds) => cardIds.indexOf(cardId) !== index);

if (duplicateCardIds.length > 0) {
  throw new Error(`Duplicate card IDs found: ${Array.from(new Set(duplicateCardIds)).join(", ")}`);
}

const decks = chunk(cards, DECK_SIZE).map((deckCards, deckIndex) => {
  const deckNumber = deckIndex + 1;
  const cardIds = deckCards.map(card => card.id);

  if (cardIds.length < DECK_SIZE) {
    const fillerIds = cards
      .map(card => card.id)
      .filter(cardId => !cardIds.includes(cardId))
      .slice(0, DECK_SIZE - cardIds.length);

    cardIds.push(...fillerIds);
  }

  if (cardIds.length !== DECK_SIZE) {
    throw new Error(`Unable to fill ${DECK_ID_PREFIX}-${String(deckNumber).padStart(3, "0")} to ${DECK_SIZE} cards.`);
  }

  return {
    id: `${DECK_ID_PREFIX}-${String(deckNumber).padStart(3, "0")}`,
    name: `${DECK_NAME_PREFIX} ${String(deckNumber).padStart(3, "0")}`,
    cardIds
  };
});

const outputDir = path.join(ROOT_DIR, "data", "decks");
fs.mkdirSync(outputDir, { recursive: true });

for (const deck of decks) {
  fs.writeFileSync(
    path.join(outputDir, `${deck.id}.json`),
    `${JSON.stringify(deck, null, 2)}\n`,
    "utf8"
  );
}

const uniqueCoveredCardIds = new Set(decks.flatMap(deck => deck.cardIds));
const missingCardIds = cards
  .map(card => card.id)
  .filter(cardId => !uniqueCoveredCardIds.has(cardId));

if (missingCardIds.length > 0) {
  throw new Error(`Generated decks missed ${missingCardIds.length} card(s): ${missingCardIds.join(", ")}`);
}

console.log(JSON.stringify({
  packIds: PACK_IDS,
  sourceCards: cards.length,
  deckSize: DECK_SIZE,
  generatedDecks: decks.length,
  outputDir,
  firstDeck: decks[0]?.id,
  lastDeck: decks.at(-1)?.id,
  fillerCopies: decks.length * DECK_SIZE - cards.length
}, null, 2));
