import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { resolvePiWebRuntimeMode, isMultiuseMode } = await createJiti(import.meta.url)
  .import("./runtime-mode.ts");

test("single is the backwards-compatible runtime-mode default", () => {
  assert.equal(resolvePiWebRuntimeMode(undefined), "single");
  assert.equal(isMultiuseMode(undefined), false);
});

test("accepts multi mode case-insensitively", () => {
  assert.equal(resolvePiWebRuntimeMode(" MULTI "), "multi");
  assert.equal(isMultiuseMode("multi"), true);
});

test("refuses an unknown operating mode", () => {
  assert.throws(() => resolvePiWebRuntimeMode("shared"), /single.*multi/);
});
