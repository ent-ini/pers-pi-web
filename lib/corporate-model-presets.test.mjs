import assert from "node:assert/strict";
import test from "node:test";
import { corporateModelPresets } from "./corporate-model-presets.ts";
import { validateProviders } from "../multiuse-manager/corporate-models.mjs";

test("company presets reuse the pinned SDK catalogue without credentials or OAuth providers", () => {
  const presets = corporateModelPresets();
  for (const id of ["openai", "anthropic", "google", "minimax", "minimax-cn", "deepseek"]) {
    const preset = presets.find((entry) => entry.id === id);
    assert.ok(preset, id);
    assert.ok(preset.provider.models.length > 0);
  }
  assert.equal(new Set(presets.map((entry) => entry.id)).size, presets.length);
  assert.ok(!presets.some((entry) => entry.id.startsWith("github-copilot")));
  for (const { id, provider } of presets) {
    assert.doesNotThrow(() => validateProviders({ [id]: provider }), `${id} must be saveable by the real manager schema`);
    assert.ok(provider.models.length <= 200);
    assert.ok(provider.baseUrl.startsWith("https://") && !/[{}$]/.test(provider.baseUrl));
    assert.equal(provider.apiKey, undefined);
    assert.equal(provider.headers, undefined);
    for (const model of provider.models) {
      assert.equal(model.headers, undefined);
      assert.ok(model.id && model.name);
    }
  }
});
