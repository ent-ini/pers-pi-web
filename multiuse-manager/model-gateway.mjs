import { providerFetch } from "./provider-fetch.mjs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { redactProviderBody } from "./provider-redaction.mjs";
export async function readJson(request, limit = 1048576) {
  let size = 0;
  const parts = [];
  for await (const part of request) {
    size += part.length;
    if (size > limit)
      throw Object.assign(new Error("Request too large"), { status: 413 });
    parts.push(part);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString() || "{}");
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}
export function publicAddress(address) {
  if (isIP(address) === 6) return !/^(::|fc|fd|fe80|ff)/i.test(address);
  const n = address.split(".").map(Number);
  return (
    n.length === 4 &&
    ![0, 10, 127].includes(n[0]) &&
    n[0] < 224 &&
    !(n[0] === 169 && n[1] === 254) &&
    !(n[0] === 172 && n[1] >= 16 && n[1] <= 31) &&
    !(n[0] === 192 && n[1] === 168) &&
    !(n[0] === 100 && n[1] >= 64 && n[1] <= 127)
  );
}
export async function assertPublicTarget(url) {
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new Error("Invalid provider target");
}
export function providerHeaders(p, m, incoming = {}) {
  const h = new Headers({ ...p.headers, ...m?.headers });
  // SDK capability/cache headers carry no provider credentials. Forward only
  // this small allowlist; company-configured values always take precedence.
  for (const name of [
    "anthropic-beta",
    "anthropic-version",
    "openai-beta",
    "x-session-id",
    "x-session-affinity",
    "session_id",
    "x-client-request-id",
  ]) {
    const value = incoming[name];
    if (
      !h.has(name) &&
      typeof value === "string" &&
      value.length <= 2048 &&
      !/[\r\n\0]/.test(value)
    )
      h.set(name, value);
  }
  h.set("content-type", "application/json");
  h.set("accept-encoding", "identity");
  if (p.api === "anthropic-messages") {
    if (p.apiKey) h.set("x-api-key", p.apiKey);
    if (!h.has("anthropic-version")) h.set("anthropic-version", "2023-06-01");
  } else if (p.api === "google-generative-ai") {
    if (p.apiKey) h.set("x-goog-api-key", p.apiKey);
  } else if (p.apiKey) h.set("authorization", `Bearer ${p.apiKey}`);
  return h;
}
export function gatewayOperation(p, operation, query, payload) {
  const expected = {
    "openai-completions": "chat/completions",
    "openai-responses": "responses",
    "anthropic-messages": "v1/messages",
  }[p.api];
  let id = payload.model;
  if (p.api === "google-generative-ai") {
    const match =
      /^(?:v1beta\/)?models\/(.+):(generateContent|streamGenerateContent)$/.exec(
        operation,
      );
    if (!match) throw new Error("Operation denied");
    id = match[1];
    if (
      query &&
      !(match[2] === "streamGenerateContent" && query === "?alt=sse")
    )
      throw new Error("Query denied");
  } else if (
    operation !== expected ||
    (query && !(p.api === "anthropic-messages" && query === "?beta=true"))
  )
    throw new Error("Operation denied");
  const model = p.models.find((m) => m.id === id && m.enabled !== false);
  if (p.enabled === false || !model) throw new Error("Model denied");
  // Never forward worker credentials or transport overrides.
  for (const k of [
    "apiKey",
    "api_key",
    "authorization",
    "headers",
    "baseUrl",
    "base_url",
    "url",
    "endpoint",
  ])
    if (k in payload) throw new Error("Credential override denied");
  if (payload.background || payload.store === true || payload.fallbacks)
    throw new Error("Deferred or fallback operation denied");
  return model;
}
export function providerTarget(p, operation, query = "") {
  let base = p.baseUrl.replace(/\/$/, "");
  if (p.api === "anthropic-messages" && base.endsWith("/v1"))
    base = base.slice(0, -3);
  if (p.api === "google-generative-ai") {
    if (!/\/v\d+(?:beta)?$/.test(base)) base += "/v1beta";
    operation = operation.replace(/^v1beta\//, "");
  }
  return new URL(`${base}/${operation}${query}`);
}
export async function gateway(
  request,
  response,
  url,
  store,
  { fetcher = providerFetch, checkTarget = assertPublicTarget } = {},
) {
  const deny = (status, message) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: message }));
  };
  try {
    const policy = /^\/gateway\/([0-9a-f-]{36})\/policy$/.exec(url.pathname);
    if (policy && request.method === "GET" && !url.search) {
      if (
        !store.authenticate(
          policy[1],
          request.headers.authorization?.replace(/^Bearer /, ""),
        )
      )
        return deny(401, "Invalid gateway token");
      const state = await store.read();
      response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(
        JSON.stringify({
          allowPersonalModels: state.allowPersonalModels,
          revision: state.revision,
          models: Object.fromEntries(
            Object.entries(state.providers)
              .filter(([, p]) => p.enabled !== false)
              .map(([id, p]) => [
                `corp-${id}`,
                p.models.filter((m) => m.enabled !== false).map((m) => m.id),
              ]),
          ),
        }),
      );
      return;
    }
    const match = /^\/gateway\/([0-9a-f-]{36})\/([a-z0-9_-]+)\/(.+)$/.exec(
      url.pathname,
    );
    if (request.method !== "POST" || !match)
      return deny(403, "Gateway operation denied");
    const [, id, pid, operation] = match;
    const supplied =
      request.headers.authorization?.replace(/^Bearer /, "") ||
      request.headers["x-api-key"] ||
      request.headers["x-goog-api-key"];
    if (!store.authenticate(id, supplied))
      return deny(401, "Invalid gateway token");
    const s = await store.read(),
      p = s.providers[pid];
    if (!p) return deny(403, "Provider denied");
    const payload = await readJson(request, 32 * 1024 * 1024);
    const m = gatewayOperation(p, operation, url.search, payload);
    const target = providerTarget(p, operation, url.search);
    await checkTarget(target);
    const abort = new AbortController();
    response.on("close", () => abort.abort());
    const upstream = await fetcher(target, {
      method: "POST",
      headers: providerHeaders(p, m, request.headers),
      body: JSON.stringify(payload),
      redirect: "manual",
      signal: abort.signal,
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return deny(502, "Provider request failed");
    }
    response.writeHead(200, {
      "content-type": upstream.headers
        .get("content-type")
        ?.startsWith("text/event-stream")
        ? "text/event-stream"
        : "application/json",
      "cache-control": "no-store",
    });
    // Decode JSON before redaction, retain SSE framing/order, and hold
    // possible credential prefixes across content deltas. Raw replacement
    // corrupts numeric JSON and misses escaped/cross-event credentials.
    const secrets = [
      p.apiKey,
      ...Object.values(p.headers || {}),
      ...Object.values(m.headers || {}),
    ];
    const sse = upstream.headers
      .get("content-type")
      ?.startsWith("text/event-stream");
    for await (const out of redactProviderBody(upstream.body, secrets, sse)) {
      if (response.destroyed) break;
      if (out && !response.write(out))
        await new Promise((resolve, reject) => {
          const cleanup = () => {
            response.off("drain", done);
            response.off("close", closed);
          };
          const done = () => {
            cleanup();
            resolve();
          };
          const closed = () => {
            cleanup();
            reject(new Error("Client closed"));
          };
          response.once("drain", done);
          response.once("close", closed);
        });
    }
    response.end();
  } catch {
    if (response.headersSent) response.destroy();
    else deny(403, "Gateway request denied");
  }
}
