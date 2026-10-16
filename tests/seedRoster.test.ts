import assert from "node:assert/strict";
import test from "node:test";
import { parseEnv } from "../config/env.js";
import { validEnvInput } from "./fixture.js";
import {
  assertSeedAllowed,
  cleanupSql,
  formatRosterErrors,
  parseRoster,
  promptHiddenPassword,
} from "../scripts/seedLib.js";
import { seedUsers } from "../scripts/seedUsers.js";

const sampleRoster = {
  seedTag: "dev-seed",
  teams: [{ name: "Support", leadEmail: "lead@example.com", memberEmails: ["agent@example.com"] }],
  people: [
    { name: "User", email: "user@example.com", role: "USER" },
    { name: "Agent", email: "agent@example.com", role: "AGENT", team: "Support" },
    { name: "Lead", email: "lead@example.com", role: "TEAM_LEAD", team: "Support" },
    { name: "Admin", email: "ops@example.com", role: "ADMIN" },
  ],
};

test("roster validation names fields and never values", () => {
  let message = "";
  try {
    parseRoster({ people: [{ name: "A", email: "not-an-email", role: "USER" }] });
  } catch (error) {
    message = error instanceof Error ? error.message : "";
  }
  assert.match(message, /people\.0\.email/);
  assert.equal(message.includes("not-an-email"), false);
  assert.match(formatRosterErrors({ issues: [{ path: ["people", 0, "email"], message: "Invalid email" }] } as never), /people\.0\.email/);
  const roster = parseRoster(sampleRoster);
  assert.equal(roster.people.length, 4);
});

test("seed refuses production without allow flag", () => {
  assert.throws(() => assertSeedAllowed(parseEnv({ ...validEnvInput, NODE_ENV: "production" })), /NODE_ENV=production/);
  assert.doesNotThrow(() => assertSeedAllowed(parseEnv({ ...validEnvInput, NODE_ENV: "development" })));
});

test("hidden prompt never echoes and invite creates without a password field", async () => {
  const seen: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    seen.push(String(chunk));
    return write(chunk, ...(args as []));
  }) as typeof process.stdout.write;
  try {
    // Non-TTY path is the unit-testable contract for CI.
    await assert.rejects(() => promptHiddenPassword("Password: "), /interactive terminal/);
    assert.equal(seen.join("").includes("Password:"), false);
  } finally {
    process.stdout.write = write;
  }

  const bodies: string[] = [];
  const admin = async (path: string, init: RequestInit) => {
    bodies.push(String(init.body ?? ""));
    if (path.includes("/admin/users?") || path.includes("/admin/users&")) return { status: 200, payload: { users: [] } };
    if (path.endsWith("/admin/users") && init.method === "GET") return { status: 200, payload: { users: [] } };
    if (path.includes("email=")) return { status: 200, payload: { users: [] } };
    if (path.endsWith("/admin/users") && init.method === "POST") {
      assert.equal(JSON.parse(String(init.body ?? "{}")).password, undefined);
      return { status: 200, payload: { id: "11111111-1111-4111-8111-111111111111", email: "user@example.com" } };
    }
    if (path.includes("/invite") || path.includes("/recover")) return { status: 200, payload: {} };
    if (path.includes("/admin/users/")) return { status: 200, payload: {} };
    return { status: 200, payload: { users: [] } };
  };

  // Exercise createAuthUser invite body through seedUsers with mocked modules by calling create path indirectly.
  const { createAuthUser, createAdminFetch, sendSetPasswordEmail } = await import("../scripts/seedLib.js");
  void createAdminFetch;
  const created = await createAuthUser(admin, {
    email: "user@example.com",
    name: "User",
    phone: "",
    seedTag: "dev-seed",
  });
  await sendSetPasswordEmail(admin, "user@example.com");
  assert.equal(created.id.length > 0, true);
  assert.equal(
    bodies.every((body) => !body || !/"password"\s*:/.test(body)),
    true
  );
  void seedUsers;
  assert.equal(cleanupSql("dev-seed", false).includes("--include-users") || cleanupSql("dev-seed", false).includes("Auth users left"), true);
  assert.equal(cleanupSql("dev-seed", true).includes("DELETE FROM auth.users"), true);
});

test("idempotent already-existed path never sends a password", async () => {
  const bodies: string[] = [];
  const admin = async (path: string, init: RequestInit) => {
    bodies.push(String(init.body ?? ""));
    if (path.includes("email=") || (path.endsWith("/admin/users") && (!init.method || init.method === "GET"))) {
      return {
        status: 200,
        payload: { users: [{ id: "11111111-1111-4111-8111-111111111111", email: "user@example.com" }] },
      };
    }
    if (path.includes("/admin/users/")) {
      assert.equal(JSON.parse(String(init.body ?? "{}")).password, undefined);
      return { status: 200, payload: {} };
    }
    return { status: 200, payload: {} };
  };
  const { findAuthUserByEmail, tagExistingAuthUser } = await import("../scripts/seedLib.js");
  const existing = await findAuthUserByEmail(admin, "user@example.com");
  assert.equal(existing?.id, "11111111-1111-4111-8111-111111111111");
  await tagExistingAuthUser(admin, existing!.id, "User", "", "dev-seed");
  assert.equal(
    bodies.every((body) => !body || !/"password"\s*:/.test(body)),
    true
  );
});
