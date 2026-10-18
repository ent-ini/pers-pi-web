import { createServer } from "node:http";
import { chmod, chown, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { request as dockerRequest } from "node:http";
import { createTemplateStore } from "./template-store.mjs";
import { createWorkspaceTemplates, snapshotTemplate } from "./workspace-template.mjs";
import { resetStoppedWorker, serialize } from "./workspace-reset.mjs";

const socketPath = "/var/run/docker.sock";
const dataRoot = "/data/pi-web/users";
const templateRoot = "/data/pi-web/templates/default";
const registryPath = "/data/pi-web/control/users.json";
const image = process.env.PI_WEB_WORKER_IMAGE || "pi-web-multi-pi-web:latest";
const secret = process.env.PI_WEB_WORKER_MANAGER_SECRET || "";
const network = process.env.PI_WEB_WORKER_NETWORK || "pi-web-internal";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const templateStore = createTemplateStore(templateRoot);
const workspaceTemplates = createWorkspaceTemplates({ stateRoot: "/data/pi-web/control/workspace-templates" });
const templateSnapshot = () => serialize("template", () => snapshotTemplate(templateRoot));

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
async function prepareDirectories(employeeId) {
  const root = `${dataRoot}/${employeeId}`;
  let created = false;
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid worker root.");
  } catch (error) { if (error.code === "ENOENT") created = true; else throw error; }
  for (const path of [root, `${root}/agent`, `${root}/workspace`]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid worker directory.");
    await chown(path, 10001, 10001);
    await chmod(path, 0o700);
  }
  // Retry an interrupted first provision only while no user has been registered.
  if (created || (!(await workspaceTemplates.read(employeeId)) && !(await users())[employeeId])) {
    await workspaceTemplates.apply(employeeId, `${root}/workspace`, await templateSnapshot());
  }
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
  const employeeId = safeEmployeeId(identity?.id);
  await workspaceTemplates.assertHealthy(employeeId);
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
  const url = `http://${name}:30141`; await waitForWorker(url);
  await serialize("registry", () => recordUser(identity));
  return url;
}
async function resetWorkspace(employeeId) {
  employeeId = safeEmployeeId(employeeId);
  const root = `${dataRoot}/${employeeId}`;
  const info = await lstat(root).catch((error) => { if (error.code === "ENOENT") { const missing = new Error("Workspace ещё не создан. Сотруднику нужно сначала войти в AI-чат."); missing.status = 404; throw missing; } throw error; });
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid worker root.");
  const snapshot = await templateSnapshot();
  return resetStoppedWorker({
    name: containerName(employeeId), docker, start, wait: waitForWorker,
    apply: () => workspaceTemplates.apply(employeeId, `${root}/workspace`, snapshot),
  });
}
function send(response, status, payload) { response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify(payload)); }
async function body(request) { let raw = ""; for await (const part of request) raw += part; return raw ? JSON.parse(raw) : {}; }

createServer(async (request, response) => {
  if (request.headers.authorization !== `Bearer ${secret}`) return send(response, 401, { error: "Unauthorized" });
  const url = new URL(request.url, "http://manager");
  try {
    if (request.method === "POST" && url.pathname === "/workers/ensure") {
      const identity = (await body(request)).identity;
      const id = safeEmployeeId(identity?.id);
      return send(response, 200, { url: await serialize(`user:${id}`, () => ensureWorker(identity)) });
    }
    if (request.method === "GET" && url.pathname === "/admin/users") {
      const all = await users();
      const result = await Promise.all(Object.values(all).map(async (user) => {
        const id = user.id; let running = false;
        try { running = Boolean((await docker("GET", `/containers/${containerName(id)}/json`)).State.Running); } catch { /* worker was never created or was removed */ }
        const manifest = await workspaceTemplates.read(id);
        const workspaceTemplate = manifest ? { revision: manifest.revision, appliedAt: manifest.appliedAt, trackedFiles: manifest.entries.filter((entry) => entry.type === "file").length } : null;
        return { ...user, running, workspaceTemplate };
      }));
      return send(response, 200, { users: result });
    }
    if (request.method === "GET" && url.pathname === "/admin/template/tree") {
      const snapshot = await templateSnapshot();
      return send(response, 200, { entries: snapshot.entries, revision: snapshot.revision });
    }
    if (request.method === "GET" && url.pathname === "/admin/template/file") return send(response, 200, { content: await templateStore.read(url.searchParams.get("path")) });
    const payload = await body(request);
    if (request.method === "PUT" && url.pathname === "/admin/template/file") { await serialize("template", () => templateStore.write(payload.path, payload.content)); return send(response, 200, { ok: true }); }
    if (request.method === "POST" && url.pathname === "/admin/template/file") { await serialize("template", () => templateStore.createFile(payload.path)); return send(response, 201, { ok: true }); }
    if (request.method === "POST" && url.pathname === "/admin/template/directory") { await serialize("template", () => templateStore.createDirectory(payload.path)); return send(response, 200, { ok: true }); }
    if (request.method === "PATCH" && url.pathname === "/admin/template/entry") { await serialize("template", () => templateStore.rename(payload.path, payload.name)); return send(response, 200, { ok: true }); }
    if (request.method === "DELETE" && url.pathname === "/admin/template/entry") { await serialize("template", () => templateStore.remove(payload.path)); return send(response, 200, { ok: true }); }
    if (request.method === "POST" && /^\/admin\/users\/[^/]+\/reset-workspace$/.test(url.pathname)) {
      const id = safeEmployeeId(url.pathname.split("/")[3]);
      const result = await serialize(`user:${id}`, () => resetWorkspace(id));
      return send(response, 200, { ok: true, ...result });
    }
    return send(response, 404, { error: "Not found" });
  } catch (error) { console.error("[worker-manager] request failed", error); return send(response, error.status || 400, { error: error instanceof Error ? error.message : "Request failed" }); }
}).listen(3030, "0.0.0.0", () => console.log("worker manager listening on :3030"));
