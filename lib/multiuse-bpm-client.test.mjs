import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { BpmLoginError, loginWithBpm } = await createJiti(import.meta.url)
  .import("./multiuse-bpm-client.ts");

const config = { bpmApiUrl: "https://bpm.buhgalterboutique.ru", sessionSecret: "a".repeat(32) };
const identity = {
  id: "2b0b19f0-7a39-4e85-8c08-886cefc3dac1",
  email: "olga@example.com",
  full_name: "Ольга Бухгалтер",
  status: "active",
  role: "employee",
};

test("logs in then resolves identity with the BPM bearer token", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return Response.json({ access_token: "bpm-token", user: { ignored: true } });
    return Response.json(identity);
  };

  assert.deepEqual(await loginWithBpm({ email: "olga@example.com", password: "secret" }, config, fetcher), {
    accessToken: "bpm-token",
    identity: { id: identity.id, email: identity.email, fullName: identity.full_name, status: "active", role: "employee" },
  });
  assert.equal(calls[0].url, "https://bpm.buhgalterboutique.ru/api/auth/login");
  assert.equal(calls[1].options.headers.Authorization, "Bearer bpm-token");
});

test("does not trust BPM's login payload as identity", async () => {
  const fetcher = async () => Response.json({ access_token: "bpm-token" });
  await assert.rejects(
    () => loginWithBpm({ email: "olga@example.com", password: "secret" }, config, fetcher),
    (error) => error instanceof BpmLoginError && error.reason === "invalid-identity",
  );
});

test("keeps invalid credentials distinct from BPM outages", async () => {
  await assert.rejects(
    () => loginWithBpm({ email: "olga@example.com", password: "wrong" }, config, async () => new Response(null, { status: 401 })),
    (error) => error instanceof BpmLoginError && error.reason === "invalid-credentials",
  );
});
