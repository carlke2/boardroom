import { getEnv } from "../../config/env.js";
import { withUser } from "../../db/postgres.js";
import type { UserRole } from "../../types/auth.js";
import { AuthProviderError } from "./errors.js";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  user: { id: string; email: string | null };
}

export interface AuthProfile {
  id: string;
  email: string | null;
  name: string;
  phone: string | null;
  role: string;
  roles: string[];
  active: boolean;
}

interface GoTrueOptions {
  method: string;
  path: string;
  token?: string;
  body?: unknown;
  /** Service role. Used only to create an already-confirmed account. */
  admin?: boolean;
}

function apiBase(): string {
  return getEnv().SUPABASE_URL.replace(/\/$/, "");
}

function safeMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const candidate = record.msg ?? record.error_description ?? record.message;
    if (typeof candidate === "string" && candidate.length > 0 && candidate.length <= 180 && !candidate.includes("eyJ")) {
      return candidate;
    }
  }
  if (status === 400 || status === 401) return "Invalid email or password";
  return "Auth request failed";
}

function mapStatus(path: string, status: number): number {
  if (path.includes("/token") && (status === 400 || status === 401)) return 401;
  if ((path.endsWith("/signup") || path.endsWith("/admin/users")) && status === 422) return 409;
  if (status === 429) return 429;
  if (status >= 500) return 502;
  return 400;
}

async function gotrue(options: GoTrueOptions): Promise<unknown> {
  const env = getEnv();
  const apiKey = options.admin ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY;
  const headers: Record<string, string> = {
    apikey: apiKey,
    "Content-Type": "application/json",
    Authorization: `Bearer ${options.token ?? apiKey}`,
  };
  let response: Response;
  try {
    response = await fetch(`${apiBase()}${options.path}`, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new AuthProviderError(502, "Auth service is unreachable");
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
  if (!response.ok) {
    throw new AuthProviderError(mapStatus(options.path, response.status), safeMessage(payload, response.status));
  }
  return payload;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function tokensFrom(payload: unknown): AuthTokens {
  const body = asRecord(payload);
  const user = asRecord(body?.user);
  const accessToken = body?.access_token;
  const refreshToken = body?.refresh_token;
  if (!body || typeof accessToken !== "string" || typeof refreshToken !== "string" || !user || typeof user.id !== "string") {
    throw new AuthProviderError(502, "Auth response was incomplete");
  }
  return {
    accessToken,
    refreshToken,
    expiresIn: typeof body.expires_in === "number" ? body.expires_in : 0,
    tokenType: typeof body.token_type === "string" ? body.token_type : "bearer",
    user: { id: user.id, email: typeof user.email === "string" ? user.email : null },
  };
}

export async function loginWithPassword(email: string, password: string): Promise<AuthTokens> {
  const payload = await gotrue({
    method: "POST",
    path: "/auth/v1/token?grant_type=password",
    body: { email, password },
  });
  return tokensFrom(payload);
}

export async function registerAccount(input: {
  email: string;
  password: string;
  name?: string;
  phone?: string;
}): Promise<{ user: { id: string; email: string | null }; tokens: AuthTokens | null }> {
  const data: Record<string, string> = {};
  if (input.name) data.name = input.name;
  if (input.phone) data.phone = input.phone;
  // Email confirmation is off until a later phase. Create the account already confirmed.
  const payload = await gotrue({
    method: "POST",
    path: "/auth/v1/admin/users",
    admin: true,
    body: {
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: data,
    },
  });
  const body = asRecord(payload);
  const nestedUser = asRecord(body?.user);
  const user = nestedUser ?? body;
  if (!user || typeof user.id !== "string") throw new AuthProviderError(502, "Auth response was incomplete");
  const email = typeof user.email === "string" ? user.email : input.email;
  let tokens: AuthTokens | null = null;
  try {
    tokens = await loginWithPassword(email, input.password);
  } catch {
    tokens = null;
  }
  return { user: { id: user.id, email }, tokens };
}

export async function requestPasswordReset(email: string): Promise<void> {
  await gotrue({ method: "POST", path: "/auth/v1/recover", body: { email } });
}

export async function updatePassword(accessToken: string, password: string): Promise<void> {
  await gotrue({ method: "PUT", path: "/auth/v1/user", token: accessToken, body: { password } });
}

export async function refreshSession(refreshToken: string): Promise<AuthTokens> {
  const payload = await gotrue({
    method: "POST",
    path: "/auth/v1/token?grant_type=refresh_token",
    body: { refresh_token: refreshToken },
  });
  return tokensFrom(payload);
}

export async function logoutSession(accessToken: string): Promise<void> {
  await gotrue({ method: "POST", path: "/auth/v1/logout", token: accessToken });
}

export async function profileForClaims(claims: Record<string, unknown>, role: UserRole): Promise<AuthProfile> {
  const sub = typeof claims.sub === "string" ? claims.sub : "";
  const row = await withUser(claims, async (client) => {
    const result = await client.query<{
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      roles: string[] | null;
      active: boolean;
    }>("select id, name, email, phone, roles, active from public.profiles where id = $1", [sub]);
    return result.rows[0] ?? null;
  });
  const storedRoles = (row?.roles ?? []).filter((entry) => typeof entry === "string");
  return {
    id: row?.id ?? sub,
    email: row?.email ?? (typeof claims.email === "string" ? claims.email : null),
    name: row?.name ?? "",
    phone: row?.phone ?? null,
    role,
    roles: storedRoles.length ? storedRoles : [role],
    active: row?.active ?? false,
  };
}
