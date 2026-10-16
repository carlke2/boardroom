import { Router } from "express";
import type { UserQuery } from "../db/rpc.js";
import { userQuery } from "../db/rpc.js";
import { authRequired, type AccessClaims } from "../middleware/auth.js";
import { requireRoles } from "../middleware/requireRole.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { optionalLimit, optionalTimestamp, requiredUuid } from "../utils/validate.js";

const ROLES = ["USER", "AGENT", "TEAM_LEAD", "ADMIN"] as const;

function claimsOf(req: { claims?: unknown; user?: { id: string } }): AccessClaims {
  return (req.claims ?? { sub: req.user!.id }) as AccessClaims;
}

export function createNotificationRouter(query: UserQuery = userQuery): Router {
  const router = Router();
  const gate = [authRequired(), requireRoles(...ROLES)] as const;

  router.get(
    "/",
    ...gate,
    asyncHandler(async (req, res) => {
      const rows = await query(claimsOf(req), "select * from public.list_notifications($1, $2)", [
        optionalLimit(req.query.limit),
        optionalTimestamp(req.query.before, "before"),
      ]);
      return res.json({ ok: true, notifications: rows });
    })
  );

  router.get(
    "/unread-count",
    ...gate,
    asyncHandler(async (req, res) => {
      const rows = await query<{ unread: number }>(claimsOf(req), "select public.unread_notification_count() as unread");
      return res.json({ ok: true, unread: Number(rows[0]?.unread ?? 0) });
    })
  );

  router.post(
    "/read-all",
    ...gate,
    asyncHandler(async (req, res) => {
      const rows = await query<{ updated: number }>(claimsOf(req), "select public.mark_all_notifications_read() as updated");
      return res.json({ ok: true, updated: Number(rows[0]?.updated ?? 0) });
    })
  );

  router.post(
    "/:id/read",
    ...gate,
    asyncHandler(async (req, res) => {
      const rows = await query(claimsOf(req), "select * from public.mark_notification_read($1::uuid)", [
        requiredUuid(req.params.id, "id"),
      ]);
      return res.json({ ok: true, notification: rows[0] ?? null });
    })
  );

  return router;
}
