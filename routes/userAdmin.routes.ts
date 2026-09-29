import { Router } from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../models/User.js";
import { authRequired } from "../middleware/auth.js";
import { adminRequired } from "../middleware/admin.js";
import type { UserRole } from "../types/auth.js";
import { asString } from "../utils/errors.js";
import { requireUser, wrapTicket } from "./ticketHttp.js";
import { isUserRole } from "../services/auth/session.js";
import { TicketError } from "../services/tickets/errors.js";

const router = Router();
const CREATABLE_ROLES = ["USER", "AGENT", "TEAM_LEAD"] as const;
const ALL_ROLES: UserRole[] = ["ADMIN", "TEAM_LEAD", "AGENT", "USER"];

router.use("/admin/users", authRequired(), adminRequired());

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function publicUser(user: {
  _id: unknown;
  name: string;
  email: string;
  phone: string;
  role: string;
  roles?: string[];
  active: boolean;
}) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    roles: user.roles?.length ? user.roles : [user.role],
    active: user.active,
  };
}

router.get(
  "/admin/users",
  wrapTicket(async (req, res) => {
    requireUser(req);
    const q = asString(req.query.q).trim();
    const role = asString(req.query.role).trim();
    const page = Math.max(1, Number(asString(req.query.page) || 1));
    const limit = Math.min(100, Math.max(1, Number(asString(req.query.limit) || 25)));

    const filter: Record<string, unknown> = {};
    if (role) {
      if (!ALL_ROLES.includes(role as UserRole)) throw new TicketError(400, "Invalid role");
      filter.role = role;
    }
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
    }

    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select("name email phone role roles active")
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

    res.json({ ok: true, users: users.map(publicUser), total });
  })
);

router.post(
  "/admin/users",
  wrapTicket(async (req, res) => {
    requireUser(req);
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const phone = String(req.body?.phone || "").trim();
    const role = String(req.body?.role || "");
    const tempPassword = String(req.body?.tempPassword || "");

    if (!name || !email || !phone || !role || !tempPassword) {
      throw new TicketError(400, "name, email, phone, role, and tempPassword are required");
    }
    if (!CREATABLE_ROLES.includes(role as (typeof CREATABLE_ROLES)[number])) {
      throw new TicketError(400, "role must be USER, AGENT, or TEAM_LEAD");
    }
    if (tempPassword.length < 8) {
      throw new TicketError(400, "tempPassword must be at least 8 characters");
    }

    const emailTaken = await User.findOne({ email });
    if (emailTaken) throw new TicketError(409, "Email already in use");
    const phoneTaken = await User.findOne({ phone });
    if (phoneTaken) throw new TicketError(409, "Phone already in use");

    const user = await User.create({
      name,
      email,
      phone,
      passwordHash: await bcrypt.hash(tempPassword, 10),
      role,
      roles: [role],
      active: true,
    });

    res.status(201).json({ ok: true, user: publicUser(user) });
  })
);

router.patch(
  "/admin/users/:id",
  wrapTicket(async (req, res) => {
    requireUser(req);
    if (!mongoose.isValidObjectId(req.params.id)) throw new TicketError(400, "Invalid id");

    const user = await User.findById(req.params.id);
    if (!user) throw new TicketError(404, "User not found");

    const body = req.body || {};
    const hasName = Object.prototype.hasOwnProperty.call(body, "name");
    const hasPhone = Object.prototype.hasOwnProperty.call(body, "phone");
    const hasActive = Object.prototype.hasOwnProperty.call(body, "active");
    const hasRoles = Object.prototype.hasOwnProperty.call(body, "roles");
    if (!hasName && !hasPhone && !hasActive && !hasRoles) {
      throw new TicketError(400, "name, phone, active, or roles is required");
    }

    if (hasName) {
      const name = String(body.name || "").trim();
      if (!name) throw new TicketError(400, "name cannot be empty");
      user.name = name;
    }

    if (hasPhone) {
      const phone = String(body.phone || "").trim();
      if (!phone) throw new TicketError(400, "phone cannot be empty");
      const taken = await User.findOne({ phone, _id: { $ne: user._id } });
      if (taken) throw new TicketError(409, "Phone already in use");
      user.phone = phone;
    }

    if (hasActive) {
      if (typeof body.active !== "boolean") throw new TicketError(400, "active must be true or false");
      user.active = body.active;
    }

    if (hasRoles) {
      if (!Array.isArray(body.roles) || body.roles.length === 0) {
        throw new TicketError(400, "roles must be a non-empty list");
      }
      const roles: UserRole[] = [];
      for (const entry of body.roles) {
        const value = String(entry);
        if (!isUserRole(value)) throw new TicketError(400, "roles must be ADMIN, TEAM_LEAD, AGENT, or USER");
        if (!roles.includes(value)) roles.push(value);
      }
      user.roles = roles;
      if (!roles.includes(user.role)) user.role = roles[0];
    }

    await user.save();
    res.json({ ok: true, user: publicUser(user) });
  })
);

export default router;
