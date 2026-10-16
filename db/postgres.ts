import { Pool, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";
import { getEnv } from "../config/env.js";

export interface Queryable {
  query: <T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => Promise<QueryResult<T>>;
}

export type DbClaims = Record<string, unknown> & { sub: string; role: "authenticated" };

let pool: Pool | null = null;

function sslConfig(): PoolConfig["ssl"] {
  const env = getEnv();
  if (env.PG_SSL === "disable") return undefined;
  return { rejectUnauthorized: env.PG_SSL_REJECT_UNAUTHORIZED };
}

export function createPool(): Pool {
  const env = getEnv();
  const next = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.PG_POOL_MAX,
    idleTimeoutMillis: env.PG_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: env.PG_CONNECTION_TIMEOUT_MS,
    statement_timeout: env.PG_STATEMENT_TIMEOUT_MS,
    query_timeout: env.PG_STATEMENT_TIMEOUT_MS,
    ssl: sslConfig(),
  });
  next.on("error", () => {
    console.error("Postgres pool error");
  });
  return next;
}

export function getPool(): Pool {
  if (!pool) throw new Error("Postgres is not connected");
  return pool;
}

export async function connectPostgres(): Promise<void> {
  if (pool) return;
  pool = createPool();
  await pool.query("SELECT 1");
  console.log("Postgres connected");
}

export async function pingPostgres(): Promise<void> {
  await getPool().query("SELECT 1");
}

export function sessionClaims(claims: Record<string, unknown>): DbClaims {
  const sub = claims.sub;
  if (typeof sub !== "string" || !sub.trim()) throw new Error("withUser requires claims.sub");
  return { ...claims, sub, role: "authenticated" };
}

async function rollback(client: Queryable): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    console.error("Postgres rollback failed");
  }
}

/**
 * Transaction as the authenticated role with the caller's JWT claims.
 * Existing RLS policies and security-definer RPCs read auth.uid() from those claims.
 */
export async function withUserOnClient<T>(client: Queryable, claims: Record<string, unknown>, fn: (client: Queryable) => Promise<T>): Promise<T> {
  const session = sessionClaims(claims);
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(session)]);
    const value = await fn(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await rollback(client);
    throw error;
  }
}

export async function withUser<T>(claims: Record<string, unknown>, fn: (client: Queryable) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await withUserOnClient(client, claims, fn);
  } finally {
    client.release();
  }
}

function assertSystemJob(authorization: { systemJob: true }): void {
  if (authorization?.systemJob !== true) {
    throw new Error("withService requires an explicit system job role check");
  }
}

/** System jobs only. Request handlers cannot call this without the systemJob flag. */
export async function withServiceOnClient<T>(
  client: Queryable,
  authorization: { systemJob: true },
  fn: (client: Queryable) => Promise<T>
): Promise<T> {
  assertSystemJob(authorization);
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE service_role");
    const value = await fn(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await rollback(client);
    throw error;
  }
}

export async function withService<T>(authorization: { systemJob: true }, fn: (client: Queryable) => Promise<T>): Promise<T> {
  assertSystemJob(authorization);
  const client = await getPool().connect();
  try {
    return await withServiceOnClient(client, authorization, fn);
  } finally {
    client.release();
  }
}
