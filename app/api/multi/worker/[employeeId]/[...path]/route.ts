import { NextRequest, NextResponse } from "next/server";
import { readMultiuseSessionToken, PI_WEB_MULTI_SESSION_COOKIE } from "@/lib/multiuse-auth";
import { getMultiuseConfig } from "@/lib/multiuse-config";
import { ensureWorker } from "@/lib/worker-manager";

export const dynamic = "force-dynamic";

const HOP_BY_HOP_HEADERS = new Set(["connection", "content-length", "cookie", "host", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

function sessionFor(request: NextRequest) {
  return readMultiuseSessionToken(
    request.cookies.get(PI_WEB_MULTI_SESSION_COOKIE)?.value,
    getMultiuseConfig(),
  );
}

function requestHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (!HOP_BY_HOP_HEADERS.has(lower) && !lower.startsWith("x-forwarded-") && lower !== "x-real-ip" && lower !== "authorization") {
      headers.set(key, value);
    }
  });
  return headers;
}

function responseHeaders(response: Response): Headers {
  const headers = new Headers();
  response.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    // A worker never gets to set cookies on the corporate origin.
    if (!HOP_BY_HOP_HEADERS.has(lower) && lower !== "set-cookie") headers.set(key, value);
  });
  return headers;
}

async function forward(request: NextRequest, context: { params: Promise<{ employeeId: string; path: string[] }> }) {
  const { employeeId, path } = await context.params;
  let session;
  try {
    session = sessionFor(request);
  } catch {
    return NextResponse.json({ error: "Multiuser configuration is unavailable" }, { status: 503 });
  }
  if (!session || session.identity.id !== employeeId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const workerUrl = await ensureWorker(session.identity);
    const upstream = await fetch(new URL(`/api/${path.map(encodeURIComponent).join("/")}`, workerUrl), {
      method: request.method,
      headers: requestHeaders(request),
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      // Node's fetch requires this for a streamed Next.js request body.
      // @ts-expect-error duplex is implemented by Node's fetch.
      duplex: "half",
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
    return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders(upstream) });
  } catch (error) {
    console.error("[multiuse-worker] proxy failed", error);
    return NextResponse.json({ error: "Рабочее пространство временно недоступно. Попробуйте ещё раз." }, { status: 503 });
  }
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
