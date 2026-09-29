import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import User from "../../models/User.js";
import { sendSms } from "../notify/sms.js";
import { normalizeKenyanMobile, phoneVariants } from "./phone.js";
import { otpStore } from "./otpStore.js";
import { assignedRoles, isUserRole, issueSession, publicSessionUser, signAccessToken } from "./session.js";
import type { UserRole } from "../../types/auth.js";

const OTP_TTL_SECONDS = 300;
const OTP_COOLDOWN_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;

interface OtpRecord {
  codeHash: string;
  userId: string;
  attempts: number;
}

export class AuthFlowError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

async function findByPhone(phoneRaw: string) {
  const normalized = normalizeKenyanMobile(phoneRaw);
  if (!normalized) throw new AuthFlowError(400, "Enter a valid phone number");

  const variants = phoneVariants(phoneRaw);
  const candidates = await User.find({ phone: { $in: variants } });
  const matches = candidates.filter((user) => normalizeKenyanMobile(user.phone || "") === normalized);
  return { normalized, matches };
}

export async function loginWithPassword(emailRaw: string, passwordRaw: string) {
  const email = String(emailRaw || "").trim().toLowerCase();
  const password = String(passwordRaw || "");
  if (!email || !password) throw new AuthFlowError(400, "email and password are required");

  const user = await User.findOne({ email });
  if (!user) throw new AuthFlowError(401, "Invalid email or password");

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) throw new AuthFlowError(401, "Invalid email or password");
  if (!user.active) throw new AuthFlowError(401, "Account is inactive");

  return issueSession(user);
}

export async function requestOtp(phoneRaw: string) {
  const { normalized, matches } = await findByPhone(phoneRaw);
  if (matches.length > 1) throw new AuthFlowError(409, "More than one account uses that phone number");

  const user = matches[0];
  if (!user) throw new AuthFlowError(401, "No account found with that phone number");
  if (!user.active) throw new AuthFlowError(401, "Account is inactive");

  const cooldownKey = `otp:cooldown:${normalized}`;
  if (otpStore.get(cooldownKey)) {
    throw new AuthFlowError(400, "A code was already sent - wait a minute before requesting another.");
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const record: OtpRecord = {
    codeHash: await bcrypt.hash(code, 10),
    userId: user._id.toString(),
    attempts: 0,
  };
  const otpKey = `otp:${normalized}`;
  otpStore.set(otpKey, JSON.stringify(record), OTP_TTL_SECONDS);
  otpStore.set(cooldownKey, "1", OTP_COOLDOWN_SECONDS);

  const sms = await sendSms({
    to: `+${normalized}`,
    message: `Your Millenium BMS login code is ${code}. It expires in 5 minutes. Do not share this code.`,
  });

  const delivered = sms.ok && !sms.skipped;
  if (!delivered && isProduction()) {
    otpStore.del(otpKey, cooldownKey);
    throw new AuthFlowError(502, "We could not send the SMS just now. Please try again in a moment.");
  }

  return {
    ok: true as const,
    expiresIn: OTP_TTL_SECONDS,
    ...(!isProduction() && !delivered ? { devCode: code } : {}),
  };
}

export async function verifyOtp(phoneRaw: string, codeRaw: string) {
  const code = String(codeRaw || "").trim();
  if (!/^\d{6}$/.test(code)) throw new AuthFlowError(400, "Code must be 6 digits");

  const { normalized } = await findByPhone(phoneRaw);
  const otpKey = `otp:${normalized}`;
  const raw = otpStore.get(otpKey);
  if (!raw) throw new AuthFlowError(401, "Code expired or was never requested - request a new one");

  const record = JSON.parse(raw) as OtpRecord;
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    otpStore.del(otpKey);
    throw new AuthFlowError(401, "Too many incorrect attempts - request a new code");
  }

  const valid = await bcrypt.compare(code, record.codeHash);
  if (!valid) {
    otpStore.setKeepingTtl(otpKey, JSON.stringify({ ...record, attempts: record.attempts + 1 }));
    throw new AuthFlowError(401, "Incorrect code");
  }

  otpStore.del(otpKey);
  const user = await User.findById(record.userId);
  if (!user || !user.active) throw new AuthFlowError(401, "Account is no longer active");
  return issueSession(user);
}

export async function selectRole(userId: string, roleRaw: string) {
  if (!isUserRole(roleRaw)) throw new AuthFlowError(400, "That role is not assigned to this account");
  const role: UserRole = roleRaw;

  const user = await User.findById(userId);
  if (!user || !user.active) throw new AuthFlowError(401, "Invalid session");

  const roles = assignedRoles(user);
  if (!roles.includes(role)) throw new AuthFlowError(400, "That role is not assigned to this account");

  return {
    token: signAccessToken(user._id.toString(), role),
    user: publicSessionUser(user, role),
  };
}

export async function updateProfile(
  userId: string,
  activeRole: UserRole,
  data: { name?: string; phone?: string; currentPassword?: string; newPassword?: string }
) {
  const user = await User.findById(userId);
  if (!user) throw new AuthFlowError(404, "User not found");

  if (data.name !== undefined) {
    const name = data.name.trim();
    if (name.length < 2) throw new AuthFlowError(400, "Name must be at least 2 characters");
    user.name = name;
  }

  if (data.phone !== undefined) {
    const phone = data.phone.trim();
    if (!phone) throw new AuthFlowError(400, "phone cannot be empty");
    const normalized = normalizeKenyanMobile(phone);
    const variants = phoneVariants(phone);
    const taken = await User.find({ _id: { $ne: user._id }, phone: { $in: variants } });
    const clash = taken.some((other) => !normalized || normalizeKenyanMobile(other.phone || "") === normalized);
    if (clash) throw new AuthFlowError(409, "Phone already in use");
    user.phone = phone;
  }

  if (data.newPassword) {
    if (data.newPassword.length < 8) throw new AuthFlowError(400, "Password must be at least 8 characters");
    const currentOk = await bcrypt.compare(data.currentPassword || "", user.passwordHash);
    if (!currentOk) throw new AuthFlowError(401, "Current password is incorrect");
    user.passwordHash = await bcrypt.hash(data.newPassword, 10);
  }

  await user.save();
  return publicSessionUser(user, activeRole);
}
