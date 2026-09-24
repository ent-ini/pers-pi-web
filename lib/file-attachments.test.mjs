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

test("keeps @ paths inside code and existing links literal", async () => {
  const { remarkFileAttachments } = await loadSubject();
  const tree = {
    type: "root",
    children: [
      { type: "inlineCode", value: "@/tmp/secret.txt" },
      { type: "link", url: "https://example.com", children: [{ type: "text", value: "@/tmp/label.txt" }] },
    ],
  };

  remarkFileAttachments()(tree);
  assert.deepEqual(tree.children[0], { type: "inlineCode", value: "@/tmp/secret.txt" });
  assert.deepEqual(tree.children[1].children[0], { type: "text", value: "@/tmp/label.txt" });
});
