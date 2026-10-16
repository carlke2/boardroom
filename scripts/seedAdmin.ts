import { getEnv, runEnvCheck } from "../config/env.js";
import { connectPostgres, withService } from "../db/postgres.js";

interface AuthUserRecord {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

interface SeedResult {
  status: "created" | "already existed";
  userId: string;
  roles: string[];
}

function adminHeaders(): Record<string, string> {
  const env = getEnv();
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}

function apiBase(): string {
  return getEnv().SUPABASE_URL.replace(/\/$/, "");
}

function safeAuthError(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const candidate = record.msg ?? record.error_description ?? record.message;
    if (typeof candidate === "string" && candidate.length > 0 && candidate.length <= 180) {
      if (!/password|secret|token|key|bearer/i.test(candidate)) return candidate;
    }
  }
  return `Auth admin request failed (${status})`;
}

async function adminJson(path: string, init: RequestInit): Promise<{ status: number; payload: unknown }> {
  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      ...init,
      headers: { ...adminHeaders(), ...(init.headers as Record<string, string> | undefined) },
    });
  } catch {
    throw new Error("Auth admin API is unreachable");
  }
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  return { status: response.status, payload };
}

function usersFromList(payload: unknown): AuthUserRecord[] {
  if (!payload || typeof payload !== "object") return [];
  const users = (payload as { users?: unknown }).users;
  if (!Array.isArray(users)) return [];
  return users.filter((row): row is AuthUserRecord => !!row && typeof row === "object" && typeof (row as AuthUserRecord).id === "string");
}

async function findAuthUserByEmail(email: string): Promise<AuthUserRecord | null> {
  const encoded = encodeURIComponent(email);
  const byQuery = await adminJson(`/auth/v1/admin/users?email=${encoded}`, { method: "GET" });
  if (byQuery.status >= 200 && byQuery.status < 300) {
    const match = usersFromList(byQuery.payload).find((user) => (user.email || "").toLowerCase() === email);
    if (match) return match;
  }

  // Fallback for older Admin API shapes: page and filter locally.
  const listed = await adminJson("/auth/v1/admin/users?page=1&per_page=200", { method: "GET" });
  if (listed.status < 200 || listed.status >= 300) {
    throw new Error(safeAuthError(listed.payload, listed.status));
  }
  return usersFromList(listed.payload).find((user) => (user.email || "").toLowerCase() === email) ?? null;
}

async function createAuthUser(input: {
  email: string;
  password: string;
  name: string;
  phone: string;
}): Promise<AuthUserRecord> {
  const created = await adminJson("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { name: input.name, phone: input.phone },
    }),
  });
  if (created.status < 200 || created.status >= 300 || !created.payload || typeof created.payload !== "object") {
    throw new Error(safeAuthError(created.payload, created.status));
  }
  const user = created.payload as AuthUserRecord;
  if (typeof user.id !== "string") throw new Error("Auth admin create returned no user id");
  return user;
}

async function updateAuthMetadata(userId: string, name: string, phone: string, password?: string): Promise<void> {
  const body: Record<string, unknown> = {
    user_metadata: { name, phone },
    email_confirm: true,
  };
  if (password !== undefined) body.password = password;
  const updated = await adminJson(`/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (updated.status < 200 || updated.status >= 300) {
    throw new Error(safeAuthError(updated.payload, updated.status));
  }
}

async function upsertAdminProfile(userId: string, name: string, phone: string, email: string): Promise<string[]> {
  return withService({ systemJob: true }, async (client) => {
    await client.query("SELECT set_config('app.role_change', 'on', true)");
    const result = await client.query<{ roles: string[] }>(
      `INSERT INTO public.profiles (id, name, email, phone, role, roles, active)
       VALUES ($1::uuid, $2, $3, NULLIF($4, ''), 'ADMIN', ARRAY['ADMIN']::text[], true)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           email = EXCLUDED.email,
           phone = EXCLUDED.phone,
           role = 'ADMIN',
           roles = ARRAY['ADMIN']::text[],
           active = true,
           updated_at = now()
       RETURNING roles`,
      [userId, name, email, phone]
    );
    await client.query("SELECT set_config('app.role_change', 'off', true)");
    return result.rows[0]?.roles ?? ["ADMIN"];
  });
}

export async function seedAdmin(options: { resetPassword: boolean }): Promise<SeedResult> {
  runEnvCheck();
  const env = getEnv();

  if (env.NODE_ENV === "production" && !env.ALLOW_PROD_SEED) {
    throw new Error("Refusing to seed in production without ALLOW_PROD_SEED=true");
  }

  if (!env.SEED_ADMIN_PASSWORD) {
    throw new Error("Invalid environment. Missing or invalid: SEED_ADMIN_PASSWORD");
  }
  if (env.SEED_ADMIN_PASSWORD.length < env.MIN_PASSWORD_LENGTH) {
    throw new Error("Invalid environment. Missing or invalid: SEED_ADMIN_PASSWORD");
  }

  const email = env.SEED_ADMIN_EMAIL.trim().toLowerCase();
  const name = env.SEED_ADMIN_NAME.trim();
  const phone = env.SEED_ADMIN_PHONE.trim();

  await connectPostgres();

  const existing = await findAuthUserByEmail(email);
  let status: SeedResult["status"];
  let userId: string;

  if (!existing) {
    const created = await createAuthUser({
      email,
      password: env.SEED_ADMIN_PASSWORD,
      name,
      phone,
    });
    status = "created";
    userId = created.id;
  } else {
    status = "already existed";
    userId = existing.id;
    if (options.resetPassword) {
      await updateAuthMetadata(userId, name, phone, env.SEED_ADMIN_PASSWORD);
    } else {
      await updateAuthMetadata(userId, name, phone);
    }
  }

  const roles = await upsertAdminProfile(userId, name, phone, email);
  return { status, userId, roles };
}

function parseArgs(argv: string[]): { resetPassword: boolean } {
  return { resetPassword: argv.includes("--reset-password") };
}

const isMain = process.argv[1]?.endsWith("seedAdmin.ts") || process.argv[1]?.endsWith("seedAdmin.js");

if (isMain) {
  try {
    const result = await seedAdmin(parseArgs(process.argv.slice(2)));
    console.log(`${result.status}`);
    console.log(`userId=${result.userId}`);
    console.log(`roles=${result.roles.join(",")}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "seed:admin failed";
    // Keep env NAMES visible. Strip bearer material and assignment-style secret values only.
    console.error(
      message
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/\b(password|secret|token|apikey)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    );
    process.exit(1);
  }
}
