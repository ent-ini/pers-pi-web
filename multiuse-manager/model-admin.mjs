import { providerFetch } from "./provider-fetch.mjs";
import { redactJson } from "./provider-redaction.mjs";
import { gatewayCompat } from "./gateway-compat.mjs";
import {
  assertPublicTarget,
  providerHeaders,
  providerTarget,
  readJson,
} from "./model-gateway.mjs";
import {
  buildModelsListUrl,
  parseDiscoveredModels,
} from "../lib/model-discovery.ts";
import {
  flattenModelsDevCatalog,
  recommendModelCatalogPreset,
  searchModelCatalog,
} from "../lib/model-catalog.ts";
async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error();
  let n = 0;
  const parts = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > 8 * 1024 * 1024) throw new Error();
      parts.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(parts).toString());
  } finally {
    await reader.cancel();
  }
}
export async function modelAdmin(
  request,
  url,
  store,
  { fetcher = providerFetch, checkTarget = assertPublicTarget } = {},
) {
  const method = request.method,
    path = url.pathname;
  if (path === "/model-policy" && method === "GET")
    return { allowPersonalModels: (await store.read()).allowPersonalModels };
  if (path === "/admin/model-settings") {
    if (method === "GET")
      return { allowPersonalModels: (await store.read()).allowPersonalModels };
    if (method === "PATCH") return store.update(await readJson(request), true);
  }
  if (path === "/admin/models-config") {
    if (method === "GET") return store.masked(await store.read());
    if (method === "PUT") return store.update(await readJson(request));
  }
  if (path === "/admin/models-config/catalog" && method === "GET") {
    const response = await fetch("https://models.dev/api.json", {
      signal: AbortSignal.timeout(12000),
      redirect: "error",
    });
    if (!response.ok) throw new Error();
    const entries = flattenModelsDevCatalog(await boundedJson(response));
    const q = (url.searchParams.get("q") || "").slice(0, 120),
      provider = (url.searchParams.get("provider") || "").slice(0, 120);
    return {
      models: searchModelCatalog(
        entries,
        q,
        provider,
        Math.min(100, Number(url.searchParams.get("limit")) || 50),
      ),
      recommendation: recommendModelCatalogPreset(
        entries,
        q,
        provider,
        (url.searchParams.get("baseUrl") || "").slice(0, 500),
      ),
      source: "https://models.dev/api.json",
    };
  }
  if (
    ["/admin/models-config/discover", "/admin/models-config/test"].includes(
      path,
    ) &&
    method === "POST"
  ) {
    const body = await readJson(request);
    if (
      typeof body.providerName !== "string" ||
      !body.provider ||
      typeof body.provider !== "object"
    )
      throw new Error();
    const testing = path.endsWith("/test");
    const provider = {
      ...body.provider,
      models: testing ? [body.model] : body.provider.models || [],
    };
    const p = (await store.resolve({ [body.providerName]: provider }))[
      body.providerName
    ];
    let target, payload;
    if (!testing) target = buildModelsListUrl(p.baseUrl, p.api);
    else {
      const id = body.model.id;
      const prompt = "Reply with OK only.";
      const op = {
        "openai-completions": "chat/completions",
        "openai-responses": "responses",
        "anthropic-messages": "v1/messages",
        "google-generative-ai": `v1beta/models/${id}:generateContent`,
      }[p.api];
      target = providerTarget(p, op);
      payload =
        p.api === "google-generative-ai"
          ? {
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: 16 },
            }
          : p.api === "openai-responses"
            ? { model: id, input: prompt, max_output_tokens: 16, store: false }
            : {
                model: id,
                messages: [{ role: "user", content: prompt }],
                [p.api === "openai-completions" ? gatewayCompat(body.providerName, p, p.models[0]).maxTokensField : "max_tokens"]: 16,
              };
    }
    await checkTarget(target);
    const started = Date.now();
    const response = await fetcher(target, {
      method: testing ? "POST" : "GET",
      headers: providerHeaders(p, testing ? p.models[0] : undefined),
      body: payload ? JSON.stringify(payload) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return testing
        ? {
            ok: false,
            status: response.status,
            error: "Provider request failed",
          }
        : { error: "Provider request failed", status: response.status };
    }
    const result = await boundedJson(response);
    if (result?.error) return { ok: false, error: "Provider request failed", status: response.status };
    // No upstream text/errors returned by testing; discovery is metadata only, scrub all saved credentials first.
    if (testing)
      return {
        ok: true,
        status: response.status,
        latencyMs: Date.now() - started,
        responseText: "Connection successful",
      };
    const safe = redactJson(
      result,
      [p.apiKey, ...Object.values(p.headers || {})].filter(Boolean),
    );
    return {
      models: parseDiscoveredModels(safe).slice(0, 1000),
      endpoint: target.toString(),
    };
  }
  return undefined;
}
