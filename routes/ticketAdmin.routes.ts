import { Router } from "express";
import { authRequired } from "../middleware/auth.js";
import {
  addAttachment,
  addComment,
  addTag,
  assignTicket,
  bulkAct,
  getTicket,
  linkTickets,
  listEvents,
  listQueueTickets,
  transitionTicket,
  updateTicket,
} from "../services/tickets/ticketService.js";
import {
  metricsByAgent,
  metricsByCategory,
  metricsByPriority,
  metricsByStatus,
  metricsCsat,
  metricsSla,
  metricsSummary,
  metricsTrend,
  metricsWorkload,
} from "../services/tickets/metrics.js";
import { asString } from "../utils/errors.js";
import { requireUser, wrapTicket } from "./ticketHttp.js";

const router = Router();

router.use("/admin/tickets", authRequired());

router.get(
  "/admin/tickets/metrics/summary",
  wrapTicket(async (req, res) => {
    res.json({ ok: true, summary: await metricsSummary(requireUser(req)) });
  })
);

router.get(
  "/admin/tickets/metrics/by-status",
  wrapTicket(async (req, res) => {
    res.json({ ok: true, items: await metricsByStatus(requireUser(req)) });
  })
);

router.get(
  "/admin/tickets/metrics/by-priority",
  wrapTicket(async (req, res) => {
    res.json({ ok: true, items: await metricsByPriority(requireUser(req)) });
  })
);

router.get(
  "/admin/tickets/metrics/by-category",
  wrapTicket(async (req, res) => {
    res.json({ ok: true, items: await metricsByCategory(requireUser(req)) });
  })
);

router.get(
  "/admin/tickets/metrics/by-agent",
  wrapTicket(async (req, res) => {
    res.json({ ok: true, items: await metricsByAgent(requireUser(req)) });
  })
);

router.get(
  "/admin/tickets/metrics/trend",
  wrapTicket(async (req, res) => {
    const points = await metricsTrend(
      requireUser(req),
      asString(req.query.from),
      asString(req.query.to),
      asString(req.query.interval) || "day"
    );
    res.json({ ok: true, points });
  })
);

router.get(
  "/admin/tickets/metrics/sla",
  wrapTicket(async (req, res) => {
    res.json({ ok: true, sla: await metricsSla(requireUser(req)) });
  })
);

router.get(
  "/admin/tickets/metrics/workload",
  wrapTicket(async (req, res) => {
    res.json({ ok: true, workload: await metricsWorkload(requireUser(req)) });
  })
);

router.get(
  "/admin/tickets/metrics/csat",
  wrapTicket(async (req, res) => {
    res.json({ ok: true, csat: await metricsCsat(requireUser(req)) });
  })
);

router.get(
  "/admin/tickets",
  wrapTicket(async (req, res) => {
    const result = await listQueueTickets(requireUser(req), {
      status: asString(req.query.status) || undefined,
      priority: asString(req.query.priority) || undefined,
      assigneeId: asString(req.query.assignee) || undefined,
      teamId: asString(req.query.team) || undefined,
      categoryId: asString(req.query.category) || undefined,
      sla: asString(req.query.sla) || undefined,
      from: asString(req.query.from) || undefined,
      to: asString(req.query.to) || undefined,
      q: asString(req.query.q) || undefined,
      page: Number(asString(req.query.page) || 1),
      limit: Number(asString(req.query.limit) || 25),
    });
    res.json({ ok: true, ...result });
  })
);

router.post(
  "/admin/tickets/bulk",
  wrapTicket(async (req, res) => {
    const results = await bulkAct(requireUser(req), req.body?.ids, req.body?.action, {
      assigneeId: req.body?.assigneeId,
      tag: req.body?.tag,
    });
    res.json({ ok: true, results });
  })
);

router.get(
  "/admin/tickets/:id",
  wrapTicket(async (req, res) => {
    res.json({ ok: true, ...(await getTicket(requireUser(req), String(req.params.id))) });
  })
);

router.get(
  "/admin/tickets/:id/events",
  wrapTicket(async (req, res) => {
    const events = await listEvents(requireUser(req), String(req.params.id));
    res.json({ ok: true, events });
  })
);

router.patch(
  "/admin/tickets/:id",
  wrapTicket(async (req, res) => {
    const ticket = await updateTicket(requireUser(req), String(req.params.id), req.body || {});
    res.json({ ok: true, ticket });
  })
);

router.post(
  "/admin/tickets/:id/assign",
  wrapTicket(async (req, res) => {
    const ticket = await assignTicket(requireUser(req), String(req.params.id), req.body?.assigneeId);
    res.json({ ok: true, ticket });
  })
);

router.post(
  "/admin/tickets/:id/transition",
  wrapTicket(async (req, res) => {
    const ticket = await transitionTicket(
      requireUser(req),
      String(req.params.id),
      String(req.body?.status || ""),
      req.body?.resolutionNote
    );
    res.json({ ok: true, ticket });
  })
);

router.post(
  "/admin/tickets/:id/comments",
  wrapTicket(async (req, res) => {
    const comment = await addComment(
      requireUser(req),
      String(req.params.id),
      req.body?.body,
      Boolean(req.body?.isInternal)
    );
    res.status(201).json({ ok: true, comment });
  })
);

router.post(
  "/admin/tickets/:id/links",
  wrapTicket(async (req, res) => {
    const link = await linkTickets(
      requireUser(req),
      String(req.params.id),
      String(req.body?.relatedTicketId || ""),
      String(req.body?.type || "")
    );
    res.status(201).json({ ok: true, link });
  })
);

router.post(
  "/admin/tickets/:id/tags",
  wrapTicket(async (req, res) => {
    const tag = await addTag(requireUser(req), String(req.params.id), String(req.body?.tag || ""));
    res.status(201).json({ ok: true, tag });
  })
);

router.post(
  "/admin/tickets/:id/attachments",
  wrapTicket(async (req, res) => {
    const attachment = await addAttachment(requireUser(req), String(req.params.id), req.body || {});
    res.status(201).json({ ok: true, attachment });
  })
);

export default router;
