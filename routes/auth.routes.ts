import { Router } from "express";
import { authRequired, bearerToken, verifyAccessToken, type AccessClaims } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { resolveRole, RoleForbidden } from "../middleware/role.js";
import { getEnv } from "../config/env.js";
import { AuthProviderError } from "../services/auth/errors.js";
import {
  loginWithPassword,
  logoutSession,
  profileForClaims,
  refreshSession,
  registerAccount,
  requestPasswordReset,
  updatePassword,
  type AuthProfile,
  type AuthTokens,
} from "../services/auth/supabaseAuth.js";
import type { UserRole } from "../types/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const WINDOW_MS = 15 * 60 * 1000;

export interface AuthProvider {
  login(email: string, password: string): Promise<AuthTokens>;
  register(input: { email: string; password: string; name?: string; phone?: string }): Promise<{
    user: { id: string; email: string | null };
    tokens: AuthTokens | null;
  }>;
  forgotPassword(email: string): Promise<void>;
  resetPassword(accessToken: string, password: string): Promise<void>;
  refresh(refreshToken: string): Promise<AuthTokens>;
  logout(accessToken: string): Promise<void>;
  me(claims: Record<string, unknown>, role: UserRole): Promise<AuthProfile>;
}

export const liveAuthProvider: AuthProvider = {
  login: loginWithPassword,
  register: registerAccount,
  forgotPassword: requestPasswordReset,
  resetPassword: updatePassword,
  refresh: refreshSession,
  logout: logoutSession,
  me: profileForClaims,
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function companyEmailAllowed(email: string): boolean {
  const domain = getEnv().COMPANY_DOMAIN.trim().toLowerCase();
  if (!domain) return true;
  return email.endsWith(`@${domain}`);
}

function sendError(res: { status: (code: number) => { json: (body: unknown) => unknown } }, error: unknown) {
  if (error instanceof AuthProviderError) {
    return res.status(error.status).json({ ok: false, message: error.message });
  }
  throw error;
}

export function createAuthRouter(provider: AuthProvider = liveAuthProvider): Router {
  const router = Router();

  router.post(
    "/login",
    rateLimit({ windowMs: WINDOW_MS, max: 10, keyPrefix: "login" }),
    asyncHandler(async (req, res) => {
      const email = text(req.body?.email).toLowerCase();
      const password = text(req.body?.password) || text(req.body?.passwordRaw);
      if (!email || !password) return res.status(400).json({ ok: false, message: "email and password are required" });
      try {
        const session = await provider.login(email, password);
        let claims: AccessClaims;
        try {
          claims = await verifyAccessToken(session.accessToken);
        } catch {
          return res.json({ ok: true, ...session });
        }
        const role = await resolveRole(claims);
        const user = await provider.me(claims, role);
        return res.json({ ok: true, ...session, user: { ...user, role } });
      } catch (error) {
        if (error instanceof RoleForbidden) return res.status(error.status).json(error.body);
        return sendError(res, error);
      }
    })
  );

  router.post(
    "/register",
    rateLimit({ windowMs: WINDOW_MS, max: 5, keyPrefix: "register" }),
    asyncHandler(async (req, res) => {
      const email = text(req.body?.email).toLowerCase();
      const password = text(req.body?.password);
      const name = text(req.body?.name);
      const phone = text(req.body?.phone);
      if (!email || !password) return res.status(400).json({ ok: false, message: "email and password are required" });
      if (password.length < getEnv().MIN_PASSWORD_LENGTH) {
        return res.status(400).json({
          ok: false,
          message: `Password must be at least ${getEnv().MIN_PASSWORD_LENGTH} characters`,
        });
      }
      if (!companyEmailAllowed(email)) return res.status(400).json({ ok: false, message: "Use your company email" });
      try {
        const created = await provider.register({ email, password, name: name || undefined, phone: phone || undefined });
        return res.status(201).json({ ok: true, user: created.user, ...(created.tokens ?? {}) });
      } catch (error) {
        return sendError(res, error);
      }
    })
  );

  router.post(
    "/forgot-password",
    rateLimit({ windowMs: WINDOW_MS, max: 5, keyPrefix: "forgot" }),
    asyncHandler(async (req, res) => {
      const email = text(req.body?.email).toLowerCase();
      if (!email) return res.status(400).json({ ok: false, message: "email is required" });
      try {
        await provider.forgotPassword(email);
        return res.json({ ok: true });
      } catch (error) {
        return sendError(res, error);
      }
    })
  );

  router.post(
    "/reset-password",
    rateLimit({ windowMs: WINDOW_MS, max: 10, keyPrefix: "reset" }),
    asyncHandler(async (req, res) => {
      const password = text(req.body?.password);
      const accessToken = text(req.body?.accessToken) || bearerToken(req) || "";
      if (!accessToken || !password) {
        return res.status(400).json({ ok: false, message: "accessToken and password are required" });
      }
      if (password.length < getEnv().MIN_PASSWORD_LENGTH) {
        return res.status(400).json({
          ok: false,
          message: `Password must be at least ${getEnv().MIN_PASSWORD_LENGTH} characters`,
        });
      }
      try {
        await verifyAccessToken(accessToken);
      } catch {
        return res.status(401).json({ ok: false, message: "Invalid token" });
      }
      try {
        await provider.resetPassword(accessToken, password);
        return res.json({ ok: true });
      } catch (error) {
        return sendError(res, error);
      }
    })
  );

  router.post(
    "/refresh",
    rateLimit({ windowMs: WINDOW_MS, max: 10, keyPrefix: "refresh" }),
    asyncHandler(async (req, res) => {
      const refreshToken = text(req.body?.refreshToken);
      if (!refreshToken) return res.status(422).json({ ok: false, message: "refreshToken is required", code: "validation" });
      try {
        const session = await provider.refresh(refreshToken);
        return res.json({ ok: true, ...session });
      } catch (error) {
        if (error instanceof AuthProviderError && (error.status === 400 || error.status === 401)) {
          return res.status(401).json({ ok: false, message: "Invalid refresh token", code: "refresh_invalid" });
        }
        return sendError(res, error);
      }
    })
  );

  router.post(
    "/logout",
    asyncHandler(async (req, res) => {
      const accessToken = bearerToken(req);
      if (!accessToken) return res.status(401).json({ ok: false, message: "Missing token", code: "token_invalid" });
      try {
        await verifyAccessToken(accessToken);
      } catch (error) {
        const expired = error instanceof Error && (error.name === "JWTExpired" || (error as { code?: string }).code === "ERR_JWT_EXPIRED");
        return res.status(401).json(
          expired
            ? { ok: false, message: "Token expired", code: "token_expired" }
            : { ok: false, message: "Invalid token", code: "token_invalid" }
        );
      }
      try {
        await provider.logout(accessToken);
        return res.json({ ok: true });
      } catch (error) {
        return sendError(res, error);
      }
    })
  );

  router.get(
    "/me",
    authRequired(),
    asyncHandler(async (req, res) => {
      const claims = (req.claims ?? { sub: req.user!.id }) as AccessClaims;
      const role = await resolveRole(claims, req);
      const user = await provider.me(claims, role);
      return res.json({ ok: true, user: { ...user, role } });
    })
  );

  return router;
}

export default createAuthRouter();
