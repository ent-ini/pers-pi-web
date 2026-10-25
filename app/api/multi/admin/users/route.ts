import { NextRequest, NextResponse } from "next/server";
import { PI_WEB_MULTI_SESSION_COOKIE, readMultiuseSessionToken } from "@/lib/multiuse-auth";
import { AdminUsersError, listBpmEmployees, mergeWorkerStates, type AdminEmployee } from "@/lib/multiuse-admin-users";
import { getMultiuseConfig } from "@/lib/multiuse-config";
import { isApiRequestAllowed } from "@/lib/request-security";
import { workerManagerRequest } from "@/lib/worker-manager";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  const adminHost = process.env.PI_WEB_ADMIN_HOST?.trim().toLowerCase();
  const requestHost = request.headers.get("host")?.split(":", 1)[0]?.toLowerCase();
  if (!adminHost || requestHost !== adminHost) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let session;
  let config;
  try {
    config = getMultiuseConfig();
    session = readMultiuseSessionToken(request.cookies.get(PI_WEB_MULTI_SESSION_COOKIE)?.value, config);
  } catch {
    return NextResponse.json({ error: "Multiuser configuration is unavailable" }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!["admin", "tech"].includes(session.identity.role)) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  try {
    const bpmEmployees = await listBpmEmployees(session.accessToken, config);
    let users: AdminEmployee[] = bpmEmployees.map((employee) => ({ ...employee, worker: "unknown" }));
    let workerAvailable = false;
    try {
      const response = await workerManagerRequest("/admin/users");
      if (!response.ok) throw new Error(`Worker manager returned ${response.status}`);
      users = mergeWorkerStates(bpmEmployees, await response.json());
      workerAvailable = true;
    } catch (error) {
      console.error("[multiuse-admin] worker states unavailable", error);
    }
    return NextResponse.json({ users, workerAvailable }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AdminUsersError) {
      if (error.status === 503) return NextResponse.json({ error: "BPM временно недоступен" }, { status: 503, headers: { "Cache-Control": "no-store" } });
      // BPM rejected the bearer token: the session cannot authorise anything
      // any more, so drop the cookie and let the user sign in again.
      if (error.status === 401) {
        const response = NextResponse.json({ error: "Сессия истекла. Войдите заново." }, { status: 401, headers: { "Cache-Control": "no-store" } });
        response.cookies.set({ name: PI_WEB_MULTI_SESSION_COOKIE, value: "", httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 0 });
        return response;
      }
      return NextResponse.json({ error: "Нет доступа к списку сотрудников BPM" }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    console.error("[multiuse-admin] employee catalogue failed", error);
    return NextResponse.json({ error: "Не удалось загрузить сотрудников BPM" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
