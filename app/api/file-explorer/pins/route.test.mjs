import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { NextRequest } from "next/server.js";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-file-explorer-pins-agent-"));
const workspace = await mkdtemp(join(tmpdir(), "pi-web-file-explorer-pins-workspace-"));
await mkdir(join(workspace, "docs"));
await writeFile(join(workspace, "README.md"), "# test\n");
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { allowFileRoot } = await jiti.import("@/lib/file-access");
allowFileRoot(workspace);
const { GET, PUT } = await jiti.import("./route.ts");

after(async () => {
  globalThis.__piWebFileExplorerPinsStore?.close();
  globalThis.__piWebFileExplorerPinsStore = undefined;
  globalThis.__piWebFileExplorerPinsStorePath = undefined;
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await Promise.all([
    rm(testAgentDir, { recursive: true, force: true }),
    rm(workspace, { recursive: true, force: true }),
  ]);
});

function getRequest() {
  return new NextRequest(`http://localhost/api/file-explorer/pins?cwd=${encodeURIComponent(workspace)}`, {
    headers: { Host: "localhost" },
  });
}

function putRequest(body, contentType = "application/json") {
  return new NextRequest("http://localhost/api/file-explorer/pins", {
    method: "PUT",
    headers: { Host: "localhost", "Content-Type": contentType },
    body: JSON.stringify(body),
  });
}

test("file explorer pins route stores ordered root entries on the server", async () => {
  let response = await GET(getRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { paths: [] });

  response = await PUT(putRequest({ cwd: workspace, paths: ["docs", "README.md"] }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { paths: ["docs", "README.md"] });

  response = await GET(getRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { paths: ["docs", "README.md"] });
});

test("file explorer pins route rejects nested, duplicate, and malformed names", async () => {
  for (const paths of [["docs/readme.md"], ["docs", "docs"], [".."]]) {
    const response = await PUT(putRequest({ cwd: workspace, paths }));
    assert.equal(response.status, 400);
  }

  const response = await PUT(putRequest({ cwd: workspace, paths: [] }, "text/plain"));
  assert.equal(response.status, 415);
});

test("listing pins removes entries for files deleted outside the explorer", async () => {
  let response = await PUT(putRequest({ cwd: workspace, paths: ["README.md"] }));
  assert.equal(response.status, 200);
  await rm(join(workspace, "README.md"));

  response = await GET(getRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { paths: [] });
});
