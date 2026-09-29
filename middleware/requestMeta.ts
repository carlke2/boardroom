import type { NextFunction, Request, Response } from "express";

export function requestMeta(req: Request, _res: Response, next: NextFunction): void {
  const forwarded = req.headers["x-forwarded-for"];
  const forwardedIp =
    typeof forwarded === "string"
      ? forwarded.split(",")[0]?.trim() || ""
      : Array.isArray(forwarded)
        ? forwarded[0] || ""
        : "";

  const ip = forwardedIp || req.ip || req.socket?.remoteAddress || "";

  req.requestMeta = {
    ip,
    userAgent: String(req.headers["user-agent"] || ""),
  };

  next();
}
