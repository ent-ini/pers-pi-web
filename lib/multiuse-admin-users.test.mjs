import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { AdminUsersError, listBpmEmployees, mergeWorkerStates } = await createJiti(import.meta.url)
  .import("./multiuse-admin-users.ts");
const config = { bpmApiUrl: "https://bpm.example.com", sessionSecret: "a".repeat(32) };
const id = "2b0b19f0-7a39-4e85-8c08-886cefc3dac1";
const archivedId = "3b0b19f0-7a39-4e85-8c08-886cefc3dac1";

function fetcherFor(role = "admin") {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ path: new URL(url).pathname + new URL(url).search, options });
    if (String(url).endsWith("/me")) return Response.json({ role });
    if (String(url).includes("status=archived")) return Response.json([{ id: archivedId, email: "old@example.com", full_name: "Архивный", role: "employee", status: "archived", password_hash: "never-return" }]);
    return Response.json([{ id, email: "olga@example.com", full_name: "Ольга", role: "tech", status: "active", phone: "private" }]);
  };
  return { fetcher, calls };
}

test("reads live BPM users including archived; returns only minimal fields", async () => {
  const { fetcher, calls } = fetcherFor();
  const users = await listBpmEmployees("secret-bpm-token", config, fetcher);
  assert.deepEqual(users, [
    { id: archivedId, name: "Архивный", email: "old@example.com", role: "employee", status: "archived" },
    { id, name: "Ольга", email: "olga@example.com", role: "tech", status: "active" },
  ]);
  assert.deepEqual(calls.map((call) => call.path), ["/api/integrations/pi-web/me", "/api/employees/all", "/api/employees/all?status=archived"]);
  assert.ok(calls.every((call) => call.options.headers.Authorization === "Bearer secret-bpm-token" && call.options.cache === "no-store"));
  assert.deepEqual(mergeWorkerStates(users, { users: [{ id, running: true }, { id: "4b0b19f0-7a39-4e85-8c08-886cefc3dac1", running: true }] }).map((user) => user.worker), ["not-created", "running"]);
});

test("rejects non-admin and revoked BPM tokens before reading employees", async () => {
  const { fetcher, calls } = fetcherFor("employee");
  await assert.rejects(() => listBpmEmployees("token", config, fetcher), (error) => error instanceof AdminUsersError && error.status === 403);
  assert.equal(calls.length, 1);
  await assert.rejects(() => listBpmEmployees("token", config, async () => new Response(null, { status: 401 })), (error) => error.status === 401);
});

test("does not treat BPM/manager failure as an empty catalogue", async () => {
  const { fetcher } = fetcherFor();
  await assert.rejects(() => listBpmEmployees("token", config, async (url, options) => String(url).includes("status=archived") ? new Response(null, { status: 503 }) : fetcher(url, options)), (error) => error.status === 503);
  assert.throws(() => mergeWorkerStates([], { users: "invalid" }));
});
