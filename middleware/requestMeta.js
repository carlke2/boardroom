function requestMeta(req, _res, next) {
  // Trust proxy is set in index.js (so req.ip can work behind Render/Vercel/etc.)
  const forwarded = req.headers["x-forwarded-for"];
  const ip =
    (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "") ||
    req.ip ||
    req.connection?.remoteAddress ||
    "";

  req.requestMeta = {
    ip,
    userAgent: String(req.headers["user-agent"] || "")
  };

  return next();
}

module.exports = { requestMeta };
