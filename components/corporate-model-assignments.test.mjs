import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  assignmentOptions,
  assignmentRefValue,
  assignmentsError,
  assignmentsPayload,
  parseAssignmentValue,
} = await jiti.import("./../lib/corporate-model-assignments.ts");

const providers = {
  minimax: {
    enabled: true,
    baseUrl: "https://api.minimax.io/anthropic",
    models: [
      { id: "MiniMax-M3", name: "MiniMax-M3" },
      { id: "MiniMax-M2.7", name: "MiniMax-M2.7", enabled: false },
    ],
  },
  other: { enabled: false, models: [{ id: "chat", name: "Chat" }] },
};

test("a role value round-trips through the select's JSON form", () => {
  const value = assignmentRefValue({ provider: "minimax", modelId: "MiniMax-M3" });
  assert.deepEqual(parseAssignmentValue(value), { provider: "minimax", modelId: "MiniMax-M3" });
  assert.equal(parseAssignmentValue(""), null);
  assert.equal(parseAssignmentValue("not json"), null);
  assert.equal(parseAssignmentValue('{"provider":"x"}'), null);
});

test("the option list shows every model with its provider and marks the unavailable ones", () => {
  const options = assignmentOptions(providers);
  assert.deepEqual(options.map((option) => option.label), [
    "MiniMax-M3 · minimax",
    "MiniMax-M2.7 · minimax",
    "Chat · other",
  ]);
  assert.deepEqual(options.map((option) => option.disabled), [false, true, true]);
});

test("a role must point at an enabled model of an enabled provider", () => {
  assert.equal(assignmentsError(providers, { defaultModel: { provider: "minimax", modelId: "MiniMax-M3" } }), null);
  assert.match(
    assignmentsError(providers, { defaultModel: { provider: "minimax", modelId: "MiniMax-M2.7" } }),
    /Модель по умолчанию недоступна/,
  );
  assert.match(
    assignmentsError(providers, { namingModel: { provider: "other", modelId: "chat" } }),
    /Модель для названий недоступна/,
  );
  assert.match(
    assignmentsError(providers, { defaultModel: { provider: "gone", modelId: "chat" } }),
    /Модель по умолчанию недоступна/,
  );
  assert.equal(assignmentsError(providers, { defaultModel: null, namingModel: null }), null);
});

test("the save payload keeps the providers and the revision it was read with", () => {
  const payload = assignmentsPayload(
    { providers, revision: "rev-1" },
    { defaultModel: { provider: "minimax", modelId: "MiniMax-M3" }, namingModel: null },
  );
  assert.equal(payload.revision, "rev-1");
  assert.deepEqual(payload.providers, providers);
  assert.deepEqual(payload.defaultModel, { provider: "minimax", modelId: "MiniMax-M3" });
  assert.equal(payload.namingModel, null);
});

test("the admin mounts the assignments block and the model editor no longer renders its own roles", async () => {
  const admin = await readFile(new URL("./CorporateModels.tsx", import.meta.url), "utf8");
  const block = await readFile(new URL("./CorporateModelAssignments.tsx", import.meta.url), "utf8");
  const editor = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");

  // One visible place for the roles: the admin's own block.
  assert.match(admin, /<CorporateModelAssignments \/>/);
  assert.doesNotMatch(editor, /<CorporateModelRoles/);
  assert.doesNotMatch(editor, /function CorporateModelRoles\(/);

  // The block talks to the multi admin API, not to the personal one.
  assert.match(block, /\/api\/multi\/admin\/models-config/);
  assert.match(block, /Сохранить назначения/);
  assert.match(block, /Модель по умолчанию/);
  assert.match(block, /Модель для названий/);

  // The editor still carries the roles in its draft: a provider or model
  // rename has to retarget them, or the stored assignment breaks.
  assert.match(editor, /retargetCorporateModelRoles/);
});
