import assert from "node:assert/strict";
import test from "node:test";
import { parseEnv } from "../config/env.js";
import { validEnvInput } from "./fixture.js";
import {
  DEV_CLEANUP_SQL,
  EXTRA_REQUESTER_EMAIL,
  SEED_TAG,
  assertDevSeedAllowed,
  devAccounts,
} from "../scripts/devSeed.js";

function envWith(overrides: Record<string, string> = {}) {
  return parseEnv({ ...validEnvInput, ...overrides });
}

const filled = {
  DEV_TEST_USER_EMAIL: "user@dev.seed.invalid",
  DEV_TEST_USER_PASSWORD: "test-password",
  DEV_TEST_AGENT_EMAIL: "agent@dev.seed.invalid",
  DEV_TEST_AGENT_PASSWORD: "test-password",
  DEV_TEST_LEAD_EMAIL: "lead@dev.seed.invalid",
  DEV_TEST_LEAD_PASSWORD: "test-password",
  DEV_TEST_ADMIN_EMAIL: "dev-admin@dev.seed.invalid",
  DEV_TEST_ADMIN_PASSWORD: "test-password",
};

test("dev seed names every empty variable and allows a blank config", () => {
  assert.equal(envWith().DEV_TEST_USER_EMAIL, "");
  assert.throws(() => devAccounts(envWith()), /DEV_TEST_USER_EMAIL/);
  const error = (() => {
    try {
      devAccounts(envWith());
      return "";
    } catch (caught) {
      return caught instanceof Error ? caught.message : "";
    }
  })();
  for (const name of [
    "DEV_TEST_USER_EMAIL",
    "DEV_TEST_USER_PASSWORD",
    "DEV_TEST_AGENT_EMAIL",
    "DEV_TEST_AGENT_PASSWORD",
    "DEV_TEST_LEAD_EMAIL",
    "DEV_TEST_LEAD_PASSWORD",
    "DEV_TEST_ADMIN_EMAIL",
    "DEV_TEST_ADMIN_PASSWORD",
  ]) {
    assert.equal(error.includes(name), true, name);
  }
  assert.equal(error.includes("test-password"), false);
});

test("dev seed refuses production and the real admin email", () => {
  assert.throws(() => assertDevSeedAllowed(envWith({ NODE_ENV: "production" })), /NODE_ENV=production/);
  assert.doesNotThrow(() => assertDevSeedAllowed(envWith({ NODE_ENV: "development" })));
  assert.throws(
    () => devAccounts(envWith({ ...filled, DEV_TEST_ADMIN_EMAIL: "admin@example.com" })),
    /DEV_TEST_ADMIN_EMAIL/
  );
  const accounts = devAccounts(envWith(filled));
  assert.deepEqual(
    accounts.map((account) => account.role),
    ["USER", "AGENT", "TEAM_LEAD", "ADMIN"]
  );
});

test("cleanup sql is tagged and will not run against an empty admin guard", () => {
  assert.equal(DEV_CLEANUP_SQL.includes(SEED_TAG), true);
  assert.equal(DEV_CLEANUP_SQL.includes(EXTRA_REQUESTER_EMAIL), false);
  assert.equal(DEV_CLEANUP_SQL.includes("app.seed_admin_email"), true);
  assert.equal(DEV_CLEANUP_SQL.includes("current_setting('app.seed_admin_email', true) <> ''"), true);
  assert.equal(DEV_CLEANUP_SQL.includes("IS DISTINCT FROM lower(current_setting('app.seed_admin_email', true))"), true);
});
