import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createTemplateStore } from "./template-store.mjs";
import { createWorkspaceTemplates, snapshotTemplate } from "./workspace-template.mjs";

const id = "2b0b19f0-7a39-4e85-8c08-886cefc3dac1";
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "pi-workspace-template-"));
  const template = join(root, "template");
  const workspace = join(root, "workspace");
  const stateRoot = join(root, "control");
  await mkdir(workspace);
  const store = createTemplateStore(template);
  const templates = createWorkspaceTemplates({ stateRoot, uid: process.getuid(), gid: process.getgid() });
  const apply = async () => templates.apply(id, workspace, await snapshotTemplate(template));
  try { await run({ root, workspace, template, stateRoot, store, templates, apply }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("records the issued revision outside the worker mount; reset removes old defaults and keeps personal files", async () => fixture(async ({ workspace, stateRoot, store, templates, apply }) => {
  await store.write("AGENTS.md", "v1");
  await store.write("guides/old.md", "old");
  await store.createDirectory("empty");
  const initial = await apply();
  const inode = (await lstat(workspace)).ino;
  const manifest = await templates.read(id);
  assert.equal(manifest.revision, initial.revision);
  assert.equal(manifest.entries.find((entry) => entry.path === "AGENTS.md").sha256.length, 64);
  assert.equal((await lstat(join(stateRoot, `${id}.json`))).mode & 0o777, 0o600);
  assert.deepEqual((await readdir(workspace)).sort(), ["AGENTS.md", "empty", "guides"]);
  await writeFile(join(workspace, "AGENTS.md"), "employee edited template");
  await writeFile(join(workspace, "guides/personal.txt"), "private");
  await writeFile(join(workspace, "invoice.pdf"), "pdf");
  await store.remove("guides");
  await store.remove("empty");
  await store.write("AGENTS.md", "v2");
  await store.write("new/start.md", "new");
  const updated = await apply();
  assert.notEqual(updated.revision, initial.revision);
  assert.equal(updated.legacy, false);
  assert.equal(await readFile(join(workspace, "AGENTS.md"), "utf8"), "v2");
  assert.equal(await readFile(join(workspace, "guides/personal.txt"), "utf8"), "private");
  assert.equal(await readFile(join(workspace, "invoice.pdf"), "utf8"), "pdf");
  await assert.rejects(lstat(join(workspace, "guides/old.md")), { code: "ENOENT" });
  await assert.rejects(lstat(join(workspace, "empty")), { code: "ENOENT" });
  assert.equal((await lstat(workspace)).ino, inode, "must retain Docker bind mount inode");
  assert.equal((await apply()).revision, updated.revision, "reset is repeatable");
}));

test("renames and file/directory transitions clean up only previously issued template entries", async () => fixture(async ({ workspace, store, apply }) => {
  await store.write("one", "a");
  await store.write("two/child", "b");
  await apply();
  await store.remove("one");
  await store.write("one/child", "c");
  await store.remove("two");
  await store.write("two", "d");
  await apply();
  assert.equal(await readFile(join(workspace, "one/child"), "utf8"), "c");
  assert.equal(await readFile(join(workspace, "two"), "utf8"), "d");
  await store.rename("two", "renamed");
  await apply();
  await assert.rejects(lstat(join(workspace, "two")), { code: "ENOENT" });
  assert.equal(await readFile(join(workspace, "renamed"), "utf8"), "d");
}));

test("personal collisions and a template directory with personal children abort before any changes", async () => fixture(async ({ workspace, store, templates, apply }) => {
  await store.write("old", "old");
  await store.write("folder/default", "default");
  await apply();
  const previous = await templates.read(id);
  await writeFile(join(workspace, "personal"), "private");
  await store.write("personal", "new default");
  await store.remove("old");
  await assert.rejects(apply(), /Конфликт.*personal/);
  assert.equal(await readFile(join(workspace, "old"), "utf8"), "old");
  assert.equal(await readFile(join(workspace, "personal"), "utf8"), "private");
  assert.deepEqual(await templates.read(id), previous);
  await store.remove("personal");
  await writeFile(join(workspace, "folder/personal"), "private");
  await store.remove("folder");
  await store.write("folder", "new file");
  await assert.rejects(apply(), /Конфликт.*folder/);
  assert.equal(await readFile(join(workspace, "folder/default"), "utf8"), "default");
}));

test("legacy workspace preserves unknown files, establishes history and refuses collisions", async () => fixture(async ({ workspace, store, templates, apply }) => {
  await writeFile(join(workspace, "unknown-old-default"), "do not guess");
  await store.write("new", "new");
  assert.equal((await apply()).legacy, true);
  assert.equal(await readFile(join(workspace, "unknown-old-default"), "utf8"), "do not guess");
  assert.ok(await templates.read(id));
  await store.remove("new");
  await apply();
  await assert.rejects(lstat(join(workspace, "new")), { code: "ENOENT" });
  assert.equal(await readFile(join(workspace, "unknown-old-default"), "utf8"), "do not guess");
}));

test("IO failure restores files and keeps the old manifest; no backup remains after a successful rollback", async () => fixture(async ({ workspace, template, stateRoot, store, templates, apply }) => {
  await store.write("old", "old");
  await apply();
  const previous = await templates.read(id);
  await writeFile(join(workspace, "personal"), "private");
  await store.remove("old");
  await store.write("new", "new");
  const brokenSnapshot = await snapshotTemplate(template);
  brokenSnapshot.files.clear(); // Simulate an unexpected failure after the old file was deleted.
  await assert.rejects(templates.apply(id, workspace, brokenSnapshot));
  assert.equal(await readFile(join(workspace, "old"), "utf8"), "old");
  assert.equal(await readFile(join(workspace, "personal"), "utf8"), "private");
  assert.deepEqual(await templates.read(id), previous);
  assert.deepEqual(await readdir(stateRoot), [`${id}.json`]);
}));

test("workspace symlinks cannot escape; unchanged personal symlinks survive", async () => fixture(async ({ root, workspace, store, templates, apply }) => {
  const outside = join(root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "secret"), "untouched");
  await symlink(outside, join(workspace, "linked"));
  await store.write("linked/secret", "overwrite");
  await assert.rejects(apply(), /Конфликт.*linked/);
  assert.equal(await readFile(join(outside, "secret"), "utf8"), "untouched");
  await store.remove("linked");
  await store.write("safe", "default");
  await apply();
  assert.ok((await lstat(join(workspace, "linked"))).isSymbolicLink());
  const otherWorkspace = join(root, "linked-root");
  await symlink(workspace, otherWorkspace);
  await assert.rejects(templates.apply(id, otherWorkspace, { entries: [], files: new Map(), revision: "x" }), /обычной папкой/);
}));

test("corrupt or escaping manifests fail closed", async () => fixture(async ({ workspace, stateRoot, store, templates, apply }) => {
  await store.write("safe", "default");
  await apply();
  const manifest = await templates.read(id);
  manifest.entries.push({ path: "../secret", type: "file" });
  await writeFile(join(stateRoot, `${id}.json`), JSON.stringify(manifest));
  await assert.rejects(apply(), /История шаблона повреждена/);
  assert.equal(await readFile(join(workspace, "safe"), "utf8"), "default");
}));

test("interrupted updates are blocked until the manager-owned backup is checked", async () => fixture(async ({ workspace, stateRoot, store, templates, apply }) => {
  await store.write("safe", "default");
  await apply();
  await writeFile(join(stateRoot, `${id}.json.pending`), JSON.stringify({ backup: "protected-backup" }));
  await assert.rejects(templates.assertHealthy(id), (error) => error.keepStopped === true && /прервано/.test(error.message));
  await assert.rejects(apply(), /прервано/);
  await writeFile(join(stateRoot, `${id}.json.pending`), "not json");
  await assert.rejects(templates.assertHealthy(id), (error) => error.keepStopped === true);
  assert.equal(await readFile(join(workspace, "safe"), "utf8"), "default");
}));

test("empty issued template is tracked, and another user's template revision is independent", async () => fixture(async ({ root, workspace, template, templates, store, apply }) => {
  const empty = await apply();
  assert.equal(empty.trackedFiles, 0);
  const anotherId = "3b0b19f0-7a39-4e85-8c08-886cefc3dac1";
  const anotherWorkspace = join(root, "another");
  await mkdir(anotherWorkspace);
  await store.write("new", "new");
  await templates.apply(anotherId, anotherWorkspace, await snapshotTemplate(template));
  assert.equal((await templates.read(id)).revision, empty.revision);
  assert.deepEqual(await readdir(workspace), []);
}));
