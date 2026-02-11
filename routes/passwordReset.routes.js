// routes/passwordReset.routes.js
const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const PasswordReset = require("../models/PasswordReset");
const { sendMail } = require("../services/mailer");

const router = express.Router();

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

// POST /auth/forgot-password
router.post("/forgot-password", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ ok: false, message: "Email is required" });

    const user = await User.findOne({ email });

    // Always return ok:true to avoid email enumeration
    if (!user) {
      console.log("[RESET] forgot-password: email not found (hidden):", email);
      return res.json({ ok: true });
    }

    // Create raw token + store hashed token
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = sha256(token);

    const minutes = Number(process.env.RESET_TOKEN_MINUTES || 30);
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000);

    // Invalidate any old tokens for this user (optional but recommended)
    await PasswordReset.updateMany(
      { userId: user._id, usedAt: null },
      { $set: { usedAt: new Date() } }
    );

    await PasswordReset.create({
      userId: user._id,
      tokenHash,
      expiresAt,
      usedAt: null,
    });

    const appUrl = process.env.APP_URL || "http://localhost:5173";
    const link = `${appUrl}/reset-password?token=${token}`;

    // ✅ Debug logs (so we know why no email arrives)
    console.log("[RESET] forgot-password request OK for:", user.email);
    console.log("[RESET] SMTP_USER is", process.env.SMTP_USER ? "SET" : "MISSING");
    console.log("[RESET] SMTP_PASS is", process.env.SMTP_PASS ? "SET" : "MISSING");
    console.log("[RESET] Reset link:", link);

    // ✅ DEV fallback: return link to help you test without email
    if (process.env.NODE_ENV !== "production" && process.env.RESET_DEV_LINK === "true") {
      return res.json({ ok: true, devLink: link });
    }

    // ✅ Send mail, but don’t hide errors from server logs
    try {
      const info = await sendMail({
        to: user.email,
        subject: "Reset your Boardroom password",
        text:
          `Hi ${user.name || "there"},\n\n` +
          `You requested a password reset.\n\n` +
          `Reset link (valid for ${minutes} minutes):\n${link}\n\n` +
          `If you didn't request this, you can ignore this email.\n\n` +
          `— Boardroom Booking System`,
      });

      console.log("[RESET] Email sent OK:", info?.messageId || info?.response || "sent");
    } catch (mailErr) {
      console.error("[RESET] Email send FAILED:", mailErr?.message || mailErr);
      // Still respond ok:true for security
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("forgot-password error:", e.message);
    // Still ok:true to prevent leaking info
    return res.json({ ok: true });
  }
});

// POST /auth/reset-password
router.post("/reset-password", async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    const newPassword = String(req.body?.newPassword || "");

    if (!token || !newPassword) {
      return res.status(400).json({ ok: false, message: "Token and newPassword are required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ ok: false, message: "Password must be at least 8 characters" });
    }

    const tokenHash = sha256(token);

    const reset = await PasswordReset.findOne({
      tokenHash,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    });

    if (!reset) {
      return res.status(400).json({ ok: false, message: "Invalid or expired reset token" });
    }

    const user = await User.findById(reset.userId);
    if (!user) return res.status(400).json({ ok: false, message: "User not found" });

    const passwordHash = await bcrypt.hash(newPassword, 10);

    // your schema requires passwordHash
    user.passwordHash = passwordHash;
    await user.save();

    reset.usedAt = new Date();
    await reset.save();

    return res.json({ ok: true });
  } catch (e) {
    console.error("reset-password error:", e.message);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

module.exports = router;
