import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { setEnvForTests } from "../config/env.js";
import { setRoleProfileLoaderForTests } from "../middleware/role.js";
import { createAuthRouter, type AuthProvider } from "../routes/auth.routes.js";
import { AuthProviderError } from "../services/auth/errors.js";
import { loginWithPassword } from "../services/auth/supabaseAuth.js";
import { testJwtAudience, testJwtIssuer, validEnv, validEnvWithLegacyJwt } from "./fixture.js";

const samplePass = "x".repeat(12);

async function listen(app: express.Express): Promise<{ base: string; close: () => Promise<void> }> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function provider(overrides: Partial<AuthProvider> = {}): AuthProvider {
  return {
    async login() {
      return {
        accessToken: "access",
        refreshToken: "refresh",
        expiresIn: 3600,
        tokenType: "bearer",
        user: { id: "user-1", email: "a@b.c" },
      };
    },
    async forgotPassword() {},
    async resetPassword() {},
    async refresh() {
      return {
        accessToken: "next",
        refreshToken: "next-refresh",
        expiresIn: 3600,
        tokenType: "bearer",
        user: { id: "user-1", email: "a@b.c" },
      };
    },
    async logout() {},
    async me() {
      return { id: "user-1", email: "a@b.c", name: "Ada", phone: null, role: "USER", roles: ["USER"], active: true };
    },
    ...overrides,
  };
}

test("login errors keep the ok response shape and register is disabled", async () => {
  const app = express();
  app.use(express.json());
  app.use(
    "/auth",
    createAuthRouter(
      provider({
        async login() {
          throw new AuthProviderError(401, "Invalid email or password");
        },
      })
    )
  );
  const server = await listen(app);
  try {
    const bad = await fetch(`${server.base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c", password: samplePass }),
    });
    assert.equal(bad.status, 401);
    assert.deepEqual(await bad.json(), { ok: false, message: "Invalid email or password" });

    const register = await fetch(`${server.base}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c", password: samplePass }),
    });
    assert.equal(register.status, 403);
    assert.deepEqual(await register.json(), { ok: false, message: "Public signup is disabled", code: "signup_disabled" });
  } finally {
    await server.close();
  }
});

test("login returns tokens and me requires a verified bearer", async () => {
  setEnvForTests(validEnvWithLegacyJwt());
  setRoleProfileLoaderForTests(async () => ({ role: "USER", active: true }));
  const token = jwt.sign(
    { sub: "user-1", email: "a@b.c", user_role: "USER", role: "authenticated" },
    "test-jwt-secret",
    {
      expiresIn: "5m",
      algorithm: "HS256",
      issuer: testJwtIssuer,
      audience: testJwtAudience,
    }
  );
  const app = express();
  app.use(express.json());
  app.use(
    "/auth",
    createAuthRouter(
      provider({
        async login() {
          return {
            accessToken: token,
            refreshToken: "refresh",
            expiresIn: 3600,
            tokenType: "bearer",
            user: { id: "user-1", email: "a@b.c" },
          };
        },
      })
    )
  );
  const server = await listen(app);
  try {
    const login = await fetch(`${server.base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c", password: samplePass }),
    });
    const body = await login.json();
    assert.equal(body.ok, true);
    assert.equal(body.accessToken, token);
    assert.equal(body.refreshToken, "refresh");
    assert.equal(body.user.name, "Ada");
    assert.equal(body.user.role, "USER");

    const missing = await fetch(`${server.base}/auth/me`);
    assert.equal(missing.status, 401);
    assert.deepEqual(await missing.json(), { ok: false, message: "Missing token", code: "token_invalid" });

    const me = await fetch(`${server.base}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    const meBody = await me.json();
    assert.equal(me.status, 200);
    assert.equal(meBody.ok, true);
    assert.equal(meBody.user.id, "user-1");
  } finally {
    setRoleProfileLoaderForTests(undefined);
    setEnvForTests(undefined);
    await server.close();
  }
});

test("password login calls Supabase Auth and does not send the service key", async () => {
  setEnvForTests(validEnv());
  const calls: { url: string; apikey: string; authorization: string; body: string }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(url),
      apikey: headers.get("apikey") ?? "",
      authorization: headers.get("authorization") ?? "",
      body: String(init?.body ?? ""),
    });
    return new Response(
      JSON.stringify({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
        token_type: "bearer",
        user: { id: "user-1", email: "a@b.c" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;
  try {
    const tokens = await loginWithPassword("a@b.c", samplePass);
    assert.equal(tokens.accessToken, "access");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/auth\/v1\/token\?grant_type=password$/);
    assert.equal(calls[0].apikey, "test-anon-key");
    assert.equal(calls[0].authorization, "Bearer test-anon-key");
    assert.equal(calls[0].authorization.includes("test-service-key"), false);
    assert.deepEqual(JSON.parse(calls[0].body), { email: "a@b.c", password: samplePass });
  } finally {
    globalThis.fetch = original;
    setEnvForTests(undefined);
  }
});
