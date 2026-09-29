import type { NextFunction, Request, RequestHandler, Response } from "express";

export function adminRequired(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ ok: false, message: "Unauthorized" });
      return;
    }
    if (req.user.role !== "ADMIN") {
      res.status(403).json({ ok: false, message: "Admin only" });
      return;
    }
    next();
  };
}
