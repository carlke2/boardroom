const ActivityLog = require("../models/ActivityLog");

async function writeLog({
  req,
  action,
  description,
  entityType = "",
  entityId = null,
  meta = {}
}) {
  try {
    const actorId = req?.user?._id || req?.user?.id || null;
    const actorEmail = req?.user?.email || null;

    // ✅ Proper IP detection (works local + production + proxies)
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0] ||
      req.socket?.remoteAddress ||
      req.ip ||
      null;

    // ✅ Proper user agent
    const userAgent = req.headers["user-agent"] || null;

    await ActivityLog.create({
      action,
      description,
      actorId,
      actorEmail,
      ip,
      userAgent,
      entityType,
      entityId,
      meta
    });
  } catch (e) {
    // Do NOT break the app if logging fails
    console.warn("[ACTIVITY] log write failed:", e?.message || e);
  }
}

module.exports = { writeLog };
