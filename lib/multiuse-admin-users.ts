import type { MultiuseConfig } from "./multiuse-config";
import type { FetchLike } from "./multiuse-bpm-client";

export type WorkspaceTemplateInfo = { revision: string; appliedAt: string; trackedFiles: number };

export type AdminEmployee = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  worker: "running" | "stopped" | "not-created" | "unknown";
  workspaceTemplate?: WorkspaceTemplateInfo | null;
};

type BpmEmployee = Omit<AdminEmployee, "worker" | "workspaceTemplate">;

export class AdminUsersError extends Error {
  constructor(public readonly status: 401 | 403 | 503) {
    super(`BPM employee catalogue failed (${status})`);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function bpmGet(path: string, token: string, config: MultiuseConfig, fetcher: FetchLike): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(new URL(path, `${config.bpmApiUrl}/`), {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AdminUsersError(503);
  }
  if (response.status === 401 || response.status === 403) throw new AdminUsersError(response.status);
  if (!response.ok) throw new AdminUsersError(503);
  try { return await response.json(); } catch { throw new AdminUsersError(503); }
}

function parseEmployees(payload: unknown): BpmEmployee[] {
  if (!Array.isArray(payload)) throw new AdminUsersError(503);
  return payload.map((value) => {
    if (!value || typeof value !== "object") throw new AdminUsersError(503);
    const item = value as Record<string, unknown>;
    if (typeof item.id !== "string" || !UUID.test(item.id)
      || typeof item.email !== "string" || !item.email
      || typeof item.status !== "string" || !item.status) throw new AdminUsersError(503);
    return {
      id: item.id.toLowerCase(),
      name: typeof item.full_name === "string" && item.full_name.trim() ? item.full_name.trim() : item.email,
      email: item.email,
      role: typeof item.role === "string" && item.role ? item.role : "employee",
      status: item.status,
    };
  });
}

/** Mutations must recheck the live BPM role, not just trust the seven-day cookie. */
export async function assertBpmAdmin(token: string, config: MultiuseConfig, fetcher: FetchLike = fetch): Promise<void> {
  const identity = await bpmGet("/api/integrations/pi-web/me", token, config, fetcher);
  if (!identity || typeof identity !== "object" || !["admin", "tech"].includes((identity as { role?: string }).role || "")) {
    throw new AdminUsersError(403);
  }
}

/** Read BPM's current role and employee catalogue. No passwords or other BPM fields leave this module. */
export async function listBpmEmployees(token: string, config: MultiuseConfig, fetcher: FetchLike = fetch): Promise<BpmEmployee[]> {
  await assertBpmAdmin(token, config, fetcher);
  // /all excludes archived employees by default. Fetch archived separately so
  // their existing workspaces aren't misrepresented as orphaned employees.
  const [current, archived] = await Promise.all([
    bpmGet("/api/employees/all", token, config, fetcher),
    bpmGet("/api/employees/all?status=archived", token, config, fetcher),
  ]);
  const unique = new Map<string, BpmEmployee>();
  for (const employee of [...parseEmployees(current), ...parseEmployees(archived)]) unique.set(employee.id, employee);
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

/** The manager's registry is only worker metadata, never the source of employee identities. */
export function mergeWorkerStates(employees: BpmEmployee[], managerPayload: unknown): AdminEmployee[] {
  if (!managerPayload || typeof managerPayload !== "object" || !Array.isArray((managerPayload as { users?: unknown }).users)) {
    throw new Error("Invalid worker manager response");
  }
  const states = new Map<string, "running" | "stopped">();
  const templates = new Map<string, WorkspaceTemplateInfo | null>();
  for (const item of (managerPayload as { users: unknown[] }).users) {
    if (!item || typeof item !== "object") throw new Error("Invalid worker manager response");
    const user = item as { id?: unknown; running?: unknown; workspaceTemplate?: unknown };
    if (typeof user.id !== "string" || !UUID.test(user.id) || typeof user.running !== "boolean") throw new Error("Invalid worker manager response");
    states.set(user.id.toLowerCase(), user.running ? "running" : "stopped");
    const template = user.workspaceTemplate as Partial<WorkspaceTemplateInfo> | null | undefined;
    if (template && typeof template.revision === "string" && /^[a-f0-9]{64}$/.test(template.revision)
      && typeof template.appliedAt === "string" && Number.isFinite(Date.parse(template.appliedAt))
      && Number.isInteger(template.trackedFiles) && template.trackedFiles! >= 0) {
      templates.set(user.id.toLowerCase(), template as WorkspaceTemplateInfo);
    } else if (user.workspaceTemplate === null) templates.set(user.id.toLowerCase(), null);
  }
  return employees.map((employee) => ({ ...employee, worker: states.get(employee.id) || "not-created",
    ...(templates.has(employee.id) ? { workspaceTemplate: templates.get(employee.id) } : {}),
  }));
}
