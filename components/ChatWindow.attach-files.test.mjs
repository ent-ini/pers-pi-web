import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";

const sourceText = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("ChatWindow.tsx", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function chatWindowCallback(name, context) {
  function findCallback(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) return node.initializer.arguments[0];
    return ts.forEachChild(node, findCallback);
  }
  return new Script(ts.transpileModule(findCallback(source).getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText).runInNewContext(context);
}

test("dropped files, including images, enter the composer inbox pipeline", () => {
  const photo = new File(["x"], "photo.png", { type: "image/png" });
  const report = new File(["x"], "report.pdf", { type: "application/pdf" });
  const calls = { files: [], notices: [] };
  const onDrop = chatWindowCallback("onDrop", {
    chatInputRef: { current: { addFiles: (files) => calls.files.push(...files) } },
    addNotice: (notice) => calls.notices.push(notice),
    t: (key, vars) => `${key}:${vars?.names ?? ""}`,
  });
  onDrop([
    { kind: "file", file: photo }, { kind: "folder", name: "src" }, { kind: "file", file: report },
  ]);
  assert.deepEqual(calls.files, [photo, report]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.notices)), [{ type: "warning", message: "chat.dropFoldersUnsupported:src" }]);
  assert.doesNotMatch(sourceText, /\/api\/worktrees|onAttachFiles=|uploadDroppedFiles/);
  assert.match(sourceText, /cwd=\{session\?\.cwd \?\? newSessionCwd\}/);
});
