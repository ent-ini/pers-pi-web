import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });
const { POST, GET } = await jiti.import("./[...path]/route.ts");
const { NextRequest } = await jiti.import("next/server");
const { createMultiuseSessionToken } = await jiti.import("../../../../lib/multiuse-auth.ts");
const id = "2b0b19f0-7a39-4e85-8c08-886cefc3dac1";
const config = { bpmApiUrl: "https://bpm.example.test", sessionSecret: "test-session-secret-".repeat(3) };
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

test.before(() => {
  process.env.PI_WEB_BPM_API_URL = config.bpmApiUrl;
  process.env.PI_WEB_MULTI_SESSION_SECRET = config.sessionSecret;
  process.env.PI_WEB_WORKER_MANAGER_URL = "http://manager.test:3030";
  process.env.PI_WEB_WORKER_MANAGER_SECRET = "test-manager-secret-".repeat(3);
  process.env.PI_WEB_ADMIN_HOST = "admin.example.test";
  process.env.PI_WEB_ALLOWED_HOSTS = "admin.example.test,ai.example.test";
});
test.after(() => { globalThis.fetch = originalFetch; process.env = originalEnv; });

function request({ role = "admin", host = "admin.example.test", cookie = true, origin = `https://${host}`, method = "POST" } = {}) {
  const token = createMultiuseSessionToken("bpm-token", { id, email: "admin@example.test", fullName: "Админ", role, status: "active" }, config);
  return new NextRequest(`https://${host}/api/multi/admin/users/${id}/reset-workspace`, { method, headers: {
    host, origin, ...(cookie ? { cookie: `pi_web_multi_session=${token}` } : {}),
  } });
}
const context = { params: Promise.resolve({ path: ["users", id, "reset-workspace"] }) };
function mockFetch({ liveRole = "admin", employeeExists = true, managerStatus = 200, bpmStatus = 200 } = {}) {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    if (url.hostname === "manager.test") return Response.json(managerStatus === 200 ? { ok: true, revision: "a".repeat(64) } : { error: "Конфликт с личным файлом" }, { status: managerStatus });
    if (url.pathname.endsWith("/me")) return Response.json({ role: liveRole }, { status: bpmStatus });
    if (url.search || !employeeExists) return Response.json([]);
    return Response.json([{ id, email: "employee@example.test", full_name: "Сотрудник", role: "employee", status: "active" }]);
  };
  return calls;
}

test("admin reset validates current BPM rights and employee, then forwards to the private manager", async () => {
  const calls = mockFetch();
  const response = await POST(request(), context);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  const manager = calls.find((call) => call.url.hostname === "manager.test");
  assert.equal(manager.url.pathname, `/admin/users/${id}/reset-workspace`);
  assert.equal(manager.init.headers.get("Authorization"), `Bearer ${process.env.PI_WEB_WORKER_MANAGER_SECRET}`);
  assert.equal(manager.init.method, "POST");
  assert.equal(calls[0].url.pathname, "/api/integrations/pi-web/me");
});

test("missing auth, ordinary employees, wrong host and cross-origin requests never reach manager", async () => {
  for (const [options, status] of [[{ cookie: false }, 401], [{ role: "employee" }, 403], [{ host: "ai.example.test" }, 404], [{ origin: "https://evil.example.test" }, 403]]) {
    const calls = mockFetch();
    assert.equal((await POST(request(options), context)).status, status);
    assert.equal(calls.length, 0);
  }
});

test("revoked roles/tokens, missing BPM employees and BPM downtime fail closed", async () => {
  for (const [options, status] of [[{ liveRole: "employee" }, 403], [{ bpmStatus: 401 }, 401], [{ bpmStatus: 503 }, 503], [{ employeeExists: false }, 404]]) {
    const calls = mockFetch(options);
    assert.equal((await POST(request(), context)).status, status);
    assert.ok(calls.every((call) => call.url.hostname !== "manager.test"));
  }
});

test("manager conflict remains a 409; template reads also recheck live admin rights", async () => {
  mockFetch({ managerStatus: 409 });
  const response = await POST(request(), context);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Конфликт/);
  const calls = mockFetch({ liveRole: "employee" });
  const result = await GET(request({ method: "GET" }), { params: Promise.resolve({ path: ["template", "tree"] }) });
  assert.equal(result.status, 403);
  assert.equal(calls.length, 1);
});

test("all corporate model operations retain live BPM and origin gates", async () => {
  const paths = [["model-settings"], ["models-config"], ["models-config", "presets"], ["models-config", "catalog"], ["models-config", "discover"], ["models-config", "test"]];
  for (const path of paths) {
    const ctx = { params: Promise.resolve({ path }) };
    let calls = mockFetch({ liveRole: "employee" });
    assert.equal((await GET(request({ method: "GET" }), ctx)).status, 403);
    assert.ok(calls.every(call => call.url.hostname !== "manager.test"));
    calls = mockFetch();
    assert.equal((await GET(request({ method: "GET", origin: "https://evil.example.test" }), ctx)).status, 403);
    assert.equal(calls.length, 0);
    calls = mockFetch();
    const response = await GET(request({ method: "GET" }), ctx);
    assert.equal(response.status, 200);
    if (path[1] === "presets") {
      assert.ok((await response.json()).presets.some((preset) => preset.id === "minimax"));
      assert.equal(calls.length, 1, "SDK catalogue checks BPM but never reads manager/personal auth");
      assert.equal(calls[0].url.pathname, "/api/integrations/pi-web/me");
    } else assert.equal(calls.at(-1).url.pathname, `/admin/${path.join("/")}`);
  }
});
