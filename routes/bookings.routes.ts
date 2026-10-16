import { Router } from "express";
import type { UserQuery } from "../db/rpc.js";
import { userQuery } from "../db/rpc.js";
import { authRequired, type AccessClaims } from "../middleware/auth.js";
import { requireRoles } from "../middleware/requireRole.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { optionalLimit, optionalText, optionalTimestamp, requiredText, requiredUuid } from "../utils/validate.js";

const ROLES = ["USER", "AGENT", "TEAM_LEAD", "ADMIN"] as const;

function claimsOf(req: { claims?: unknown; user?: { id: string } }): AccessClaims {
  return (req.claims ?? { sub: req.user!.id }) as AccessClaims;
}

export function createBookingRouter(query: UserQuery = userQuery): Router {
  const router = Router();
  const gate = [authRequired(), requireRoles(...ROLES)] as const;

  router.get(
    "/mine",
    ...gate,
    asyncHandler(async (req, res) => {
      const rows = await query<{ bookings: unknown }>(claimsOf(req), "select public.list_my_bookings($1, $2) as bookings", [
        optionalLimit(req.query.limit),
        optionalTimestamp(req.query.before, "before"),
      ]);
      return res.json({ ok: true, bookings: rows[0]?.bookings ?? [] });
    })
  );

  router.post(
    "/",
    ...gate,
    asyncHandler(async (req, res) => {
      const attendees = Array.isArray(req.body?.attendees) ? req.body.attendees.filter((item: unknown) => typeof item === "string") : [];
      const rows = await query(
        claimsOf(req),
        "select * from public.create_booking($1::uuid, $2::timestamptz, $3::timestamptz, $4, $5, $6::text[], $7)",
        [
          requiredUuid(req.body?.roomId, "roomId"),
          requiredText(req.body?.start, "start"),
          requiredText(req.body?.end, "end"),
          requiredText(req.body?.teamName, "teamName"),
          optionalText(req.body?.title) ?? "",
          attendees,
          optionalText(req.body?.meetingLink),
        ]
      );
      return res.status(201).json({ ok: true, booking: rows[0] ?? null });
    })
  );

  router.post(
    "/:id/cancel",
    ...gate,
    asyncHandler(async (req, res) => {
      const rows = await query(claimsOf(req), "select * from public.cancel_booking($1::uuid)", [requiredUuid(req.params.id, "id")]);
      return res.json({ ok: true, booking: rows[0] ?? null });
    })
  );

  return router;
}
