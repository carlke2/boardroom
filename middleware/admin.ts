import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AccessClaims } from "./auth.js";
import { resolveRole, RoleForbidden } from "./role.js";

export function adminRequired(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const claims = req.claims as AccessClaims | undefined;
    if (!claims?.sub) {
      res.status(401).json({ ok: false, message: "Missing token", code: "token_invalid" });
      return;
    }
    void resolveRole(claims, req)
      .then((role) => {
        if (role !== "ADMIN") {
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
