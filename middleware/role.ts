import type { QueryResultRow } from "pg";
import { withUser } from "../db/postgres.js";
import type { UserRole } from "../types/auth.js";
import type { AccessClaims } from "./auth.js";

const ROLES: readonly UserRole[] = ["ADMIN", "TEAM_LEAD", "AGENT", "USER"];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && ROLES.includes(value as UserRole);
}

/** Inactive or unknown profile. Body is the only 403 shape the gates return for this case. */
export class RoleForbidden extends Error {
  readonly status = 403;
  readonly body = { ok: false as const, message: "forbidden", code: "forbidden" as const };

  constructor() {
    super("forbidden");
  }
}

export interface RoleProfile {
  role: string;
  active: boolean;
}

type RoleProfileLoader = (claims: AccessClaims) => Promise<RoleProfile | null>;

let testLoader: RoleProfileLoader | undefined;

/** Tests inject a profile. Production always reads public.profiles once per scope. */
export function setRoleProfileLoaderForTests(loader: RoleProfileLoader | undefined): void {
  testLoader = loader;
}

async function loadProfile(claims: AccessClaims): Promise<RoleProfile | null> {
  if (testLoader) return testLoader(claims);
  return withUser(claims, async (client) => {
    const result = await client.query<QueryResultRow & RoleProfile>(
      "select role, active from public.profiles where id = $1",
      [claims.sub]
    );
    return result.rows[0] ?? null;
  });
}

const resolved = new WeakMap<object, Promise<UserRole>>();

/**
 * The only role decision in Express.
 * A verified user_role claim wins. Otherwise profiles.role for the token sub.
 * The profile row is loaded once for this scope (the request, when one is passed).
 */
export function resolveRole(claims: AccessClaims, scope: object = claims): Promise<UserRole> {
  const cached = resolved.get(scope);
  if (cached) return cached;
  const pending = decide(claims).catch((error: unknown) => {
    if (!(error instanceof RoleForbidden)) resolved.delete(scope);
    throw error;
  });
  resolved.set(scope, pending);
  return pending;
}

async function decide(claims: AccessClaims): Promise<UserRole> {
  const profile = await loadProfile(claims);
  if (!profile || profile.active !== true) throw new RoleForbidden();
  const claim = typeof claims.user_role === "string" ? claims.user_role.trim() : "";
  if (claim) {
    if (!isUserRole(claim)) throw new RoleForbidden();
    return claim;
  }
  if (!isUserRole(profile.role)) throw new RoleForbidden();
  return profile.role;
}
