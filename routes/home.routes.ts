import { Router } from "express";
import { authRequired } from "../middleware/auth.js";
import { withUser } from "../db/postgres.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { mapDbError } from "../utils/httpError.js";

export interface HomeCounts {
  openTickets: number;
  unreadNotifications: number;
  upcomingBookings: number;
}

export async function loadHomeCounts(claims: Record<string, unknown>): Promise<HomeCounts> {
  return withUser(claims, async (client) => {
    const result = await client.query<{ counts: HomeCounts }>("select public.home_counts() as counts");
    const counts = result.rows[0]?.counts;
    return {
      openTickets: Number(counts?.openTickets ?? 0),
      unreadNotifications: Number(counts?.unreadNotifications ?? 0),
      upcomingBookings: Number(counts?.upcomingBookings ?? 0),
    };
  });
}

export function createHomeRouter(load: (claims: Record<string, unknown>) => Promise<HomeCounts> = loadHomeCounts): Router {
  const router = Router();
  router.get(
    "/counts",
    authRequired(),
    asyncHandler(async (req, res) => {
      try {
        const counts = await load(req.claims ?? { sub: req.user!.id });
        return res.json({ ok: true, ...counts });
      } catch (error) {
        throw mapDbError(error);
      }
    })
  );
  return router;
}

export default createHomeRouter();
