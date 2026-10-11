import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { currentProjectRows, sessionsInCurrentProject } = await jiti.import("./sidebar-current-project.ts");
const { buildSessionTree, buildArchiveRows } = await jiti.import("./session-tree.ts");

const session = (id, projectKey) => ({
  id, path: `/tmp/${id}.jsonl`, cwd: projectKey, projectKey,
  created: "2026-10-11T00:00:00.000Z", modified: "2026-10-11T00:00:00.000Z",
  messageCount: 1, firstMessage: id,
});
const uiState = { version: 1, revision: 0, sessions: { b: { archivedAt: Date.parse("2026-10-11T00:00:01.000Z") } }, projects: { "/other": { pinnedAt: 5 } } };
const common = { uiState, runningIds: new Set(), awaitingIds: new Set(), unreadIds: new Set(), selectedSessionId: null, currentProject: { key: "/here", root: "/here" } };

test("session list only shows the selected directory, without project folders", () => {
  const all = [session("a", "/here"), session("b", "/here"), session("c", "/other")];
  assert.deepEqual(sessionsInCurrentProject(all, "/here").map((s) => s.id), ["a", "b"]);
  assert.deepEqual(sessionsInCurrentProject(all, null), []);
  const sessions = sessionsInCurrentProject(all, "/here");
  const model = buildSessionTree({ ...common, sessions, groupExpansion: { "/here": true }, moreShown: {}, pinnedCollapsed: false });
  assert.equal(model.archivedCount, 1);
  const rows = currentProjectRows(model.rows, "/here");
  assert.deepEqual(rows.filter((row) => row.kind === "session").map((row) => row.family.root.id), ["a"]);
  assert.equal(rows.some((row) => row.kind === "group" || row.kind === "footer-open"), false);
  assert.equal(rows.find((row) => row.kind === "footer-archived")?.count, 1);
  const archive = currentProjectRows(buildArchiveRows({ ...common, sessions }), "/here");
  assert.deepEqual(archive.map((row) => row.kind === "session" ? row.family.root.id : row.kind), ["b"]);
  assert.deepEqual(currentProjectRows(model.rows, null), []);
});

test("empty selected directory does not show other pinned directory headings", () => {
  const model = buildSessionTree({ ...common, sessions: [], groupExpansion: { "/here": true }, moreShown: {}, pinnedCollapsed: false });
  const rows = currentProjectRows(model.rows, "/here");
  assert.equal(rows.some((row) => row.kind === "group-empty" && row.project.key === "/here"), true);
  assert.equal(rows.some((row) => row.kind === "group" || (row.kind === "group-empty" && row.project.key === "/other")), false);
});
