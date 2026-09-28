import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { getMultiuseConfig } = await createJiti(import.meta.url).import("./multiuse-config.ts");

const valid = {
  PI_WEB_BPM_API_URL: "https://bpm.buhgalterboutique.ru",
  PI_WEB_MULTI_SESSION_SECRET: "a".repeat(32),
};

test("reads the required multiuser configuration", () => {
  assert.deepEqual(getMultiuseConfig(valid), {
    bpmApiUrl: "https://bpm.buhgalterboutique.ru",
    sessionSecret: "a".repeat(32),
  });
});

test("refuses incomplete and unsafe BPM configuration", () => {
  assert.throws(() => getMultiuseConfig({}), /PI_WEB_MULTI_SESSION_SECRET/);
  assert.throws(() => getMultiuseConfig({ ...valid, PI_WEB_MULTI_SESSION_SECRET: "short" }), /at least 32/);
  assert.throws(() => getMultiuseConfig({ ...valid, PI_WEB_BPM_API_URL: "https://bpm.example/api" }), /origin/);
  assert.throws(() => getMultiuseConfig({ ...valid, PI_WEB_BPM_API_URL: "file:///etc/passwd" }), /HTTP/);
});
