import "../env/loadEnvFile.js";

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closeDbPool, getDbPool } from "./pool.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function findMigrationsDir(): Promise<string> {
  const candidates = [
    path.resolve(__dirname, "migrations"),
    path.resolve(__dirname, "../../src/db/migrations"),
    path.resolve(process.cwd(), "src/db/migrations")
  ];

  for (const candidate of candidates) {
    try {
      const stats = await fs.stat(candidate);
      if (stats.isDirectory()) return candidate;
    } catch {
      // Try the next location.
    }
  }

  throw new Error(`Could not find db migrations directory. Tried: ${candidates.join(", ")}`);
}

async function ensureMigrationTable(): Promise<void> {
  await getDbPool().query(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

async function listAppliedMigrations(): Promise<Set<string>> {
  const result = await getDbPool().query<{ id: string }>("select id from schema_migrations");
  return new Set(result.rows.map(row => row.id));
}

async function run(): Promise<void> {
  await ensureMigrationTable();

  const applied = await listAppliedMigrations();
  const migrationsDir = await findMigrationsDir();
  const entries = await fs.readdir(migrationsDir);
  const migrationFiles = entries
    .filter(fileName => fileName.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  for (const fileName of migrationFiles) {
    if (applied.has(fileName)) continue;

    const sql = await fs.readFile(path.join(migrationsDir, fileName), "utf8");

    console.log(`[db] Applying ${fileName}`);
    await getDbPool().query("begin");

    try {
      await getDbPool().query(sql);
      await getDbPool().query(
        "insert into schema_migrations (id) values ($1)",
        [fileName]
      );
      await getDbPool().query("commit");
    } catch (error) {
      await getDbPool().query("rollback");
      throw error;
    }
  }

  console.log("[db] Migrations complete.");
}

run()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeDbPool();
  });
