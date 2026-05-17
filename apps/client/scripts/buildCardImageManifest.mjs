import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cardImagesDir = path.resolve(scriptDir, "../public/card-images");
const manifestPath = path.join(cardImagesDir, "manifest.json");
const imageExtensions = new Set([".png", ".webp", ".jpg", ".jpeg"]);

const entries = await readdir(cardImagesDir, { withFileTypes: true });
const files = entries
  .filter(entry => entry.isFile())
  .map(entry => entry.name)
  .filter(fileName => imageExtensions.has(path.extname(fileName).toLowerCase()))
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

await writeFile(
  manifestPath,
  `${JSON.stringify({ version: 1, files }, null, 2)}\n`,
  "utf-8"
);

console.log(`Wrote ${files.length} card image entries to ${manifestPath}`);
