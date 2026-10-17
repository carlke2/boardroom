import { Router } from "express";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rateLimit } from "../middleware/rateLimit.js";
import { checkAuth, checkDatabase, type LiveCheck } from "../utils/liveChecks.js";

const WINDOW_MS = 60 * 1000;
const HEALTH_MAX = 60;

function appVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return typeof pkg.version === "string" && pkg.version ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function statusOf(check: LiveCheck): "up" | "down" {
  return check.ok ? "up" : "down";
}

function requestIdOf(req: { requestId?: string; id?: string }): string {
  return req.requestId || req.id || "";
}

export function createHealthRouter(
  databaseCheck: () => Promise<LiveCheck> = checkDatabase,
  authCheck: () => Promise<LiveCheck> = checkAuth,
  version = appVersion()
): Router {
  const router = Router();
  const limit = rateLimit({ windowMs: WINDOW_MS, max: HEALTH_MAX, keyPrefix: "health" });

  router.get("/health", limit, async (req, res) => {
    const [database, auth] = await Promise.all([databaseCheck(), authCheck()]);
    const requestId = requestIdOf(req as { requestId?: string; id?: string });
    const body = {
      ok: database.ok && auth.ok,
      database: statusOf(database),
      auth: statusOf(auth),
      time: new Date().toISOString(),
      version,
      requestId,
    };
    res.status(body.ok ? 200 : 503).json(body);
  });

  router.get("/ready", limit, async (req, res) => {
    const [database, auth] = await Promise.all([databaseCheck(), authCheck()]);
    const requestId = requestIdOf(req as { requestId?: string; id?: string });
    const ready = database.ok && auth.ok;
    const body = {
      ok: ready,
      database: statusOf(database),
      auth: statusOf(auth),
      time: new Date().toISOString(),
      version,
      requestId,
    };
    res.status(ready ? 200 : 503).json(body);
  });

  return router;
}
