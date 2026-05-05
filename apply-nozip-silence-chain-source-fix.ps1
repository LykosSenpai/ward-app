param(
  [string]$ProjectRoot = "$env:USERPROFILE\Documents\ward-app"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $ProjectRoot)) {
  throw "Project root not found: $ProjectRoot"
}

$PatchJs = @'
const fs = require("fs");
const path = require("path");

const root = process.argv[2];

function relPath(rel) {
  return path.join(root, rel);
}

function read(rel) {
  return fs.readFileSync(relPath(rel), "utf8");
}

function write(rel, text) {
  fs.writeFileSync(relPath(rel), text);
}

function backup(rel) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(root, "_patch_backups", "silence-chain-source-fix-" + stamp);
  const dst = path.join(backupRoot, rel);

  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(relPath(rel), dst);

  console.log("Backed up: " + rel);
}

function replaceRegexOnce(text, pattern, replacement, label) {
  if (!pattern.test(text)) {
    throw new Error("Could not find patch location: " + label);
  }

  return text.replace(pattern, replacement);
}

const target = "packages/engine/src/magicChainActions.ts";
backup(target);

let s = read(target);

if (!s.includes("SILENCE_SOURCE_LINKED_EFFECTS_RESOLVE_BEFORE_CARD_LEAVES_CHAIN")) {
  s = replaceRegexOnce(
    s,
    /    const chainCard = nextState\.chainZone\[chainCardIndex\];\r?\n\r?\n    nextState\.chainZone\.splice\(chainCardIndex, 1\);\r?\n\r?\n    const ownerPlayer = getPlayer\(nextState, chainCard\.ownerPlayerId\);\r?\n\r?\n    if \(link\.status === "NEGATED"\) \{\r?\n      chainCard\.zone = "CEMETERY";/,
    `    const chainCard = nextState.chainZone[chainCardIndex];

    const ownerPlayer = getPlayer(nextState, chainCard.ownerPlayerId);

    if (link.status === "NEGATED") {
      nextState.chainZone.splice(chainCardIndex, 1);
      chainCard.zone = "CEMETERY";`,
    "move chainZone splice out of pre-resolution position"
  );

  s = replaceRegexOnce(
    s,
    /    resolveOrQueueResolvedMagicEffects\(nextState, link\);\r?\n    if \(link\.magicType === "INFINITE" && !link\.isLightningResponse\) \{/,
    `    // SILENCE_SOURCE_LINKED_EFFECTS_RESOLVE_BEFORE_CARD_LEAVES_CHAIN
    // Source-linked resolved effects must run while the source card is still findable in chainZone.
    // Silence From The Grave uses this to attach its Magic lock and turn-conditional creature suppression.
    resolveOrQueueResolvedMagicEffects(nextState, link);

    nextState.chainZone.splice(chainCardIndex, 1);

    if (link.magicType === "INFINITE" && !link.isLightningResponse) {`,
    "resolve before removing source card from chainZone"
  );

  write(target, s);
  console.log("Patched: " + target);
} else {
  console.log("No changes needed: " + target);
}

console.log("Silence chain source fix complete.");
'@

$PatchFile = Join-Path $ProjectRoot "_nozip_silence_chain_source_fix.cjs"
Set-Content -Path $PatchFile -Value $PatchJs -Encoding UTF8

Push-Location $ProjectRoot
try {
  node $PatchFile $ProjectRoot

  if (Test-Path ".\tools\card-generation\build-card-packs.mjs") {
    pnpm.cmd cards:check
  }

  if ((Get-Content .\package.json -Raw) -match '"effects:audit"') {
    pnpm.cmd effects:audit
  }

  pnpm.cmd check
}
finally {
  Pop-Location
}

Write-Host ""
Write-Host "Silence chain source fix complete. Restart server/client and hard refresh browser." -ForegroundColor Green
