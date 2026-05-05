import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";
const pnpm = isWindows ? "pnpm.cmd" : "pnpm";

const commands = [
  ["node", ["tools/check-project-files.mjs"], "Project file check", false],
  ["node", ["tools/check-css-braces.mjs"], "CSS syntax check", false],
  ["node", ["tools/check-engine-exports.mjs"], "Engine export check", false],
  [pnpm, ["--filter", "@ward/shared", "check"], "Shared type check", isWindows],
  [pnpm, ["--filter", "@ward/engine", "check"], "Engine type check", isWindows],
  [pnpm, ["--filter", "@ward/server", "check"], "Server type check", isWindows],
  [pnpm, ["--filter", "@ward/client", "check"], "Client type check", isWindows]
];

for (const [command, args, label, useShell] of commands) {
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

console.log("\nAll workspace checks passed.");
