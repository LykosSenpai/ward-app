import "../env/loadEnvFile.js";

import { closeDbPool } from "../db/pool.js";
import { listSavedMatches as listSavedMatchesFromDisk, loadMatchFromDisk } from "../dataStore.js";
import { saveSavedMatch } from "../matches/savedMatchStore.js";

const apply = process.argv.includes("--apply");

async function run(): Promise<void> {
  const summaries = listSavedMatchesFromDisk();

  if (summaries.length === 0) {
    console.log("[saved-matches] No disk saved matches found.");
    return;
  }

  console.log(`[saved-matches] Found ${summaries.length} disk saved match(es).`);
  console.table(summaries.map(summary => ({
    matchId: summary.matchId,
    format: summary.format,
    turnNumber: summary.turnNumber,
    updatedAt: summary.updatedAt
  })));

  if (!apply) {
    console.log("[saved-matches] Dry run only. Re-run with --apply to import these saves into Postgres.");
    return;
  }

  let importedCount = 0;
  for (const summary of summaries) {
    const match = loadMatchFromDisk(summary.matchId);
    await saveSavedMatch(match);
    importedCount += 1;
  }

  console.log(`[saved-matches] Imported ${importedCount} disk saved match(es) into Postgres. Disk files were left untouched.`);
}

run()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeDbPool();
  });
