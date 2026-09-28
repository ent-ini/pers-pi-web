import type { MultiuseIdentity } from "./multiuse-auth";
import type { MultiuseConfig } from "./multiuse-config";

export type BpmLoginFailure = "invalid-credentials" | "unavailable" | "invalid-identity";

export class BpmLoginError extends Error {
  constructor(public readonly reason: BpmLoginFailure) {
    super(reason);
  }
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function endpoint(config: MultiuseConfig, path: string): URL {
  return new URL(path, `${config.bpmApiUrl}/`);
}

function nonEmptyString(value: unknown, maxLength = 8192): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null;
}

function identityFrom(value: unknown): MultiuseIdentity | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const id = nonEmptyString(body.id, 128);
  const email = nonEmptyString(body.email, 320);
  const fullName = nonEmptyString(body.full_name, 320);
  const employeeStatus = nonEmptyString(body.status, 64);
  const role = nonEmptyString(body.role, 64);
  if (!id || !email || !fullName || !employeeStatus || !role) return null;
  return { id, email, fullName, status: employeeStatus, role };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Authenticate against BPM, then resolve identity from its purpose-built endpoint. */
export async function loginWithBpm(
  credentials: { email: string; password: string },
  config: MultiuseConfig,
  fetcher: FetchLike = fetch,
): Promise<{ accessToken: string; identity: MultiuseIdentity }> {
  let loginResponse: Response;
  try {
    loginResponse = await fetcher(endpoint(config, "/api/auth/login"), {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new BpmLoginError("unavailable");
  }
  if (loginResponse.status === 401) throw new BpmLoginError("invalid-credentials");
  if (!loginResponse.ok) throw new BpmLoginError("unavailable");

  const loginBody = await readJson(loginResponse);
  const accessToken = loginBody && typeof loginBody === "object"
    ? nonEmptyString((loginBody as Record<string, unknown>).access_token)
    : null;
  if (!accessToken) throw new BpmLoginError("unavailable");

  let identityResponse: Response;
  try {
    identityResponse = await fetcher(endpoint(config, "/api/integrations/pi-web/me"), {
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new BpmLoginError("unavailable");
  }
  if (!identityResponse.ok) {
    throw new BpmLoginError(identityResponse.status === 403 ? "invalid-identity" : "unavailable");
  }
  const identity = identityFrom(await readJson(identityResponse));
  if (!identity || identity.status.toLowerCase() !== "active") throw new BpmLoginError("invalid-identity");
  return { accessToken, identity };
}
