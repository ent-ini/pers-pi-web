import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./inbox-files.ts");
}

test("appends saved inbox paths to the message text", async () => {
  const { buildInboxAttachmentText } = await loadSubject();

  assert.equal(buildInboxAttachmentText("привет", []), "привет");
  assert.equal(
    buildInboxAttachmentText("посмотри", ["inbox/photo.png", "inbox/report.pdf"]),
    "посмотри\n\ninbox/photo.png\ninbox/report.pdf",
  );
  // Files only: the path block is the whole message.
  assert.equal(buildInboxAttachmentText("", ["inbox/a.txt"]), "inbox/a.txt");
  // Blank paths are dropped and duplicates collapse.
  assert.equal(
    buildInboxAttachmentText("ок", ["inbox/a.txt", "  ", "inbox/a.txt"]),
    "ок\n\ninbox/a.txt",
  );
});

test("uploads picked files to the workspace inbox", async () => {
  const { uploadFilesToInbox } = await loadSubject();
  const saved = [{ name: "a.txt", path: "/w/inbox/a.txt", relativePath: "inbox/a.txt", size: 1 }];
  const originalFetch = globalThis.fetch;

  try {
    assert.deepEqual(await uploadFilesToInbox([], "/w"), { saved: [], failed: [] });

    let seenUrl = "";
    let seenBody = null;
    globalThis.fetch = async (url, init) => {
      seenUrl = String(url);
      seenBody = init.body;
      return new Response(JSON.stringify({ saved, failed: [] }), { status: 200 });
    };
    const file = new File(["hi"], "a.txt", { type: "text/plain" });
    const result = await uploadFilesToInbox([file], "/home/me/work space");
    assert.deepEqual(result.saved, saved);
    assert.equal(seenUrl, "/api/inbox?cwd=%2Fhome%2Fme%2Fwork%20space");
    assert.ok(seenBody instanceof FormData);

    globalThis.fetch = async () => new Response(JSON.stringify({ error: "Access denied" }), { status: 403 });
    await assert.rejects(() => uploadFilesToInbox([file], "/w"), /Access denied/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});