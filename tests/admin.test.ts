import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { setEnvForTests } from "../config/env.js";
import { setRoleProfileLoaderForTests } from "../middleware/role.js";
import { createAdminRouter } from "../routes/admin.routes.js";
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

function signRole(sub: string, role: string): string {
  return jwt.sign(
    { sub, user_role: role, user_roles: [role], role: "authenticated" },
    "test-jwt-secret",
    {
      expiresIn: "5m",
      algorithm: "HS256",
      issuer: testJwtIssuer,
      audience: testJwtAudience,
    }
  );
}

test("non-admin user cannot reach an admin-only route", async () => {
  setEnvForTests(validEnvWithLegacyJwt());
  setRoleProfileLoaderForTests(async () => ({ role: "USER", active: true }));
  const app = express();
  app.use("/admin", createAdminRouter());
  const server = await listen(app);
  try {
    const denied = await fetch(`${server.base}/admin/ping`, {
      headers: { Authorization: `Bearer ${signRole("user-1", "USER")}` },
    });
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { ok: false, message: "forbidden", code: "forbidden" });

    const allowed = await fetch(`${server.base}/admin/ping`, {
      headers: { Authorization: `Bearer ${signRole("admin-1", "ADMIN")}` },
    });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { ok: true, role: "ADMIN" });
  } finally {
    setRoleProfileLoaderForTests(undefined);
    setEnvForTests(undefined);
    await server.close();
  }
});
