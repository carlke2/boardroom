import { parseEnv, type Env } from "../config/env.js";

export const validEnvInput: Record<string, string> = {
  PORT: "5000",
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/postgres",
  PG_POOL_MAX: "5",
  PG_IDLE_TIMEOUT_MS: "1000",
  PG_CONNECTION_TIMEOUT_MS: "1000",
  PG_STATEMENT_TIMEOUT_MS: "1000",
  PG_SSL: "disable",
  PG_SSL_REJECT_UNAUTHORIZED: "false",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  SUPABASE_JWT_SECRET: "",
  CORS_ORIGINS: "http://localhost:5173",
  FCM_PROJECT_ID: "test-project",
  FCM_CLIENT_EMAIL: "fcm@example.com",
  FCM_PRIVATE_KEY: "test-private-key",
  SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/X",
  TIMEZONE: "Africa/Nairobi",
  BUFFER_MINUTES: "5",
  WORK_START: "08:00",
  WORK_END: "18:00",
  SLOT_MINUTES: "30",
  COMPANY_DOMAIN: "",
  CRON_TZ: "Africa/Nairobi",
  REMINDER_CRON_SCHEDULE: "* * * * *",
  TICKET_CRON_SCHEDULE: "*/5 * * * *",
  JOIN_NOW_SMS: "false",
  ENDING_10_EMAIL: "false",
  SLA_AT_RISK_MINUTES: "30",
  TICKET_REOPEN_DAYS: "7",
  APP_NAME: "Boardroom Booking",
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
  RESET_TOKEN_MINUTES: "30",
  APP_URL: "http://localhost:5173",
  RESET_DEV_LINK: "false",
  MIN_PASSWORD_LENGTH: "8",
  SEED_ADMIN_EMAIL: "admin@example.com",
  SEED_ADMIN_PASSWORD: "",
  SEED_ADMIN_NAME: "System Admin",
  SEED_ADMIN_PHONE: "",
  ALLOW_PROD_SEED: "false",
};

export function validEnv(): Env {
  return parseEnv(validEnvInput);
}

/** Env with a legacy HS256 secret for unit tests that mint local tokens. */
export function validEnvWithLegacyJwt(secret = "test-jwt-secret"): Env {
  return parseEnv({ ...validEnvInput, SUPABASE_JWT_SECRET: secret });
}

export const testJwtIssuer = "https://example.supabase.co/auth/v1";
export const testJwtAudience = "authenticated";
