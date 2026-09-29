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
// Turn absolute POSIX paths in ordinary prose into compact file links. `@`
// remains supported as an explicit attachment marker, but assistant replies
// commonly contain bare paths too. Paths are deliberately limited to one
// non-whitespace token so we never have to guess where following prose begins.
const ATTACHMENT_PATH = /(^|[\s(])@?(\/[^\s<>"'`]+)/g;

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

function attachmentPath(token: string): string | null {
  const rawPath = token.startsWith("@/") ? token.slice(1) : token;
  if (!rawPath.startsWith("/")) return null;
  const filePath = rawPath.replace(TRAILING_PATH_PUNCTUATION, "");
  return filePath && filePath !== "/" ? filePath : null;
}

/** Split one ordinary markdown text node into text and compact absolute-path links. */
export function splitFileAttachmentText(value: string): MarkdownNode[] {
  const result: MarkdownNode[] = [];
  let cursor = 0;
  ATTACHMENT_PATH.lastIndex = 0;

  for (let match; (match = ATTACHMENT_PATH.exec(value));) {
    const prefix = match[1];
    const tokenIndex = match.index + prefix.length;
    const rawPath = match[2];
    const pathIndex = tokenIndex + (value[tokenIndex] === "@" ? 1 : 0);
    const filePath = attachmentPath(rawPath);
    if (!filePath) continue;

    if (tokenIndex > cursor) result.push(text(value.slice(cursor, tokenIndex)));
    result.push(attachment(filePath));
    cursor = pathIndex + filePath.length;
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
    // Models normally format a standalone path as inline code. It is still a
    // file reference, so promote just that exact token; command snippets and
    // all fenced code stay literal.
    if (child.type === "inlineCode" && child.value !== undefined) {
      const filePath = attachmentPath(child.value);
      children.push(filePath ? attachment(filePath) : child);
      continue;
    }
    // Existing links, image labels, and fenced code are intentional literal
    // content; only prose text receives the attachment shorthand.
    if (child.type !== "link" && child.type !== "image" && child.type !== "code") {
      transformChildren(child);
    }
    children.push(child);
  }
  node.children = children;
}

/** Remark plugin that turns bare or @-prefixed absolute paths into marked local links. */
export function remarkFileAttachments() {
  return (tree: MarkdownNode) => {
    transformChildren(tree);
  };
}
