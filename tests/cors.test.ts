import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import cors from "cors";

async function listen(app: express.Express): Promise<{ base: string; close: () => Promise<void> }> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

test("CORS allows requests with no Origin header (native clients)", async () => {
  const app = express();
  const origins = ["http://localhost:5173"];
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || origins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
    })
  );
  app.get("/ping", (_req, res) => res.json({ ok: true }));
  const server = await listen(app);
  try {
    const response = await fetch(`${server.base}/ping`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    await server.close();
  }
});
