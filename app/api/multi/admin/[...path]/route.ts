import { NextRequest, NextResponse } from "next/server";
import { PI_WEB_MULTI_SESSION_COOKIE, readMultiuseSessionToken } from "@/lib/multiuse-auth";
import { getMultiuseConfig } from "@/lib/multiuse-config";
import { workerManagerRequest } from "@/lib/worker-manager";
import { AdminUsersError, assertBpmAdmin, listBpmEmployees } from "@/lib/multiuse-admin-users";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function isAdmin(role: string): boolean {
  return role === "admin" || role === "tech";
}

class ModelBodyLimitError extends Error {}
async function boundedModelBody(request: NextRequest): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1_048_576) throw new ModelBodyLimitError();
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { reader.releaseLock(); }
}

async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  const adminHost = process.env.PI_WEB_ADMIN_HOST?.trim().toLowerCase();
  const requestHost = request.headers.get("host")?.split(":", 1)[0]?.toLowerCase();
  if (!adminHost || requestHost !== adminHost) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let session;
  let config;
  try {
    config = getMultiuseConfig();
    session = readMultiuseSessionToken(request.cookies.get(PI_WEB_MULTI_SESSION_COOKIE)?.value, config);
  } catch { return NextResponse.json({ error: "Multiuser configuration is unavailable" }, { status: 503 }); }
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!isAdmin(session.identity.role)) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  const { path } = await context.params;
  const managerPath = `/admin/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
  try {
    const isReset = request.method === "POST" && path.length === 3 && path[0] === "users" && path[2] === "reset-workspace";
    if (isReset) {
      const employees = await listBpmEmployees(session.accessToken, config);
      if (!employees.some((employee) => employee.id === path[1].toLowerCase())) return NextResponse.json({ error: "Сотрудник не найден в BPM" }, { status: 404 });
    } else {
      await assertBpmAdmin(session.accessToken, config);
    }
    const response = await workerManagerRequest(managerPath, {
      method: request.method,
      signal: AbortSignal.timeout(isReset ? 120_000 : 15_000),
      body: request.method === "GET" || request.method === "HEAD" ? undefined : (path[0]?.startsWith("model") ? await boundedModelBody(request) : await request.text()),
      headers: request.headers.get("content-type") ? { "content-type": request.headers.get("content-type")! } : undefined,
    });
    return new NextResponse(response.body, { status: response.status, headers: { "content-type": response.headers.get("content-type") || "application/json", "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ModelBodyLimitError) return NextResponse.json({error:"Request too large"},{status:413});
    if (error instanceof AdminUsersError) return NextResponse.json({ error: error.status === 503 ? "BPM временно недоступен" : "Права администратора в BPM больше не действуют" }, { status: error.status });
    console.error("[multiuse-admin] manager request failed", error);
    return NextResponse.json({ error: "Административный сервис временно недоступен." }, { status: 503 });
  }
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
