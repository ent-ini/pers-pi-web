import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });
const { GET, POST } = await jiti.import("./[employeeId]/[...path]/route.ts");
const { NextRequest } = await jiti.import("next/server");
const { createMultiuseSessionToken } = await jiti.import("../../../../lib/multiuse-auth.ts");
const { isApiRequestAllowed } = await jiti.import("../../../../lib/request-security.ts");
const id = "2b0b19f0-7a39-4e85-8c08-886cefc3dac1";
const config = { bpmApiUrl: "https://bpm.example.test", sessionSecret: "test-session-secret-".repeat(3) };
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const workerUrl = "http://pi_worker_test:30141";

test.before(() => {
  process.env.PI_WEB_ALLOWED_HOSTS = "ai.example.test";
  process.env.PI_WEB_BPM_API_URL = config.bpmApiUrl;
  process.env.PI_WEB_MULTI_SESSION_SECRET = config.sessionSecret;
  process.env.PI_WEB_WORKER_MANAGER_URL = "http://manager.test:3030";
  process.env.PI_WEB_WORKER_MANAGER_SECRET = "test-manager-secret-".repeat(3);
});
test.after(() => { globalThis.fetch = originalFetch; process.env = originalEnv; });

function request(path, { method = "GET", cookie = true, body, origin, fetchSite, forwardedProto, protocol = "https", host = "ai.example.test" } = {}) {
  const token = createMultiuseSessionToken("bpm-token", { id, email: "user@example.test", fullName: "Сотрудник", role: "employee", status: "active" }, config);
  return new NextRequest(`${protocol}://${host}${path}`, { method, body, headers: {
    host, ...(cookie ? { cookie: `pi_web_multi_session=${token}` } : {}),
    ...(origin ? { origin } : {}), ...(fetchSite ? { "sec-fetch-site": fetchSite } : {}),
    ...(forwardedProto ? { "x-forwarded-proto": forwardedProto } : {}),
  } });
}
const context = (path, employeeId = id) => ({ params: Promise.resolve({ employeeId, path }) });
function mockFetch() {
  const calls = [];
  calls.managerRequests = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    if (url.hostname === "manager.test") { calls.managerRequests++; return Response.json({ url: workerUrl }); }
    calls.push({ url, init });
    const headers = new Headers(init.headers);
    headers.set("host", url.host); // Node fetch supplies the upstream Host.
    const workerRequest = new Request(url, { method: init.method, headers });
    if (!isApiRequestAllowed(workerRequest, [url.hostname])) return Response.json({ error: "Untrusted API request" }, { status: 403 });
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
  assert.equal(calls[0].init.headers.get("accept-encoding"), "identity");
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

test("browser message POST passes worker security with a translated, validated Origin", async () => {
  const calls = mockFetch();
  const response = await POST(request("/api/agent/new", { method: "POST", body: "{}", origin: "https://ai.example.test", fetchSite: "same-origin" }), context(["agent", "new"]));
  assert.equal(response.status, 200);
  assert.equal(calls[0].init.headers.get("origin"), workerUrl);
  assert.equal(calls[0].init.headers.get("sec-fetch-site"), "same-origin");
  assert.equal(await new Response(calls[0].init.body).text(), "{}", "forwarding must retain the message body");
});

test("HTTPS browser origin behind an HTTP reverse proxy is validated before translation", async () => {
  const calls = mockFetch();
  const response = await POST(request("/api/agent/new", {
    method: "POST", body: "{}", origin: "https://ai.example.test", fetchSite: "same-origin", forwardedProto: "https", protocol: "http",
  }), context(["agent", "new"]));
  assert.equal(response.status, 200);
  assert.equal(calls[0].init.headers.get("origin"), workerUrl);
  assert.equal(calls[0].init.headers.has("x-forwarded-proto"), false);
});

test("foreign/null origins, cross-site fetches and untrusted hosts are rejected before ensureWorker", async () => {
  for (const options of [
    { origin: "https://evil.example.test", fetchSite: "same-site" },
    { origin: "null" },
    { origin: "https://ai.example.test", fetchSite: "cross-site" },
    { host: "evil.example.test", origin: "https://evil.example.test" },
    { origin: workerUrl }, // An internal Origin from a browser is not trusted either.
  ]) {
    const calls = mockFetch();
    const response = await POST(request("/api/agent/new", { method: "POST", body: "{}", ...options }), context(["agent", "new"]));
    assert.equal(response.status, 403, JSON.stringify(options));
    assert.equal(calls.length, 0);
    assert.equal(calls.managerRequests, 0);
  }
});

test("non-browser requests without Origin keep it absent", async () => {
  const calls = mockFetch();
  const response = await POST(request("/api/agent/new", { method: "POST", body: "{}" }), context(["agent", "new"]));
  assert.equal(response.status, 200);
  assert.equal(calls[0].init.headers.has("origin"), false);
});

test("a real gzipped upstream response is decoded once, without stale encoding/length or worker cookies", async () => {
  const payload = { text: "Тест сжатого ответа. ".repeat(100) };
  const compressed = gzipSync(JSON.stringify(payload));
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip", "content-length": compressed.length, "set-cookie": "worker=private" });
    response.end(compressed);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    globalThis.fetch = async (input) => new URL(input).hostname === "manager.test"
      ? Response.json({ url: workerUrl }) : originalFetch(`http://127.0.0.1:${server.address().port}`);
    const response = await GET(request("/api/sessions/test"), context(["sessions", "test"]));
    assert.deepEqual(await response.json(), payload, "Node fetch already decompressed the response body");
    assert.equal(response.headers.has("content-encoding"), false, "browser must not attempt gzip decoding again");
    assert.equal(response.headers.has("content-length"), false);
    assert.equal(response.headers.has("set-cookie"), false);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("unauthenticated and cross-employee requests never reach a worker", async () => {
  const calls = mockFetch();
  assert.equal((await GET(request("/api/home", { cookie: false }), context(["home"]))).status, 401);
  assert.equal((await GET(request("/api/home"), context(["home"], "other-employee"))).status, 401);
  assert.equal(calls.length, 0);
});
