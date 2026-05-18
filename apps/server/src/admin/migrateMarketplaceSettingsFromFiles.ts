import "../env/loadEnvFile.js";

import { closeDbPool } from "../db/pool.js";
import { importMarketplaceAutoListingSettingsFiles } from "../collection/marketplaceSettingsStore.js";

const apply = process.argv.includes("--apply");

importMarketplaceAutoListingSettingsFiles({ apply })
  .then(result => {
    console.log(`[marketplace-settings] ${result.applied ? "Imported" : "Dry run for"} ${result.importedCount} marketplace settings file(s) from ${result.sourceDir}.`);
    if (result.rows.length > 0) {
      console.table(result.rows.map(row => ({
        userId: row.userId,
        enabled: row.settings.enabled,
        sourcePath: row.sourcePath
      })));
    }
    if (result.failures.length > 0) {
      console.table(result.failures);
    }
    if (!result.applied) {
      console.log("[marketplace-settings] Dry run only. Re-run with --apply to write these values to Postgres.");
    }
  })
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeDbPool();
  });
