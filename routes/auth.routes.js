const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { google } = require("googleapis");

const User = require("../models/User");
const { authRequired } = require("../middleware/auth");
const { CONST } = require("../config/constants");

/**
 * Safe async wrapper
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/* =========================================================
   AUTH ROUTES
========================================================= */

/**
 * POST /auth/register
 */
router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { name, email, phone, password, role } = req.body || {};

    if (!name || !email || !phone || !password) {
      return res.status(400).json({
        ok: false,
        message: "name, email, phone, password are required"
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedPhone = String(phone).trim();

    const existsEmail = await User.findOne({ email: normalizedEmail });
    if (existsEmail) {
      return res.status(409).json({ ok: false, message: "Email already in use" });
    }

    const existsPhone = await User.findOne({ phone: normalizedPhone });
    if (existsPhone) {
      return res.status(409).json({ ok: false, message: "Phone already in use" });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    const safeRole = role === "ADMIN" ? "ADMIN" : "USER";

    const user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      phone: normalizedPhone,
      passwordHash,
      role: safeRole
    });

    return res.status(201).json({
      ok: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role
      }
    });
  })
);

/**
 * POST /auth/login
 */
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ ok: false, message: "email and password are required" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(401).json({ ok: false, message: "Invalid credentials" });
    }

    const match = await bcrypt.compare(String(password), user.passwordHash);
    if (!match) {
      return res.status(401).json({ ok: false, message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user._id.toString(), role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({
      ok: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role
      }
    });
  })
);

/**
 * GET /auth/me
 */
router.get(
  "/me",
  authRequired,
  asyncHandler(async (req, res) => {
    return res.json({ ok: true, user: req.user });
  })
);

/* =========================================================
   GOOGLE CALENDAR OAUTH (RENDER PRODUCTION READY)
========================================================= */

/**
 * GET /auth/google/connect
 * Opens Google consent screen
 */
router.get("/google/connect", (req, res) => {
  const client = new google.auth.OAuth2(
    CONST.GOOGLE.CLIENT_ID,
    CONST.GOOGLE.CLIENT_SECRET,
    CONST.GOOGLE.REDIRECT_URI
  );

  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar"]
  });

  return res.redirect(url);
});

/**
 * GET /auth/oauth2callback
 * Returns refresh token JSON
 */
router.get(
  "/oauth2callback",
  asyncHandler(async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send("Missing ?code");

    const client = new google.auth.OAuth2(
      CONST.GOOGLE.CLIENT_ID,
      CONST.GOOGLE.CLIENT_SECRET,
      CONST.GOOGLE.REDIRECT_URI
    );

    const { tokens } = await client.getToken(code);

    return res.json({
      ok: true,
      message: "Copy this refresh_token into Render env",
      refresh_token: tokens.refresh_token || null
    });
  })
);

module.exports = router;
