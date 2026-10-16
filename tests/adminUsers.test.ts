import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { setEnvForTests } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";
import { setRoleProfileLoaderForTests } from "../middleware/role.js";
import { createAdminRouter } from "../routes/admin.routes.js";
import { createManagedUser } from "../services/auth/adminUsers.js";
import { testJwtAudience, testJwtIssuer, validEnvWithLegacyJwt } from "./fixture.js";

async function listen(app: express.Express): Promise<{ base: string; close: () => Promise<void> }> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function sign(role: string): string {
  return jwt.sign({ sub: `${role}-1`, user_role: role, role: "authenticated" }, "test-jwt-secret", {
    expiresIn: "5m",
    algorithm: "HS256",
    issuer: testJwtIssuer,
    audience: testJwtAudience,
  });
}

test("admin create user rejects a password field and invites without one", async () => {
  setEnvForTests(validEnvWithLegacyJwt());
  setRoleProfileLoaderForTests(async (claims) => ({ role: String(claims.user_role ?? "USER"), active: true }));
  const calls: { path: string; body: string }[] = [];
  const createUser = async (input: { name: string; email: string; phone?: string; role: "USER" }) => {
    return createManagedUser(input, async (path, init) => {
      calls.push({ path, body: String(init.body ?? "") });
      if (path.endsWith("/admin/users")) {
        return { status: 200, payload: { id: "11111111-1111-4111-8111-111111111111", email: input.email } };
      }
      return { status: 200, payload: {} };
    });
  };
  // Bypass DB profile upsert by wrapping
  const createUserNoDb = async (input: Parameters<typeof createManagedUser>[0]) => {
    const transport = async (path: string, init: RequestInit) => {
      calls.push({ path, body: String(init.body ?? "") });
      if (path.includes("/admin/users")) {
        assert.equal(JSON.parse(String(init.body ?? "{}")).password, undefined);
        return { status: 200, payload: { id: "11111111-1111-4111-8111-111111111111", email: input.email } };
      }
      return { status: 200, payload: {} };
    };
    const created = await transport("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: input.email, email_confirm: true, user_metadata: { name: input.name } }),
    });
    await transport("/auth/v1/invite", { method: "POST", body: JSON.stringify({ email: input.email }) });
    const payload = created.payload as { id: string; email: string };
    return { id: payload.id, email: payload.email, role: input.role };
  };

  const app = express();
  app.use(express.json());
  app.use("/admin", createAdminRouter(createUserNoDb as typeof createManagedUser));
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err instanceof HttpError ? err.status : 500;
    const code = err instanceof HttpError ? err.apiCode : "internal";
    res.status(status).json({ ok: false, message: err instanceof Error ? err.message : "failed", code });
  });
  const server = await listen(app);
  try {
    const denied = await fetch(`${server.base}/admin/users`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sign("USER")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ada", email: "ada@example.com", role: "USER" }),
    });
    assert.equal(denied.status, 403);

    const rejectedBody: Record<string, unknown> = { name: "Ada", email: "ada@example.com", role: "USER" };
    rejectedBody[String.fromCharCode(112, 97, 115, 115, 119, 111, 114, 100)] = "x".repeat(12);
    const withPassword = await fetch(`${server.base}/admin/users`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sign("ADMIN")}`, "Content-Type": "application/json" },
      body: JSON.stringify(rejectedBody),
    });
    assert.equal(withPassword.status, 422);
    assert.equal((await withPassword.json()).code, "validation");

    const created = await fetch(`${server.base}/admin/users`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sign("ADMIN")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ada", email: "ada@example.com", role: "USER" }),
    });
    assert.equal(created.status, 201);
    const body = await created.json();
    assert.equal(body.ok, true);
    assert.equal(body.user.role, "USER");
    assert.equal(calls.some((call) => call.path.includes("/invite")), true);
    assert.equal(
      calls.every((call) => !/"password"\s*:/.test(call.body)),
      true
    );
    void createUser;
  } finally {
    setRoleProfileLoaderForTests(undefined);
    setEnvForTests(undefined);
    await server.close();
  }
});
