import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { setEnvForTests } from "../config/env.js";
import type { UserQuery } from "../db/rpc.js";
import { HttpError } from "../utils/httpError.js";
import { setRoleProfileLoaderForTests } from "../middleware/role.js";
import { createAdminRouter } from "../routes/admin.routes.js";
import { createBookingRouter } from "../routes/bookings.routes.js";
import { createDashboardRouter } from "../routes/dashboard.routes.js";
import { createNotificationRouter } from "../routes/notifications.routes.js";
import { createRoomRouter } from "../routes/rooms.routes.js";
import { createTicketRouter } from "../routes/tickets.routes.js";
import { testJwtAudience, testJwtIssuer, validEnvWithLegacyJwt } from "./fixture.js";

const id = "00000000-0000-4000-8000-000000000001";
const roles = ["USER", "AGENT", "TEAM_LEAD", "ADMIN"] as const;
type Role = (typeof roles)[number];

const calls: string[] = [];
const query = (async (_claims: Record<string, unknown>, text: string) => {
  calls.push(text);
  if (text.includes("ticket_detail")) return [{ detail: { id } }];
  if (text.includes("list_rooms")) return [{ rooms: [] }];
  if (text.includes("room_day")) return [{ day: { rooms: [] } }];
  if (text.includes("list_my_bookings")) return [{ bookings: [] }];
  if (text.includes("unread_notification_count")) return [{ unread: 0 }];
  if (text.includes("mark_all_notifications_read")) return [{ updated: 1 }];
  if (text.includes("dashboard_")) return [{ dashboard: { openTickets: 1 } }];
  return [{ id }];
}) as UserQuery;

function sign(role: Role, expiresIn: jwt.SignOptions["expiresIn"] = "5m"): string {
  return jwt.sign({ sub: `${role}-1`, user_role: role, role: "authenticated" }, "test-jwt-secret", {
    expiresIn,
    algorithm: "HS256",
    issuer: testJwtIssuer,
    audience: testJwtAudience,
  });
}

const matrix: { method: string; path: string; body?: unknown; allow: readonly Role[] }[] = [
  { method: "GET", path: "/tickets", allow: roles },
  { method: "GET", path: `/tickets/${id}`, allow: roles },
  { method: "POST", path: "/tickets", body: { subject: "Jam", description: "Paper" }, allow: roles },
  { method: "POST", path: `/tickets/${id}/comments`, body: { body: "Noted" }, allow: roles },
  { method: "POST", path: `/tickets/${id}/transition`, body: { to: "OPEN" }, allow: roles },
  { method: "POST", path: `/tickets/${id}/rate`, body: { score: 5 }, allow: roles },
  { method: "POST", path: `/tickets/${id}/attachments`, body: { path: `tickets/${id}/a.png`, mime: "image/png", bytes: 12 }, allow: roles },
  { method: "GET", path: "/rooms", allow: roles },
  { method: "GET", path: "/rooms/day?day=2026-10-20", allow: roles },
  { method: "GET", path: "/bookings/mine", allow: roles },
  { method: "POST", path: "/bookings", body: { roomId: id, start: "2026-10-20T07:00:00.000Z", end: "2026-10-20T08:00:00.000Z", teamName: "Ops" }, allow: roles },
  { method: "POST", path: `/bookings/${id}/cancel`, allow: roles },
  { method: "GET", path: "/notifications", allow: roles },
  { method: "GET", path: "/notifications/unread-count", allow: roles },
  { method: "POST", path: "/notifications/read-all", allow: roles },
  { method: "POST", path: `/notifications/${id}/read`, allow: roles },
  { method: "GET", path: "/dashboard/user", allow: ["USER"] },
  { method: "GET", path: "/dashboard/staff", allow: ["AGENT", "TEAM_LEAD"] },
  { method: "GET", path: "/dashboard/admin", allow: ["ADMIN"] },
  { method: "GET", path: "/admin/ping", allow: ["ADMIN"] },
];

async function listen(app: express.Express): Promise<{ base: string; close: () => Promise<void> }> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

test("each role is allowed or forbidden on each route", async () => {
  setEnvForTests(validEnvWithLegacyJwt());
  setRoleProfileLoaderForTests(async (claims) => ({ role: String(claims.user_role ?? "USER"), active: true }));
  const app = express();
  app.use(express.json());
  app.use("/tickets", createTicketRouter(query));
  app.use("/rooms", createRoomRouter(query));
  app.use("/bookings", createBookingRouter(query));
  app.use("/notifications", createNotificationRouter(query));
  app.use("/dashboard", createDashboardRouter(query));
  app.use("/admin", createAdminRouter());
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err instanceof HttpError ? err.status : 500;
    const code = err instanceof HttpError ? err.apiCode : "internal";
    res.status(status).json({ ok: false, message: err instanceof Error ? err.message : "failed", code, ...(err instanceof HttpError ? err.details : {}) });
  });
  const server = await listen(app);
  try {
    for (const entry of matrix) {
      const anon = await fetch(server.base + entry.path, { method: entry.method });
      assert.equal(anon.status, 401, `anon ${entry.method} ${entry.path}`);
      assert.equal((await anon.json()).code, "token_invalid");
      for (const role of roles) {
        calls.length = 0;
        const response = await fetch(server.base + entry.path, {
          method: entry.method,
          headers: { Authorization: `Bearer ${sign(role)}`, "Content-Type": "application/json" },
          body: entry.body ? JSON.stringify(entry.body) : undefined,
        });
        const allowed = entry.allow.includes(role);
        assert.equal(response.status < 300, allowed, `${role} ${entry.method} ${entry.path} -> ${response.status}`);
        if (!allowed) {
          assert.equal(response.status, 403);
          assert.equal((await response.json()).code, "forbidden");
          assert.equal(calls.length, 0);
        }
      }
    }

    const bad = await fetch(`${server.base}/tickets?status=NOPE`, {
      headers: { Authorization: `Bearer ${sign("USER")}` },
    });
    assert.equal(bad.status, 422);
    assert.equal((await bad.json()).code, "validation");

    const expired = await fetch(`${server.base}/tickets`, {
      headers: { Authorization: `Bearer ${sign("USER", -10)}` },
    });
    assert.equal(expired.status, 401);
    assert.equal((await expired.json()).code, "token_expired");
  } finally {
    setRoleProfileLoaderForTests(undefined);
    setEnvForTests(undefined);
    await server.close();
  }
});
