import { createServer } from "node:http";
import { chmod, chown, mkdir } from "node:fs/promises";
import { request as dockerRequest } from "node:http";

const socketPath = "/var/run/docker.sock";
const dataRoot = "/data/pi-web/users";
const image = process.env.PI_WEB_WORKER_IMAGE || "pi-web-multi-pi-web:latest";
const secret = process.env.PI_WEB_WORKER_MANAGER_SECRET || "";
const network = process.env.PI_WEB_WORKER_NETWORK || "pi-web-internal";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (secret.length < 32) throw new Error("PI_WEB_WORKER_MANAGER_SECRET must be at least 32 characters.");

function docker(method, path, body) {
  return new Promise((resolve, reject) => {
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    const request = dockerRequest({ socketPath, path, method, headers: encoded ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(encoded) } : undefined }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => {
        let payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch { /* Docker error body need not be JSON. */ }
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(payload);
        else reject(new Error(`Docker ${method} ${path}: ${response.statusCode} ${payload?.message || text}`));
      });
    });
    request.on("error", reject);
    if (encoded) request.write(encoded);
    request.end();
  });
}

function containerName(employeeId) {
  return `pi_worker_${employeeId.replaceAll("-", "")}`;
}

async function prepareDirectories(employeeId) {
  const root = `${dataRoot}/${employeeId}`;
  for (const path of [root, `${root}/agent`, `${root}/workspace`]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chown(path, 10001, 10001);
    await chmod(path, 0o700);
  }
  return root;
}

async function ensureWorker(employeeId) {
  if (!UUID.test(employeeId)) throw new Error("Invalid employee identifier.");
  const name = containerName(employeeId);
  let info;
  try {
    info = await docker("GET", `/containers/${name}/json`);
  } catch (error) {
    if (!String(error).includes(" 404 ")) throw error;
  }
  if (!info) {
    const root = await prepareDirectories(employeeId);
    await docker("POST", `/containers/create?name=${name}`, {
      Image: image,
      Cmd: ["--mode", "single", "--hostname", "0.0.0.0", "--no-open"],
      Env: ["HOME=/home/pi", "PI_WEB_MODE=single", "PI_WEB_HOSTNAME=0.0.0.0", "PI_WEB_NO_OPEN=1"],
      HostConfig: {
        NetworkMode: network,
        ReadonlyRootfs: true,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges:true"],
        PidsLimit: 256,
        Memory: 2147483648,
        NanoCpus: 2000000000,
        Tmpfs: { "/tmp": "rw,noexec,nosuid,size=256m" },
        Mounts: [
          { Type: "bind", Source: `${root}/agent`, Target: "/home/pi/.pi", ReadOnly: false },
          { Type: "bind", Source: `${root}/workspace`, Target: "/workspace", ReadOnly: false },
        ],
      },
    });
    await docker("POST", `/containers/${name}/start`);
  } else if (!info.State.Running) {
    await docker("POST", `/containers/${name}/start`);
  }
  return `http://${name}:30141`;
}

function send(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/workers/ensure") return send(response, 404, { error: "Not found" });
  if (request.headers.authorization !== `Bearer ${secret}`) return send(response, 401, { error: "Unauthorized" });
  let raw = "";
  for await (const chunk of request) raw += chunk;
  try {
    const { employeeId } = JSON.parse(raw);
    if (typeof employeeId !== "string") throw new Error("employeeId is required.");
    send(response, 200, { url: await ensureWorker(employeeId) });
  } catch (error) {
    console.error("[worker-manager] ensure failed", error);
    send(response, 503, { error: "Worker provisioning failed" });
  }
}).listen(3030, "0.0.0.0", () => console.log("worker manager listening on :3030"));
