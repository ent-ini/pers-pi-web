import type { MultiuseIdentity } from "./multiuse-auth";

interface WorkerManagerConfig {
  url: string;
  secret: string;
}

function getWorkerManagerConfig(env: NodeJS.ProcessEnv = process.env): WorkerManagerConfig {
  const url = env.PI_WEB_WORKER_MANAGER_URL?.trim();
  const secret = env.PI_WEB_WORKER_MANAGER_SECRET?.trim();
  if (!url || !secret) throw new Error("Worker manager is not configured.");
  if (secret.length < 32) throw new Error("PI_WEB_WORKER_MANAGER_SECRET must be at least 32 characters long.");
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("PI_WEB_WORKER_MANAGER_URL must be HTTP(S).");
  return { url: parsed.origin, secret };
}

export async function workerManagerRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const config = getWorkerManagerConfig();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${config.secret}`);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(new URL(path, config.url), {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!response) throw new Error("Worker manager request failed (network).");
  return response;
}

/** Ensures that an authenticated employee has exactly one private Pi worker. */
export async function ensureWorker(identity: MultiuseIdentity): Promise<string> {
  const response = await workerManagerRequest("/workers/ensure", {
    method: "POST",
    body: JSON.stringify({ identity }),
  });
  if (!response.ok) throw new Error(`Worker manager request failed (${response.status}).`);
  const payload = await response.json().catch(() => null) as { url?: unknown } | null;
  if (!payload || typeof payload.url !== "string" || !/^http:\/\/[a-z0-9_-]+:30141$/.test(payload.url)) {
    throw new Error("Worker manager returned an invalid worker address.");
  }
  return payload.url;
}
