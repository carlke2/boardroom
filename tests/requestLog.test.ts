import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import test from "node:test";
import express from "express";
import pino from "pino";
import { createRequestLogger, requestPath } from "../utils/logger.js";
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

test("requestPath strips query strings that may hold secrets", () => {
  assert.equal(requestPath("/auth/reset?accessToken=secret"), "/auth/reset");
  assert.equal(requestPath("/health"), "/health");
});

test("request log line never includes token, authorization, or body", async () => {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  const logger = pino({ level: "info" }, stream);
  const app = express();
  app.use(createRequestLogger(logger));
  app.use(express.json());
  app.use(requestMeta);
  app.post("/probe", (req, res) => {
    res.setHeader("X-Request-Id", String((req as { id?: string }).id || ""));
    res.status(200).json({ ok: true, requestId: (req as { id?: string }).id });
  });
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ ok: false, requestId: req.requestId || req.id || "" });
  });

  const server = await listen(app);
  try {
    const secret = "super-secret-token-value-xyz";
    const bodySecret = "password-should-not-log";
    const response = await fetch(`${server.base}/probe?token=${secret}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: bodySecret, token: secret }),
    });
    assert.equal(response.status, 200);
    const requestId = response.headers.get("x-request-id");
    assert.ok(requestId);
    // Wait for async log flush
    await new Promise((r) => setTimeout(r, 50));
    const joined = chunks.join("");
    assert.ok(joined.includes("POST"));
    assert.ok(joined.includes("/probe"));
    assert.equal(joined.includes(secret), false);
    assert.equal(joined.includes(bodySecret), false);
    assert.equal(joined.includes("Authorization"), false);
    assert.equal(joined.includes("Bearer"), false);
    assert.equal(joined.includes("password"), false);
  } finally {
    await server.close();
  }
});
