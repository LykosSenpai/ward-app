import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set. Add it to .env before using Postgres-backed features.");
  }

  return databaseUrl;
}

export function getDbPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getDatabaseUrl()
    });
  }

  return pool;
}

export async function checkDbConnection(): Promise<{ ok: true; now: string }> {
  const result = await getDbPool().query<{ now: Date }>("select now() as now");
  const now = result.rows[0]?.now;

  return {
    ok: true,
    now: now instanceof Date ? now.toISOString() : String(now)
  };
}

export async function closeDbPool(): Promise<void> {
  if (!pool) return;

  await pool.end();
  pool = null;
}
