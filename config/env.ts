import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

/** Backend root from this file, not the process working directory. */
export const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const repoRoot = path.resolve(backendRoot, "..");
export const envFilePath = path.join(backendRoot, ".env");
export const envExamplePath = path.join(backendRoot, ".env.example");

const envFileName = /^\.env(\..+)?$/;
const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const text = z.string().trim().min(1);
const optionalText = z.string().trim();
const optionalEmail = z.union([z.literal(""), z.string().trim().email()]);
const optionalBlank = optionalText.optional().default("");
const optionalBlankEmail = optionalEmail.optional().default("");

/** Dev seed only. Absent or blank is valid at startup; the seed scripts require values. */
export const DEV_TEST_ENV_KEYS = [
  "DEV_TEST_USER_EMAIL",
  "DEV_TEST_USER_PASSWORD",
  "DEV_TEST_AGENT_EMAIL",
  "DEV_TEST_AGENT_PASSWORD",
  "DEV_TEST_LEAD_EMAIL",
  "DEV_TEST_LEAD_PASSWORD",
  "DEV_TEST_ADMIN_EMAIL",
  "DEV_TEST_ADMIN_PASSWORD",
] as const;
const optionalUrl = z.union([z.literal(""), z.string().trim().url()]);
const int = z.coerce.number().int();
const flag = z.enum(["true", "false"]).transform((value) => value === "true");

export const envObjectSchema = z
  .object({
    PORT: int.positive().max(65535),
    NODE_ENV: z.enum(["development", "test", "production"]),
    DATABASE_URL: text.refine(isPostgresUrl, "DATABASE_URL must be a postgres URL"),
    PG_POOL_MAX: int.positive().max(50),
    PG_IDLE_TIMEOUT_MS: int.positive(),
    PG_CONNECTION_TIMEOUT_MS: int.positive(),
    PG_STATEMENT_TIMEOUT_MS: int.positive(),
    PG_SSL: z.enum(["require", "disable"]),
    PG_SSL_REJECT_UNAUTHORIZED: flag,
    SUPABASE_URL: text.url(),
    SUPABASE_ANON_KEY: text,
    SUPABASE_SERVICE_ROLE_KEY: text,
    // Optional legacy HS256 secret. Access tokens are verified via JWKS by default.
    SUPABASE_JWT_SECRET: optionalText,
    CORS_ORIGINS: text,
    // Push/Slack may stay empty; those features stay off until filled.
    FCM_PROJECT_ID: optionalText,
    FCM_CLIENT_EMAIL: optionalEmail,
    FCM_PRIVATE_KEY: optionalText,
    SLACK_WEBHOOK_URL: optionalUrl,
    TIMEZONE: text,
    BUFFER_MINUTES: int.nonnegative(),
    WORK_START: text.regex(clock),
    WORK_END: text.regex(clock),
    SLOT_MINUTES: int.positive(),
    COMPANY_DOMAIN: optionalText,
    CRON_TZ: text,
    REMINDER_CRON_SCHEDULE: text,
    TICKET_CRON_SCHEDULE: text,
    JOIN_NOW_SMS: flag,
    ENDING_10_EMAIL: flag,
    SLA_AT_RISK_MINUTES: int.positive(),
    TICKET_REOPEN_DAYS: int.positive(),
    APP_NAME: text,
    SMTP_HOST: text,
    SMTP_PORT: int.positive().max(65535),
    RESET_TOKEN_MINUTES: int.positive(),
    APP_URL: text.url(),
    RESET_DEV_LINK: flag,
    MIN_PASSWORD_LENGTH: int.positive().max(128),
    SEED_ADMIN_EMAIL: text.email(),
    // Empty is allowed at API startup; npm run seed:admin requires a real value.
    SEED_ADMIN_PASSWORD: optionalText,
    SEED_ADMIN_NAME: text,
    SEED_ADMIN_PHONE: optionalText,
    ALLOW_PROD_SEED: flag,
    DEV_TEST_USER_EMAIL: optionalBlankEmail,
    DEV_TEST_USER_PASSWORD: optionalBlank,
    DEV_TEST_AGENT_EMAIL: optionalBlankEmail,
    DEV_TEST_AGENT_PASSWORD: optionalBlank,
    DEV_TEST_LEAD_EMAIL: optionalBlankEmail,
    DEV_TEST_LEAD_PASSWORD: optionalBlank,
    DEV_TEST_ADMIN_EMAIL: optionalBlankEmail,
    DEV_TEST_ADMIN_PASSWORD: optionalBlank,
  })
  .strict();

export const envSchema = envObjectSchema.superRefine((value, ctx) => {
  if (
    value.SEED_ADMIN_PASSWORD.length > 0 &&
    value.SEED_ADMIN_PASSWORD.length < value.MIN_PASSWORD_LENGTH
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SEED_ADMIN_PASSWORD"],
      message: `must be at least MIN_PASSWORD_LENGTH characters`,
    });
  }
});

export type Env = z.infer<typeof envObjectSchema>;

let cached: Env | undefined;

function isPostgresUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "postgresql:" || protocol === "postgres:";
  } catch {
    return false;
  }
}

export function invalidEnvNames(error: z.ZodError): string[] {
  const names = new Set<string>();
  for (const issue of error.issues) {
    const name = issue.path[0];
    if (typeof name === "string") names.add(name);
  }
  return [...names].sort();
}

/** Validates a name/value map taken from backend/.env. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment. Missing or invalid: ${invalidEnvNames(parsed.error).join(", ")}`);
  }
  return parsed.data;
}

export function readEnvKeys(filePath: string): string[] {
  if (!fs.existsSync(filePath)) throw new Error(`Missing ${filePath}`);
  return Object.keys(dotenv.parse(fs.readFileSync(filePath))).sort();
}

export function unexpectedEnvFiles(backendDir = backendRoot, rootDir = repoRoot): string[] {
  const found: string[] = [];
  for (const name of fs.readdirSync(backendDir)) {
    if (!envFileName.test(name)) continue;
    if (name !== ".env" && name !== ".env.example") found.push(path.join(backendDir, name));
  }
  for (const name of fs.readdirSync(rootDir)) {
    if (!envFileName.test(name)) continue;
    if (name !== ".env.example") found.push(path.join(rootDir, name));
  }
  return found;
}

export function diffEnvKeys(exampleFile = envExamplePath, envFile = envFilePath): { missing: string[]; extra: string[] } {
  const example = new Set(readEnvKeys(exampleFile));
  const actual = new Set(readEnvKeys(envFile));
  return {
    missing: [...example].filter((key) => !actual.has(key)).sort(),
    extra: [...actual].filter((key) => !example.has(key)).sort(),
  };
}

/** Key diff plus a ban on any env file other than backend/.env, backend/.env.example, and the root template. */
export function runEnvCheck(): void {
  const unexpected = unexpectedEnvFiles();
  if (unexpected.length) {
    throw new Error(`Unexpected env files: ${unexpected.join(", ")}`);
  }
  const diff = diffEnvKeys();
  const optional = new Set<string>(DEV_TEST_ENV_KEYS);
  const missing = diff.missing.filter((key) => !optional.has(key));
  if (missing.length || diff.extra.length) {
    throw new Error(
      `Env keys differ. Missing: ${missing.join(", ") || "(none)"}. Extra: ${diff.extra.join(", ") || "(none)"}`
    );
  }
  const exampleKeys = readEnvKeys(envExamplePath);
  const schemaKeys = Object.keys(envObjectSchema.shape).sort();
  const missingFromExample = schemaKeys.filter((key) => !exampleKeys.includes(key));
  const extraInExample = exampleKeys.filter((key) => !schemaKeys.includes(key));
  if (missingFromExample.length || extraInExample.length) {
    throw new Error(
      `Env example does not match the config schema. Missing: ${missingFromExample.join(", ") || "(none)"}. Extra: ${extraInExample.join(", ") || "(none)"}`
    );
  }
}

function loadBackendEnv(): Env {
  if (!fs.existsSync(envFilePath)) {
    throw new Error(`Missing ${envFilePath}. The API reads backend/.env only.`);
  }
  return parseEnv(dotenv.parse(fs.readFileSync(envFilePath)));
}

/** Loads and validates backend/.env. This module is the only env reader. */
export function getEnv(): Env {
  if (!cached) cached = loadBackendEnv();
  return cached;
}

/** Test hook. Production startup uses getEnv(), which reads backend/.env. */
export function setEnvForTests(value: Env | undefined): void {
  cached = value;
}
