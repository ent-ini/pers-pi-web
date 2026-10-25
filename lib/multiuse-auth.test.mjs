import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { createMultiuseSessionToken, readMultiuseSessionToken, bpmTokenExpiresAt } = await createJiti(import.meta.url)
  .import("./multiuse-auth.ts");

const config = {
  bpmApiUrl: "https://bpm.buhgalterboutique.ru",
  sessionSecret: "a".repeat(32),
};
const identity = {
  id: "2b0b19f0-7a39-4e85-8c08-886cefc3dac1",
  email: "olga@example.com",
  fullName: "Ольга Бухгалтер",
  status: "active",
  role: "employee",
};

test("encrypts and restores a BPM access token", () => {
  const now = 1_700_000_000_000;
  const token = createMultiuseSessionToken("bpm-access-token", identity, config, now, Buffer.alloc(12, 7));
  assert.doesNotMatch(token, /bpm-access-token|olga@example/);
  assert.deepEqual(readMultiuseSessionToken(token, config, now), {
    accessToken: "bpm-access-token",
    identity,
    expiresAt: 1_700_604_800,
  });
});

test("refuses altered, expired, and differently-keyed sessions", () => {
  const now = 1_700_000_000_000;
  const token = createMultiuseSessionToken("bpm-access-token", identity, config, now, Buffer.alloc(12, 7));
  assert.equal(readMultiuseSessionToken(`${token}x`, config, now), null);
  assert.equal(readMultiuseSessionToken(token, { ...config, sessionSecret: "b".repeat(32) }, now), null);
  assert.equal(readMultiuseSessionToken(token, config, now + 604_800_001), null);
});

function jwtWithExpiry(exp) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256" })}.${part({ exp })}.signature`;
}

test("a session never outlives the BPM token it carries", () => {
  const now = 1_700_000_000_000;
  const tokenExp = Math.floor(now / 1000) + 3_600;
  const session = createMultiuseSessionToken(jwtWithExpiry(tokenExp), identity, config, now, Buffer.alloc(12, 7));
  const restored = readMultiuseSessionToken(session, config, now);
  assert.equal(restored.expiresAt, tokenExp);
  // The week-long refresh must not push the session past the token expiry.
  assert.equal(restored.expiresAt < Math.floor(now / 1000) + 604_800, true);
});

test("a session with an expired BPM token is refused even before its own expiry", () => {
  const now = 1_700_000_000_000;
  const expired = jwtWithExpiry(Math.floor(now / 1000) - 60);
  const session = createMultiuseSessionToken(expired, identity, config, now, Buffer.alloc(12, 7));
  assert.equal(readMultiuseSessionToken(session, config, now), null);
});

test("reads the expiry claim of a BPM token and ignores unusable ones", () => {
  assert.equal(bpmTokenExpiresAt(jwtWithExpiry(1_700_000_000)), 1_700_000_000);
  assert.equal(bpmTokenExpiresAt("opaque-token"), null);
  assert.equal(bpmTokenExpiresAt("a.!!!.c"), null);
  assert.equal(bpmTokenExpiresAt("a.eyJleHAiOiJub3QifQ.c"), null);
});
