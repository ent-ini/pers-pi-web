import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createTemplateStore, MAX_TEMPLATE_FILE_BYTES } from "./template-store.mjs";

async function withStore(run) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-template-store-"));
  try { await run(createTemplateStore(root), root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("template store persists a nested text template and lists its real tree", async () => {
  await withStore(async (store) => {
    await store.createDirectory("Инструкции");
    await store.createFile("Инструкции/Старт.md");
    assert.equal(await store.read("Инструкции/Старт.md"), "");
    await assert.rejects(store.createFile("Инструкции/Старт.md"), /already exists/);
    await store.write("Инструкции/Старт.md", "# Начало\n");
    await store.write("README.md", "Шаблон");

    assert.deepEqual(await store.list(), [
      { path: "README.md", type: "file" },
      { path: "Инструкции", type: "directory" },
      { path: "Инструкции/Старт.md", type: "file" },
    ]);
    assert.equal(await store.read("Инструкции/Старт.md"), "# Начало\n");
    await store.rename("Инструкции/Старт.md", "Продолжение.md");
    await store.rename("Инструкции", "Материалы");
    assert.equal(await store.read("Материалы/Продолжение.md"), "# Начало\n");
    await store.write("Материалы/README.md", "Занято");
    await assert.rejects(store.rename("Материалы/Продолжение.md", "README.md"), /already exists/);
    await assert.rejects(store.rename("Материалы/Продолжение.md", "../escape.md"), /Invalid entry name/);

    await store.remove("Материалы");
    assert.deepEqual(await store.list(), [{ path: "README.md", type: "file" }]);
  });
});

test("template store refuses paths outside the template, links, and oversized text", async () => {
  await withStore(async (store, root) => {
    await assert.rejects(store.write("../escape.md", "x"), /stay inside/);
    await assert.rejects(store.createDirectory("/tmp/escape"), /stay inside/);
    await assert.rejects(store.write("large.txt", "я".repeat(Math.ceil(MAX_TEMPLATE_FILE_BYTES / 2) + 1)), /Invalid file content/);

    await writeFile(join(root, "target.txt"), "private");
    await symlink("target.txt", join(root, "linked.txt"));
    await assert.rejects(store.read("linked.txt"), /not a file/);
    await assert.rejects(store.write("linked.txt", "overwrite"), /not a file/);
    assert.deepEqual(await store.list(), [{ path: "target.txt", type: "file" }]);
  });
});
