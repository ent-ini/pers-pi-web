import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./file-attachments.ts");
}

test("turns an absolute @ attachment path into a compact file link", async () => {
  const { splitFileAttachmentText } = await loadSubject();
  const parts = splitFileAttachmentText("Готово: @/home/ini/outbound/report.pdf.");

  assert.deepEqual(parts, [
    { type: "text", value: "Готово: " },
    {
      type: "link",
      url: "file:///home/ini/outbound/report.pdf#pi-web-attachment",
      children: [{ type: "text", value: "report.pdf" }],
    },
    { type: "text", value: "." },
  ]);
});

test("turns a bare absolute path into the same compact file link", async () => {
  const { splitFileAttachmentText } = await loadSubject();
  const parts = splitFileAttachmentText("Файл: /tmp/audits/scrm-ar-errors-by-date-2026-09-29.md.");

  assert.deepEqual(parts, [
    { type: "text", value: "Файл: " },
    {
      type: "link",
      url: "file:///tmp/audits/scrm-ar-errors-by-date-2026-09-29.md#pi-web-attachment",
      children: [{ type: "text", value: "scrm-ar-errors-by-date-2026-09-29.md" }],
    },
    { type: "text", value: "." },
  ]);
});

test("turns a standalone inline-code path into a file link but keeps commands and links literal", async () => {
  const { remarkFileAttachments } = await loadSubject();
  const tree = {
    type: "root",
    children: [
      { type: "inlineCode", value: "@/tmp/secret.txt" },
      { type: "inlineCode", value: "cat /tmp/secret.txt" },
      { type: "link", url: "https://example.com", children: [{ type: "text", value: "@/tmp/label.txt" }] },
    ],
  };

  remarkFileAttachments()(tree);
  assert.deepEqual(tree.children[0], {
    type: "link",
    url: "file:///tmp/secret.txt#pi-web-attachment",
    children: [{ type: "text", value: "secret.txt" }],
  });
  assert.deepEqual(tree.children[1], { type: "inlineCode", value: "cat /tmp/secret.txt" });
  assert.deepEqual(tree.children[2].children[0], { type: "text", value: "@/tmp/label.txt" });
});
