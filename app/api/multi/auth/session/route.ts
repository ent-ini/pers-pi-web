import { NextRequest, NextResponse } from "next/server";
import { createMultiuseSessionToken, PI_WEB_MULTI_SESSION_COOKIE, PI_WEB_MULTI_SESSION_MAX_AGE, readMultiuseSessionToken } from "@/lib/multiuse-auth";
import { getMultiuseConfig } from "@/lib/multiuse-config";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:"
    || request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() === "https";
}

function clearSession(response: NextResponse, request: Request): NextResponse {
  response.cookies.set({
    name: PI_WEB_MULTI_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(request),
    path: "/",
    ...(process.env.PI_WEB_MULTI_SESSION_COOKIE_DOMAIN ? { domain: process.env.PI_WEB_MULTI_SESSION_COOKIE_DOMAIN } : {}),
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  try {
    const config = getMultiuseConfig();
    const session = readMultiuseSessionToken(request.cookies.get(PI_WEB_MULTI_SESSION_COOKIE)?.value, config);
    if (!session) return clearSession(NextResponse.json({ error: "Authentication required" }, { status: 401 }), request);
    // Refresh the encrypted token on an active visit so sessions move to the
    // current one-week TTL without forcing everyone to sign in again.
    const response = NextResponse.json({ user: session.identity }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set({
      name: PI_WEB_MULTI_SESSION_COOKIE,
      value: createMultiuseSessionToken(session.accessToken, session.identity, config),
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureRequest(request),
      path: "/",
      ...(process.env.PI_WEB_MULTI_SESSION_COOKIE_DOMAIN ? { domain: process.env.PI_WEB_MULTI_SESSION_COOKIE_DOMAIN } : {}),
      maxAge: PI_WEB_MULTI_SESSION_MAX_AGE,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Multiuser configuration is unavailable" }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  return clearSession(NextResponse.json({ ok: true }), request);
}
