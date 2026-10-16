import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import { getEnv } from "../config/env.js";
import type { AuthUser, UserRole } from "../types/auth.js";
import { resolveRole, RoleForbidden } from "./role.js";

export interface AccessClaims extends Record<string, unknown> {
  sub: string;
  email?: string;
  role: "authenticated";
  user_role?: string;
  user_roles?: string[];
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

function authIssuer(supabaseUrl = getEnv().SUPABASE_URL): string {
  return `${supabaseUrl.replace(/\/$/, "")}/auth/v1`;
}

function jwksUrl(supabaseUrl = getEnv().SUPABASE_URL): URL {
  return new URL("/auth/v1/.well-known/jwks.json", `${supabaseUrl.replace(/\/$/, "")}/`);
}

let remoteJwks: JWTVerifyGetKey | undefined;
let jwksOverride: JWTVerifyGetKey | undefined;

/** Test hook: inject a local JWKS key set. Pass undefined to clear. */
export function setJwksForTests(getKey: JWTVerifyGetKey | undefined): void {
  jwksOverride = getKey;
  remoteJwks = undefined;
}

function resolveJwks(): JWTVerifyGetKey {
  if (jwksOverride) return jwksOverride;
  if (!remoteJwks) {
    remoteJwks = createRemoteJWKSet(jwksUrl());
  }
  return remoteJwks;
}

function asClaims(payload: JWTPayload): AccessClaims {
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("Invalid token payload");
  }
  const userRoles = Array.isArray(payload.user_roles)
    ? payload.user_roles.filter((role): role is string => typeof role === "string")
    : undefined;
  return {
    ...payload,
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    role: "authenticated",
    user_role: typeof payload.user_role === "string" ? payload.user_role : undefined,
    user_roles: userRoles,
  };
}

/**
 * Verifies a Supabase access token via JWKS (signature, expiry, issuer, audience).
 * If SUPABASE_JWT_SECRET is set, falls back to HS256 with the same checks.
 */
export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const env = getEnv();
  const issuer = authIssuer(env.SUPABASE_URL);
  const options = { issuer, audience: "authenticated" } as const;

  try {
    const { payload } = await jwtVerify(token, resolveJwks(), options);
    return asClaims(payload);
  } catch (jwksError) {
    const legacy = env.SUPABASE_JWT_SECRET;
    if (!legacy) throw jwksError;
    const secret = new TextEncoder().encode(legacy);
    const { payload } = await jwtVerify(token, secret, {
      ...options,
      algorithms: ["HS256"],
    });
    return asClaims(payload);
  }
}

export function toAuthUser(claims: AccessClaims, role: UserRole): AuthUser {
  return {
    id: claims.sub,
    _id: claims.sub,
    name: "",
    email: claims.email ?? "",
    role,
    roles: [role],
    activeRole: role,
    phone: null,
  };
}

async function applyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ ok: false, message: "Missing token", code: "token_invalid" });
    return;
  }
  let claims: AccessClaims;
  try {
    claims = await verifyAccessToken(token);
  } catch (error) {
    const expired =
      (error instanceof Error && error.name === "JWTExpired") ||
      (error && typeof error === "object" && "code" in error && error.code === "ERR_JWT_EXPIRED");
    res.status(401).json(
      expired
        ? { ok: false, message: "Token expired", code: "token_expired" }
        : { ok: false, message: "Invalid token", code: "token_invalid" }
    );
    return;
  }
  try {
    const role = await resolveRole(claims, req);
    req.user = toAuthUser(claims, role);
    req.token = token;
    req.claims = claims;
    req.jwt = claims;
    next();
  } catch (error) {
    if (error instanceof RoleForbidden) {
      res.status(error.status).json(error.body);
      return;
    }
    next(error);
  }
}

export function authRequired(req: Request, res: Response, next: NextFunction): void;
export function authRequired(): RequestHandler;
export function authRequired(...args: [] | [Request, Response, NextFunction]): RequestHandler | void {
  if (args.length === 0) return (req, res, next) => {
    void applyAuth(req, res, next);
  };
  const [req, res, next] = args;
  void applyAuth(req, res, next);
}

export const requireAuth = authRequired;
