import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("expands process details when a completed turn has no final presentation", () => {
  assert.match(source, /const \[expanded, setExpanded\] = useState\(defaultExpanded\)/);
  assert.match(
    source,
    /<ProcessDetailsGroup[\s\S]*?defaultExpanded=\{!hasFinalPresentation\}/,
  );
});

test("keeps text/image content between technical blocks outside process details", () => {
  assert.match(source, /splitAssistantBlocksForDisplay\(processMessage\)/);
  assert.match(source, /if \(segment\.kind === "process"\)/);
  assert.match(source, /flushProcessViews\(\);[\s\S]*?rendered\.push\(renderMessage\(processIdx/);
});
