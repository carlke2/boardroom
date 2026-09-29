import { Router } from "express";
import TicketCategory from "../models/TicketCategory.js";
import { authRequired } from "../middleware/auth.js";
import {
  addAttachment,
  addComment,
  createTicket,
  getTicket,
  ingestEmail,
  listOwnTickets,
  reopenTicket,
  submitCsat,
} from "../services/tickets/ticketService.js";
import { TicketError } from "../services/tickets/errors.js";
import { asString } from "../utils/errors.js";
import { requireUser, wrapTicket } from "./ticketHttp.js";

const router = Router();

router.post(
  "/tickets/inbound/email",
  wrapTicket(async (req, res) => {
    const secret = process.env.TICKET_INTAKE_SECRET;
    if (!secret) throw new TicketError(503, "Email intake is not configured");
    if (req.header("x-intake-secret") !== secret) throw new TicketError(401, "Unauthorized");
    const ticket = await ingestEmail({
      from: req.body?.from,
      subject: req.body?.subject,
      body: req.body?.body,
      sourceRef: req.body?.sourceRef ?? null,
    });
    res.status(201).json({ ok: true, ticket });
  })
);

router.get(
  "/tickets/meta",
  authRequired(),
  wrapTicket(async (_req, res) => {
    const categories = await TicketCategory.find({}).sort({ name: 1 });
    res.json({ ok: true, categories });
  })
);

router.post(
  "/tickets",
  authRequired(),
  wrapTicket(async (req, res) => {
    const ticket = await createTicket(requireUser(req), req.body || {});
    res.status(201).json({ ok: true, ticket });
  })
);

router.get(
  "/tickets",
  authRequired(),
  wrapTicket(async (req, res) => {
    const result = await listOwnTickets(requireUser(req), {
      status: asString(req.query.status) || undefined,
      page: Number(asString(req.query.page) || 1),
      limit: Number(asString(req.query.limit) || 25),
    });
    res.json({ ok: true, ...result });
  })
);

router.get(
  "/tickets/:id",
  authRequired(),
  wrapTicket(async (req, res) => {
    const detail = await getTicket(requireUser(req), String(req.params.id));
    res.json({ ok: true, ...detail });
  })
);

router.post(
  "/tickets/:id/comments",
  authRequired(),
  wrapTicket(async (req, res) => {
    const comment = await addComment(requireUser(req), String(req.params.id), req.body?.body, false);
    res.status(201).json({ ok: true, comment });
  })
);

router.post(
  "/tickets/:id/reopen",
  authRequired(),
  wrapTicket(async (req, res) => {
    const ticket = await reopenTicket(requireUser(req), String(req.params.id));
    res.json({ ok: true, ticket });
  })
);

router.post(
  "/tickets/:id/csat",
  authRequired(),
  wrapTicket(async (req, res) => {
    const csat = await submitCsat(
      requireUser(req),
      String(req.params.id),
      Number(req.body?.score),
      req.body?.comment
    );
    res.status(201).json({ ok: true, csat });
  })
);

router.post(
  "/tickets/:id/attachments",
  authRequired(),
  wrapTicket(async (req, res) => {
    const attachment = await addAttachment(requireUser(req), String(req.params.id), req.body || {});
    res.status(201).json({ ok: true, attachment });
  })
);

export default router;
