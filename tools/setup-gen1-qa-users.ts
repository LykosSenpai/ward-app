import bcrypt from "bcryptjs";

import { validateDeckCardIds } from "@ward/engine";
import type { CardDefinition } from "@ward/shared";

import "../apps/server/src/env/loadEnvFile.js";
import { closeDbPool, getDbPool } from "../apps/server/src/db/pool.js";
import {
  loadCardCatalog,
  saveUserDeckListToDisk
} from "../apps/server/src/dataStore.js";

const QA_GENERATION = process.env.WARD_QA_GENERATION?.trim() || "1";
const QA_LABEL = `Gen${QA_GENERATION}`;
const PACK_ID = `ward-gen${QA_GENERATION}`;
const QA_PASSWORD = process.env[`WARD_GEN${QA_GENERATION}_QA_PASSWORD`]?.trim() || `WardGen${QA_GENERATION}QA!2026`;
const DECK_COUNT = 10;

const QA_USERS = [
  {
    username: `gen${QA_GENERATION}_qa_alpha`,
    email: `gen${QA_GENERATION}_qa_alpha@example.test`,
    displayName: `${QA_LABEL} QA Alpha`
  },
  {
    username: `gen${QA_GENERATION}_qa_bravo`,
    email: `gen${QA_GENERATION}_qa_bravo@example.test`,
    displayName: `${QA_LABEL} QA Bravo`
  }
];

type GenerationQaDeck = {
  id: string;
  name: string;
  userIndex: number;
  cardIds: string[];
};

type CreatureCard = Extract<CardDefinition, { cardType: "CREATURE" }>;

function byCardNumber(left: CardDefinition, right: CardDefinition): number {
  return left.id.localeCompare(right.id, undefined, { numeric: true });
}

function takeCyclic<T>(items: T[], startIndex: number, count: number): T[] {
  if (items.length === 0) {
    throw new Error("Cannot build QA deck from an empty card group.");
  }

  return Array.from({ length: count }, (_item, index) => {
    return items[(startIndex + index) % items.length];
  });
}

function buildGenerationQaDecks(catalog: Record<string, CardDefinition>): GenerationQaDeck[] {
  const cards = Object.values(catalog).sort(byCardNumber);
  const creatures = cards.filter(
    (card): card is CreatureCard => card.cardType === "CREATURE"
  );
  const al12 = creatures.filter(card => card.armorLevel === 12);
  const al7To11 = creatures.filter(card => card.armorLevel >= 7 && card.armorLevel <= 11);
  const al1To6 = creatures.filter(card => card.armorLevel <= 6);
  const magic = cards.filter(card => card.cardType === "MAGIC");

  return Array.from({ length: DECK_COUNT }, (_item, deckIndex) => {
    const deckNumber = deckIndex + 1;
    const userIndex = deckIndex % QA_USERS.length;
    const cardIds = [
      ...takeCyclic(al12, deckIndex * 2, 2),
      ...takeCyclic(al7To11, deckIndex * 3, 3),
      ...takeCyclic(al1To6, deckIndex * 15, 15),
      ...takeCyclic(magic, deckIndex * 10, 10)
    ].map(card => card.id);

    return {
      id: `gen${QA_GENERATION}-qa-${String(deckNumber).padStart(2, "0")}`,
      name: `${QA_LABEL} QA Deck ${String(deckNumber).padStart(2, "0")}`,
      userIndex,
      cardIds
    };
  });
}

function getArmorLevelBandCounts(cardIds: string[], catalog: Record<string, CardDefinition>) {
  return cardIds.reduce(
    (counts, cardId) => {
      const card = catalog[cardId];
      if (card?.cardType !== "CREATURE") return counts;

      if (card.armorLevel === 12) counts.al12 += 1;
      else if (card.armorLevel >= 7 && card.armorLevel <= 11) counts.al7To11 += 1;
      else counts.al1To6 += 1;

      return counts;
    },
    { al12: 0, al7To11: 0, al1To6: 0 }
  );
}

function assertDecksCoverGeneration(
  decks: GenerationQaDeck[],
  catalog: Record<string, CardDefinition>
): void {
  const coveredCardIds = new Set(decks.flatMap(deck => deck.cardIds));
  const missingCardIds = Object.keys(catalog)
    .sort()
    .filter(cardId => !coveredCardIds.has(cardId));

  if (missingCardIds.length > 0) {
    throw new Error(`${QA_LABEL} QA decks missed ${missingCardIds.length} card(s): ${missingCardIds.join(", ")}`);
  }
}

const catalog = loadCardCatalog([PACK_ID]);
const decks = buildGenerationQaDecks(catalog);

for (const deck of decks) {
  const validation = validateDeckCardIds({
    cardIds: deck.cardIds,
    cardCatalog: catalog
  });

  if (!validation.isLegal) {
    throw new Error(
      `${deck.name} is not legal: ${validation.issues
        .map(issue => issue.message)
        .join(" | ")}`
    );
  }

  const bands = getArmorLevelBandCounts(deck.cardIds, catalog);
  if (bands.al12 !== 2 || bands.al7To11 !== 3 || bands.al1To6 !== 15) {
    throw new Error(
      `${deck.name} must contain 2 AL12, 3 AL7-11, and 15 AL1-6 creatures. ` +
      `Actual: ${JSON.stringify(bands)}`
    );
  }

  console.log(
    `${deck.name}: ${validation.deckSize} cards, ` +
    `${validation.creatureCount} creatures, ${validation.magicCount} magic, ` +
    `AL bands ${JSON.stringify(bands)}`
  );
}

assertDecksCoverGeneration(decks, catalog);

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(QA_PASSWORD, 12);
  const pool = getDbPool();

  try {
    const savedUsers = [];

    for (const user of QA_USERS) {
      const result = await pool.query<{
        id: string;
        username: string;
        email: string;
        display_name: string;
        role: string;
        dev_tools_enabled: boolean;
      }>(
        `
          insert into users (username, email, password_hash, display_name, role, dev_tools_enabled)
          values ($1, $2, $3, $4, 'DEVELOPER', true)
          on conflict (username) do update
            set email = excluded.email,
                password_hash = excluded.password_hash,
                display_name = excluded.display_name,
                role = 'DEVELOPER',
                dev_tools_enabled = true
          returning id, username, email, display_name, role, dev_tools_enabled
        `,
        [user.username, user.email, passwordHash, user.displayName]
      );

      const savedUser = result.rows[0];
      if (!savedUser) {
        throw new Error(`Unable to create or update ${user.username}.`);
      }

      savedUsers.push({
        username: savedUser.username,
        userId: savedUser.id
      });
    }

    for (const deck of decks) {
      const savedUser = savedUsers[deck.userIndex];
      if (!savedUser) {
        throw new Error(`Missing saved user for ${deck.name}.`);
      }

      saveUserDeckListToDisk(savedUser.userId, {
        id: deck.id,
        name: deck.name,
        cardIds: deck.cardIds
      });
    }

    console.log(JSON.stringify({
      password: QA_PASSWORD,
      users: savedUsers,
      decks: decks.map(deck => ({
        id: deck.id,
        owner: savedUsers[deck.userIndex]?.username,
        cards: deck.cardIds.length
      })),
      coveredCards: new Set(decks.flatMap(deck => deck.cardIds)).size
    }, null, 2));
  } finally {
    await closeDbPool();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
