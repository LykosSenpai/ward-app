import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";
const pnpm = isWindows ? "pnpm.cmd" : "pnpm";

/** @typedef {{ command: string, args: string[], label: string, id: string, useShell?: boolean }} WorkspaceCheck */

/** @type {WorkspaceCheck[]} */
const checks = [
  { id: "files", command: "node", args: ["tools/check-project-files.mjs"], label: "Project file check" },
  {
    id: "cards",
    command: "node",
    args: ["tools/card-generation/build-card-packs.mjs", "--check"],
    label: "Card source pack check"
  },
  { id: "css", command: "node", args: ["tools/check-css-braces.mjs"], label: "CSS syntax check" },
  { id: "exports", command: "node", args: ["tools/check-engine-exports.mjs"], label: "Engine export check" },
  {
    id: "shared-types",
    command: pnpm,
    args: ["--filter", "@ward/shared", "check"],
    label: "Shared type check",
    useShell: isWindows
  },
  {
    id: "engine-types",
    command: pnpm,
    args: ["--filter", "@ward/engine", "check"],
    label: "Engine type check",
    useShell: isWindows
  },
  {
    id: "server-types",
    command: pnpm,
    args: ["--filter", "@ward/server", "check"],
    label: "Server type check",
    useShell: isWindows
  },
  {
    id: "client-types",
    command: pnpm,
    args: ["--filter", "@ward/client", "check"],
    label: "Client type check",
    useShell: isWindows
  },
  {
    id: "client-dispatch-guards",
    command: pnpm,
    args: ["--filter", "@ward/client", "check:dispatch-guards"],
    label: "Client dispatch guard check",
    useShell: isWindows
  },
  {
    id: "client-board-preview-integration",
    command: pnpm,
    args: ["--filter", "@ward/client", "check:board-preview-integration"],
    label: "Client board-preview integration check",
    useShell: isWindows
  }
];

const selectedCheckIds = new Set(process.argv.slice(2));
if (selectedCheckIds.size > 0) {
  const unknownCheckIds = [...selectedCheckIds].filter((checkId) => !checks.some((check) => check.id === checkId));
  if (unknownCheckIds.length > 0) {
    console.error(`\nUnknown workspace check id(s): ${unknownCheckIds.join(", ")}`);
    console.error(`Available ids: ${checks.map((check) => check.id).join(", ")}`);
    process.exit(1);
  }
}

const checksToRun = selectedCheckIds.size === 0 ? checks : checks.filter((check) => selectedCheckIds.has(check.id));
const startTime = Date.now();

for (const { command, args, label, useShell = false } of checksToRun) {
  console.log(`\n=== ${label} ===`);

  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: useShell
  });

  if (result.error) {
    console.error(`\n${label} failed to start: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`\n${label} failed.`);
    process.exit(result.status ?? 1);
  }
}

const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`\nAll workspace checks passed in ${elapsedSeconds}s.`);
