import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { getEnv, trustProxySetting } from "./config/env.js";
import { requestMeta } from "./middleware/requestMeta.js";
import { createAdminRouter } from "./routes/admin.routes.js";
import { createAuthRouter, liveAuthProvider } from "./routes/auth.routes.js";
import { createBookingRouter } from "./routes/bookings.routes.js";
import { createDashboardRouter } from "./routes/dashboard.routes.js";
import { createHealthRouter } from "./routes/health.js";
import { createHomeRouter } from "./routes/home.routes.js";
import { createNotificationRouter } from "./routes/notifications.routes.js";
import { createRoomRouter } from "./routes/rooms.routes.js";
import { createTicketRouter } from "./routes/tickets.routes.js";
import { clientErrorMessage } from "./utils/errors.js";
import { HttpError } from "./utils/httpError.js";
import { attachRequestId, createLogger, createRequestLogger } from "./utils/logger.js";

export function createApp(): express.Express {
  const env = getEnv();
  const app = express();
  app.set("trust proxy", trustProxySetting(env));

  const logger = createLogger(env.NODE_ENV);
  app.use(createRequestLogger(logger));
  app.use(attachRequestId());

  const origins = env.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowAnyOrigin = origins.includes("*");
  app.use(
    cors({
      origin(origin, callback) {
        // Native mobile clients often send no Origin; allow those.
        if (!origin || allowAnyOrigin || origins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
    })
  );
  app.use(express.json({ limit: "8mb" }));
  app.use(requestMeta);
  app.use(createHealthRouter());
  app.use("/auth", createAuthRouter(liveAuthProvider));
  app.use("/home", createHomeRouter());
  app.use("/admin", createAdminRouter());
  app.use("/tickets", createTicketRouter());
  app.use("/rooms", createRoomRouter());
  app.use("/bookings", createBookingRouter());
  app.use("/notifications", createNotificationRouter());
  app.use("/dashboard", createDashboardRouter());

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const status =
      err instanceof HttpError
        ? err.status
        : err && typeof err === "object" && "status" in err && typeof err.status === "number"
          ? err.status
          : 500;
    if (status >= 500) console.error("Request failed");
    const code = err instanceof HttpError ? err.apiCode : status >= 500 ? "internal" : "validation";
    const details = err instanceof HttpError ? err.details : {};
    const requestId = req.requestId || (req as Request & { id?: string }).id || "";
    if (requestId && !res.getHeader("X-Request-Id")) {
      res.setHeader("X-Request-Id", requestId);
    }
    res.status(status).json({
      ok: false,
      message: clientErrorMessage(err, status, env.NODE_ENV),
      code,
      requestId,
      ...details,
    });
  });

  return app;
}
