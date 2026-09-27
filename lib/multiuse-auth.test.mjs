import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { createMultiuseSessionToken, readMultiuseSessionToken } = await createJiti(import.meta.url)
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
    expiresAt: 1_700_003_600,
  });
});

test("refuses altered, expired, and differently-keyed sessions", () => {
  const now = 1_700_000_000_000;
  const token = createMultiuseSessionToken("bpm-access-token", identity, config, now, Buffer.alloc(12, 7));
  assert.equal(readMultiuseSessionToken(`${token}x`, config, now), null);
  assert.equal(readMultiuseSessionToken(token, { ...config, sessionSecret: "b".repeat(32) }, now), null);
  assert.equal(readMultiuseSessionToken(token, config, now + 3_600_001), null);
});
