"use client";

import { createContext, useContext, useMemo, type ComponentProps, type MouseEvent } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import { parsePdfPageFragment, resolveLocalFileHref, shouldOpenLocalFileInApp } from "@/lib/file-links";
import { encodeFilePathForApi, getFileName } from "@/lib/file-paths";
import { isFileAttachmentHref } from "@/lib/file-attachments";
import { usePathKinds } from "@/hooks/usePathKinds";
import type { PathKind } from "@/lib/file-path-kinds";
import { markdownAppUrlTransform, markdownRehypePlugins, markdownRemarkPlugins, markdownUrlTransform, markdownUserRemarkPlugins, normalizeDisplayMath } from "@/lib/markdown";
import { ImagePreview } from "./ImagePreview";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";
import { FolderIcon, getFileIcon } from "./FileIcons";

const MarkdownLinkContext = createContext(false);

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string, page?: number) => void;
  /** Open a mentioned directory. Falls back to the file handler. */
  onOpenDirectory?: (filePath: string) => void;
  /** Session the message belongs to; it decides which paths may be classified. */
  sessionId?: string | null;
  /** Known path kinds. Supplied by callers that already know them. */
  pathKinds?: Map<string, PathKind>;
  /** Render every line ending as a line break, for text the user typed. */
  keepLineBreaks?: boolean;
}

function MarkdownImage({
  src,
  alt,
  cwd,
  ...props
}: ComponentProps<"img"> & ExtraProps & { cwd?: string }) {
  const insideLink = useContext(MarkdownLinkContext);
  delete props.node;
  const href = typeof src === "string" ? src : undefined;
  const filePath = href ? resolveLocalFileHref(href, cwd) : null;
  const imageSrc = filePath
    ? `/api/files/${encodeFilePathForApi(filePath)}?type=read`
    : href;
  // Dynamic local paths are served directly by the file API.
  // eslint-disable-next-line @next/next/no-img-element
  const image = <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />;
  if (!imageSrc || insideLink) return image;
  return (
    <ImagePreview src={imageSrc} alt={alt ?? ""} className="markdown-image">
      {image}
    </ImagePreview>
  );
}

export function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile, onOpenDirectory, sessionId, pathKinds, keepLineBreaks }: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);
  // A file mention shows its name, a directory mention the whole path: the
  // server says which is which, because the browser cannot stat anything.
  const detectedKinds = usePathKinds(children, sessionId, { enabled: !pathKinds });
  const kinds = pathKinds ?? detectedKinds;
  // Stable renderer identities keep stateful blocks mounted across message hover updates.
  const components = useMemo<Components>(() => ({
    code({ className, children, ...props }) {
      const lang = className?.replace("language-", "").toLowerCase() ?? "";
      const raw = String(children);
      const isBlock = className?.includes("language-") || raw.includes("\n");
      if (isBlock) {
        if (lang === "mermaid") {
          return (
            <MermaidBlock
              code={raw.replace(/\n$/, "")}
              isStreaming={isStreaming}
              defaultPreview
            />
          );
        }
        return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} isStreaming={isStreaming} />;
      }
      return (
        <code
          className="markdown-inline-code"
          {...props}
        >
          {children}
        </code>
      );
    },
    pre({ children }) {
      return <>{children}</>;
    },
    a({ href, children, ...props }) {
      // `node` is react-markdown metadata, not a DOM attribute.
      delete props.node;
      const isAttachment = isFileAttachmentHref(href);
      const filePath = onOpenFile ? resolveLocalFileHref(href, cwd) : null;
      const openFile = onOpenFile;

      if (isAttachment && filePath && openFile) {
        const name = getFileName(filePath);
        if (kinds.get(filePath) === "directory") {
          // A directory name alone says little: two folders can share it. The
          // whole path is what tells them apart.
          return (
            <button
              type="button"
              title={filePath}
              aria-label={`Open directory: ${filePath}`}
              onClick={() => (onOpenDirectory ?? openFile)(filePath)}
              className="markdown-file-attachment"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "2px 8px",
                verticalAlign: "baseline",
                fontSize: "0.9em",
                fontFamily: "var(--font-mono)",
                lineHeight: 1.5,
                color: "var(--text)",
                background: "var(--bg-subtle)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              <FolderIcon size={13} />
              <span>{filePath}</span>
            </button>
          );
        }
        return (
          <button
            type="button"
            title={filePath}
            aria-label={`Open file: ${name}`}
            onClick={() => openFile(filePath, parsePdfPageFragment(href) ?? undefined)}
            className="markdown-file-attachment"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "2px 8px",
              verticalAlign: "baseline",
              fontSize: "0.9em",
              fontFamily: "var(--font-mono)",
              lineHeight: 1.5,
              color: "var(--text)",
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            {getFileIcon(name, 13)}
            <span>{name}</span>
          </button>
        );
      }

      if (!filePath || !openFile) {
        return (
          <MarkdownLinkContext.Provider value={true}>
            <a href={href} {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          </MarkdownLinkContext.Provider>
        );
      }

      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (!shouldOpenLocalFileInApp(event)) return;
        const target = event.currentTarget.getAttribute("target");
        if (target && target !== "_self") return;
        event.preventDefault();
        openFile(filePath, parsePdfPageFragment(href) ?? undefined);
      };

      return (
        <MarkdownLinkContext.Provider value={true}>
          <a href={href} {...props} onClick={handleClick}>
            {children}
          </a>
        </MarkdownLinkContext.Provider>
      );
    },
    img(props) {
      return <MarkdownImage cwd={cwd} {...props} />;
    },
    ol({ node, start, style, ...props }) {
      // An outside marker wider than the list's left padding is clipped by
      // .markdown-body's overflow-x, so the padding follows the largest number.
      const items = node?.children.filter((child) => child.type === "element" && child.tagName === "li").length ?? 0;
      const digits = String(Math.abs((start ?? 1) + Math.max(items, 1) - 1)).length;
      return <ol start={start} style={{ ...style, ["--ol-marker-digits" as string]: Math.max(digits, 2) }} {...props} />;
    },
    table({ children }) {
      return (
        <div className="markdown-table-wrap">
          <table>{children}</table>
        </div>
      );
    },
  }), [cwd, isStreaming, onOpenFile, onOpenDirectory, kinds]);

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={keepLineBreaks ? markdownUserRemarkPlugins : markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        urlTransform={onOpenFile ? markdownUrlTransform : markdownAppUrlTransform}
        components={components}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
}
