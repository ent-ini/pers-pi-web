import { NextRequest, NextResponse } from "next/server";
import { PI_WEB_MULTI_SESSION_COOKIE, readMultiuseSessionToken } from "@/lib/multiuse-auth";
import { getMultiuseConfig } from "@/lib/multiuse-config";
import { workerManagerRequest } from "@/lib/worker-manager";

export const dynamic = "force-dynamic";

function isAdmin(role: string): boolean {
  return role === "admin" || role === "tech";
}

async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const adminHost = process.env.PI_WEB_ADMIN_HOST?.trim().toLowerCase();
  const requestHost = request.headers.get("host")?.split(":", 1)[0]?.toLowerCase();
  if (adminHost && requestHost !== adminHost) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let session;
  try {
    session = readMultiuseSessionToken(request.cookies.get(PI_WEB_MULTI_SESSION_COOKIE)?.value, getMultiuseConfig());
  } catch { return NextResponse.json({ error: "Multiuser configuration is unavailable" }, { status: 503 }); }
  if (!session || !isAdmin(session.identity.role)) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  const { path } = await context.params;
  const managerPath = `/admin/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
  try {
    const response = await workerManagerRequest(managerPath, {
      method: request.method,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
      headers: request.headers.get("content-type") ? { "content-type": request.headers.get("content-type")! } : undefined,
    });
    return new NextResponse(response.body, { status: response.status, headers: { "content-type": response.headers.get("content-type") || "application/json", "cache-control": "no-store" } });
  } catch (error) {
    console.error("[multiuse-admin] manager request failed", error);
    return NextResponse.json({ error: "Административный сервис временно недоступен." }, { status: 503 });
  }
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const DELETE = forward;
