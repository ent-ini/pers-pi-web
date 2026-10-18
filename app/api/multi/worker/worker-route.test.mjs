import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });
const { GET, POST } = await jiti.import("./[employeeId]/[...path]/route.ts");
const { NextRequest } = await jiti.import("next/server");
const { createMultiuseSessionToken } = await jiti.import("../../../../lib/multiuse-auth.ts");
const id = "2b0b19f0-7a39-4e85-8c08-886cefc3dac1";
const config = { bpmApiUrl: "https://bpm.example.test", sessionSecret: "test-session-secret-".repeat(3) };
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const workerUrl = "http://pi_worker_test:30141";

test.before(() => {
  process.env.PI_WEB_BPM_API_URL = config.bpmApiUrl;
  process.env.PI_WEB_MULTI_SESSION_SECRET = config.sessionSecret;
  process.env.PI_WEB_WORKER_MANAGER_URL = "http://manager.test:3030";
  process.env.PI_WEB_WORKER_MANAGER_SECRET = "test-manager-secret-".repeat(3);
});
test.after(() => { globalThis.fetch = originalFetch; process.env = originalEnv; });

function request(path, { method = "GET", cookie = true, body } = {}) {
  const token = createMultiuseSessionToken("bpm-token", { id, email: "user@example.test", fullName: "Сотрудник", role: "employee", status: "active" }, config);
  return new NextRequest(`https://ai.example.test${path}`, { method, body, headers: {
    host: "ai.example.test", ...(cookie ? { cookie: `pi_web_multi_session=${token}` } : {}),
  } });
}
const context = (path, employeeId = id) => ({ params: Promise.resolve({ employeeId, path }) });
function mockFetch() {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    if (url.hostname === "manager.test") return Response.json({ url: workerUrl });
    calls.push({ url, init });
    if (url.pathname === "/api/file-explorer/pins") return url.searchParams.get("cwd")
      ? Response.json({ paths: [] }) : Response.json({ error: "cwd must be an absolute path" }, { status: 400 });
    if (url.pathname.startsWith("/api/files/")) return url.searchParams.get("type") === "read"
      ? Response.json({ content: "test file" }) : Response.json({ error: "Not a directory" }, { status: 400 });
    return Response.json({ ok: true });
  };
  return calls;
}

test("file read type reaches the worker instead of listing a file as a directory", async () => {
  const calls = mockFetch();
  const response = await GET(request("/api/files/workspace/AGENTS.md?type=read&offset=0&limit=1024"), context(["files", "workspace", "AGENTS.md"]));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).content, "test file");
  assert.equal(calls[0].url.search, "?type=read&offset=0&limit=1024");
});

test("pinned files request retains cwd, avoiding HTTP 400", async () => {
  const calls = mockFetch();
  const response = await GET(request("/api/file-explorer/pins?cwd=%2Fworkspace"), context(["file-explorer", "pins"]));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { paths: [] });
  assert.equal(calls[0].url.searchParams.get("cwd"), "/workspace");
});

test("preserves encoded/repeated query values and path segments without leaking corporate credentials", async () => {
  const calls = mockFetch();
  const query = "?cwd=%2Fworkspace&name=%D1%84%D0%B0%D0%B9%D0%BB+1&tag=a%2Bb&tag=a%26b";
  const response = await GET(request(`/api/models${query}`), context(["models"]));
  assert.equal(response.status, 200);
  assert.equal(calls[0].url.search, query);
  assert.equal(calls[0].url.origin, workerUrl);
  assert.equal(calls[0].init.headers.has("cookie"), false);
  assert.equal(calls[0].init.headers.has("authorization"), false);
  await GET(request("/api/files/workspace/test?type=read"), context(["files", "workspace", "a?b#c.md"]));
  assert.equal(calls[1].url.pathname, "/api/files/workspace/a%3Fb%23c.md");
  assert.equal(calls[1].url.search, "?type=read");
});

test("query parameters survive POST as well; requests without a query remain unchanged", async () => {
  const calls = mockFetch();
  await POST(request("/api/files/workspace?type=upload-check&conflict=skip", { method: "POST", body: "{}" }), context(["files", "workspace"]));
  assert.equal(calls[0].url.search, "?type=upload-check&conflict=skip");
  assert.equal(calls[0].init.method, "POST");
  await GET(request("/api/home"), context(["home"]));
  assert.equal(calls[1].url.href, `${workerUrl}/api/home`);
});

test("unauthenticated and cross-employee requests never reach a worker", async () => {
  const calls = mockFetch();
  assert.equal((await GET(request("/api/home", { cookie: false }), context(["home"]))).status, 401);
  assert.equal((await GET(request("/api/home"), context(["home"], "other-employee"))).status, 401);
  assert.equal(calls.length, 0);
});
