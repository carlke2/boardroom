import { Router } from "express";
import bcrypt from "bcryptjs";
import { google } from "googleapis";
import User from "../models/User.js";
import { authAllowPending, authRequired } from "../middleware/auth.js";
import { CONST } from "../config/constants.js";
import type { UserRole } from "../types/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AuthFlowError, loginWithPassword, requestOtp, selectRole, updateProfile, verifyOtp } from "../services/auth/authFlow.js";

const router = Router();

function sendFlowError(res: { status: (code: number) => { json: (body: unknown) => unknown } }, error: unknown) {
  if (error instanceof AuthFlowError) {
    return res.status(error.status).json({ ok: false, message: error.message });
  }
  throw error;
}

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { name, email, phone, password, role } = req.body || {};

    if (!name || !email || !phone || !password) {
      return res.status(400).json({
        ok: false,
        message: "name, email, phone, password are required",
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
    const safeRole: UserRole = role === "ADMIN" ? "ADMIN" : "USER";

    const user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      phone: normalizedPhone,
      passwordHash,
      role: safeRole,
      roles: [safeRole],
    });

    return res.status(201).json({
      ok: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  })
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const email = req.body?.email;
    const password = req.body?.passwordRaw ?? req.body?.password;
    try {
      const session = await loginWithPassword(email, password);
      return res.json({ ok: true, ...session });
    } catch (error) {
      return sendFlowError(res, error);
    }
  })
);

router.post(
  "/otp/request",
  asyncHandler(async (req, res) => {
    try {
      const result = await requestOtp(req.body?.phone);
      return res.json(result);
    } catch (error) {
      return sendFlowError(res, error);
    }
  })
);

router.post(
  "/otp/verify",
  asyncHandler(async (req, res) => {
    try {
      const session = await verifyOtp(req.body?.phone, req.body?.code);
      return res.json({ ok: true, ...session });
    } catch (error) {
      return sendFlowError(res, error);
    }
  })
);

router.post(
  "/select-role",
  authAllowPending,
  asyncHandler(async (req, res) => {
    try {
      const session = await selectRole(req.user!.id, req.body?.role);
      return res.json({ ok: true, ...session });
    } catch (error) {
      return sendFlowError(res, error);
    }
  })
);

router.post(
  "/switch-role",
  authRequired(),
  asyncHandler(async (req, res) => {
    try {
      const session = await selectRole(req.user!.id, req.body?.role);
      return res.json({ ok: true, ...session });
    } catch (error) {
      return sendFlowError(res, error);
    }
  })
);

router.get(
  "/me",
  authRequired,
  asyncHandler(async (req, res) => {
    return res.json({ ok: true, user: req.user });
  })
);

router.patch(
  "/me",
  authRequired(),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const hasName = Object.prototype.hasOwnProperty.call(body, "name");
    const hasPhone = Object.prototype.hasOwnProperty.call(body, "phone");
    const hasNext = Object.prototype.hasOwnProperty.call(body, "newPassword");
    if (!hasName && !hasPhone && !hasNext) {
      return res.status(400).json({ ok: false, message: "name, phone, or newPassword is required" });
    }
    if (hasNext && !body.currentPassword) {
      return res.status(400).json({ ok: false, message: "Current password is required to set a new password" });
    }
    try {
      const user = await updateProfile(req.user!.id, req.user!.role, {
        name: hasName ? String(body.name || "") : undefined,
        phone: hasPhone ? String(body.phone || "") : undefined,
        currentPassword: body.currentPassword ? String(body.currentPassword) : undefined,
        newPassword: hasNext ? String(body.newPassword || "") : undefined,
      });
      return res.json({ ok: true, user });
    } catch (error) {
      return sendFlowError(res, error);
    }
  })
);

router.get("/google/connect", (_req, res) => {
  const client = new google.auth.OAuth2(
    CONST.GOOGLE.CLIENT_ID,
    CONST.GOOGLE.CLIENT_SECRET,
    CONST.GOOGLE.REDIRECT_URI
  );

  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar"],
  });

  return res.redirect(url);
});

router.get(
  "/oauth2callback",
  asyncHandler(async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
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
      refresh_token: tokens.refresh_token || null,
    });
  })
);

export default router;
