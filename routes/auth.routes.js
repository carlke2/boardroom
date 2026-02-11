const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const { authRequired } = require("../middleware/auth");

/**
 * Safe async wrapper
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * POST /auth/register
 * body: { name, email, phone, password, role? }
 *
 * NOTE: Your User schema requires:
 * - phone (required)
 * - passwordHash (required)
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
    const normalizedPhone = String(phone).trim(); // keep as user provides (+254...)

    const existsEmail = await User.findOne({ email: normalizedEmail });
    if (existsEmail) {
      return res.status(409).json({ ok: false, message: "Email already in use" });
    }

    const existsPhone = await User.findOne({ phone: normalizedPhone });
    if (existsPhone) {
      return res.status(409).json({ ok: false, message: "Phone already in use" });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    // Default USER unless explicitly set to ADMIN (you can lock this down later)
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
 * body: { email, password }
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

    const hash = user.passwordHash;
    if (!hash) {
      return res.status(500).json({ ok: false, message: "User passwordHash missing in DB" });
    }

    const match = await bcrypt.compare(String(password), hash);
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

module.exports = router;
