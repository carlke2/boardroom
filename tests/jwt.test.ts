import assert from "node:assert/strict";
import test from "node:test";
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  createLocalJWKSet,
  type JWK,
} from "jose";
import { setEnvForTests } from "../config/env.js";
import { setJwksForTests, verifyAccessToken } from "../middleware/auth.js";
import { validEnv, validEnvInput } from "./fixture.js";
import { parseEnv } from "../config/env.js";

const issuer = "https://example.supabase.co/auth/v1";

async function mintToken(options: {
  privateKey: CryptoKey;
  kid: string;
  expiresIn?: string | number;
  audience?: string;
}): Promise<string> {
  return new SignJWT({
    email: "a@b.c",
    role: "authenticated",
    user_role: "USER",
  })
    .setProtectedHeader({ alg: "ES256", kid: options.kid, typ: "JWT" })
    .setSubject("user-1")
    .setIssuer(issuer)
    .setAudience(options.audience ?? "authenticated")
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "5m")
    .sign(options.privateKey);
}

test("JWKS accepts a valid access token", async () => {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  jwk.alg = "ES256";
  jwk.use = "sig";
  setEnvForTests(validEnv());
  setJwksForTests(createLocalJWKSet({ keys: [jwk as JWK] }));
  try {
    const token = await mintToken({ privateKey, kid: "test-key" });
    const claims = await verifyAccessToken(token);
    assert.equal(claims.sub, "user-1");
    assert.equal(claims.role, "authenticated");
    assert.equal(claims.user_role, "USER");
  } finally {
    setJwksForTests(undefined);
    setEnvForTests(undefined);
  }
});

test("JWKS rejects an expired access token", async () => {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  jwk.alg = "ES256";
  setEnvForTests(validEnv());
  setJwksForTests(createLocalJWKSet({ keys: [jwk as JWK] }));
  try {
    const token = await mintToken({ privateKey, kid: "test-key", expiresIn: "-1s" });
    await assert.rejects(() => verifyAccessToken(token));
  } finally {
    setJwksForTests(undefined);
    setEnvForTests(undefined);
  }
});

test("JWKS rejects a token signed by a different key", async () => {
  const good = await generateKeyPair("ES256");
  const other = await generateKeyPair("ES256");
  const jwk = await exportJWK(good.publicKey);
  jwk.kid = "good-key";
  jwk.alg = "ES256";
  setEnvForTests(validEnv());
  setJwksForTests(createLocalJWKSet({ keys: [jwk as JWK] }));
  try {
    const token = await mintToken({ privateKey: other.privateKey, kid: "good-key" });
    await assert.rejects(() => verifyAccessToken(token));
  } finally {
    setJwksForTests(undefined);
    setEnvForTests(undefined);
  }
});

test("env accepts an empty SUPABASE_JWT_SECRET", () => {
  const env = parseEnv({ ...validEnvInput, SUPABASE_JWT_SECRET: "" });
  assert.equal(env.SUPABASE_JWT_SECRET, "");
});
