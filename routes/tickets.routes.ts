import { Router } from "express";
import type { UserQuery } from "../db/rpc.js";
import { userQuery } from "../db/rpc.js";
import { authRequired, type AccessClaims } from "../middleware/auth.js";
import { requireRoles } from "../middleware/requireRole.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import {
  optionalBool,
  optionalEnum,
  optionalInt,
  optionalLimit,
  optionalText,
  optionalTimestamp,
  optionalUuid,
  requiredText,
  requiredUuid,
} from "../utils/validate.js";

const ROLES = ["USER", "AGENT", "TEAM_LEAD", "ADMIN"] as const;
const STATUSES = ["NEW", "OPEN", "IN_PROGRESS", "PENDING_CUSTOMER", "ON_HOLD", "RESOLVED", "REOPENED", "CLOSED"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const SLA = ["on_track", "at_risk", "overdue", "paused"] as const;
const CHANNELS = ["API", "WEB", "AGENT", "EMAIL", "SYSTEM"] as const;

function claimsOf(req: { claims?: unknown; user?: { id: string } }): AccessClaims {
  return (req.claims ?? { sub: req.user!.id }) as AccessClaims;
}

export function createTicketRouter(query: UserQuery = userQuery): Router {
  const router = Router();
  const gate = [authRequired(), requireRoles(...ROLES)] as const;

  router.get(
    "/",
    ...gate,
    asyncHandler(async (req, res) => {
      const rows = await query(claimsOf(req), "select * from public.list_tickets($1, $2, $3, $4, $5, $6, $7, $8)", [
        optionalLimit(req.query.limit),
        optionalTimestamp(req.query.before, "before"),
        optionalEnum(req.query.status, STATUSES, "status"),
        optionalEnum(req.query.priority, PRIORITIES, "priority"),
        optionalUuid(req.query.assignee, "assignee"),
        optionalEnum(req.query.sla, SLA, "sla"),
        optionalText(req.query.search),
        optionalUuid(req.query.beforeId, "beforeId"),
      ]);
      const last = rows[rows.length - 1] as { created_at?: string; id?: string } | undefined;
      return res.json({
        ok: true,
        tickets: rows,
        next: last?.created_at ? { before: last.created_at, beforeId: last.id } : null,
      });
    })
  );

  router.get(
    "/:id",
    ...gate,
    asyncHandler(async (req, res) => {
      const rows = await query<{ detail: unknown }>(claimsOf(req), "select public.ticket_detail($1::uuid) as detail", [
        requiredUuid(req.params.id, "id"),
      ]);
      return res.json({ ok: true, ticket: rows[0]?.detail ?? null });
    })
  );

  router.post(
    "/",
    ...gate,
    asyncHandler(async (req, res) => {
      const channel = optionalEnum(req.body?.channel, CHANNELS, "channel") ?? "WEB";
      const rows = await query(claimsOf(req), "select * from public.create_ticket($1, $2, $3, $4::uuid, $5, $6::uuid)", [
        requiredText(req.body?.subject, "subject"),
        requiredText(req.body?.description, "description"),
        channel,
        optionalUuid(req.body?.categoryId, "categoryId"),
        optionalEnum(req.body?.priority, PRIORITIES, "priority"),
        optionalUuid(req.body?.requesterId, "requesterId"),
      ]);
      return res.status(201).json({ ok: true, ticket: rows[0] ?? null });
    })
  );

  router.post(
    "/:id/comments",
    ...gate,
    asyncHandler(async (req, res) => {
      const rows = await query(claimsOf(req), "select * from public.add_comment($1::uuid, $2, $3)", [
        requiredUuid(req.params.id, "id"),
        requiredText(req.body?.body, "body"),
        optionalBool(req.body?.internal),
      ]);
      return res.status(201).json({ ok: true, comment: rows[0] ?? null });
    })
  );

  router.post(
    "/:id/transition",
    ...gate,
    asyncHandler(async (req, res) => {
      const rows = await query(claimsOf(req), "select * from public.transition_ticket($1::uuid, $2, $3)", [
        requiredUuid(req.params.id, "id"),
        requiredText(req.body?.to, "to"),
        optionalText(req.body?.note),
      ]);
      return res.json({ ok: true, ticket: rows[0] ?? null });
    })
  );

  router.post(
    "/:id/rate",
    ...gate,
    asyncHandler(async (req, res) => {
      const score = optionalInt(req.body?.score, "score");
      if (score == null) throw new HttpError(422, "score is required", "validation");
      const rows = await query(claimsOf(req), "select * from public.rate_ticket($1::uuid, $2, $3)", [
        requiredUuid(req.params.id, "id"),
        score,
        optionalText(req.body?.comment),
      ]);
      return res.status(201).json({ ok: true, rating: rows[0] ?? null });
    })
  );

  router.post(
    "/:id/attachments",
    ...gate,
    asyncHandler(async (req, res) => {
      const bytes = optionalInt(req.body?.bytes, "bytes");
      if (bytes == null) throw new HttpError(422, "bytes is required", "validation");
      const rows = await query(claimsOf(req), "select * from public.register_attachment($1::uuid, $2, $3, $4)", [
        requiredUuid(req.params.id, "id"),
        requiredText(req.body?.path, "path"),
        requiredText(req.body?.mime, "mime"),
        bytes,
      ]);
      return res.status(201).json({ ok: true, attachment: rows[0] ?? null });
    })
  );

  return router;
}
