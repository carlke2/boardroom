import { Router } from "express";
import { adminRequired } from "../middleware/admin.js";
import { authRequired, type AccessClaims } from "../middleware/auth.js";
import { resolveRole } from "../middleware/role.js";
import { createManagedUser } from "../services/auth/adminUsers.js";
import { AuthProviderError } from "../services/auth/errors.js";
import type { UserRole } from "../types/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { optionalText, requiredText } from "../utils/validate.js";

const ROLES: readonly UserRole[] = ["USER", "AGENT", "TEAM_LEAD", "ADMIN"];

export function createAdminRouter(
  createUser: typeof createManagedUser = createManagedUser
): Router {
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

  router.post(
    "/users",
    authRequired(),
    adminRequired(),
    asyncHandler(async (req, res) => {
      if (req.body && typeof req.body === "object" && "password" in req.body) {
        throw new HttpError(422, "password is not accepted", "validation");
      }
      const name = requiredText(req.body?.name, "name");
      const email = requiredText(req.body?.email, "email").toLowerCase();
      const phone = optionalText(req.body?.phone) ?? undefined;
      const roleRaw = requiredText(req.body?.role, "role");
      if (!ROLES.includes(roleRaw as UserRole)) throw new HttpError(422, "invalid role", "validation");
      try {
        const user = await createUser({ name, email, phone, role: roleRaw as UserRole });
        return res.status(201).json({ ok: true, user });
      } catch (error) {
        if (error instanceof AuthProviderError) {
          return res.status(error.status).json({ ok: false, message: error.message, code: "validation" });
        }
        throw error;
      }
    })
  );

  return router;
}

export default createAdminRouter();
