import { Router } from "express";
import type { UserQuery } from "../db/rpc.js";
import { userQuery } from "../db/rpc.js";
import { authRequired, type AccessClaims } from "../middleware/auth.js";
import { requireRoles } from "../middleware/requireRole.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { optionalDay, optionalLimit } from "../utils/validate.js";

const ROLES = ["USER", "AGENT", "TEAM_LEAD", "ADMIN"] as const;

export function createRoomRouter(query: UserQuery = userQuery): Router {
  const router = Router();
  const gate = [authRequired(), requireRoles(...ROLES)] as const;

  router.get(
    "/",
    ...gate,
    asyncHandler(async (req, res) => {
      const claims = (req.claims ?? { sub: req.user!.id }) as AccessClaims;
      const rows = await query<{ rooms: unknown }>(claims, "select public.list_rooms($1) as rooms", [
        optionalLimit(req.query.limit),
      ]);
      return res.json({ ok: true, rooms: rows[0]?.rooms ?? [] });
    })
  );

  router.get(
    "/day",
    ...gate,
    asyncHandler(async (req, res) => {
      const day = optionalDay(req.query.day);
      if (!day) throw new HttpError(422, "day is required", "validation");
      const claims = (req.claims ?? { sub: req.user!.id }) as AccessClaims;
      const rows = await query<{ day: unknown }>(claims, "select public.room_day($1::date) as day", [day]);
      return res.json({ ok: true, ...(rows[0]?.day as object) });
    })
  );

  return router;
}
