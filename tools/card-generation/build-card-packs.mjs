import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SOURCE_ROOT = path.join(ROOT, "data", "cards", "src");
const PACK_ROOT = path.join(ROOT, "data", "cards", "packs");
const CHECK_ONLY = process.argv.includes("--check");
const TARGET_PACK_ARG = process.argv.find((arg) => arg.startsWith("--pack="));
const TARGET_PACK = TARGET_PACK_ARG ? TARGET_PACK_ARG.slice("--pack=".length).trim() : "";

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read JSON ${path.relative(ROOT, filePath)}: ${error.message}`);
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeGeneratedText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isCardSourceFile(fileName) {
  return fileName.endsWith(".json") && !fileName.startsWith("_");
}

function cardSortKey(card, fallbackFileName) {
  const numberText = String(card.cardNumber ?? card.number ?? "").trim();
  const numeric = Number.parseInt(numberText, 10);
  return {
    number: Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER,
    numberText,
    name: String(card.name ?? card.cardName ?? card.id ?? fallbackFileName).toLowerCase(),
    fallbackFileName: fallbackFileName.toLowerCase()
  };
}

function compareCardSort(a, b) {
  const ka = cardSortKey(a.card, a.fileName);
  const kb = cardSortKey(b.card, b.fileName);

  if (ka.number !== kb.number) return ka.number - kb.number;
  if (ka.numberText !== kb.numberText) return ka.numberText.localeCompare(kb.numberText, undefined, { numeric: true });
  if (ka.name !== kb.name) return ka.name.localeCompare(kb.name);
  return ka.fallbackFileName.localeCompare(kb.fallbackFileName);
}

function validatePackSource(packDir, metadata, cardEntries) {
  const relativePackDir = path.relative(ROOT, packDir);
  const errors = [];

  for (const requiredField of ["id", "name", "version", "source"])
    if (metadata[requiredField] === undefined || metadata[requiredField] === null || metadata[requiredField] === "")
      errors.push(`${relativePackDir}/_pack.json missing required field: ${requiredField}`);

  const seenIds = new Map();
  const seenNumbers = new Map();

  for (const { fileName, card } of cardEntries) {
    const relativeCardPath = path.join(relativePackDir, fileName);
    const cardId = String(card.id ?? "").trim();
    const cardNumber = String(card.cardNumber ?? card.number ?? "").trim();
    const cardName = String(card.name ?? card.cardName ?? "").trim();

    if (!cardId) errors.push(`${relativeCardPath} missing card id`);
    if (!cardNumber) errors.push(`${relativeCardPath} missing cardNumber`);
    if (!cardName) errors.push(`${relativeCardPath} missing name`);

    if (cardId) {
      if (seenIds.has(cardId)) errors.push(`${relativeCardPath} duplicates card id from ${seenIds.get(cardId)}: ${cardId}`);
      else seenIds.set(cardId, relativeCardPath);
    }

    if (cardNumber) {
      if (seenNumbers.has(cardNumber)) errors.push(`${relativeCardPath} duplicates cardNumber from ${seenNumbers.get(cardNumber)}: ${cardNumber}`);
      else seenNumbers.set(cardNumber, relativeCardPath);
    }
  }

  if (errors.length > 0) throw new Error(errors.join("\n"));
}

function buildOnePack(packDir) {
  const metadataPath = path.join(packDir, "_pack.json");
  if (!fs.existsSync(metadataPath)) throw new Error(`Missing metadata file: ${path.relative(ROOT, metadataPath)}`);

  const metadata = readJson(metadataPath);
  const fileNames = fs.readdirSync(packDir).filter(isCardSourceFile).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const cardEntries = fileNames.map((fileName) => ({ fileName, card: readJson(path.join(packDir, fileName)) })).sort(compareCardSort);

  validatePackSource(packDir, metadata, cardEntries);

  const pack = {
    ...metadata,
    cards: cardEntries.map((entry) => entry.card)
  };

  const outputFileName = `${metadata.id}.json`;
  const outputPath = path.join(PACK_ROOT, outputFileName);
  const generatedText = normalizeGeneratedText(pack);

  if (CHECK_ONLY) {
    if (!fs.existsSync(outputPath)) throw new Error(`Missing generated pack: ${path.relative(ROOT, outputPath)}`);
    const existingText = fs.readFileSync(outputPath, "utf8");
    if (existingText !== generatedText) {
      throw new Error(
        `Generated pack is out of date: ${path.relative(ROOT, outputPath)}\n` +
          `Run: pnpm.cmd cards:build`
      );
    }
  } else {
    fs.mkdirSync(PACK_ROOT, { recursive: true });
    fs.writeFileSync(outputPath, generatedText, "utf8");
  }

  return { id: metadata.id, outputPath, count: cardEntries.length };
}

function main() {
  if (!fs.existsSync(SOURCE_ROOT)) {
    throw new Error(`Missing card source directory: ${path.relative(ROOT, SOURCE_ROOT)}`);
  }

  const packDirs = fs
    .readdirSync(SOURCE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(SOURCE_ROOT, entry.name))
    .filter((packDir) => {
      if (!TARGET_PACK) return true;
      const name = path.basename(packDir).toLowerCase();
      const metadataPath = path.join(packDir, "_pack.json");
      const id = fs.existsSync(metadataPath) ? String(readJson(metadataPath).id ?? "").toLowerCase() : "";
      const target = TARGET_PACK.toLowerCase();
      return name === target || id === target || id === `ward-${target}`;
    })
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (packDirs.length === 0) throw new Error(`No card source packs found for target: ${TARGET_PACK || "all"}`);

  const results = packDirs.map(buildOnePack);

  for (const result of results) {
    const action = CHECK_ONLY ? "Verified" : "Built";
    console.log(`${action} ${path.relative(ROOT, result.outputPath)} from ${result.count} source cards.`);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
