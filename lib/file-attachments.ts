interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
}

const ATTACHMENT_FRAGMENT = "#pi-web-attachment";

export function isFileAttachmentHref(href: string | undefined): boolean {
  return href?.endsWith(ATTACHMENT_FRAGMENT) ?? false;
}
const TRAILING_PATH_PUNCTUATION = /[.,;:!?)}\]]+$/;
// An attachment emitted by Ini is an @ prefix followed by an absolute POSIX
// path. Paths are deliberately limited to one non-whitespace token: outbound
// attachments use ASCII no-space names, and this avoids guessing where prose
// after a path begins.
const ATTACHMENT_PATH = /(^|[\s(])@(\/[^\s<>"'`]+)/g;

function filePathToHref(filePath: string): string {
  // Encode each segment so #, ?, and Unicode stay part of the filesystem path,
  // rather than becoming URL syntax.
  return `file://${filePath.split("/").map(encodeURIComponent).join("/")}${ATTACHMENT_FRAGMENT}`;
}

function getFileName(filePath: string): string {
  return filePath.slice(filePath.lastIndexOf("/") + 1) || filePath;
}

function text(value: string): MarkdownNode {
  return { type: "text", value };
}

function attachment(filePath: string): MarkdownNode {
  return {
    type: "link",
    url: filePathToHref(filePath),
    children: [text(getFileName(filePath))],
  };
}

/** Split one ordinary markdown text node into text and compact file links. */
export function splitFileAttachmentText(value: string): MarkdownNode[] {
  const result: MarkdownNode[] = [];
  let cursor = 0;
  ATTACHMENT_PATH.lastIndex = 0;

  for (let match; (match = ATTACHMENT_PATH.exec(value));) {
    const prefix = match[1];
    const atIndex = match.index + prefix.length;
    const rawPath = match[2];
    const filePath = rawPath.replace(TRAILING_PATH_PUNCTUATION, "");
    if (!filePath || filePath === "/") continue;

    if (atIndex > cursor) result.push(text(value.slice(cursor, atIndex)));
    result.push(attachment(filePath));
    cursor = atIndex + 1 + filePath.length;
    // The regex includes trailing prose punctuation. Resume from the actual
    // path end so that punctuation remains visible as normal message text.
    ATTACHMENT_PATH.lastIndex = cursor;
  }

  if (cursor === 0) return [text(value)];
  if (cursor < value.length) result.push(text(value.slice(cursor)));
  return result;
}

function transformChildren(node: MarkdownNode): void {
  if (!node.children) return;

  const children: MarkdownNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && child.value !== undefined) {
      children.push(...splitFileAttachmentText(child.value));
      continue;
    }
    // Existing links, image labels, and code are intentional literal content;
    // only prose text receives the attachment shorthand.
    if (child.type !== "link" && child.type !== "image" && child.type !== "inlineCode" && child.type !== "code") {
      transformChildren(child);
    }
    children.push(child);
  }
  node.children = children;
}

/** Remark plugin that turns @/absolute/path tokens into marked local links. */
export function remarkFileAttachments() {
  return (tree: MarkdownNode) => {
    transformChildren(tree);
  };
}
