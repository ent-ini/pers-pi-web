import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const testDir = await mkdtemp(join(tmpdir(), "pi-web-file-explorer-pins-"));
const jiti = createJiti(import.meta.url);
const { createFileExplorerPinsStore } = await jiti.import("./file-explorer-pins.ts");

after(async () => {
  await rm(testDir, { recursive: true, force: true });
});

test("file explorer pin store persists the chosen order", () => {
  const store = createFileExplorerPinsStore(join(testDir, "pins.sqlite"));
  try {
    assert.deepEqual(store.list("/workspace"), []);
    assert.deepEqual(
      store.replace("/workspace", ["docs", "README.md", "src"]),
      ["docs", "README.md", "src"],
    );
    assert.deepEqual(store.list("/workspace"), ["docs", "README.md", "src"]);
  } finally {
    store.close();
  }
});

test("pin order is scoped to a workspace and user", () => {
  const store = createFileExplorerPinsStore(join(testDir, "scoped.sqlite"));
  try {
    store.replace("/workspace-a", ["one"], "artemiy");
    store.replace("/workspace-b", ["two"], "artemiy");
    store.replace("/workspace-a", ["three"], "another-user");

    assert.deepEqual(store.list("/workspace-a", "artemiy"), ["one"]);
    assert.deepEqual(store.list("/workspace-b", "artemiy"), ["two"]);
    assert.deepEqual(store.list("/workspace-a", "another-user"), ["three"]);
  } finally {
    store.close();
  }
});

test("replacing pins removes duplicates while retaining their first position", () => {
  const store = createFileExplorerPinsStore(join(testDir, "dedup.sqlite"));
  try {
    assert.deepEqual(
      store.replace("/workspace", ["src", "docs", "src", "README.md", "docs"]),
      ["src", "docs", "README.md"],
    );
  } finally {
    store.close();
  }
});
