import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { SOURCE_TAG, withSourceTag, stripSourceTag } = await jiti.import("./source-tag.ts");

test("withSourceTag prepends the pi-web tag to a plain message", () => {
  assert.equal(withSourceTag("hello"), `${SOURCE_TAG}\nhello`);
});

test("withSourceTag prepends the tag to an empty message", () => {
  // Image-only messages have an empty text body; the tag still needs to land
  // in the message so the model and other clients can identify the source.
  assert.equal(withSourceTag(""), `${SOURCE_TAG}\n`);
});

test("withSourceTag is idempotent", () => {
  const once = withSourceTag("hello");
  const twice = withSourceTag(once);
  assert.equal(twice, once);
});

test("stripSourceTag removes the leading pi-web tag", () => {
  assert.equal(stripSourceTag(`${SOURCE_TAG}\nhello`), "hello");
});

test("stripSourceTag removes any [source:...] prefix (other clients too)", () => {
  assert.equal(
    stripSourceTag('[source:pi-macos-app type=text session="Foo" client-send-id="abc"]\nhi'),
    "hi",
  );
});

test("stripSourceTag is a no-op when no source tag is present", () => {
  assert.equal(stripSourceTag("plain message"), "plain message");
});

test("stripSourceTag leaves a non-leading [source:...] line untouched", () => {
  // Only the very first line is metadata; later occurrences are content.
  assert.equal(
    stripSourceTag("hello\n[source:someone] cited text"),
    "hello\n[source:someone] cited text",
  );
});

test("withSourceTag + stripSourceTag round-trip preserves body", () => {
  const body = "multi\nline\n\nbody";
  assert.equal(stripSourceTag(withSourceTag(body)), body);
});

test("stripSourceTag handles tag without trailing newline", () => {
  assert.equal(stripSourceTag("[source:pi-web type=text]hello"), "hello");
});