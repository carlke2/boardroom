import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { z } from "zod";
import { backendRoot, getEnv, runEnvCheck, type Env } from "../config/env.js";
import { connectPostgres, withService, type Queryable } from "../db/postgres.js";
import type { UserRole } from "../types/auth.js";

export const DEFAULT_SEED_TAG = "dev-seed";
export const ROSTER_LOCAL = path.join(backendRoot, "seed", "roster.local.json");
export const ROSTER_EXAMPLE = path.join(backendRoot, "seed", "roster.example.json");

const ROLES = ["USER", "AGENT", "TEAM_LEAD", "ADMIN"] as const;

const personSchema = z
  .object({
    name: z.string().trim().min(1),
    email: z.string().trim().email(),
    phone: z.string().trim().optional().default(""),
    role: z.enum(ROLES),
    team: z.string().trim().optional(),
  })
  .strict();

const teamSchema = z
  .object({
    name: z.string().trim().min(1),
    leadEmail: z.string().trim().email(),
    memberEmails: z.array(z.string().trim().email()).default([]),
  })
  .strict();

export const rosterSchema = z
  .object({
    seedTag: z.string().trim().min(1).default(DEFAULT_SEED_TAG),
    teams: z.array(teamSchema).default([]),
    people: z.array(personSchema).min(1),
  })
  .strict()
  .superRefine((roster, ctx) => {
    const emails = new Set<string>();
    for (const [index, person] of roster.people.entries()) {
      const email = person.email.toLowerCase();
      if (emails.has(email)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["people", index, "email"], message: "duplicate" });
      }
      emails.add(email);
      if (person.team && !roster.teams.some((team) => team.name === person.team)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["people", index, "team"], message: "unknown team" });
      }
    }
    for (const [index, team] of roster.teams.entries()) {
      if (!emails.has(team.leadEmail.toLowerCase())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["teams", index, "leadEmail"], message: "unknown person" });
      }
      for (const [memberIndex, member] of team.memberEmails.entries()) {
        if (!emails.has(member.toLowerCase())) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["teams", index, "memberEmails", memberIndex],
            message: "unknown person",
          });
        }
      }
    }
  });

export type Roster = z.infer<typeof rosterSchema>;
export type RosterPerson = z.infer<typeof personSchema>;

/** Field paths only. Values are never included. */
export function formatRosterErrors(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const fields = error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.map(String).join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
  return `Invalid roster. ${fields.join("; ")}`;
}

export function parseRoster(raw: unknown): Roster {
  const parsed = rosterSchema.safeParse(raw);
  if (!parsed.success) throw new Error(formatRosterErrors(parsed.error));
  return {
    ...parsed.data,
    people: parsed.data.people.map((person) => ({ ...person, email: person.email.toLowerCase() })),
    teams: parsed.data.teams.map((team) => ({
      ...team,
      leadEmail: team.leadEmail.toLowerCase(),
      memberEmails: team.memberEmails.map((email) => email.toLowerCase()),
    })),
  };
}

export function loadRosterFile(filePath = ROSTER_LOCAL): Roster {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing roster file. Copy seed/roster.example.json to seed/roster.local.json and edit it locally.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error("Invalid roster. file: not valid JSON");
  }
  return parseRoster(raw);
}

export function assertSeedAllowed(env: Env): void {
  if (env.NODE_ENV === "production" && !env.ALLOW_PROD_SEED) {
    throw new Error("Refusing to seed when NODE_ENV=production without ALLOW_PROD_SEED=true");
  }
}

export async function prepareSeed(): Promise<Env> {
  runEnvCheck();
  const env = getEnv();
  assertSeedAllowed(env);
  await connectPostgres();
  return env;
}

export type PromptPassword = (label: string) => Promise<string>;

/** Hidden terminal input. Never echoes. Caller must not log the return value. */
export async function promptHiddenPassword(label: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error("Password prompt requires an interactive terminal");
  }
  const stdin = process.stdin;
  const stdout = process.stdout;
  stdout.write(label);
  const wasRaw = stdin.isRaw;
  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (result: string) => {
      stdin.setRawMode?.(wasRaw ?? false);
      stdin.removeListener("data", onData);
      stdout.write("\n");
      resolve(result);
    };
    const onData = (chunk: string | Buffer) => {
      const text = String(chunk);
      if (text === "\u0003") {
        stdin.setRawMode?.(wasRaw ?? false);
        stdin.removeListener("data", onData);
        reject(new Error("Cancelled"));
        return;
      }
      if (text === "\n" || text === "\r" || text === "\u0004") {
        finish(value);
        return;
      }
      if (text === "\u007f" || text === "\b") {
        value = value.slice(0, -1);
        return;
      }
      if (text === "\u0015") {
        value = "";
        return;
      }
      if (text.charCodeAt(0) >= 32) value += text;
    };
    stdin.on("data", onData);
  });
}

export async function minPasswordLength(client: Queryable, env: Env): Promise<number> {
  const result = await client.query<{ value: unknown }>(
    "select value from public.app_settings where key = 'min_password_length' limit 1"
  );
  const raw = result.rows[0]?.value;
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return env.MIN_PASSWORD_LENGTH;
}

export interface AuthUserRecord {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

export type AdminFetch = (path: string, init: RequestInit) => Promise<{ status: number; payload: unknown }>;

export function createAdminFetch(env: Env = getEnv()): AdminFetch {
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
  return async (path, init) => {
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
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

function usersFrom(payload: unknown): AuthUserRecord[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as { users?: unknown; id?: unknown };
  if (typeof record.id === "string") return [payload as AuthUserRecord];
  if (!Array.isArray(record.users)) return [];
  return record.users.filter((row): row is AuthUserRecord => !!row && typeof row === "object" && typeof (row as AuthUserRecord).id === "string");
}

export async function findAuthUserByEmail(admin: AdminFetch, email: string): Promise<AuthUserRecord | null> {
  const byQuery = await admin(`/auth/v1/admin/users?email=${encodeURIComponent(email)}`, { method: "GET" });
  if (byQuery.status >= 200 && byQuery.status < 300) {
    const match = usersFrom(byQuery.payload).find((user) => (user.email || "").toLowerCase() === email);
    if (match) return match;
  }
  const listed = await admin("/auth/v1/admin/users?page=1&per_page=200", { method: "GET" });
  if (listed.status < 200 || listed.status >= 300) throw new Error(safeAuthError(listed.payload, listed.status));
  return usersFrom(listed.payload).find((user) => (user.email || "").toLowerCase() === email) ?? null;
}

export function seedMetadata(name: string, phone: string, seedTag: string): Record<string, unknown> {
  return { name, phone, seed_tag: seedTag, seed: true };
}

export async function createAuthUser(
  admin: AdminFetch,
  input: { email: string; name: string; phone: string; seedTag: string; password?: string }
): Promise<AuthUserRecord> {
  const body: Record<string, unknown> = {
    email: input.email,
    email_confirm: true,
    user_metadata: seedMetadata(input.name, input.phone, input.seedTag),
  };
  if (input.password !== undefined) body.password = input.password;
  const created = await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify(body) });
  if (created.status < 200 || created.status >= 300) throw new Error(safeAuthError(created.payload, created.status));
  const user = usersFrom(created.payload)[0];
  if (!user) throw new Error("Auth admin create returned no user id");
  return user;
}

/** Updates metadata only. Never sends a password. */
export async function tagExistingAuthUser(
  admin: AdminFetch,
  userId: string,
  name: string,
  phone: string,
  seedTag: string
): Promise<void> {
  const updated = await admin(`/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    body: JSON.stringify({
      email_confirm: true,
      user_metadata: seedMetadata(name, phone, seedTag),
    }),
  });
  if (updated.status < 200 || updated.status >= 300) throw new Error(safeAuthError(updated.payload, updated.status));
}

export async function sendSetPasswordEmail(admin: AdminFetch, email: string): Promise<void> {
  const invited = await admin("/auth/v1/invite", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  if (invited.status >= 200 && invited.status < 300) return;
  const recover = await admin("/auth/v1/recover", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  if (recover.status < 200 || recover.status >= 300) {
    throw new Error(safeAuthError(invited.payload ?? recover.payload, invited.status || recover.status));
  }
}

export async function upsertProfile(
  client: Queryable,
  userId: string,
  name: string,
  email: string,
  phone: string,
  role: UserRole
): Promise<void> {
  await client.query("SELECT set_config('app.role_change', 'on', true)");
  await client.query(
    `INSERT INTO public.profiles (id, name, email, phone, role, roles, active)
     VALUES ($1::uuid, $2, $3, NULLIF($4, ''), $5, ARRAY[$5]::text[], true)
     ON CONFLICT (id) DO UPDATE
     SET name = EXCLUDED.name,
         email = EXCLUDED.email,
         phone = EXCLUDED.phone,
         role = EXCLUDED.role,
         roles = EXCLUDED.roles,
         active = true,
         updated_at = now()`,
    [userId, name, email, phone, role]
  );
}

export async function withSeedService<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
  return withService({ systemJob: true }, fn);
}

export function redact(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(password|secret|token|apikey)\s*[:=]\s*\S+/gi, "$1=[redacted]");
}

/**
 * Deletes only rows tagged with the roster seedTag.
 * Auth users are removed only when include_users is true.
 * Never deletes SEED_ADMIN_EMAIL. Empty admin guard deletes nothing for Auth.
 */
export function cleanupSql(seedTag: string, includeUsers: boolean): string {
  return `-- seedTag=${seedTag}
-- Put SEED_ADMIN_EMAIL between the quotes before running. Empty deletes no Auth users.
BEGIN;
SELECT set_config('app.seed_admin_email', '', true);

DELETE FROM public.notifications n
WHERE n.event_type = ${literal(seedTag)}
   OR n.user_id IN (
     SELECT u.id FROM auth.users u
     WHERE coalesce(u.raw_user_meta_data ->> 'seed_tag', '') = ${literal(seedTag)}
       AND current_setting('app.seed_admin_email', true) <> ''
       AND lower(u.email) IS DISTINCT FROM lower(current_setting('app.seed_admin_email', true))
   );

DELETE FROM public.bookings b
WHERE b.team_name = ${literal(seedTag)}
   OR b.user_id IN (
     SELECT u.id FROM auth.users u
     WHERE coalesce(u.raw_user_meta_data ->> 'seed_tag', '') = ${literal(seedTag)}
       AND current_setting('app.seed_admin_email', true) <> ''
       AND lower(u.email) IS DISTINCT FROM lower(current_setting('app.seed_admin_email', true))
   );

DELETE FROM public.ticket_comments c
WHERE c.ticket_id IN (SELECT t.id FROM public.tickets t WHERE t.source_ref = ${literal(seedTag)});
DELETE FROM public.ticket_events e
WHERE e.ticket_id IN (SELECT t.id FROM public.tickets t WHERE t.source_ref = ${literal(seedTag)});
DELETE FROM public.ticket_staff s
WHERE s.ticket_id IN (SELECT t.id FROM public.tickets t WHERE t.source_ref = ${literal(seedTag)});
DELETE FROM public.tickets t WHERE t.source_ref = ${literal(seedTag)};

DELETE FROM public.ticket_categories c
WHERE c.name = ${literal(seedTag)}
  AND NOT EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.category_id = c.id AND t.source_ref IS DISTINCT FROM ${literal(seedTag)}
  );

DELETE FROM public.rooms r
WHERE r.name LIKE ${literal(seedTag + " %")}
  AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.room_id = r.id);

DELETE FROM public.team_members m
WHERE m.team_id IN (SELECT t.id FROM public.teams t WHERE t.name LIKE ${literal(seedTag + "%")} OR t.name = ${literal(seedTag)});
DELETE FROM public.teams t
WHERE t.name LIKE ${literal(seedTag + "%")} OR t.name = ${literal(seedTag)};

DELETE FROM public.profiles p
WHERE p.id IN (
  SELECT u.id FROM auth.users u
  WHERE coalesce(u.raw_user_meta_data ->> 'seed_tag', '') = ${literal(seedTag)}
    AND current_setting('app.seed_admin_email', true) <> ''
    AND lower(u.email) IS DISTINCT FROM lower(current_setting('app.seed_admin_email', true))
);

${
  includeUsers
    ? `DELETE FROM auth.users u
WHERE coalesce(u.raw_user_meta_data ->> 'seed_tag', '') = ${literal(seedTag)}
  AND current_setting('app.seed_admin_email', true) <> ''
  AND lower(u.email) IS DISTINCT FROM lower(current_setting('app.seed_admin_email', true));`
    : `-- Auth users left in place (pass --include-users to remove tagged Auth users)`
}

COMMIT;`;
}

function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// Keep readline import used for type-only environments that tree-shake raw mode helpers.
void readline;
