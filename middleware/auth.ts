import type { NextFunction, Request, RequestHandler, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import User from "../models/User.js";
import type { AuthUser, UserRole } from "../types/auth.js";

interface AccessToken extends JwtPayload {
  id?: string;
  _id?: string;
  userId?: string;
  role?: string;
}

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET missing in .env");
  return secret;
}

function asRole(role: string | undefined): UserRole {
  if (role === "ADMIN" || role === "TEAM_LEAD" || role === "AGENT") return role;
  return "USER";
}

async function runAuth(req: Request): Promise<
  | { ok: false; status: number; message: string }
  | { ok: true; user: AuthUser; token: string; decoded: AccessToken | string }
> {
  const token = getBearerToken(req);
  if (!token) return { ok: false, status: 401, message: "Missing token" };

  let decoded: AccessToken | string;
  try {
    const verified = jwt.verify(token, jwtSecret());
    decoded = typeof verified === "string" ? verified : (verified as AccessToken);
  } catch {
    return { ok: false, status: 401, message: "Invalid token" };
  }

  if (typeof decoded === "string") {
    return { ok: false, status: 401, message: "Invalid token payload" };
  }

  const userId = decoded.id || decoded._id || decoded.userId || decoded.sub;
  if (!userId) return { ok: false, status: 401, message: "Invalid token payload" };

  const user = await User.findById(userId).select("_id name email role phone");
  if (!user) return { ok: false, status: 401, message: "User not found" };

  return {
    ok: true,
    user: {
      id: user._id.toString(),
      _id: user._id,
      name: user.name,
      email: user.email,
      role: asRole(user.role),
      phone: user.phone || null,
    },
    token,
    decoded,
  };
}

async function applyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await runAuth(req);
    if (!result.ok) {
      res.status(result.status).json({ ok: false, message: result.message });
      return;
    }

    req.user = result.user;
    req.token = result.token;
    req.jwt = result.decoded;
    next();
  } catch (err) {
    console.error("Auth middleware failed:", err);
    res.status(500).json({ ok: false, message: "Auth middleware failed" });
  }
}

export function authRequired(req: Request, res: Response, next: NextFunction): Promise<void>;
export function authRequired(): RequestHandler;
export function authRequired(
  ...args: [] | [Request, Response, NextFunction]
): RequestHandler | Promise<void> {
  if (args.length === 0) {
    const handler: RequestHandler = (req, res, next) => {
      void applyAuth(req, res, next);
    };
    return handler;
  }

  const [req, res, next] = args;
  return applyAuth(req, res, next);
}

export const requireAuth = authRequired;
