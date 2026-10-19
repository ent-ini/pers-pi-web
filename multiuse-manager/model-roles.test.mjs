import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createCorporateModels } from "./corporate-models.mjs";

const provider = { api: "openai-completions", baseUrl: "https://example.com/v1", apiKey: "fixture-company-key", models: [{ id: "chat" }, { id: "cheap-naming" }, { id: "hidden", enabled: false }] };
const roles = { defaultModel: { provider: "company", modelId: "chat" }, namingModel: { provider: "company", modelId: "cheap-naming" } };

test("model roles persist atomically, reach worker snapshots and survive legacy saves", async () => {
  const root = await mkdtemp(`${tmpdir()}/company-model-roles-`);
  try {
    const store = createCorporateModels({ root, secret: "fixture-manager-secret".repeat(3) });
    let saved = await store.update({ revision: "initial", providers: { company: provider }, ...roles });
    assert.deepEqual(saved.defaultModel, roles.defaultModel);
    assert.deepEqual(saved.namingModel, roles.namingModel);
    const snapshot = await store.snapshot("11111111-1111-4111-8111-111111111111");
    assert.deepEqual(snapshot.defaultModel, { provider: "corp-company", modelId: "chat" });
    assert.deepEqual(snapshot.namingModel, { provider: "corp-company", modelId: "cheap-naming" });
    assert.deepEqual(snapshot.providers["corp-company"].models.map((model) => model.id), ["chat", "cheap-naming"]);
    // An older browser omitting the new fields must not erase configured roles.
    saved = await store.update({ revision: saved.revision, providers: saved.providers });
    assert.deepEqual(saved.namingModel, roles.namingModel);
    const before = await readFile(`${root}/models.enc`, "utf8");
    for (const invalid of [
      { ...saved, defaultModel: { provider: "company", modelId: "hidden" } },
      { ...saved, namingModel: { provider: "missing", modelId: "chat" } },
      { ...saved, providers: { company: { ...saved.providers.company, models: [{ id: "chat", enabled: false }, { id: "cheap-naming" }] } } },
    ]) {
      await assert.rejects(store.update(invalid));
      assert.equal(await readFile(`${root}/models.enc`, "utf8"), before, "rejected role edits must leave canonical bytes intact");
    }
    const cleared = await store.update({ ...saved, defaultModel: null, namingModel: null, providers: {} });
    assert.equal(cleared.defaultModel, null);
    assert.equal(cleared.namingModel, null);
  } finally { await rm(root, { recursive: true, force: true }); }
});
