import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { shouldUseVisualViewportHeight } = await jiti.import("./useViewportHeight.ts");

test("uses the visual viewport for a focused editor when the keyboard shrinks it", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    restingViewportHeight: 844,
    viewportHeight: 510,
    viewportScale: 1,
  }), true);
});

test("does not keep the keyboard height after the visual viewport restores", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    restingViewportHeight: 844,
    viewportHeight: 844,
    viewportScale: 1,
  }), false);
});

test("restores the dynamic height as soon as the editor loses focus", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: false,
    innerHeight: 844,
    restingViewportHeight: 844,
    viewportHeight: 510,
    viewportScale: 1,
  }), false);
});

test("uses the resting viewport when iOS resizes innerHeight with the keyboard", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 510,
    restingViewportHeight: 844,
    viewportHeight: 510,
    viewportScale: 1,
  }), true);
});

test("does not mistake pinch zoom for an open keyboard", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    restingViewportHeight: 844,
    viewportHeight: 422,
    viewportScale: 2,
  }), false);
});

test("does not use the dynamic height for an ordinary focused editor", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    restingViewportHeight: 844,
    viewportHeight: 844,
    viewportScale: 1,
  }), false);
});
