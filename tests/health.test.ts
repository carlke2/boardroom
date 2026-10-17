import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { createHealthRouter } from "../routes/health.js";
import { createRequestLogger, createLogger, attachRequestId } from "../utils/logger.js";
import { requestMeta } from "../middleware/requestMeta.js";

async function listen(app: express.Express): Promise<{ base: string; close: () => Promise<void> }> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function appWith(
  database: () => Promise<{ ok: true } | { ok: false; reason: string }>,
  auth: () => Promise<{ ok: true } | { ok: false; reason: string }>
): express.Express {
  const app = express();
  app.use(createRequestLogger(createLogger("test")));
  app.use(attachRequestId());
  app.use(requestMeta);
  app.use(createHealthRouter(database, auth, "1.0.0-test"));
  return app;
}

test("GET /health shape includes ok database auth time version requestId", async () => {
  const app = appWith(
    async () => ({ ok: true }),
    async () => ({ ok: true })
  );
  const server = await listen(app);
  try {
    const response = await fetch(`${server.base}/health`);
    assert.equal(response.status, 200);
    const headerId = response.headers.get("x-request-id");
    assert.ok(headerId);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.ok, true);
    assert.equal(body.database, "up");
    assert.equal(body.auth, "up");
    assert.equal(body.version, "1.0.0-test");
    assert.equal(typeof body.time, "string");
    assert.equal(body.requestId, headerId);
    assert.equal("message" in body && String(body.message).includes("eyJ"), false);
  } finally {
    await server.close();
  }
});

test("GET /ready returns 503 when database or auth fails", async () => {
  const downDb = appWith(
    async () => ({ ok: false, reason: "Database query failed" }),
    async () => ({ ok: true })
  );
  const downAuth = appWith(
    async () => ({ ok: true }),
    async () => ({ ok: false, reason: "Supabase Auth unreachable" })
  );
  const dbServer = await listen(downDb);
  const authServer = await listen(downAuth);
  try {
    const dbRes = await fetch(`${dbServer.base}/ready`);
    assert.equal(dbRes.status, 503);
    const dbBody = (await dbRes.json()) as Record<string, unknown>;
    assert.equal(dbBody.ok, false);
    assert.equal(dbBody.database, "down");
    assert.equal(dbBody.auth, "up");
    assert.ok(dbRes.headers.get("x-request-id"));
    assert.equal(dbBody.requestId, dbRes.headers.get("x-request-id"));

    const authRes = await fetch(`${authServer.base}/ready`);
    assert.equal(authRes.status, 503);
    const authBody = (await authRes.json()) as Record<string, unknown>;
    assert.equal(authBody.auth, "down");
    assert.equal(authBody.database, "up");
  } finally {
    await dbServer.close();
    await authServer.close();
  }
});

test("request id propagates from incoming X-Request-Id", async () => {
  const app = appWith(
    async () => ({ ok: true }),
    async () => ({ ok: true })
  );
  const server = await listen(app);
  try {
    const response = await fetch(`${server.base}/health`, {
      headers: { "X-Request-Id": "client-fixed-id-001" },
    });
    assert.equal(response.headers.get("x-request-id"), "client-fixed-id-001");
    const body = (await response.json()) as { requestId: string };
    assert.equal(body.requestId, "client-fixed-id-001");
  } finally {
    await server.close();
  }
});
