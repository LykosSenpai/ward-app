import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const REDUNDANT_FILES = [
  "gitignore",
  "apps/client/src/client App.tsx",
  "apps/server/src/apps__server__src__dataStore.ts",
  "apps/server/src/server index.ts",
  "packages/engine/src/engine actions.ts",
  "packages/engine/src/engine index.ts",
  "packages/engine/src/shared index.ts",
  "packages/shared/src/shared index.ts"
];

const WARN_ONLY_DIRECTORIES = [
  "node_modules",
  "apps/client/node_modules",
  "apps/server/node_modules",
  "packages/engine/node_modules",
  "packages/shared/node_modules"
];

let errorCount = 0;
let warningCount = 0;

for (const relativePath of REDUNDANT_FILES) {
  const filePath = path.join(ROOT, relativePath);

  if (fs.existsSync(filePath)) {
    console.error(`Redundant file should be removed: ${relativePath}`);
    errorCount++;
  }
}

if (!fs.existsSync(path.join(ROOT, ".gitignore"))) {
  console.error("Missing root .gitignore");
  errorCount++;
}

for (const relativePath of WARN_ONLY_DIRECTORIES) {
  const directoryPath = path.join(ROOT, relativePath);

  if (fs.existsSync(directoryPath)) {
    console.warn(`Warning: ${relativePath} exists. Keep locally, but do not include it in project zips.`);
    warningCount++;
  }
}

if (errorCount > 0) {
  console.error(`\nProject file check failed with ${errorCount} issue(s).`);
  process.exit(1);
}

console.log(`Project file check passed with ${warningCount} warning(s).`);
