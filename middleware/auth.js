// server/middleware/auth.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

async function runAuth(req) {
  const token = getBearerToken(req);
  if (!token) return { ok: false, status: 401, message: "Missing token" };

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    return { ok: false, status: 401, message: "Invalid token" };
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
      role: user.role,
      phone: user.phone || null,
    },
    token,
    decoded,
  };
}

function authRequired(...args) {
  // authRequired()
  if (args.length === 0) {
    return async (req, res, next) => {
      try {
        const result = await runAuth(req);
        if (!result.ok) return res.status(result.status).json({ ok: false, message: result.message });

        req.user = result.user;
        req.token = result.token;
        req.jwt = result.decoded;

        return next();
      } catch (err) {
        console.error("Auth middleware failed:", err);
        return res.status(500).json({ ok: false, message: "Auth middleware failed" });
      }
    };
  }

  // authRequired(req,res,next)
  const [req, res, next] = args;
  return (async () => {
    try {
      const result = await runAuth(req);
      if (!result.ok) return res.status(result.status).json({ ok: false, message: result.message });

      req.user = result.user;
      req.token = result.token;
      req.jwt = result.decoded;

      return next();
    } catch (err) {
      console.error("Auth middleware failed:", err);
      return res.status(500).json({ ok: false, message: "Auth middleware failed" });
    }
  })();
}

const requireAuth = authRequired;

module.exports = { authRequired, requireAuth };
