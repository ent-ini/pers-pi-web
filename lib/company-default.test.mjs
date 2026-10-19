import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { resolveVisibleModels, selectInitialModelScope } = await jiti.import("./model-scope.ts");

test("company default stays visible and initializes new chats without overriding explicit picks", async () => {
  const root = mkdtempSync(`${tmpdir()}/company-default-`);
  const previous = process.env.PI_WEB_MODEL_SNAPSHOT;
  const company = { provider: "corp-company", id: "chat", name: "Company chat" };
  const personal = { provider: "personal", id: "own", name: "Personal" };
  try {
    const file = `${root}/snapshot.json`;
    writeFileSync(file, JSON.stringify({ version: 1, revision: "1", allowPersonalModels: true, defaultModel: { provider: company.provider, modelId: company.id }, providers: { "corp-company": { api: "openai-completions", baseUrl: "http://manager/gateway", apiKey: "fixture", models: [{ id: "chat" }] } } }));
    process.env.PI_WEB_MODEL_SNAPSHOT = file;
    const scope = await resolveVisibleModels({ getAvailable: async () => [personal, company] }, ["personal/own"]);
    assert.ok(scope.visible.some((model) => model === company));
    assert.equal(selectInitialModelScope(scope, { defaultModel: { provider: "personal", modelId: "own" } }).model, company);
    assert.equal(selectInitialModelScope(scope, { requestedModel: { provider: "personal", modelId: "own" } }).model, personal);
  } finally {
    if (previous === undefined) delete process.env.PI_WEB_MODEL_SNAPSHOT; else process.env.PI_WEB_MODEL_SNAPSHOT = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
