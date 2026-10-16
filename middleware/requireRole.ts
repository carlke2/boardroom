import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { UserRole } from "../types/auth.js";
import type { AccessClaims } from "./auth.js";
import { resolveRole, RoleForbidden } from "./role.js";

/** Role gate. The only role read is resolveRole. */
export function requireRoles(...allowed: UserRole[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const claims = req.claims as AccessClaims | undefined;
    if (!claims?.sub) {
      res.status(401).json({ ok: false, message: "Missing token", code: "token_invalid" });
      return;
    }
    void resolveRole(claims, req)
      .then((role) => {
        if (!allowed.includes(role)) {
          res.status(403).json({ ok: false, message: "forbidden", code: "forbidden" });
          return;
        }
        next();
      })
      .catch((error: unknown) => {
        if (error instanceof RoleForbidden) {
          res.status(error.status).json(error.body);
          return;
        }
        next(error);
      });
  };
}
