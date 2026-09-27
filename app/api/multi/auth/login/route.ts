import { NextRequest, NextResponse } from "next/server";
import { getAuthRetryAfterMs, recordAuthFailure, recordAuthSuccess, retryAfterSeconds } from "@/lib/auth-throttle";
import { BpmLoginError, loginWithBpm } from "@/lib/multiuse-bpm-client";
import { createMultiuseSessionToken, PI_WEB_MULTI_SESSION_COOKIE, PI_WEB_MULTI_SESSION_MAX_AGE } from "@/lib/multiuse-auth";
import { getMultiuseConfig } from "@/lib/multiuse-config";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { ensureWorker } from "@/lib/worker-manager";

export const dynamic = "force-dynamic";

function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:"
    || request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() === "https";
}

function throttled(retryAfterMs: number): NextResponse {
  return NextResponse.json(
    { error: "Попробуйте снова позже.", retryAfterMs },
    { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfterSeconds(retryAfterMs)) } },
  );
}

export async function POST(request: NextRequest) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });

  const retryAfterMs = getAuthRetryAfterMs();
  if (retryAfterMs > 0) return throttled(retryAfterMs);

  const body = await request.json().catch(() => null) as { email?: unknown; password?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || email.length > 320 || !password || password.length > 4_096) {
    const delay = recordAuthFailure();
    return NextResponse.json({ error: "Неверный email или пароль.", retryAfterMs: delay }, { status: 401, headers: { "Retry-After": String(retryAfterSeconds(delay)) } });
  }

  try {
    const config = getMultiuseConfig();
    const result = await loginWithBpm({ email, password }, config);
    // Do not issue a session that lands on an unusable placeholder: provisioning
    // is idempotent and starts (or resumes) this employee's isolated worker.
    await ensureWorker(result.identity);
    recordAuthSuccess();
    const response = NextResponse.json({ user: result.identity }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set({
      name: PI_WEB_MULTI_SESSION_COOKIE,
      value: createMultiuseSessionToken(result.accessToken, result.identity, config),
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureRequest(request),
      path: "/",
      maxAge: PI_WEB_MULTI_SESSION_MAX_AGE,
    });
    return response;
  } catch (error) {
    if (error instanceof BpmLoginError && error.reason === "invalid-credentials") {
      const delay = recordAuthFailure();
      return NextResponse.json({ error: "Неверный email или пароль.", retryAfterMs: delay }, { status: 401, headers: { "Retry-After": String(retryAfterSeconds(delay)) } });
    }
    if (error instanceof BpmLoginError && error.reason === "invalid-identity") {
      return NextResponse.json({ error: "Доступ к ИИ-помощнику для этого сотрудника недоступен." }, { status: 403 });
    }
    console.error("[multiuse-auth] login or worker provisioning failed", error);
    return NextResponse.json({ error: "Не удалось подготовить рабочее пространство. Попробуйте позже." }, { status: 503 });
  }
}
