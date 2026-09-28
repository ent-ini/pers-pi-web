import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");

test("supports command/control toggles and shift ranges in the file explorer", () => {
  assert.match(source, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(source, /event\.shiftKey && anchorPath/);
  assert.match(source, /data-file-explorer-path=\{node\.fullPath\}/);
  assert.match(source, /setSelectedPaths\(new Set\(visiblePaths\.slice/);
});

test("moves and deletes the complete selected file set", () => {
  assert.match(source, /application\/x-pi-web-file", JSON\.stringify\(paths\)/);
  assert.match(source, /const handleMove = useCallback\(async \(sourcePaths: string\[\]/);
  assert.match(source, /const handleDelete = useCallback\(async \(sourcePaths: string\[\]/);
  assert.match(source, /handleDelete\(contextMenu\.paths\)/);
});

test("only offers a bulk pin action for root-level selections", () => {
  assert.match(source, /canPinContextSelection/);
  assert.match(source, /contextRootNames\.every\(\(name\) => !name\.includes\("\/"\)\)/);
  assert.match(source, /togglePinnedPaths\(contextMenu\.paths\)/);
});

test("keeps pinned dot entries visible while hidden files are off", () => {
  // Roots are fetched with hidden entries included; only the unpinned section
  // applies the hidden-files filter, so a stored pin can override it.
  assert.match(source, /fetchEntries\(cwd, true\)/);
  assert.match(source, /!pinnedRootNames\.has\(node\.name\)[\s\S]*?showHidden \|\| !node\.name\.startsWith\("\."\)/);
  assert.match(source, /pinnedRootNodes\.map\(\(node\) =>/);
});
