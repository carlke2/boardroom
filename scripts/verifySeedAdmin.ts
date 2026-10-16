/**
 * Read-only verification for the seeded admin. Never prints passwords or tokens.
 * Temporary helper for the seed task; safe output only.
 */
import jwt from "jsonwebtoken";
import { getEnv, runEnvCheck } from "../config/env.js";
import { connectPostgres, getPool } from "../db/postgres.js";

function redact(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(password|secret|token|apikey)\s*[:=]\s*\S+/gi, "$1=[redacted]");
}

async function main(): Promise<void> {
  runEnvCheck();
  const env = getEnv();
  await connectPostgres();

  const email = env.SEED_ADMIN_EMAIL.trim().toLowerCase();
  const auth = await getPool().query<{
    id: string;
    confirmed: boolean;
  }>(
    `SELECT id::text AS id, (email_confirmed_at IS NOT NULL) AS confirmed
     FROM auth.users
     WHERE lower(email) = lower($1)
     LIMIT 1`,
    [email]
  );
  const authRow = auth.rows[0];
  if (!authRow) {
    console.log("sql.auth=missing");
  } else {
    console.log(`sql.auth=present confirmed=${authRow.confirmed} userId=${authRow.id}`);
    const profile = await getPool().query<{
      role: string;
      roles: string[];
      active: boolean;
    }>("SELECT role, roles, active FROM public.profiles WHERE id = $1::uuid", [authRow.id]);
    const row = profile.rows[0];
    if (!row) {
      console.log("sql.profile=missing");
    } else {
      console.log(`sql.profile=present role=${row.role} roles=${(row.roles || []).join(",")} active=${row.active}`);
      console.log(`sql.admin_role=${(row.roles || []).includes("ADMIN") && row.role === "ADMIN"}`);
    }
  }

  const loginResponse = await fetch(`http://127.0.0.1:${env.PORT}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: env.SEED_ADMIN_PASSWORD }),
  });
  const loginBody = (await loginResponse.json()) as Record<string, unknown>;
  console.log(`login.status=${loginResponse.status} ok=${loginBody.ok === true}`);
  const accessToken = typeof loginBody.accessToken === "string" ? loginBody.accessToken : "";
  console.log(`login.accessTokenPresent=${accessToken.length > 0}`);

  if (!accessToken) {
    console.log("login.claims=unavailable");
    return;
  }

  const decoded = jwt.decode(accessToken);
  if (!decoded || typeof decoded !== "object") {
    console.log("login.claims=undecodable");
    return;
  }
  const claims = decoded as Record<string, unknown>;
  const userRole = typeof claims.user_role === "string" ? claims.user_role : null;
  const userRoles = Array.isArray(claims.user_roles) ? claims.user_roles.filter((role) => typeof role === "string") : [];
  console.log(`login.claim.user_role=${userRole ?? "missing"}`);
  console.log(`login.claim.user_roles=${userRoles.length ? userRoles.join(",") : "missing"}`);
  if (userRole === "ADMIN" || userRoles.includes("ADMIN")) {
    console.log("login.hook=enabled_or_claims_include_ADMIN");
  } else {
    console.log("login.hook=not_enabled_fallback_profiles.role");
  }

  try {
    jwt.verify(accessToken, env.SUPABASE_JWT_SECRET, { algorithms: ["HS256"] });
    console.log("login.tokenVerified=true");
  } catch {
    console.log("login.tokenVerified=false");
  }

  const meResponse = await fetch(`http://127.0.0.1:${env.PORT}/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meBody = (await meResponse.json()) as Record<string, unknown>;
  const meUser = meBody.user && typeof meBody.user === "object" ? (meBody.user as Record<string, unknown>) : null;
  console.log(`me.status=${meResponse.status} ok=${meBody.ok === true} role=${meUser?.role ?? "missing"}`);

  const countsResponse = await fetch(`http://127.0.0.1:${env.PORT}/home/counts`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const countsBody = (await countsResponse.json()) as Record<string, unknown>;
  console.log(
    `home.status=${countsResponse.status} ok=${countsBody.ok === true} keys=${Object.keys(countsBody).sort().join(",")}`
  );
}

try {
  await main();
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : "verify failed"));
  process.exit(1);
}
