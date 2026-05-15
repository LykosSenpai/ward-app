import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appPath = resolve("src/App.tsx");
const appSource = readFileSync(appPath, "utf8");

function fail(message: string): never {
  console.error(`board3d-only regression check failed: ${message}`);
  process.exit(1);
}

if (/from\s+["']\.\/components\/CardBoardView["']/.test(appSource)) {
  fail("App.tsx must not import CardBoardView.");
}

if (/type\s+PlayViewMode\s*=\s*"board3d"\s*;/.test(appSource) === false && /parseRequestedEmbedView/.test(appSource) === false) {
  fail("PlayViewMode must be board3d-only.");
}

if (/\bsetPlayViewMode\("board3d"\)/.test(appSource) === false) {
  fail("Embed/view normalization must force board3d runtime mode.");
}


if (/\<CardBoardView\b/.test(appSource)) {
  fail("Live Play Table must not render CardBoardView.");
}

console.log("board3d-only regression checks passed");
