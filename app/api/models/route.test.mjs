import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { promisify } from "node:util";
import { createJiti } from "jiti";

const execFileAsync = promisify(execFile);

// Real paths: the temp folder may itself be a link on macOS.
const root = realpathSync(await mkdtemp(join(tmpdir(), "pi-web-models-worktree-")));
const agentDir = join(root, "agent");
const repo = join(root, "repo");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousOffline = process.env.PI_OFFLINE;
process.env.PI_CODING_AGENT_DIR = agentDir;
// The list is served from the SDK's own data and the models.json below, so the route
// never reaches for the network here.
process.env.PI_OFFLINE = "1";

await mkdir(agentDir, { recursive: true });
await writeFile(join(agentDir, "models.json"), JSON.stringify({
  providers: {
    acme: {
      baseUrl: "https://example.invalid/v1",
      apiKey: "sk-test",
      api: "openai-completions",
      models: [{ id: "one", name: "Acme One" }],
    },
  },
}, null, 2));

// A temporary repository with an explicit allow-list entry.
async function initRepo(name) {
  const path = join(root, name);
  await execFileAsync("git", ["init", path]);
  return path;
}
await initRepo("repo");

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
const { GET } = await jiti.import("./route.ts");
// Only explicit roots may serve model lists.
allowFileRoot(repo);

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousOffline === undefined) delete process.env.PI_OFFLINE;
  else process.env.PI_OFFLINE = previousOffline;
  await rm(root, { recursive: true, force: true });
});

async function models(cwd) {
  const response = await GET(new Request(`http://localhost/api/models?cwd=${encodeURIComponent(cwd)}`, { headers: { host: "localhost" } }));
  return { status: response.status, body: await response.json() };
}

test("the authorized repo lists its configured models", async () => {
  const response = await models(repo);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.modelList.map((m) => `${m.provider}:${m.id}`), ["acme:one"]);
});

test("a removed worktree has no implicit fallback to its repo", async () => {
  const removed = join(`${repo}-worktrees`, "pi-web-agent-abc");
  const response = await models(removed);
  assert.equal(response.status, 400);
  assert.equal(response.body.error, `Directory does not exist: ${removed}`);
});

test("an unauthorized repo cannot list models", async () => {
  const unknown = await initRepo("unknown");
  const response = await models(unknown);
  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { error: "Access denied" });
});

test("a missing folder that is not a removed worktree of a repo is refused as before", async () => {
  const missing = join(root, "never-existed");
  const gone = await models(missing);
  assert.equal(gone.status, 400);
  assert.equal(gone.body.error, `Directory does not exist: ${missing}`);

  // The `-worktrees` name alone is not enough: there has to be a repo to fall back to.
  const orphan = await models(join(`${root}-worktrees`, "orphan"));
  assert.equal(orphan.status, 400);
  assert.equal(orphan.body.error, `Directory does not exist: ${join(`${root}-worktrees`, "orphan")}`);
});
