import type { Request } from "express";
import type { Types } from "mongoose";
import ActivityLog from "../models/ActivityLog.js";

function headerIp(req: Request): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0] || null;
  if (Array.isArray(forwarded)) return forwarded[0] || null;
  return null;
}

export async function writeLog(input: {
  req: Request;
  action: string;
  description: string;
  entityType?: string;
  entityId?: Types.ObjectId | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const { req, action, description, entityType = "", entityId = null, meta = {} } = input;

  try {
    const actorId = req.user?._id || null;
    const actorEmail = req.user?.email || "";

    const ip = headerIp(req) || req.socket?.remoteAddress || req.ip || "";
    const userAgent = req.headers["user-agent"] || "";

    await ActivityLog.create({
      action,
      description,
      actorId,
      actorEmail,
      ip,
      userAgent,
      entityType,
      entityId,
      meta,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn("[ACTIVITY] log write failed:", message);
  }
}
