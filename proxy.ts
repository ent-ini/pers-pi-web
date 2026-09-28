import { NextResponse, type NextRequest } from "next/server";
import {
  getAuthRetryAfterMs,
  recordAuthFailure,
  retryAfterSeconds,
} from "@/lib/auth-throttle";
import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
} from "@/lib/request-security";
import {
  isValidWebSessionToken,
  isValidBasicAuthorization,
  isWebPasswordEnabled,
  PI_WEB_SESSION_COOKIE,
} from "@/lib/web-auth";
import { PI_WEB_MULTI_SESSION_COOKIE, readMultiuseSessionToken } from "@/lib/multiuse-auth";
import { getMultiuseConfig } from "@/lib/multiuse-config";
import { isMultiuseMode } from "@/lib/runtime-mode";

function tooManyAttempts(retryAfterMs: number): NextResponse {
  return new NextResponse("Too many failed attempts", {
    status: 429,
    headers: {
      "Cache-Control": "no-store",
      "Retry-After": String(retryAfterSeconds(retryAfterMs)),
    },
  });
}

export function proxy(request: NextRequest) {
  const isApiRequest = request.nextUrl.pathname === "/api"
    || request.nextUrl.pathname.startsWith("/api/");
  const isTrustedRequest = isApiRequest
    ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);

  if (!isTrustedRequest) {
    if (!isApiRequest) {
      return new NextResponse("Untrusted request", { status: 403 });
    }
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  if (isMultiuseMode()) {
    const adminHost = process.env.PI_WEB_ADMIN_HOST?.trim().toLowerCase();
    const requestHost = request.headers.get("host")?.split(":", 1)[0]?.toLowerCase();
    const isAdminOrigin = Boolean(adminHost && requestHost === adminHost);
    if (!isAdminOrigin && request.nextUrl.pathname === "/admin") {
      return new NextResponse("Not found", { status: 404 });
    }
    if (isAdminOrigin && request.nextUrl.pathname === "/") {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    let authenticated = false;
    try {
      authenticated = Boolean(readMultiuseSessionToken(
        request.cookies.get(PI_WEB_MULTI_SESSION_COOKIE)?.value,
        getMultiuseConfig(),
      ));
    } catch {
      return new NextResponse("Multiuser configuration is unavailable", { status: 503 });
    }

    const isLoginEndpoint = request.nextUrl.pathname === "/api/multi/auth/login";
    const isSessionEndpoint = request.nextUrl.pathname === "/api/multi/auth/session";
    if (request.nextUrl.pathname === "/login") {
      return authenticated
        ? NextResponse.redirect(new URL("/", request.url))
        : NextResponse.next();
    }
    // The session route itself decides whether its response is 401 or exposes
    // the non-secret identity. It also clears an invalid cookie on GET.
    if (isLoginEndpoint || isSessionEndpoint) return NextResponse.next();
    if (!authenticated) {
      if (!isApiRequest) {
        const loginUrl = new URL("/login", request.url);
        if (request.nextUrl.search) loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
        return NextResponse.redirect(loginUrl);
      }
      return new NextResponse("Authentication required", { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    // A browser retains the normal pi-web API shape, but every legacy request
    // is rewritten to a server-side proxy for *this* employee's worker. The
    // control-plane process never reads its own Pi data for corporate users.
    if (isApiRequest && !request.nextUrl.pathname.startsWith("/api/multi/")) {
      const path = request.nextUrl.pathname.slice("/api/".length);
      const workerSession = readMultiuseSessionToken(
        request.cookies.get(PI_WEB_MULTI_SESSION_COOKIE)?.value,
        getMultiuseConfig(),
      );
      // authenticated above guarantees a valid token; preserve the guard so a
      // future change cannot accidentally turn this into an unauthenticated rewrite.
      if (!workerSession) return new NextResponse("Authentication required", { status: 401 });
      const target = new URL(`/api/multi/worker/${encodeURIComponent(workerSession.identity.id)}/${path}`, request.url);
      target.search = request.nextUrl.search;
      return NextResponse.rewrite(target);
    }
    return NextResponse.next();
  }

  const password = process.env.PI_WEB_PASSWORD;
  if (!isWebPasswordEnabled(password)) {
    if (request.nextUrl.pathname === "/login") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  let authenticated = isValidWebSessionToken(request.cookies.get(PI_WEB_SESSION_COOKIE)?.value, password);
  const authorization = isApiRequest ? request.headers.get("authorization") : null;
  if (!authenticated && authorization && /^Basic\s/i.test(authorization)) {
    // Every Basic header is a password guess, so it shares the login form's
    // throttle; otherwise any API path (or GET /api/web-auth) answers guesses
    // at full speed. While blocked even the right password is refused, or the
    // answer would leak. A success does not reset the counter: Basic clients
    // authenticate on every request, and each reset would hand an interleaved
    // guesser a fresh short block.
    const retryAfterMs = getAuthRetryAfterMs();
    if (retryAfterMs > 0) return tooManyAttempts(retryAfterMs);
    authenticated = isValidBasicAuthorization(authorization, password);
    if (!authenticated) recordAuthFailure();
  }
  if (request.nextUrl.pathname === "/login") {
    return authenticated
      ? NextResponse.redirect(new URL("/", request.url))
      : NextResponse.next();
  }
  if (request.nextUrl.pathname === "/api/web-auth") return NextResponse.next();

  if (!authenticated) {
    if (!isApiRequest) {
      const loginUrl = new URL("/login", request.url);
      if (request.nextUrl.search) {
        loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
      }
      return NextResponse.redirect(loginUrl);
    }
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Basic realm="Pi Web", charset="UTF-8"',
      },
    });
  }

  return NextResponse.next();
}

export const config = { matcher: ["/", "/login", "/admin/:path*", "/api/:path*"] };
