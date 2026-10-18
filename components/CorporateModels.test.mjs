import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { modelsConfigApiPath } from "./models-config-api.ts";

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");

test("corporate model editor routes config, discovery, test and catalogue only to the admin scope", () => {
  for (const path of ["/api/models-config", "/api/models-config/presets", "/api/models-config/discover", "/api/models-config/test", "/api/models-config/catalog?q=some%2Fmodel"]) {
    assert.equal(modelsConfigApiPath(path, true), path.replace("/api/", "/api/multi/admin/"));
    assert.equal(modelsConfigApiPath(path, false), path);
  }
  for (const path of ["/api/auth/providers", "/api/auth/api-key/openai", "/api/models/enabled", "https://example.test/api/models-config", "/api/models-config-other"]) {
    assert.throws(() => modelsConfigApiPath(path, true));
  }
});

test("admin removes model demos and embeds the real editor with i18n", async () => {
  const [admin, page, corporate] = await Promise.all([read("./MultiuseAdmin.tsx"), read("../app/admin/page.tsx"), read("./CorporateModels.tsx")]);
  assert.doesNotMatch(admin, /initialModels|ownModelsAllowed|setModels/);
  assert.match(admin, /activeTab === "models" && <CorporateModels/);
  assert.match(page, /<I18nProvider initialLocale="ru">/);
  assert.match(corporate, /<ModelsConfig corporate embedded/);
  assert.match(corporate, /method: "PATCH"/);
  assert.match(corporate, /setAllowed\(saved\)/);
});

test("corporate save replaces submitted keys with the sanitized server response and preserves revision", async () => {
  const source = await read("./ModelsConfig.tsx");
  assert.match(source, /revision\?: string/);
  assert.match(source, /if \(corporate\) \{[\s\S]*?setConfig\(d\);\s*draft = d;/);
  assert.match(source, /useEnabledModels\(cwd, !corporate\)/);
  assert.match(source, /oauthProviders=\{corporate \? \[\]/);
  assert.match(source, /disabled=\{loading \|\| loadError !== null \|\| saving\}/);
});

test("personal editor does not mount before a successful server policy read", async () => {
  const source = await read("./PersonalModelsPolicy.tsx");
  assert.match(source, /useState<boolean \| null>\(null\)/);
  assert.match(source, /if \(allowed === true\) return children/);
  assert.match(source, /setAllowed\(null\); setError\(true\)/);
  assert.match(source, /window.addEventListener\("focus", refresh\)/);
});
