import { getEnv } from "../../config/env.js";
import { withService } from "../../db/postgres.js";
import type { UserRole } from "../../types/auth.js";
import { AuthProviderError } from "./errors.js";

export interface CreateManagedUserInput {
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
}

export interface CreateManagedUserResult {
  id: string;
  email: string;
  role: UserRole;
}

type AdminTransport = (path: string, init: RequestInit) => Promise<{ status: number; payload: unknown }>;

function safeMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const candidate = record.msg ?? record.error_description ?? record.message;
    if (typeof candidate === "string" && candidate.length > 0 && candidate.length <= 180) {
      if (!/password|secret|token|key|bearer/i.test(candidate)) return candidate;
    }
  }
  return `Auth admin request failed (${status})`;
}

export function createAdminTransport(): AdminTransport {
  const env = getEnv();
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  return async (path, init) => {
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        ...init,
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    } catch {
      throw new AuthProviderError(502, "Auth admin API is unreachable");
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

/**
 * Creates a confirmed Auth user with no password and emails a set-password link.
 * Rejects callers that pass a password field before this runs.
 */
export async function createManagedUser(
  input: CreateManagedUserInput,
  transport: AdminTransport = createAdminTransport()
): Promise<CreateManagedUserResult> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const phone = (input.phone ?? "").trim();
  const created = await transport("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      email_confirm: true,
      user_metadata: { name, phone },
    }),
  });
  if (created.status < 200 || created.status >= 300) {
    throw new AuthProviderError(created.status >= 400 && created.status < 600 ? created.status : 502, safeMessage(created.payload, created.status));
  }
  const payload = created.payload && typeof created.payload === "object" ? (created.payload as Record<string, unknown>) : null;
  const nested = payload?.user && typeof payload.user === "object" ? (payload.user as Record<string, unknown>) : null;
  const id = typeof nested?.id === "string" ? nested.id : typeof payload?.id === "string" ? payload.id : "";
  if (!id) throw new AuthProviderError(502, "Auth admin create returned no user id");

  const invite = await transport("/auth/v1/invite", { method: "POST", body: JSON.stringify({ email }) });
  if (invite.status < 200 || invite.status >= 300) {
    const recover = await transport("/auth/v1/recover", { method: "POST", body: JSON.stringify({ email }) });
    if (recover.status < 200 || recover.status >= 300) {
      throw new AuthProviderError(502, safeMessage(invite.payload ?? recover.payload, invite.status || recover.status));
    }
  }

  await withService({ systemJob: true }, async (client) => {
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
      [id, name, email, phone, input.role]
    );
  });

  return { id, email, role: input.role };
}
