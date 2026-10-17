import { getEnv } from "../config/env.js";
import { getPool } from "../db/postgres.js";

export type LiveCheck = { ok: true } | { ok: false; reason: string };

/** Real Postgres query. Reasons never include connection strings or secrets. */
export async function checkDatabase(): Promise<LiveCheck> {
  try {
    await getPool().query("SELECT 1");
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: safeReason(error, "Database query failed") };
  }
}

/**
 * Real call to Supabase Auth health.
 * Uses SUPABASE_URL only; never logs keys or response bodies with tokens.
 */
export async function checkAuth(): Promise<LiveCheck> {
  const env = getEnv();
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const url = `${base}/auth/v1/health`;
  let response: Response;
  try {
    // GoTrue requires apikey; value is never logged.
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      },
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    return { ok: false, reason: safeReason(error, "Supabase Auth unreachable") };
  }
  if (!response.ok) {
    return { ok: false, reason: `Supabase Auth health returned ${response.status}` };
  }
  return { ok: true };
}

function safeReason(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.trim();
  if (!message) return fallback;
  // Strip anything that looks like a URL with credentials or a long token.
  if (/:\/\//.test(message) || /eyJ[A-Za-z0-9_-]{10,}/.test(message) || /password/i.test(message)) {
    return fallback;
  }
  if (message.length > 160) return fallback;
  return message;
}
