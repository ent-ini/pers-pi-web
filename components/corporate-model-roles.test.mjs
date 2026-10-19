import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { corporateModelDraftError, retargetCorporateModelRoles } = await createJiti(import.meta.url).import("./models-config-api.ts");

test("explicit provider/model renames retarget both roles, including IDs with slashes", () => {
  const draft = { defaultModel: { provider: "company", modelId: "vendor/chat" }, namingModel: { provider: "company", modelId: "vendor/name" } };
  const renamed = retargetCorporateModelRoles(draft, { provider: "company" }, { provider: "renamed" });
  assert.equal(renamed.defaultModel.provider, "renamed");
  assert.equal(renamed.namingModel.provider, "renamed");
  const model = retargetCorporateModelRoles(renamed, { provider: "renamed", modelId: "vendor/chat" }, { provider: "renamed", modelId: "another/chat" });
  assert.equal(model.defaultModel.modelId, "another/chat");
  assert.equal(model.namingModel.modelId, "vendor/name");
  assert.equal(draft.defaultModel.provider, "company");
});

test("draft visibility changes require role reassignment or explicit clearing", () => {
  const providers = { company: { baseUrl: "https://example.com/v1", models: [{ id: "chat", enabled: false }] } };
  assert.match(corporateModelDraftError(providers, { defaultModel: { provider: "company", modelId: "chat" } }), /по умолчанию недоступна/);
  assert.equal(corporateModelDraftError(providers, { defaultModel: null, namingModel: null }), null);
});
