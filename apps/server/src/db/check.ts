import "../env/loadEnvFile.js";

import { checkDbConnection, closeDbPool } from "./pool.js";

checkDbConnection()
  .then(result => {
    console.log(`[db] Connected at ${result.now}`);
  })
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeDbPool();
  });
