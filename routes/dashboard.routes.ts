import { Router } from "express";
import type { UserQuery } from "../db/rpc.js";
import { userQuery } from "../db/rpc.js";
import { authRequired, type AccessClaims } from "../middleware/auth.js";
import { requireRoles } from "../middleware/requireRole.js";
import { asyncHandler } from "../utils/asyncHandler.js";

function claimsOf(req: { claims?: unknown; user?: { id: string } }): AccessClaims {
  return (req.claims ?? { sub: req.user!.id }) as AccessClaims;
}

async function load(query: UserQuery, claims: AccessClaims, fn: string): Promise<unknown> {
  const rows = await query<{ dashboard: unknown }>(claims, `select public.${fn}() as dashboard`);
  return rows[0]?.dashboard ?? {};
}

export function createDashboardRouter(query: UserQuery = userQuery): Router {
  const router = Router();

  router.get(
    "/user",
    authRequired(),
    requireRoles("USER"),
    asyncHandler(async (req, res) => {
      return res.json({ ok: true, ...(await load(query, claimsOf(req), "dashboard_user") as object) });
    })
  );

  router.get(
    "/staff",
    authRequired(),
    requireRoles("AGENT", "TEAM_LEAD"),
    asyncHandler(async (req, res) => {
      return res.json({ ok: true, ...(await load(query, claimsOf(req), "dashboard_staff") as object) });
    })
  );

  router.get(
    "/admin",
    authRequired(),
    requireRoles("ADMIN"),
    asyncHandler(async (req, res) => {
      return res.json({ ok: true, ...(await load(query, claimsOf(req), "dashboard_admin") as object) });
    })
  );

  return router;
}
