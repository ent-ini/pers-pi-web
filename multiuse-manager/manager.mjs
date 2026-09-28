import { createServer } from "node:http";
import { chmod, chown, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { request as dockerRequest } from "node:http";

const socketPath = "/var/run/docker.sock";
const dataRoot = "/data/pi-web/users";
const templateRoot = "/data/pi-web/templates/default";
const registryPath = "/data/pi-web/control/users.json";
const image = process.env.PI_WEB_WORKER_IMAGE || "pi-web-multi-pi-web:latest";
const secret = process.env.PI_WEB_WORKER_MANAGER_SECRET || "";
const network = process.env.PI_WEB_WORKER_NETWORK || "pi-web-internal";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (secret.length < 32) throw new Error("PI_WEB_WORKER_MANAGER_SECRET must be at least 32 characters.");

function docker(method, path, body) {
  return new Promise((resolvePromise, reject) => {
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    const request = dockerRequest({ socketPath, path, method, headers: encoded ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(encoded) } : undefined }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => {
        let payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch { /* Docker errors need not be JSON. */ }
        if (response.statusCode >= 200 && response.statusCode < 300) resolvePromise(payload);
        else reject(new Error(`Docker ${method} ${path}: ${response.statusCode} ${payload?.message || text}`));
      });
    });
    request.on("error", reject);
    if (encoded) request.write(encoded);
    request.end();
  });
}

function containerName(employeeId) { return `pi_worker_${employeeId.replaceAll("-", "")}`; }
function safeEmployeeId(value) {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error("Invalid employee identifier.");
  return value.toLowerCase();
}
function safePath(root, value) {
  if (typeof value !== "string" || !value || value.length > 512 || value.includes("\0")) throw new Error("Invalid path.");
  const target = resolve(root, value);
  if (target === root || !target.startsWith(`${root}${sep}`)) throw new Error("Path must stay inside the template.");
  return target;
}
async function chownTree(path) {
  const info = await stat(path);
  await chown(path, 10001, 10001);
  await chmod(path, info.isDirectory() ? 0o700 : 0o600);
  if (info.isDirectory()) for (const entry of await readdir(path)) await chownTree(`${path}/${entry}`);
}
async function applyTemplate(workspace) {
  await mkdir(templateRoot, { recursive: true, mode: 0o750 });
  await cp(templateRoot, workspace, { recursive: true, force: false });
  await chownTree(workspace);
}
async function prepareDirectories(employeeId) {
  const root = `${dataRoot}/${employeeId}`;
  let created = false;
  try { await stat(root); } catch { created = true; }
  for (const path of [root, `${root}/agent`, `${root}/workspace`]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chown(path, 10001, 10001);
    await chmod(path, 0o700);
  }
  if (created) await applyTemplate(`${root}/workspace`);
  return root;
}
async function users() {
  try { const value = JSON.parse(await readFile(registryPath, "utf8")); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; }
}
async function recordUser(identity) {
  const id = safeEmployeeId(identity?.id);
  const all = await users();
  const previous = all[id] || {};
  all[id] = {
    id,
    email: typeof identity?.email === "string" ? identity.email : previous.email || "",
    fullName: typeof identity?.fullName === "string" ? identity.fullName : previous.fullName || "",
    role: typeof identity?.role === "string" ? identity.role : previous.role || "employee",
    provisionedAt: previous.provisionedAt || new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };
  await mkdir("/data/pi-web/control", { recursive: true, mode: 0o750 });
  await writeFile(registryPath, JSON.stringify(all, null, 2), { mode: 0o600 });
  return id;
}
async function waitForWorker(url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${url}/api/home`, { signal: AbortSignal.timeout(1_000) })).ok) return; } catch { /* starting */ }
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error("Worker did not become ready in time.");
}
async function start(name) {
  await docker("POST", `/containers/${name}/start`).catch((error) => { if (!String(error).includes(" 304 ")) throw error; });
}
async function ensureWorker(identity) {
  const employeeId = await recordUser(identity);
  const name = containerName(employeeId);
  let info;
  try { info = await docker("GET", `/containers/${name}/json`); } catch (error) { if (!String(error).includes(" 404 ")) throw error; }
  if (!info) {
    const root = await prepareDirectories(employeeId);
    try {
      await docker("POST", `/containers/create?name=${name}`, {
        Image: image, Cmd: ["--mode", "single", "--hostname", "0.0.0.0", "--no-open"],
        Env: ["HOME=/home/pi", "PI_WEB_MODE=single", "PI_WEB_HOSTNAME=0.0.0.0", "PI_WEB_NO_OPEN=1", "PI_WEB_DEFAULT_CWD=/workspace", "PI_WEB_LOCKED_CWD=/workspace", `PI_WEB_ALLOWED_HOSTS=${name}`],
        HostConfig: { NetworkMode: network, ReadonlyRootfs: true, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges:true"], PidsLimit: 256, Memory: 2147483648, NanoCpus: 2000000000, Tmpfs: { "/tmp": "rw,noexec,nosuid,size=256m" }, Mounts: [
          { Type: "bind", Source: `${root}/agent`, Target: "/home/pi/.pi", ReadOnly: false },
          { Type: "bind", Source: `${root}/workspace`, Target: "/workspace", ReadOnly: false },
        ] },
      });
    } catch (error) { if (!String(error).includes(" 409 ")) throw error; info = await docker("GET", `/containers/${name}/json`); }
    if (!info || !info.State.Running) await start(name);
  } else if (!info.State.Running) await start(name);
  const url = `http://${name}:30141`; await waitForWorker(url); return url;
}
async function templateTree(directory = templateRoot, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    result.push({ path, type: entry.isDirectory() ? "directory" : "file" });
    if (entry.isDirectory()) result.push(...await templateTree(`${directory}/${entry.name}`, path));
  }
  return result;
}
async function resetWorkspace(employeeId) {
  employeeId = safeEmployeeId(employeeId);
  const root = `${dataRoot}/${employeeId}`;
  await stat(root);
  const name = containerName(employeeId);
  let wasRunning = false;
  try { const info = await docker("GET", `/containers/${name}/json`); wasRunning = Boolean(info.State.Running); if (wasRunning) await docker("POST", `/containers/${name}/stop?t=10`); } catch (error) { if (!String(error).includes(" 404 ")) throw error; }
  const workspace = `${root}/workspace`;
  await rm(workspace, { recursive: true, force: true });
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  await applyTemplate(workspace);
  if (wasRunning) await start(name);
}
function send(response, status, payload) { response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify(payload)); }
async function body(request) { let raw = ""; for await (const part of request) raw += part; return raw ? JSON.parse(raw) : {}; }

createServer(async (request, response) => {
  if (request.headers.authorization !== `Bearer ${secret}`) return send(response, 401, { error: "Unauthorized" });
  const url = new URL(request.url, "http://manager");
  try {
    if (request.method === "POST" && url.pathname === "/workers/ensure") return send(response, 200, { url: await ensureWorker((await body(request)).identity) });
    await mkdir(templateRoot, { recursive: true, mode: 0o750 });
    if (request.method === "GET" && url.pathname === "/admin/users") {
      const all = await users();
      const result = await Promise.all(Object.values(all).map(async (user) => {
        const id = user.id; let running = false;
        try { running = Boolean((await docker("GET", `/containers/${containerName(id)}/json`)).State.Running); } catch { /* worker was never created or was removed */ }
        return { ...user, running };
      }));
      return send(response, 200, { users: result });
    }
    if (request.method === "GET" && url.pathname === "/admin/template/tree") return send(response, 200, { entries: await templateTree() });
    if (request.method === "GET" && url.pathname === "/admin/template/file") return send(response, 200, { content: await readFile(safePath(templateRoot, url.searchParams.get("path")), "utf8") });
    const payload = await body(request);
    if (request.method === "PUT" && url.pathname === "/admin/template/file") {
      if (typeof payload.content !== "string" || payload.content.length > 1_000_000) throw new Error("Invalid file content.");
      const target = safePath(templateRoot, payload.path); await mkdir(resolve(target, ".."), { recursive: true, mode: 0o750 }); await writeFile(target, payload.content, { mode: 0o640 }); return send(response, 200, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/admin/template/directory") { await mkdir(safePath(templateRoot, payload.path), { recursive: true, mode: 0o750 }); return send(response, 200, { ok: true }); }
    if (request.method === "DELETE" && url.pathname === "/admin/template/entry") { await rm(safePath(templateRoot, payload.path), { recursive: true, force: true }); return send(response, 200, { ok: true }); }
    if (request.method === "POST" && /^\/admin\/users\/[^/]+\/reset-workspace$/.test(url.pathname)) { await resetWorkspace(url.pathname.split("/")[3]); return send(response, 200, { ok: true }); }
    return send(response, 404, { error: "Not found" });
  } catch (error) { console.error("[worker-manager] request failed", error); return send(response, 400, { error: error instanceof Error ? error.message : "Request failed" }); }
}).listen(3030, "0.0.0.0", () => console.log("worker manager listening on :3030"));
