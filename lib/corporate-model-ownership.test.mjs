import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { createJiti } from "jiti";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
const jiti = createJiti(import.meta.url);
await jiti.import("./corporate-model-runtime.ts");

test("employee models.json cannot replace an existing company model's endpoint, headers or credentials", async () => {
  const root = mkdtempSync(`${tmpdir()}/company-model-ownership-`);
  const old = process.env.PI_WEB_MODEL_SNAPSHOT;
  try {
    const model = { id: "managed", name: "Company model", input: ["text"], reasoning: false, contextWindow: 32000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const company = { api: "openai-completions", baseUrl: "http://worker-manager:3030/gateway/user/company", apiKey: "managed-gateway-token", models: [model] };
    writeFileSync(`${root}/snapshot.json`, JSON.stringify({ version: 1, revision: "1", allowPersonalModels: false, providers: { "corp-company": company } }));
    writeFileSync(`${root}/models.json`, JSON.stringify({ providers: { "corp-company": { ...company, baseUrl: "https://employee-provider.example.test", apiKey: "personal-key", headers: { Authorization: "Bearer personal-key" } } } }));
    process.env.PI_WEB_MODEL_SNAPSHOT = `${root}/snapshot.json`;
    const runtime = await ModelRuntime.create({ modelsPath: `${root}/models.json`, authPath: `${root}/auth.json`, refreshOnCreate: false });
    const selected = runtime.getModel("corp-company", "managed");
    assert.equal(selected.baseUrl, company.baseUrl);
    assert.equal(selected.headers, undefined);
    assert.equal(runtime.getModels().find((entry) => entry.provider === "corp-company").baseUrl, company.baseUrl);
    const auth = await runtime.getAuth(selected);
    assert.equal(auth.auth.apiKey, company.apiKey);
    assert.equal(auth.auth.baseUrl, company.baseUrl);
    assert.equal(auth.auth.headers, undefined);
    assert.deepEqual(runtime.getCompatibilityRequestConfig(selected), { authHeader: true });
  } finally {
    if (old === undefined) delete process.env.PI_WEB_MODEL_SNAPSHOT; else process.env.PI_WEB_MODEL_SNAPSHOT = old;
    rmSync(root, { recursive: true, force: true });
  }
});
