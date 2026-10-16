import { Router } from "express";

export function createHealthRouter(ping: () => Promise<void>): Router {
  const router = Router();
  router.get("/health", async (_req, res) => {
    try {
      await ping();
      res.json({ ok: true, database: "up" });
    } catch {
      res.status(503).json({ ok: false, database: "down" });
    }
  });
  return router;
}
