import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cardImagesDir = path.resolve(scriptDir, "../public/card-images");
const manifestPath = path.join(cardImagesDir, "manifest.json");
const imageExtensions = new Set([".png", ".webp", ".jpg", ".jpeg"]);

async function listImageFiles(directory, relativeDirectory = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listImageFiles(absolutePath, relativePath));
      continue;
    }

    if (entry.isFile() && imageExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(relativePath);
    }
  }

  return files;
}

const files = (await listImageFiles(cardImagesDir))
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

await writeFile(
  manifestPath,
  `${JSON.stringify({ version: 1, files }, null, 2)}\n`,
  "utf-8"
);

console.log(`Wrote ${files.length} card image entries to ${manifestPath}`);
