import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { setEnvForTests } from "../config/env.js";
import { authRequired, type AccessClaims } from "../middleware/auth.js";
import { resolveRole, setRoleProfileLoaderForTests, type RoleProfile } from "../middleware/role.js";
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

function sign(sub: string, userRole?: string): string {
  const payload: Record<string, unknown> = { sub, role: "authenticated" };
  if (userRole) payload.user_role = userRole;
  return jwt.sign(payload, "test-jwt-secret", {
    expiresIn: "5m",
    algorithm: "HS256",
    issuer: testJwtIssuer,
    audience: testJwtAudience,
  });
}

function whoami(): express.Express {
  const app = express();
  app.get("/who", authRequired(), async (req, res, next) => {
    try {
      const role = await resolveRole(req.claims as AccessClaims, req);
      res.json({ ok: true, role });
    } catch (error) {
      next(error);
    }
  });
  return app;
}

describe("role resolution", { concurrency: false }, () => {
  test("uses the verified user_role claim", async () => {
    setEnvForTests(validEnvWithLegacyJwt());
    let loads = 0;
    setRoleProfileLoaderForTests(async () => {
      loads += 1;
      return { role: "USER", active: true };
    });
    const server = await listen(whoami());
    try {
      const response = await fetch(`${server.base}/who`, {
        headers: { Authorization: `Bearer ${sign("admin-1", "ADMIN")}` },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, role: "ADMIN" });
      assert.equal(loads, 1);
    } finally {
      setRoleProfileLoaderForTests(undefined);
      setEnvForTests(undefined);
      await server.close();
    }
  });

  test("falls back to profiles.role when the claim is absent", async () => {
    setEnvForTests(validEnvWithLegacyJwt());
    setRoleProfileLoaderForTests(async () => ({ role: "AGENT", active: true }));
    const server = await listen(whoami());
    try {
      const response = await fetch(`${server.base}/who`, {
        headers: { Authorization: `Bearer ${sign("agent-1")}` },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, role: "AGENT" });
    } finally {
      setRoleProfileLoaderForTests(undefined);
      setEnvForTests(undefined);
      await server.close();
    }
  });

  test("a hook claim wins over a stale profile role", async () => {
    setEnvForTests(validEnvWithLegacyJwt());
    setRoleProfileLoaderForTests(async () => ({ role: "USER", active: true }));
    const server = await listen(whoami());
    try {
      const response = await fetch(`${server.base}/who`, {
        headers: { Authorization: `Bearer ${sign("lead-1", "TEAM_LEAD")}` },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, role: "TEAM_LEAD" });
    } finally {
      setRoleProfileLoaderForTests(undefined);
      setEnvForTests(undefined);
      await server.close();
    }
  });

  test("an inactive profile is forbidden", async () => {
    setEnvForTests(validEnvWithLegacyJwt());
    const profile: RoleProfile = { role: "ADMIN", active: false };
    setRoleProfileLoaderForTests(async () => profile);
    const server = await listen(whoami());
    try {
      const response = await fetch(`${server.base}/who`, {
        headers: { Authorization: `Bearer ${sign("admin-1", "ADMIN")}` },
      });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { ok: false, message: "forbidden", code: "forbidden" });
    } finally {
      setRoleProfileLoaderForTests(undefined);
      setEnvForTests(undefined);
      await server.close();
    }
  });

  test("an unknown profile is forbidden", async () => {
    setEnvForTests(validEnvWithLegacyJwt());
    setRoleProfileLoaderForTests(async () => null);
    const server = await listen(whoami());
    try {
      const response = await fetch(`${server.base}/who`, {
        headers: { Authorization: `Bearer ${sign("missing-1", "USER")}` },
      });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { ok: false, message: "forbidden", code: "forbidden" });
    } finally {
      setRoleProfileLoaderForTests(undefined);
      setEnvForTests(undefined);
      await server.close();
    }
  });
});
