import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  diffEnvKeys,
  envExamplePath,
  envObjectSchema,
  DEV_TEST_ENV_KEYS,
  parseEnv,
  readEnvKeys,
  runEnvCheck,
  unexpectedEnvFiles,
} from "../config/env.js";
import { validEnvInput } from "./fixture.js";

test("parseEnv lists every missing name and no values", () => {
  assert.throws(
    () => parseEnv({}),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^Invalid environment\. Missing or invalid: /);
      const names = error.message.slice("Invalid environment. Missing or invalid: ".length).split(", ");
      const required = Object.keys(envObjectSchema.shape)
        .filter((key) => !DEV_TEST_ENV_KEYS.includes(key as (typeof DEV_TEST_ENV_KEYS)[number]))
        .sort();
      assert.deepEqual(names, required);
      assert.equal(error.message.includes("postgresql"), false);
      return true;
    }
  );
});

test("parseEnv accepts the fixture and rejects a bad database url by name", () => {
  const env = parseEnv(validEnvInput);
  assert.equal(env.PORT, 5000);
  assert.equal(env.PG_SSL, "disable");
  assert.equal(env.JOIN_NOW_SMS, false);
  assert.throws(() => parseEnv({ ...validEnvInput, DATABASE_URL: "https://example.com" }), /DATABASE_URL/);
});

test("optional integrations and empty seed password do not block startup", () => {
  const env = parseEnv({
    ...validEnvInput,
    FCM_PROJECT_ID: "",
    FCM_CLIENT_EMAIL: "",
    FCM_PRIVATE_KEY: "",
    SLACK_WEBHOOK_URL: "",
    SEED_ADMIN_PASSWORD: "",
  });
  assert.equal(env.FCM_PROJECT_ID, "");
  assert.equal(env.SEED_ADMIN_PASSWORD, "");
  assert.equal(env.DEV_TEST_USER_EMAIL, "");
  assert.equal(env.DEV_TEST_ADMIN_PASSWORD, "");
  assert.throws(
    () => parseEnv({ ...validEnvInput, SEED_ADMIN_PASSWORD: "short" }),
    /SEED_ADMIN_PASSWORD/
  );
});

test("env file check fails on extra env files and key drift", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bms-env-"));
  const backend = path.join(root, "backend");
  fs.mkdirSync(backend);
  fs.writeFileSync(path.join(root, ".env.example"), "PORT=\n");
  fs.writeFileSync(path.join(backend, ".env"), "PORT=1\n");
  fs.writeFileSync(path.join(backend, ".env.example"), "PORT=\nNODE_ENV=\n");
  assert.deepEqual(unexpectedEnvFiles(backend, root), []);
  fs.writeFileSync(path.join(backend, ".env.local"), "PORT=1\n");
  fs.writeFileSync(path.join(root, ".env"), "PORT=1\n");
  const unexpected = unexpectedEnvFiles(backend, root).map((file) => path.basename(file)).sort();
  assert.deepEqual(unexpected, [".env", ".env.local"]);
  const diff = diffEnvKeys(path.join(backend, ".env.example"), path.join(backend, ".env"));
  assert.deepEqual(diff.missing, ["NODE_ENV"]);
  assert.deepEqual(diff.extra, []);
});

test("backend/.env matches backend/.env.example", () => {
  const example = readEnvKeys(envExamplePath);
  assert.deepEqual(example, Object.keys(envObjectSchema.shape).sort());
  assert.doesNotThrow(() => runEnvCheck());
});
