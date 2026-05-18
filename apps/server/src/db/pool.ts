import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

function readOptionalPositiveIntEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set. Add it to .env before using Postgres-backed features.");
  }

  return databaseUrl;
}

export function getDbPool(): pg.Pool {
  if (!pool) {
    const max = readOptionalPositiveIntEnv("PG_POOL_MAX");
    const idleTimeoutMillis = readOptionalPositiveIntEnv("PG_POOL_IDLE_TIMEOUT_MS");
    const connectionTimeoutMillis = readOptionalPositiveIntEnv("PG_POOL_CONNECTION_TIMEOUT_MS");

    pool = new Pool({
      connectionString: getDatabaseUrl(),
      ...(max ? { max } : {}),
      ...(idleTimeoutMillis ? { idleTimeoutMillis } : {}),
      ...(connectionTimeoutMillis ? { connectionTimeoutMillis } : {})
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
