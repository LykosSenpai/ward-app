import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const requireFromServer = createRequire(path.join(ROOT_DIR, "apps", "server", "package.json"));
const pg = requireFromServer("pg");
const USERNAME = process.argv[2]?.trim().toLowerCase();
const DECK_PATTERN = /^qa-test-\d{3}\.json$/;

function stripInlineComment(value) {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const previous = index > 0 ? value[index - 1] : "";

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote && previous !== "\\") {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === "#" && !inSingleQuote && !inDoubleQuote) {
      const before = index > 0 ? value[index - 1] : "";
      if (!before || /\s/.test(before)) {
        return value.slice(0, index).trimEnd();
      }
    }
  }

  return value;
}

function unquote(value) {
  const trimmed = stripInlineComment(value.trim());

  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];

    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      const inner = trimmed.slice(1, -1);
      return first === '"'
        ? inner
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "\r")
            .replace(/\\t/g, "\t")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\")
        : inner;
    }
  }

  return trimmed;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  for (const rawLine of fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;
    const equalsIndex = withoutExport.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = withoutExport.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;

    process.env[key] = unquote(withoutExport.slice(equalsIndex + 1));
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validateDataFileId(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid data file ID: ${id}`);
  }
}

if (!USERNAME) {
  throw new Error("Usage: node tools/import-qa-test-decks-to-user.mjs <username>");
}

loadEnvFile(path.join(ROOT_DIR, ".env"));
loadEnvFile(path.join(ROOT_DIR, ".env.local"));
loadEnvFile(path.join(ROOT_DIR, "apps", "server", ".env"));
loadEnvFile(path.join(ROOT_DIR, "apps", "server", ".env.local"));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to import decks into the account library.");
}

const decksDir = path.join(ROOT_DIR, "data", "decks");
const decks = fs
  .readdirSync(decksDir)
  .filter(fileName => DECK_PATTERN.test(fileName))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .map(fileName => readJson(path.join(decksDir, fileName)));

if (decks.length === 0) {
  throw new Error("No qa-test deck files found in data/decks.");
}

for (const deck of decks) {
  validateDataFileId(deck.id);
  if (!Array.isArray(deck.cardIds) || deck.cardIds.length !== 30) {
    throw new Error(`${deck.id} must contain exactly 30 card IDs.`);
  }
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const userResult = await pool.query(
    "select id, username, display_name from users where username = $1",
    [USERNAME]
  );
  const user = userResult.rows[0];

  if (!user) {
    throw new Error(`User not found: ${USERNAME}`);
  }

  const userDeckDir = path.join(ROOT_DIR, "data", "users", user.id, "decks");
  fs.mkdirSync(userDeckDir, { recursive: true });

  for (const deck of decks) {
    const deckData = {
      id: deck.id,
      name: deck.name,
      cardIds: deck.cardIds,
      format: deck.format === "TOURNAMENT" ? "TOURNAMENT" : "FREE_PLAY"
    };

    await pool.query(
      `
        insert into user_deck_lists (user_id, deck_id, deck_name, deck_data, card_count, format, updated_at)
        values ($1, $2, $3, $4::jsonb, $5, $6, now())
        on conflict (user_id, deck_id)
        do update set
          deck_name = excluded.deck_name,
          deck_data = excluded.deck_data,
          card_count = excluded.card_count,
          format = excluded.format,
          updated_at = now()
      `,
      [
        user.id,
        deckData.id,
        deckData.name,
        JSON.stringify(deckData),
        deckData.cardIds.length,
        deckData.format
      ]
    );

    fs.writeFileSync(
      path.join(userDeckDir, `${deckData.id}.json`),
      `${JSON.stringify(deckData, null, 2)}\n`,
      "utf8"
    );
  }

  console.log(JSON.stringify({
    username: user.username,
    displayName: user.display_name,
    userId: user.id,
    importedDecks: decks.length,
    firstDeck: decks[0].id,
    lastDeck: decks.at(-1).id,
    userDeckDir
  }, null, 2));
} finally {
  await pool.end();
}
