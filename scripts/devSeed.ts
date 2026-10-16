import { randomBytes } from "node:crypto";
import type { Env } from "../config/env.js";
import { getEnv, runEnvCheck } from "../config/env.js";
import { connectPostgres, withService, type Queryable } from "../db/postgres.js";

/** Marker stored on every dev row. Not an email domain: the four addresses come from env. */
export const SEED_TAG = "dev-seed";

export const EXTRA_REQUESTER_EMAIL = "dev-requester@dev.seed.invalid";

export type DevRole = "USER" | "AGENT" | "TEAM_LEAD" | "ADMIN";

export interface DevAccount {
  role: DevRole;
  emailKey: keyof Env;
  passwordKey: keyof Env;
  email: string;
  password: string;
}

const ACCOUNT_SPECS: { role: DevRole; emailKey: keyof Env; passwordKey: keyof Env }[] = [
  { role: "USER", emailKey: "DEV_TEST_USER_EMAIL", passwordKey: "DEV_TEST_USER_PASSWORD" },
  { role: "AGENT", emailKey: "DEV_TEST_AGENT_EMAIL", passwordKey: "DEV_TEST_AGENT_PASSWORD" },
  { role: "TEAM_LEAD", emailKey: "DEV_TEST_LEAD_EMAIL", passwordKey: "DEV_TEST_LEAD_PASSWORD" },
  { role: "ADMIN", emailKey: "DEV_TEST_ADMIN_EMAIL", passwordKey: "DEV_TEST_ADMIN_PASSWORD" },
];

export function assertDevSeedAllowed(env: Env): void {
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing to seed dev users when NODE_ENV=production");
  }
}

/** Names every blank dev variable. Does not include the values. */
export function devAccounts(env: Env): DevAccount[] {
  const empty: string[] = [];
  const short: string[] = [];
  const accounts: DevAccount[] = [];
  for (const spec of ACCOUNT_SPECS) {
    const email = String(env[spec.emailKey] ?? "").trim().toLowerCase();
    const password = String(env[spec.passwordKey] ?? "");
    if (!email) empty.push(spec.emailKey);
    if (!password) empty.push(spec.passwordKey);
    else if (password.length < env.MIN_PASSWORD_LENGTH) short.push(spec.passwordKey);
    accounts.push({ ...spec, email, password });
  }
  if (empty.length) {
    throw new Error(`Dev seed needs these set: ${empty.join(", ")}`);
  }
  if (short.length) {
    throw new Error(`Dev seed passwords are shorter than MIN_PASSWORD_LENGTH: ${short.join(", ")}`);
  }
  const adminEmail = env.SEED_ADMIN_EMAIL.trim().toLowerCase();
  const clashes = accounts.filter((account) => account.email === adminEmail).map((account) => account.emailKey);
  if (clashes.length) {
    throw new Error(`Dev seed must not use the real admin account: ${clashes.join(", ")}`);
  }
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const account of accounts) {
    if (seen.has(account.email)) duplicates.push(account.emailKey);
    seen.add(account.email);
  }
  if (duplicates.length) {
    throw new Error(`Dev seed emails must be distinct: ${duplicates.join(", ")}`);
  }
  if (accounts.some((account) => account.email === EXTRA_REQUESTER_EMAIL)) {
    throw new Error("Dev seed emails must not use the reserved extra requester address");
  }
  return accounts;
}

export interface AuthUserRecord {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

function adminHeaders(env: Env): Record<string, string> {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}

function safeAuthError(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const candidate = record.msg ?? record.error_description ?? record.message ?? record.error;
    if (typeof candidate === "string" && candidate.length > 0 && candidate.length <= 180) {
      if (!/password|secret|token|key|bearer/i.test(candidate)) return candidate;
    }
  }
  return `Auth admin request failed (${status})`;
}

async function adminJson(env: Env, path: string, init: RequestInit): Promise<{ status: number; payload: unknown }> {
  let response: Response;
  try {
    response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { ...adminHeaders(env), ...(init.headers as Record<string, string> | undefined) },
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
  const record = payload as { users?: unknown; id?: unknown };
  if (typeof record.id === "string") return [payload as AuthUserRecord];
  const users = record.users;
  if (!Array.isArray(users)) return [];
  return users.filter((row): row is AuthUserRecord => !!row && typeof row === "object" && typeof (row as AuthUserRecord).id === "string");
}

export async function findAuthUserByEmail(env: Env, email: string): Promise<AuthUserRecord | null> {
  const encoded = encodeURIComponent(email);
  const byQuery = await adminJson(env, `/auth/v1/admin/users?email=${encoded}`, { method: "GET" });
  if (byQuery.status >= 200 && byQuery.status < 300) {
    const match = usersFromList(byQuery.payload).find((user) => (user.email || "").toLowerCase() === email);
    if (match) return match;
  }
  const listed = await adminJson(env, "/auth/v1/admin/users?page=1&per_page=200", { method: "GET" });
  if (listed.status < 200 || listed.status >= 300) {
    throw new Error(safeAuthError(listed.payload, listed.status));
  }
  return usersFromList(listed.payload).find((user) => (user.email || "").toLowerCase() === email) ?? null;
}

export function devMetadata(name: string): Record<string, unknown> {
  return { name, dev: true, seed_tag: SEED_TAG };
}

export async function createDevAuthUser(env: Env, email: string, password: string, name: string): Promise<AuthUserRecord> {
  const created = await adminJson(env, "/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: devMetadata(name),
    }),
  });
  if (created.status < 200 || created.status >= 300) {
    throw new Error(safeAuthError(created.payload, created.status));
  }
  const user = usersFromList(created.payload)[0];
  if (!user) throw new Error("Auth admin create returned no user id");
  return user;
}

/** Confirms the user and sets the dev tag. Sends a password only when asked. */
export async function updateDevAuthUser(
  env: Env,
  userId: string,
  name: string,
  password?: string
): Promise<void> {
  const body: Record<string, unknown> = {
    email_confirm: true,
    user_metadata: devMetadata(name),
  };
  if (password !== undefined) body.password = password;
  const updated = await adminJson(env, `/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (updated.status < 200 || updated.status >= 300) {
    throw new Error(safeAuthError(updated.payload, updated.status));
  }
}

export const UPSERT_PROFILE_SQL = `INSERT INTO public.profiles (id, name, email, phone, role, roles, active)
VALUES ($1::uuid, $2, $3, NULL, $4, ARRAY[$4]::text[], true)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    email = EXCLUDED.email,
    role = EXCLUDED.role,
    roles = EXCLUDED.roles,
    active = true,
    updated_at = now()`;

export async function upsertDevProfile(client: Queryable, userId: string, name: string, email: string, role: DevRole): Promise<void> {
  await client.query("SELECT set_config('app.role_change', 'on', true)");
  await client.query(UPSERT_PROFILE_SQL, [userId, name, email, role]);
}

export const UPSERT_TEAM_SQL = `INSERT INTO public.teams (name, active)
VALUES ($1, true)
ON CONFLICT (name) DO UPDATE SET active = true
RETURNING id`;

export const UPSERT_MEMBERS_SQL = `INSERT INTO public.team_members (team_id, profile_id, is_lead)
VALUES ($1::uuid, $2::uuid, false), ($1::uuid, $3::uuid, true)
ON CONFLICT (team_id, profile_id) DO UPDATE
SET is_lead = EXCLUDED.is_lead`;

export function devDisplayName(role: DevRole): string {
  return `Dev ${role}`;
}

export function newDevPassword(): string {
  return randomBytes(24).toString("base64url");
}

export async function withDevService<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
  return withService({ systemJob: true }, fn);
}

export async function prepareDevSeed(): Promise<Env> {
  runEnvCheck();
  const env = getEnv();
  assertDevSeedAllowed(env);
  await connectPostgres();
  return env;
}

export function redact(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(password|secret|token|apikey)\s*[:=]\s*\S+/gi, "$1=[redacted]");
}

/**
 * Deletes only rows tagged seed_tag = dev-seed.
 * Does nothing when app.seed_admin_email is unset, and never deletes that email.
 * Not executed by dev:cleanup.
 */
export const DEV_CLEANUP_SQL = `-- Tag is auth.users.raw_user_meta_data.seed_tag = '${SEED_TAG}',
-- plus the same token in teams.name, rooms.name, ticket_categories.name,
-- tickets.source_ref, bookings.team_name, and notifications.event_type.
-- Set app.seed_admin_email to SEED_ADMIN_EMAIL first. An empty setting deletes nothing.
-- This statement list is not run by npm run dev:cleanup.

BEGIN;
-- Put SEED_ADMIN_EMAIL between the quotes before running. Empty deletes nothing.
SELECT set_config('app.seed_admin_email', '', true);

DELETE FROM public.notifications n
WHERE n.event_type = '${SEED_TAG}'
   OR n.user_id IN (
     SELECT u.id FROM auth.users u
     WHERE coalesce(u.raw_user_meta_data ->> 'seed_tag', '') = '${SEED_TAG}'
       AND current_setting('app.seed_admin_email', true) <> ''
       AND lower(u.email) IS DISTINCT FROM lower(current_setting('app.seed_admin_email', true))
   );

DELETE FROM public.bookings b
WHERE b.team_name = '${SEED_TAG}'
   OR b.user_id IN (
     SELECT u.id FROM auth.users u
     WHERE coalesce(u.raw_user_meta_data ->> 'seed_tag', '') = '${SEED_TAG}'
       AND current_setting('app.seed_admin_email', true) <> ''
       AND lower(u.email) IS DISTINCT FROM lower(current_setting('app.seed_admin_email', true))
   );

DELETE FROM public.ticket_comments c
WHERE c.ticket_id IN (SELECT t.id FROM public.tickets t WHERE t.source_ref = '${SEED_TAG}');

DELETE FROM public.ticket_events e
WHERE e.ticket_id IN (SELECT t.id FROM public.tickets t WHERE t.source_ref = '${SEED_TAG}');

DELETE FROM public.ticket_staff s
WHERE s.ticket_id IN (SELECT t.id FROM public.tickets t WHERE t.source_ref = '${SEED_TAG}');

DELETE FROM public.tickets t
WHERE t.source_ref = '${SEED_TAG}';

DELETE FROM public.ticket_categories c
WHERE c.name = '${SEED_TAG}'
  AND NOT EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.category_id = c.id AND t.source_ref IS DISTINCT FROM '${SEED_TAG}'
  );

DELETE FROM public.rooms r
WHERE r.name LIKE '${SEED_TAG} %'
  AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.room_id = r.id);

DELETE FROM public.team_members m
WHERE m.team_id IN (SELECT t.id FROM public.teams t WHERE t.name = '${SEED_TAG}');

DELETE FROM public.teams t
WHERE t.name = '${SEED_TAG}';

DELETE FROM public.profiles p
WHERE p.id IN (
  SELECT u.id FROM auth.users u
  WHERE coalesce(u.raw_user_meta_data ->> 'seed_tag', '') = '${SEED_TAG}'
    AND current_setting('app.seed_admin_email', true) <> ''
    AND lower(u.email) IS DISTINCT FROM lower(current_setting('app.seed_admin_email', true))
);

DELETE FROM auth.users u
WHERE coalesce(u.raw_user_meta_data ->> 'seed_tag', '') = '${SEED_TAG}'
  AND current_setting('app.seed_admin_email', true) <> ''
  AND lower(u.email) IS DISTINCT FROM lower(current_setting('app.seed_admin_email', true));

COMMIT;`;
