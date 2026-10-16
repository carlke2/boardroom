import { Router } from "express";
import { adminRequired } from "../middleware/admin.js";
import { authRequired, type AccessClaims } from "../middleware/auth.js";
import { resolveRole } from "../middleware/role.js";
import { asyncHandler } from "../utils/asyncHandler.js";

/** Minimal admin surface for auth checks. Broader admin APIs are not rewritten here. */
export function createAdminRouter(): Router {
  const router = Router();
  router.get(
    "/ping",
    authRequired(),
    adminRequired(),
    asyncHandler(async (req, res) => {
      const role = await resolveRole(req.claims as AccessClaims, req);
      return res.json({ ok: true, role });
    })
  );
  return router;
}

export default createAdminRouter();
