import { Router } from "express";
import mongoose from "mongoose";
import { authRequired } from "../middleware/auth.js";
import { adminRequired } from "../middleware/admin.js";
import TicketCategory from "../models/TicketCategory.js";
import Team from "../models/Team.js";
import TeamMember from "../models/TeamMember.js";
import User from "../models/User.js";
import SlaPolicy from "../models/SlaPolicy.js";
import BusinessHours from "../models/BusinessHours.js";
import RoutingRule from "../models/RoutingRule.js";
import CannedResponse from "../models/CannedResponse.js";
import { ASSIGN_STRATEGIES, isTicketChannel, isTicketPriority } from "../types/tickets.js";
import { TicketError } from "../services/tickets/errors.js";
import { requireUser, wrapTicket } from "./ticketHttp.js";

const router = Router();
router.use("/admin/ticket-config", authRequired(), adminRequired());

function duplicate(error: unknown, message: string): never {
  if (error && typeof error === "object" && "code" in error && error.code === 11000) {
    throw new TicketError(409, message);
  }
  throw error;
}

function isHHMM(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

router.get(
  "/admin/ticket-config/categories",
  wrapTicket(async (_req, res) => {
    res.json({ ok: true, categories: await TicketCategory.find({}).sort({ name: 1 }) });
  })
);

router.post(
  "/admin/ticket-config/categories",
  wrapTicket(async (req, res) => {
    requireUser(req);
    const name = String(req.body?.name || "").trim();
    if (!name) throw new TicketError(400, "name is required");
    const priority = req.body?.defaultPriority;
    if (priority && !isTicketPriority(priority)) throw new TicketError(400, "Invalid priority");
    try {
      const category = await TicketCategory.create({
        name,
        defaultTeamId: req.body?.defaultTeamId || null,
        defaultPriority: priority && isTicketPriority(priority) ? priority : "MEDIUM",
      });
      res.status(201).json({ ok: true, category });
    } catch (error) {
      duplicate(error, "Category already exists");
    }
  })
);

router.patch(
  "/admin/ticket-config/categories/:id",
  wrapTicket(async (req, res) => {
    const category = await TicketCategory.findByIdAndUpdate(req.params.id, req.body || {}, { new: true });
    if (!category) throw new TicketError(404, "Category not found");
    res.json({ ok: true, category });
  })
);

router.delete(
  "/admin/ticket-config/categories/:id",
  wrapTicket(async (req, res) => {
    const category = await TicketCategory.findByIdAndDelete(req.params.id);
    if (!category) throw new TicketError(404, "Category not found");
    res.json({ ok: true });
  })
);

router.get(
  "/admin/ticket-config/teams",
  wrapTicket(async (_req, res) => {
    const teams = await Team.find({}).sort({ name: 1 });
    const members = await TeamMember.find({}).populate("userId", "name email role");
    res.json({ ok: true, teams, members });
  })
);

router.post(
  "/admin/ticket-config/teams",
  wrapTicket(async (req, res) => {
    const name = String(req.body?.name || "").trim();
    if (!name) throw new TicketError(400, "name is required");
    try {
      const team = await Team.create({ name });
      res.status(201).json({ ok: true, team });
    } catch (error) {
      duplicate(error, "Team already exists");
    }
  })
);

router.patch(
  "/admin/ticket-config/teams/:id",
  wrapTicket(async (req, res) => {
    const name = req.body?.name != null ? String(req.body.name).trim() : undefined;
    const team = await Team.findByIdAndUpdate(req.params.id, name ? { name } : {}, { new: true });
    if (!team) throw new TicketError(404, "Team not found");
    res.json({ ok: true, team });
  })
);

router.delete(
  "/admin/ticket-config/teams/:id",
  wrapTicket(async (req, res) => {
    const team = await Team.findByIdAndDelete(req.params.id);
    if (!team) throw new TicketError(404, "Team not found");
    await TeamMember.deleteMany({ teamId: team._id });
    res.json({ ok: true });
  })
);

router.post(
  "/admin/ticket-config/teams/:id/members",
  wrapTicket(async (req, res) => {
    const team = await Team.findById(req.params.id);
    if (!team) throw new TicketError(404, "Team not found");
    if (!mongoose.isValidObjectId(req.body?.userId)) throw new TicketError(400, "userId is required");
    const user = await User.findById(req.body.userId);
    if (!user) throw new TicketError(404, "User not found");
    const isLead = Boolean(req.body?.isLead);
    if (user.role === "USER") user.role = isLead ? "TEAM_LEAD" : "AGENT";
    else if (isLead && user.role === "AGENT") user.role = "TEAM_LEAD";
    await user.save();
    try {
      const member = await TeamMember.create({ teamId: team._id, userId: user._id, isLead });
      res.status(201).json({ ok: true, member });
    } catch (error) {
      duplicate(error, "User is already on this team");
    }
  })
);

router.delete(
  "/admin/ticket-config/teams/:id/members/:userId",
  wrapTicket(async (req, res) => {
    const member = await TeamMember.findOneAndDelete({
      teamId: req.params.id,
      userId: req.params.userId,
    });
    if (!member) throw new TicketError(404, "Member not found");
    res.json({ ok: true });
  })
);

router.get(
  "/admin/ticket-config/sla-policies",
  wrapTicket(async (_req, res) => {
    res.json({ ok: true, policies: await SlaPolicy.find({}).sort({ priority: 1 }) });
  })
);

router.post(
  "/admin/ticket-config/sla-policies",
  wrapTicket(async (req, res) => {
    const priority = String(req.body?.priority || "");
    if (!isTicketPriority(priority)) throw new TicketError(400, "Invalid priority");
    const responseMinutes = Number(req.body?.responseMinutes);
    const resolutionMinutes = Number(req.body?.resolutionMinutes);
    if (!Number.isFinite(responseMinutes) || responseMinutes < 1) {
      throw new TicketError(400, "responseMinutes must be >= 1");
    }
    if (!Number.isFinite(resolutionMinutes) || resolutionMinutes < 1) {
      throw new TicketError(400, "resolutionMinutes must be >= 1");
    }
    try {
      const policy = await SlaPolicy.create({
        priority,
        responseMinutes,
        resolutionMinutes,
        businessHoursId: req.body?.businessHoursId || null,
      });
      res.status(201).json({ ok: true, policy });
    } catch (error) {
      duplicate(error, "A policy for that priority already exists");
    }
  })
);

router.patch(
  "/admin/ticket-config/sla-policies/:id",
  wrapTicket(async (req, res) => {
    const policy = await SlaPolicy.findByIdAndUpdate(req.params.id, req.body || {}, { new: true });
    if (!policy) throw new TicketError(404, "Policy not found");
    res.json({ ok: true, policy });
  })
);

router.delete(
  "/admin/ticket-config/sla-policies/:id",
  wrapTicket(async (req, res) => {
    const policy = await SlaPolicy.findByIdAndDelete(req.params.id);
    if (!policy) throw new TicketError(404, "Policy not found");
    res.json({ ok: true });
  })
);

router.get(
  "/admin/ticket-config/business-hours",
  wrapTicket(async (_req, res) => {
    res.json({ ok: true, items: await BusinessHours.find({}).sort({ name: 1 }) });
  })
);

router.post(
  "/admin/ticket-config/business-hours",
  wrapTicket(async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const windows = Array.isArray(req.body?.windows) ? req.body.windows : [];
    if (!name) throw new TicketError(400, "name is required");
    for (const window of windows) {
      if (typeof window.day !== "number" || window.day < 0 || window.day > 6) {
        throw new TicketError(400, "window.day must be 0-6");
      }
      if (!isHHMM(String(window.start)) || !isHHMM(String(window.end))) {
        throw new TicketError(400, "window start and end must be HH:mm");
      }
    }
    const item = await BusinessHours.create({
      name,
      timezone: req.body?.timezone || "Africa/Nairobi",
      windows,
    });
    res.status(201).json({ ok: true, item });
  })
);

router.patch(
  "/admin/ticket-config/business-hours/:id",
  wrapTicket(async (req, res) => {
    const item = await BusinessHours.findByIdAndUpdate(req.params.id, req.body || {}, { new: true });
    if (!item) throw new TicketError(404, "Business hours not found");
    res.json({ ok: true, item });
  })
);

router.delete(
  "/admin/ticket-config/business-hours/:id",
  wrapTicket(async (req, res) => {
    const item = await BusinessHours.findByIdAndDelete(req.params.id);
    if (!item) throw new TicketError(404, "Business hours not found");
    res.json({ ok: true });
  })
);

router.get(
  "/admin/ticket-config/routing-rules",
  wrapTicket(async (_req, res) => {
    res.json({ ok: true, rules: await RoutingRule.find({}).sort({ order: 1, createdAt: 1 }) });
  })
);

router.post(
  "/admin/ticket-config/routing-rules",
  wrapTicket(async (req, res) => {
    const name = String(req.body?.name || "").trim();
    if (!name) throw new TicketError(400, "name is required");
    const channel = req.body?.channel ? String(req.body.channel) : null;
    if (channel && !isTicketChannel(channel)) throw new TicketError(400, "Invalid channel");
    const priority = req.body?.priority ? String(req.body.priority) : null;
    if (priority && !isTicketPriority(priority)) throw new TicketError(400, "Invalid priority");
    const assignStrategy = String(req.body?.assignStrategy || "MANUAL");
    if (!(ASSIGN_STRATEGIES as readonly string[]).includes(assignStrategy)) {
      throw new TicketError(400, "Invalid assignStrategy");
    }
    const rule = await RoutingRule.create({
      name,
      active: req.body?.active !== false,
      channel,
      keyword: req.body?.keyword || "",
      categoryId: req.body?.categoryId || null,
      priority,
      teamId: req.body?.teamId || null,
      assignStrategy,
      order: Number(req.body?.order || 0),
    });
    res.status(201).json({ ok: true, rule });
  })
);

router.patch(
  "/admin/ticket-config/routing-rules/:id",
  wrapTicket(async (req, res) => {
    const rule = await RoutingRule.findByIdAndUpdate(req.params.id, req.body || {}, { new: true });
    if (!rule) throw new TicketError(404, "Rule not found");
    res.json({ ok: true, rule });
  })
);

router.delete(
  "/admin/ticket-config/routing-rules/:id",
  wrapTicket(async (req, res) => {
    const rule = await RoutingRule.findByIdAndDelete(req.params.id);
    if (!rule) throw new TicketError(404, "Rule not found");
    res.json({ ok: true });
  })
);

router.get(
  "/admin/ticket-config/canned-responses",
  wrapTicket(async (_req, res) => {
    res.json({ ok: true, items: await CannedResponse.find({}).sort({ title: 1 }) });
  })
);

router.post(
  "/admin/ticket-config/canned-responses",
  wrapTicket(async (req, res) => {
    const title = String(req.body?.title || "").trim();
    const body = String(req.body?.body || "").trim();
    if (!title || !body) throw new TicketError(400, "title and body are required");
    const item = await CannedResponse.create({
      title,
      body,
      teamId: req.body?.teamId || null,
    });
    res.status(201).json({ ok: true, item });
  })
);

router.patch(
  "/admin/ticket-config/canned-responses/:id",
  wrapTicket(async (req, res) => {
    const item = await CannedResponse.findByIdAndUpdate(req.params.id, req.body || {}, { new: true });
    if (!item) throw new TicketError(404, "Canned response not found");
    res.json({ ok: true, item });
  })
);

router.delete(
  "/admin/ticket-config/canned-responses/:id",
  wrapTicket(async (req, res) => {
    const item = await CannedResponse.findByIdAndDelete(req.params.id);
    if (!item) throw new TicketError(404, "Canned response not found");
    res.json({ ok: true });
  })
);

export default router;
