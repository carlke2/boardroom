import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult } from "pg";
import { withService, withServiceOnClient, withUserOnClient, type Queryable } from "../db/postgres.js";

function recordingClient(): Queryable & { calls: { sql: string; params?: unknown[] }[] } {
  const calls: { sql: string; params?: unknown[] }[] = [];
  return {
    calls,
    query: (async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      return { command: "SELECT", rowCount: 1, oid: 0, fields: [], rows: [{ counts: { openTickets: 1 } }] } as QueryResult;
    }) as Queryable["query"],
  };
}

test("withUser sets the authenticated role and jwt claims inside a transaction", async () => {
  const client = recordingClient();
  const value = await withUserOnClient(client, { sub: "user-1", email: "a@b.c", user_role: "USER" }, async () => "ok");
  assert.equal(value, "ok");
  assert.deepEqual(
    client.calls.map((call) => call.sql),
    ["BEGIN", "SET LOCAL ROLE authenticated", "SELECT set_config('request.jwt.claims', $1, true)", "COMMIT"]
  );
  const claims = JSON.parse(String(client.calls[2]?.params?.[0]));
  assert.equal(claims.sub, "user-1");
  assert.equal(claims.role, "authenticated");
  assert.equal(claims.user_role, "USER");
});

test("withUser rolls back when the callback fails", async () => {
  const client = recordingClient();
  await assert.rejects(
    () => withUserOnClient(client, { sub: "user-1" }, async () => Promise.reject(new Error("boom"))),
    /boom/
  );
  assert.equal(client.calls.at(-1)?.sql, "ROLLBACK");
});

test("withService refuses callers that are not system jobs", async () => {
  const client = recordingClient();
  await assert.rejects(
    () => withServiceOnClient(client, { systemJob: false } as never, async () => "no"),
    /system job role check/
  );
  assert.equal(client.calls.length, 0);
  await assert.rejects(() => withService({ systemJob: false } as never, async () => "no"), /system job role check/);
});

test("withService uses the service role only after the role check", async () => {
  const client = recordingClient();
  await withServiceOnClient(client, { systemJob: true }, async () => "job");
  assert.deepEqual(
    client.calls.map((call) => call.sql),
    ["BEGIN", "SET LOCAL ROLE service_role", "COMMIT"]
  );
});
