import "../env/loadEnvFile.js";

import { closeDbPool } from "../db/pool.js";
import { importFeatureFlagsFromFile } from "./adminFeatureFlags.js";

const apply = process.argv.includes("--apply");

importFeatureFlagsFromFile({ apply })
  .then(result => {
    console.log(`[features] ${result.applied ? "Imported" : "Dry run for"} ${result.importedCount} feature flag(s) from ${result.sourcePath}.`);
    console.table(result.features.map(flag => ({
      key: flag.key,
      enabledForPlayers: flag.enabledForPlayers,
      updatedAt: flag.updatedAt
    })));
    if (!result.applied) {
      console.log("[features] Dry run only. Re-run with --apply to write these values to Postgres.");
    }
  })
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeDbPool();
  });
