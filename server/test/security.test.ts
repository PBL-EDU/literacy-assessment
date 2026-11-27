import test from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  randomToken,
  sha256,
  signAccessToken,
  totpCode,
  verifyAccessToken,
  verifyPassword,
  verifyTotp,
} from "../src/security/tokens.js";
import { decryptSecret, encryptSecret } from "../src/security/secrets.js";

test("password hashes verify and reject wrong passwords", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  assert.equal(await verifyPassword("wrong", hash), false);
});

test("access tokens are signed, expire, and reject tampering", () => {
  const secret = "a".repeat(32);
  const token = signAccessToken({ sub: "m1", dev: "d1", org: "o1", role: "teacher", exp: 0 }, secret, 60);
  assert.equal(verifyAccessToken(token, secret)?.sub, "m1");
  assert.equal(verifyAccessToken(token, "b".repeat(32)), null);
  assert.equal(verifyAccessToken(`${token}x`, secret), null);
  const expired = signAccessToken({ sub: "m1", dev: "d1", org: "o1", role: "teacher", exp: 0 }, secret, -1);
  assert.equal(verifyAccessToken(expired, secret), null);
});

test("TOTP matches the RFC 6238 SHA-1 vector", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(totpCode(secret, 59_000), "287082");
  assert.equal(verifyTotp(secret, "287082", 59_000), true);
  assert.equal(verifyTotp(secret, "000000", 59_000), false);
});

test("organization API keys can be encrypted at rest", () => {
  const master = "m".repeat(32);
  const encrypted = encryptSecret("sk-test-secret", master);
  assert.notEqual(encrypted, "sk-test-secret");
  assert.equal(decryptSecret(encrypted, master), "sk-test-secret");
  assert.throws(() => decryptSecret(encrypted, "n".repeat(32)));
});

test("random tokens and hashes are stable", () => {
  const token = randomToken(16);
  assert.ok(token.length >= 20);
  assert.equal(sha256("abc"), sha256("abc"));
  assert.notEqual(sha256("abc"), sha256("abd"));
});
