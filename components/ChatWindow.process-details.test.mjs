import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("groups the leading segment when the history page starts mid-turn", () => {
  // A turn longer than the initial page loses its anchor, and the old loop
  // flattened every message before the first anchor instead of grouping them.
  assert.match(source, /const hasAnchor = isMessageGroupAnchor\(msg\)/);
  assert.match(source, /if \(!hasAnchor && idx !== 0\)/);
  assert.match(source, /const userIdx = hasAnchor \? idx : -1/);
  assert.match(source, /const groupStartIdx = hasAnchor \? idx : 0/);
  assert.match(source, /if \(hasAnchor\) rendered\.push\(renderMessage\(userIdx\)\)/);
});

test("expands process details when a completed turn has no final answer", () => {
  assert.match(source, /const \[expanded, setExpanded\] = useState\(defaultExpanded\)/);
  // A provider error alone is no answer: the preceding process must stay visible.
  assert.match(source, /const finalHasAnswer = hasFinalAssistantAnswer\(finalAssistant\);/);
  assert.match(source, /<ProcessDetailsGroup[\s\S]*?defaultExpanded=\{!finalHasAnswer\}/);
});

test("resets process details when the turn gains or loses its final answer", () => {
  // useState only reads defaultExpanded on mount; keying on answer availability
  // makes an answered turn start collapsed even if it first rendered unanswered.
  assert.match(
    source,
    /<ProcessDetailsGroup key=\{finalHasAnswer \? "answered" : "unanswered"\}[\s\S]*?defaultExpanded=\{!finalHasAnswer\}/,
  );
});

test("passes a grouped turn's MessageViews the same copies on every render (#1005)", () => {
  // Interleaved process/content blocks are separate while copies and written
  // file lists remain stable across unrelated composer renders.
  assert.match(source, /const assistantSegmentsCache = useMemo\(\(\) => new WeakMap/);
  assert.match(source, /const assistantViewCache = useMemo\(\(\) => new WeakMap/);
  assert.match(source, /let message = views\.get\(cacheKey\)/);
  assert.match(source, /turnWrittenFilesCache\.get\(finalAssistantIdx\)/);
});

test("skips custom messages without display and counts them nowhere (#1043)", () => {
  // pi's TUI never renders them; one card per idle session restart flooded the chat.
  assert.match(source, /const msg = options\.messageOverride \?\? messages\[idx\];\s*if \(isHiddenCustomMessage\(msg\)\) return null;/);
  assert.match(
    source,
    /if \(processMessage\.role === "custom"\) \{[^}]*?if \(isHiddenCustomMessage\(processMessage\)\) continue;/,
  );
});

test("keeps text/image content between technical blocks outside process details", () => {
  assert.match(source, /splitAssistantBlocksForDisplay\(processMessage\)/);
  assert.match(source, /if \(segment\.kind === "process"\)/);
  assert.match(source, /flushProcessViews\(\);[\s\S]*?rendered\.push\(renderMessage\(processIdx/);
});

test("snapshots accumulated process views before resetting the next group", () => {
  assert.match(source, /const views = \[\.\.\.processViews\];/);
  assert.match(source, /<ProcessDetailsGroup key=\{finalHasAnswer \? "answered" : "unanswered"\} messageCount=\{views\.length\}[\s\S]*?>\s*\{views\}/);
  assert.match(source, /\{views\}[\s\S]*?processViews\.length = 0;/);
});
