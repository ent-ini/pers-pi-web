import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createCorporateModels } from "./corporate-models.mjs";
import { gateway } from "./model-gateway.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const provider = { api: "openai-completions", baseUrl: "https://api.deepseek.com", apiKey: "synthetic-company-credential", models: [{ id: "deepseek-chat" }] };

test("changing personal policy does not invalidate the separate corporate-model draft", async () => {
  const root = await mkdtemp(`${tmpdir()}/models-policy-draft-`);
  try {
    const store = createCorporateModels({ root, secret: "fixture-secret".repeat(4) });
    const draft = await store.update({ revision: "initial", providers: { company: provider } });
    const before = await store.snapshot(id);
    await store.update({ allowPersonalModels: false }, true);
    assert.notEqual((await store.snapshot(id)).revision, before.revision, "runtime policy generation must advance");
    const saved = await store.update({ ...draft, providers: { renamed: draft.providers.company } });
    assert.equal((await store.read()).allowPersonalModels, false);
    assert.ok(saved.providers.renamed.apiKey.startsWith("retain:"));
    await assert.rejects(store.update(draft), (error) => error.status === 409, "real stale model drafts still conflict");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("gateway preserves valid JSON and redacts escaped or cross-event text credential echoes", async () => {
  const secret = provider.apiKey;
  const p = { ...provider, headers: { "x-version": "1" } };
  const fragments = [secret.slice(0, 12), secret.slice(12)];
  const responses = [
    new Response(JSON.stringify({ usage: { total_tokens: 1 }, content: `echo ${secret}` }).replace(secret, [...secret].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join(""))),
    new Response(fragments.map((content) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`).join("") + 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":1}}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } }),
  ];
  const server = createServer((request, response) => gateway(request, response, new URL(request.url, "http://fixture"), { authenticate: () => true, read: async () => ({ providers: { company: p } }) }, { checkTarget: async () => {}, fetcher: async () => responses.shift() }));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const send = () => fetch(`http://127.0.0.1:${server.address().port}/gateway/${id}/company/chat/completions`, { method: "POST", headers: { authorization: "Bearer fixture" }, body: JSON.stringify({ model: "deepseek-chat" }) });
    const body = await (await send()).json();
    assert.equal(body.usage.total_tokens, 1, "numeric header value must not corrupt numeric JSON fields");
    assert.ok(!body.content.includes(secret), "JSON escaping must not bypass redaction");
    const sse = await (await send()).text();
    let text = "";
    for (const frame of sse.trim().split(/\r?\n\r?\n/)) {
      const data = frame.split(/\r?\n/).find((line) => line.startsWith("data:"))?.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      const event = JSON.parse(data);
      text += event.choices?.[0]?.delta?.content || "";
      if (event.usage) assert.equal(event.usage.total_tokens, 1);
    }
    assert.ok(!text.includes(secret), "joining streamed content must not reconstruct the shared key");
    assert.ok(text.includes("[redacted]"));
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

test("compressed upstream reset rejects only that response rather than killing the manager", () => {
  const code = `
    import assert from 'node:assert/strict';
    import https from 'node:https';
    import { syncBuiltinESMExports } from 'node:module';
    import { PassThrough } from 'node:stream';
    import { providerFetch } from './multiuse-manager/provider-fetch.mjs';
    const upstream = new PassThrough();
    upstream.headers = {'content-encoding':'gzip'}; upstream.statusCode = 200;
    https.request = (_url, _options, callback) => { queueMicrotask(() => callback(upstream)); return new PassThrough(); };
    syncBuiltinESMExports();
    const response = await providerFetch('https://1.1.1.1/');
    const rejected = assert.rejects(response.text(), /fixture upstream reset|terminated|aborted/);
    upstream.destroy(new Error('fixture upstream reset'));
    await rejected;
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
});

test("DeepSeek's inferred upstream compatibility survives the company's gateway address", async () => {
  const root = await mkdtemp(`${tmpdir()}/models-gateway-compat-`);
  const store = createCorporateModels({ root, secret: "fixture-secret".repeat(4) });
  let payload;
  const server = createServer((request, response) => gateway(request, response, new URL(request.url, "http://fixture"), store, { checkTarget: async () => {}, fetcher: async (_url, options) => { payload = JSON.parse(options.body); return new Response("denied", { status: 401 }); } }));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    await store.update({ revision: "initial", providers: { deepseek: provider } });
    const snapshot = await store.snapshot(id);
    const p = snapshot.providers["corp-deepseek"];
    p.baseUrl = `http://127.0.0.1:${server.address().port}/gateway/${id}/deepseek`;
    const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
    runtime.registerProvider("corp-deepseek", p);
    await runtime.completeSimple(runtime.getModel("corp-deepseek", "deepseek-chat"), { messages: [{ role: "user", content: "fixture", timestamp: 0 }] }, { maxTokens: 16, maxRetries: 0 });
    assert.ok(payload, "real SDK request must reach the gateway");
    assert.equal(payload.max_tokens, 16, "gateway address must not change DeepSeek's max token field");
    assert.equal(payload.max_completion_tokens, undefined);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
});
