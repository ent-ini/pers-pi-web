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

/** Ensures that an authenticated employee has exactly one private Pi worker. */
export async function ensureWorker(identity: MultiuseIdentity): Promise<string> {
  const config = getWorkerManagerConfig();
  const response = await fetch(new URL("/workers/ensure", config.url), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.secret}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ employeeId: identity.id }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!response?.ok) throw new Error(`Worker manager request failed (${response?.status ?? "network"}).`);
  const payload = await response.json().catch(() => null) as { url?: unknown } | null;
  if (!payload || typeof payload.url !== "string" || !/^http:\/\/[a-z0-9_-]+:30141$/.test(payload.url)) {
    throw new Error("Worker manager returned an invalid worker address.");
  }
  return payload.url;
}
