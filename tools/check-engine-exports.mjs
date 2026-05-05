import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ENGINE_SRC = path.join(ROOT, "packages", "engine", "src");
const INDEX_FILE = path.join(ENGINE_SRC, "index.ts");

const REQUIRED_PUBLIC_MODULES = [
  "actions",
  "actionCards",
  "actionGuards",
  "creatureActions",
  "deckActions",
  "equipActions",
  "handActions",
  "magicChainActions",
  "manualMagicEffectActions",
  "matchOutcomeActions",
  "primaryCreatureEffectActions",
  "attachments",
  "battle",
  "cardInstances",
  "cardMovement",
  "cemetery",
  "deckValidator",
  "demoCards",
  "effectiveStats",
  "effectPrompts",
  "effectRegistry",
  "effectResolver",
  "engineRuntime",
  "matchFactory",
  "normalizeMatch",
  "summonRules",
  "targets",
  "triggers",
  "turns"
];

if (!fs.existsSync(INDEX_FILE)) {
  console.error("Missing packages/engine/src/index.ts");
  process.exit(1);
}

const indexText = fs.readFileSync(INDEX_FILE, "utf-8");
let errorCount = 0;

for (const moduleName of REQUIRED_PUBLIC_MODULES) {
  const tsFile = path.join(ENGINE_SRC, `${moduleName}.ts`);

  if (!fs.existsSync(tsFile)) {
    console.error(`Missing engine source module: packages/engine/src/${moduleName}.ts`);
    errorCount++;
    continue;
  }

  const expected = `export * from "./${moduleName}.js";`;

  if (!indexText.includes(expected)) {
    console.error(`Missing engine barrel export: ${expected}`);
    errorCount++;
  }
}

const badRelativeExports = [...indexText.matchAll(/export\s+\*\s+from\s+["']\.\/([^"']+)["'];/g)]
  .filter(match => !match[1].endsWith(".js"));

for (const match of badRelativeExports) {
  console.error(`Engine barrel export is missing .js extension: ${match[0]}`);
  errorCount++;
}

if (errorCount > 0) {
  console.error(`\nEngine export check failed with ${errorCount} issue(s).`);
  process.exit(1);
}

console.log("Engine export check passed.");
