import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createJiti } from "jiti";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-file-kinds-")));
process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/allowed-roots.ts");
allowFileRoot(root);

fs.writeFileSync(path.join(root, "report.md"), "hello");
fs.mkdirSync(path.join(root, "outbox"), { recursive: true });
fs.writeFileSync(path.join(root, "outbox", "one.md"), "one");

function kinds(paths) {
  const params = new URLSearchParams();
  for (const value of paths) params.append("paths", value);
  return GET(new NextRequest(`http://localhost/api/file-kinds?${params.toString()}`));
}

test("tells a file from a directory", async () => {
  const response = await kinds([
    path.join(root, "report.md"),
    path.join(root, "outbox"),
  ]);

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.kinds[path.join(root, "report.md")], "file");
  assert.equal(body.kinds[path.join(root, "outbox")], "directory");
});

test("says nothing about a path outside the allowed roots", async () => {
  const outside = path.join(os.tmpdir(), "pi-web-outside-secret");
  const response = await kinds([outside, "/etc/passwd"]);

  const body = await response.json();
  assert.equal(body.kinds[outside], undefined);
  assert.equal(body.kinds["/etc/passwd"], undefined);
});

test("ignores a path that does not exist", async () => {
  const response = await kinds([path.join(root, "missing.md")]);

  const body = await response.json();
  assert.equal(body.kinds[path.join(root, "missing.md")], undefined);
});
