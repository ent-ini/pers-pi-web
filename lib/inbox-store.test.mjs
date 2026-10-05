import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function loadSubject() {
  return import("./inbox-store.ts");
}

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-inbox-"));
}

test("sanitizes file names into a single safe path segment", async () => {
  const { sanitizeInboxFileName } = await loadSubject();

  assert.equal(sanitizeInboxFileName("photo.png"), "photo.png");
  assert.equal(sanitizeInboxFileName("../../etc/passwd"), "passwd");
  assert.equal(sanitizeInboxFileName("C:\\Users\\me\\report.pdf"), "report.pdf");
  assert.equal(sanitizeInboxFileName(".."), "file");
  assert.equal(sanitizeInboxFileName(""), "file");
  assert.equal(sanitizeInboxFileName(null), "file");
  assert.equal(sanitizeInboxFileName("bad\u0000name\u001f.txt"), "bad_name_.txt");
  assert.equal(sanitizeInboxFileName(".hidden"), "hidden");
});

test("never overwrites an existing inbox file", async () => {
  const { uniqueInboxFileName } = await loadSubject();
  const directory = tempWorkspace();

  assert.equal(uniqueInboxFileName(directory, "photo.png"), "photo.png");
  fs.writeFileSync(path.join(directory, "photo.png"), "a");
  assert.equal(uniqueInboxFileName(directory, "photo.png"), "photo-2.png");
  fs.writeFileSync(path.join(directory, "photo-2.png"), "b");
  assert.equal(uniqueInboxFileName(directory, "photo.png"), "photo-3.png");
  fs.writeFileSync(path.join(directory, ".env"), "c");
  assert.equal(uniqueInboxFileName(directory, ".env"), ".env-2");
});

test("resolves the inbox directory from the workspace or the deployment override", async () => {
  const { resolveInboxDirectory, getInboxRootOverride, INBOX_DIR_NAME } = await loadSubject();
  const previous = process.env.PI_WEB_INBOX_DIR;

  delete process.env.PI_WEB_INBOX_DIR;
  assert.equal(getInboxRootOverride(), null);
  assert.equal(resolveInboxDirectory("/srv/work"), path.join("/srv/work", INBOX_DIR_NAME));
  assert.equal(resolveInboxDirectory(null), null);
  assert.equal(resolveInboxDirectory("relative/dir"), null);

  process.env.PI_WEB_INBOX_DIR = "/mnt/dropbox";
  assert.equal(getInboxRootOverride(), "/mnt/dropbox");
  assert.equal(resolveInboxDirectory("/srv/work"), "/mnt/dropbox");

  process.env.PI_WEB_INBOX_DIR = "not-absolute";
  assert.equal(getInboxRootOverride(), null);

  if (previous === undefined) delete process.env.PI_WEB_INBOX_DIR;
  else process.env.PI_WEB_INBOX_DIR = previous;
});

test("saves dropped files into inbox and reports workspace-relative paths", async () => {
  const { saveFilesToInbox } = await loadSubject();
  const workspace = tempWorkspace();
  const directory = path.join(workspace, "inbox");

  const { saved, failed } = saveFilesToInbox(directory, [
    { name: "notes.txt", bytes: Buffer.from("hello") },
    { name: "../escape.txt", bytes: Buffer.from("nope") },
    { name: "notes.txt", bytes: Buffer.from("again") },
  ], workspace);

  assert.deepEqual(failed, []);
  assert.equal(saved.length, 3);
  assert.deepEqual(saved.map((entry) => entry.relativePath), [
    "inbox/notes.txt",
    "inbox/escape.txt",
    "inbox/notes-2.txt",
  ]);
  assert.equal(fs.readFileSync(path.join(directory, "notes.txt"), "utf8"), "hello");
  assert.equal(fs.readFileSync(path.join(directory, "notes-2.txt"), "utf8"), "again");
  assert.equal(saved[0].size, 5);
  assert.ok(fs.existsSync(path.join(directory, "escape.txt")));
  assert.ok(!fs.existsSync(path.join(workspace, "escape.txt")));
});