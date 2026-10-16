import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { createHealthRouter } from "../routes/health.js";

async function listen(app: express.Express): Promise<{ base: string; close: () => Promise<void> }> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

test("health reports database up and down", async () => {
  const up = express();
  up.use(createHealthRouter(async () => {}));
  const upServer = await listen(up);
  const down = express();
  down.use(
    createHealthRouter(async () => {
      throw new Error("db");
    })
  );
  const downServer = await listen(down);
  try {
    const upResponse = await fetch(`${upServer.base}/health`);
    assert.equal(upResponse.status, 200);
    assert.deepEqual(await upResponse.json(), { ok: true, database: "up" });
    const downResponse = await fetch(`${downServer.base}/health`);
    assert.equal(downResponse.status, 503);
    assert.deepEqual(await downResponse.json(), { ok: false, database: "down" });
  } finally {
    await upServer.close();
    await downServer.close();
  }
});
