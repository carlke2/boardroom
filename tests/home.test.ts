import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { setEnvForTests } from "../config/env.js";
import { setRoleProfileLoaderForTests } from "../middleware/role.js";
import { createHomeRouter } from "../routes/home.routes.js";
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

test("home counts returns the signed-in user's numbers", async () => {
  setEnvForTests(validEnvWithLegacyJwt());
  setRoleProfileLoaderForTests(async () => ({ role: "USER", active: true }));
  const app = express();
  app.use(
    "/home",
    createHomeRouter(async () => ({ openTickets: 2, unreadNotifications: 3, upcomingBookings: 4 }))
  );
  const server = await listen(app);
  try {
    const token = jwt.sign(
      { sub: "user-1", user_role: "USER", role: "authenticated" },
      "test-jwt-secret",
      {
        expiresIn: "5m",
        algorithm: "HS256",
        issuer: testJwtIssuer,
        audience: testJwtAudience,
      }
    );
    const response = await fetch(`${server.base}/home/counts`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, openTickets: 2, unreadNotifications: 3, upcomingBookings: 4 });
  } finally {
    setRoleProfileLoaderForTests(undefined);
    setEnvForTests(undefined);
    await server.close();
  }
});

test("request handlers do not call withService", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../routes");
  for (const name of fs.readdirSync(root)) {
    if (!name.endsWith(".ts")) continue;
    const text = fs.readFileSync(path.join(root, name), "utf8");
    assert.equal(text.includes("withService"), false, name);
  }
});
