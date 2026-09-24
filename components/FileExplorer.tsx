"use client";

import { forwardRef, useState, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { getFileIcon, FolderIcon } from "./FileIcons";
import {
  encodeFilePathForApi,
  getRelativeFilePath,
  joinFilePath,
} from "@/lib/file-paths";
import type { FileIndexEntry } from "@/lib/file-fuzzy";
import { buildSearchTree, type SearchTreeNode } from "@/lib/search-tree";
import { useI18n } from "@/hooks/useI18n";
type Translate = ReturnType<typeof useI18n>["t"];

interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: string;
}

interface FileNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  size: number;
  children?: FileNode[];
  loaded?: boolean;
}

interface Props {
  cwd: string;
  onOpenFile: (filePath: string, fileName: string) => void;
  refreshKey?: number;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
  onUploadBusyChange?: (busy: boolean) => void;
  fileSearchOpen?: boolean;
  onFileSearchOpenChange?: (open: boolean) => void;
}

export interface FileExplorerHandle {
  openUploadPicker: () => void;
  startCreateFolder: () => void;
}

type UploadPhase = "idle" | "checking" | "uploading";
type UploadConflictStrategy = "error" | "overwrite" | "skip";

interface UploadError {
  name: string;
  error: string;
}

interface UploadResponse {
  uploaded?: string[];
  skipped?: string[];
  errors?: UploadError[];
  conflicts?: string[];
  nonReplaceable?: string[];
  error?: string;
}

interface UploadSummary {
  targetDirectory: string;
  uploaded: string[];
  skipped: string[];
  errors: UploadError[];
}

interface PendingConflict {
  targetDirectory: string;
  files: File[];
  conflicts: string[];
  nonReplaceable: string[];
}

function hasExternalFiles(dataTransfer: DataTransfer): boolean {
  // Browsers deliberately keep DataTransfer.files empty until drop, so use the
  // advertised type while hovering and read the files only in onDrop.
  return Array.from(dataTransfer.types).includes("Files");
}

async function fetchEntries(dirPath: string, showHidden = false): Promise<FileNode[]> {
  const encoded = encodeFilePathForApi(dirPath);
  const res = await fetch(`/api/files/${encoded}?type=list${showHidden ? "&showHidden=1" : ""}`);
  if (!res.ok) {
    let message = `Failed to load files (HTTP ${res.status})`;
    try {
      const data = await res.json() as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // ignore non-JSON error bodies
    }
    throw new Error(message);
  }
  const data = await res.json() as { entries?: FileEntry[] };
  return (data.entries ?? []).map((e) => ({
    name: e.name,
    fullPath: joinFilePath(dirPath, e.name),
    isDir: e.isDir,
    size: e.size,
    children: e.isDir ? [] : undefined,
    loaded: !e.isDir,
  }));
}

function uploadFiles(
  targetDirectory: string,
  files: File[],
  strategy: UploadConflictStrategy,
  onProgress: (progress: number) => void,
): Promise<{ status: number; data: UploadResponse }> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file, file.name));

    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `/api/files/${encodeFilePathForApi(targetDirectory)}?type=upload&conflict=${strategy}`,
    );
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onerror = () => reject(new Error("Network error while uploading files"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.onload = () => {
      let data: UploadResponse = {};
      try {
        data = JSON.parse(xhr.responseText) as UploadResponse;
      } catch {
        if (xhr.responseText) data.error = xhr.responseText;
      }
      resolve({ status: xhr.status, data });
    };
    xhr.send(formData);
  });
}

function DismissButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{ width: 24, height: 24, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: "none", borderRadius: 4, background: "none", color: "var(--text-dim)", cursor: "pointer" }}
      onMouseEnter={(event) => { event.currentTarget.style.color = "var(--text-muted)"; event.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text-dim)"; event.currentTarget.style.background = "none"; }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <path d="m6 6 12 12" />
        <path d="m18 6-12 12" />
      </svg>
    </button>
  );
}

function MentionIcon() {
  return <span aria-hidden="true">@</span>;
}

function TreeNode({
  node,
  depth,
  cwd,
  onOpenFile,
  onAtMention,
  expandedPaths,
  onToggleExpanded,
  refreshToken,
  highlightedPaths,
  draggedPaths,
  dropTargetPath,
  deletingPaths,
  selectedPaths,
  onSelect,
  onDragStart,
  onDragEnd,
  onDropTarget,
  onDropFiles,
  onMove,
  onDelete,
  onContextMenu,
  isPinned = false,
  pinnedDraggedPath = null,
  pinnedDropTargetPath = null,
  onPinnedDragStart,
  onPinnedDropTarget,
  onPinnedDrop,
  showHidden,
  t,
}: {
  node: FileNode;
  depth: number;
  cwd: string;
  onOpenFile: (filePath: string, fileName: string) => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  expandedPaths: Set<string>;
  onToggleExpanded: (fullPath: string, open: boolean) => void;
  refreshToken?: string;
  highlightedPaths: Set<string>;
  draggedPaths: string[];
  dropTargetPath: string | null;
  deletingPaths: Set<string>;
  selectedPaths: Set<string>;
  onSelect: (node: FileNode, depth: number, event: React.MouseEvent<HTMLDivElement>) => void;
  onDragStart: (node: FileNode, paths: string[]) => void;
  onDragEnd: () => void;
  onDropTarget: (targetPath: string) => void;
  onDropFiles: (targetDirectory: string, files: File[]) => void;
  onMove: (sourcePaths: string[], targetDirectory: string) => void;
  onDelete: (node: FileNode, depth: number) => void;
  onContextMenu: (node: FileNode, depth: number, event: React.MouseEvent<HTMLDivElement>) => void;
  isPinned?: boolean;
  pinnedDraggedPath?: string | null;
  pinnedDropTargetPath?: string | null;
  onPinnedDragStart?: (node: FileNode) => void;
  onPinnedDropTarget?: (targetPath: string) => void;
  onPinnedDrop?: (sourcePath: string, targetPath: string, insertAfter: boolean) => void;
  showHidden: boolean;
  t: Translate;
}) {
  const open = expandedPaths.has(node.fullPath);
  const highlighted = highlightedPaths.has(node.fullPath);
  const [children, setChildren] = useState<FileNode[]>(node.children ?? []);
  const [loaded, setLoaded] = useState(node.loaded ?? false);
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const deleting = deletingPaths.has(node.fullPath);
  const selected = selectedPaths.has(node.fullPath);
  const dropTarget = dropTargetPath === node.fullPath;
  const pinnedDropTarget = pinnedDropTargetPath === node.fullPath;

  const loadChildren = useCallback(async (force = false) => {
    if (loaded && !force) return;
    setLoading(true);
    try {
      const entries = await fetchEntries(node.fullPath, showHidden);
      setChildren(entries);
      setLoaded(true);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [loaded, node.fullPath, showHidden]);

  // Re-fetch children when the tree refreshes and the directory is open.
  // This also loads a closed destination folder after it receives a drop.
  useEffect(() => {
    if (refreshToken !== undefined && open) {
      loadChildren(loaded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken, showHidden]);

  const handleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    onSelect(node, depth, event);
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (node.isDir) {
      const next = !open;
      onToggleExpanded(node.fullPath, next);
      if (next && !loaded) loadChildren();
    } else {
      onOpenFile(node.fullPath, node.name);
    }
  }, [depth, node, loaded, open, loadChildren, onOpenFile, onSelect, onToggleExpanded]);

  const handleDragStart = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (deleting) {
      event.preventDefault();
      return;
    }
    const paths = selected ? [...selectedPaths] : [node.fullPath];
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-pi-web-file", JSON.stringify(paths));
    if (isPinned && paths.length === 1) event.dataTransfer.setData("application/x-pi-web-pin", node.fullPath);
    event.dataTransfer.setData("text/plain", node.name);
    onDragStart(node, paths);
    if (isPinned && paths.length === 1) onPinnedDragStart?.(node);
  }, [deleting, isPinned, node, onDragStart, onPinnedDragStart, selected, selectedPaths]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (deleting) return;
    const draggedPinPath = pinnedDraggedPath ?? event.dataTransfer.getData("application/x-pi-web-pin");
    if (isPinned && draggedPinPath && draggedPinPath !== node.fullPath) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      onPinnedDropTarget?.(node.fullPath);
      return;
    }
    if (!node.isDir) return;
    const externalFiles = hasExternalFiles(event.dataTransfer);
    const internalFile = draggedPaths.length > 0 || Array.from(event.dataTransfer.types).includes("application/x-pi-web-file");
    if (!externalFiles && !internalFile) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = externalFiles ? "copy" : "move";
    onDropTarget(node.fullPath);
  }, [deleting, draggedPaths.length, isPinned, node.fullPath, node.isDir, onDropTarget, onPinnedDropTarget, pinnedDraggedPath]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (deleting) return;
    const pinSourcePath = pinnedDraggedPath ?? event.dataTransfer.getData("application/x-pi-web-pin");
    if (isPinned && pinSourcePath && pinSourcePath !== node.fullPath) {
      event.preventDefault();
      event.stopPropagation();
      const bounds = event.currentTarget.getBoundingClientRect();
      onPinnedDrop?.(pinSourcePath, node.fullPath, event.clientY > bounds.top + bounds.height / 2);
      onDragEnd();
      return;
    }
    if (!node.isDir) return;
    const files = hasExternalFiles(event.dataTransfer) ? Array.from(event.dataTransfer.files) : [];
    const rawPaths = event.dataTransfer.getData("application/x-pi-web-file");
    let sourcePaths = draggedPaths;
    if (sourcePaths.length === 0 && rawPaths) {
      try {
        const parsed: unknown = JSON.parse(rawPaths);
        sourcePaths = Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [rawPaths];
      } catch {
        sourcePaths = [rawPaths];
      }
    }
    if (files.length === 0 && sourcePaths.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (files.length > 0) onDropFiles(node.fullPath, files);
    else onMove(sourcePaths.filter((sourcePath) => sourcePath !== node.fullPath), node.fullPath);
    onDragEnd();
  }, [deleting, draggedPaths, isPinned, node.fullPath, node.isDir, onDragEnd, onDropFiles, onMove, onPinnedDrop, pinnedDraggedPath]);

  return (
    <div>
      <div
        draggable={!deleting}
        data-file-explorer-path={node.fullPath}
        onClick={handleClick}
        onDragStart={handleDragStart}
        onDragEnd={onDragEnd}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDrop={handleDrop}
        onContextMenu={(event) => onContextMenu(node, depth, event)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 4,
          paddingLeft: 8 + depth * 14,
          paddingRight: 8,
          height: 24,
          cursor: deleting ? "wait" : isPinned ? "grab" : "pointer",
          background: dropTarget || pinnedDropTarget
            ? "color-mix(in srgb, var(--accent) 18%, var(--bg-hover))"
            : selected ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : isPinned ? "color-mix(in srgb, var(--accent) 6%, transparent)" : "transparent",
          outline: dropTarget || pinnedDropTarget ? "1px solid var(--accent)" : "none",
          borderRadius: 4,
          userSelect: "none",
        }}
      >
        {node.isDir && (
          <svg
            width="10" height="10" viewBox="0 0 10 10" fill="none"
            stroke="var(--text-dim)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            style={{ flexShrink: 0, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.1s" }}
          >
            <polyline points="3 2 7 5 3 8" />
          </svg>
        )}
        {!node.isDir && <span style={{ width: 10, flexShrink: 0 }} />}
        <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
          {node.isDir ? <FolderIcon size={14} open={open} /> : getFileIcon(node.name, 14)}
        </span>
        {isPinned && (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
            <path d="M12 17v5" /><path d="m9 3 6 6" /><path d="m15 3-6 6" /><path d="M5 12h14" /><path d="m8 12 1-3h6l1 3" />
          </svg>
        )}
        <span
          style={{
            fontSize: 12,
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
          title={node.fullPath}
        >
          {node.name}
        </span>
        {highlighted && (
          <span
            title={t("files.newlyUploaded")}
            aria-label={t("files.newlyUploaded")}
            style={{ width: 14, height: 14, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#3b82f6" }} />
          </span>
        )}
        {loading && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
          </svg>
        )}
        {onAtMention && hovered && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAtMention(getRelativeFilePath(node.fullPath, cwd), node.isDir);
            }}
            title={t("files.insertPath")}
            style={{
              position: "absolute",
              right: !node.isDir ? 28 : 4,
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 8px",
              height: 20,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--accent)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            <MentionIcon />
          </button>
        )}
        {hovered && !node.isDir && (
          <a
            href={`/api/files/${encodeFilePathForApi(node.fullPath)}?type=download`}
            download
            onClick={(e) => e.stopPropagation()}
            title={t("files.download")}
            style={{
              position: "absolute",
              right: 4,
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              padding: "0 5px",
              height: 20,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: "nowrap",
              textDecoration: "none",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </a>
        )}
      </div>
      {node.isDir && open && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              cwd={cwd}
              onOpenFile={onOpenFile}
              onAtMention={onAtMention}
              expandedPaths={expandedPaths}
              onToggleExpanded={onToggleExpanded}
              refreshToken={refreshToken}
              highlightedPaths={highlightedPaths}
              draggedPaths={draggedPaths}
              dropTargetPath={dropTargetPath}
              deletingPaths={deletingPaths}
              selectedPaths={selectedPaths}
              onSelect={onSelect}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDropTarget={onDropTarget}
              onDropFiles={onDropFiles}
              onMove={onMove}
              onDelete={onDelete}
              onContextMenu={onContextMenu}
              showHidden={showHidden}
              t={t}
            />
          ))}
          {children.length === 0 && loaded && (
            <div style={{ paddingLeft: 8 + (depth + 1) * 14, fontSize: 11, color: "var(--text-dim)", height: 22, display: "flex", alignItems: "center" }}>
              empty
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const FileExplorer = forwardRef<FileExplorerHandle, Props>(function FileExplorer({
  cwd,
  onOpenFile,
  refreshKey,
  onAtMention,
  onAtMentions,
  onUploadBusyChange,
  fileSearchOpen = false,
  onFileSearchOpenChange,
}, ref) {
  const { t } = useI18n();
  const [roots, setRoots] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const [highlightedPaths, setHighlightedPaths] = useState<Set<string>>(new Set());
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(null);
  const [pendingConflict, setPendingConflict] = useState<PendingConflict | null>(null);
  const [draggedPaths, setDraggedPaths] = useState<string[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [deletingPaths, setDeletingPaths] = useState<Set<string>>(new Set());
  const [moveBusy, setMoveBusy] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolderBusy, setCreatingFolderBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ node: FileNode; depth: number; paths: string[]; x: number; y: number } | null>(null);
  const [pinnedNames, setPinnedNames] = useState<string[]>([]);
  const [pinnedDraggedPath, setPinnedDraggedPath] = useState<string | null>(null);
  const [pinnedDropTargetPath, setPinnedDropTargetPath] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchPaths, setSearchPaths] = useState<string[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const prevCwdRef = useRef<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const explorerRef = useRef<HTMLDivElement>(null);
  const selectionAnchorPathRef = useRef<string | null>(null);
  const pinMutationRef = useRef(Promise.resolve());
  const refreshToken = `${refreshKey ?? 0}:${treeRefreshKey}`;
  const uploadBusy = uploadPhase !== "idle";
  const operationBusy = uploadBusy || moveBusy || creatingFolderBusy || deletingPaths.size > 0;
  const hasSearchQuery = searchQuery.trim().length > 0;

  // Reuse the cached, bounded file index used by @ mentions.
  useEffect(() => {
    if (!fileSearchOpen) return;
    const query = searchQuery.trim();
    if (!query) {
      setSearchPaths([]);
      setSearchLoading(false);
      setSearchError(false);
      return;
    }
    const controller = new AbortController();
    setSearchLoading(true);
    setSearchError(false);
    const timer = setTimeout(() => {
      fetch(`/api/file-index?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<{ matches?: FileIndexEntry[] }> : Promise.reject(new Error("Search failed")))
        .then((data) => setSearchPaths((data.matches ?? []).filter((entry) => !entry.isDir).map((entry) => entry.path)))
        .catch(() => {
          if (!controller.signal.aborted) {
            setSearchPaths([]);
            setSearchError(true);
          }
        })
        .finally(() => { if (!controller.signal.aborted) setSearchLoading(false); });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [cwd, fileSearchOpen, searchQuery]);

  // Focus the search input whenever the search panel opens.
  useEffect(() => {
    if (fileSearchOpen) searchInputRef.current?.focus();
  }, [fileSearchOpen]);

  useEffect(() => {
    if (creatingFolder) newFolderInputRef.current?.focus();
  }, [creatingFolder]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || !event.shiftKey || event.code !== "Period") return;
      event.preventDefault();
      setShowHidden((visible) => !visible);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("resize", close);
    };
  }, [contextMenu]);

  const persistPinnedNames = useCallback((paths: string[], targetCwd = cwd) => {
    pinMutationRef.current = pinMutationRef.current
      .catch(() => undefined)
      .then(async () => {
        const response = await fetch("/api/file-explorer/pins", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd: targetCwd, paths }),
        });
        const data = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(data.error ?? `Could not save pinned files (HTTP ${response.status})`);
      })
      .catch((pinFailure) => {
        setUploadError(pinFailure instanceof Error ? pinFailure.message : String(pinFailure));
      });
  }, [cwd]);

  useEffect(() => {
    let cancelled = false;
    setPinnedNames([]);
    fetch(`/api/file-explorer/pins?cwd=${encodeURIComponent(cwd)}`)
      .then((response) => response.ok
        ? response.json() as Promise<{ paths?: unknown }>
        : Promise.reject(new Error(`Could not load pinned files (HTTP ${response.status})`)))
      .then((data) => {
        if (!cancelled && Array.isArray(data.paths) && data.paths.every((name) => typeof name === "string")) {
          setPinnedNames(data.paths);
        }
      })
      .catch((pinFailure) => {
        if (!cancelled) setUploadError(pinFailure instanceof Error ? pinFailure.message : String(pinFailure));
      });
    return () => { cancelled = true; };
  }, [cwd]);

  // Results render as a tree; keep every directory that contains a match
  // expanded, while preserving the user's manual collapses as they type.
  useEffect(() => {
    if (searchPaths.length === 0) return;
    const dirs = new Set<string>();
    for (const relative of searchPaths) {
      const parts = relative.split("/");
      let path = "";
      for (let i = 0; i < parts.length - 1; i++) {
        path = path ? `${path}/${parts[i]}` : parts[i];
        dirs.add(joinFilePath(cwd, path));
      }
    }
    setSearchExpanded((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const dir of dirs) {
        if (!next.has(dir)) { next.add(dir); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [cwd, searchPaths]);

  const searchRoots = useMemo(() => {
    const toFileNode = (node: SearchTreeNode): FileNode => ({
      name: node.name,
      fullPath: joinFilePath(cwd, node.path),
      isDir: node.isDir,
      size: 0,
      children: node.children.map(toFileNode),
      loaded: true,
    });
    return buildSearchTree(searchPaths).map(toFileNode);
  }, [cwd, searchPaths]);

  const pinnedRootNodes = useMemo(() => {
    const rootsByName = new Map(roots.map((node) => [node.name, node]));
    return pinnedNames.flatMap((name) => {
      const node = rootsByName.get(name);
      return node ? [node] : [];
    });
  }, [pinnedNames, roots]);
  const pinnedRootNames = useMemo(() => new Set(pinnedRootNodes.map((node) => node.name)), [pinnedRootNodes]);
  const unpinnedRootNodes = useMemo(
    () => roots.filter((node) => (
      !pinnedRootNames.has(node.name)
      && (showHidden || !node.name.startsWith("."))
    )),
    [pinnedRootNames, roots, showHidden],
  );

  const handleSelectNode = useCallback((node: FileNode, _depth: number, event: React.MouseEvent<HTMLDivElement>) => {
    const toggle = event.metaKey || event.ctrlKey;
    const anchorPath = selectionAnchorPathRef.current;
    if (event.shiftKey && anchorPath) {
      const visiblePaths = Array.from(
        explorerRef.current?.querySelectorAll<HTMLElement>("[data-file-explorer-path]") ?? [],
        (element) => element.dataset.fileExplorerPath,
      ).filter((path): path is string => Boolean(path));
      const start = visiblePaths.indexOf(anchorPath);
      const end = visiblePaths.indexOf(node.fullPath);
      if (start >= 0 && end >= 0) {
        setSelectedPaths(new Set(visiblePaths.slice(Math.min(start, end), Math.max(start, end) + 1)));
        return;
      }
    }
    selectionAnchorPathRef.current = node.fullPath;
    if (toggle) {
      setSelectedPaths((previous) => {
        const next = new Set(previous);
        if (next.has(node.fullPath)) next.delete(node.fullPath);
        else next.add(node.fullPath);
        return next;
      });
      return;
    }
    setSelectedPaths(new Set([node.fullPath]));
  }, []);

  const handleToggleExpanded = useCallback((fullPath: string, open: boolean) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (open) next.add(fullPath); else next.delete(fullPath);
      return next;
    });
  }, []);

  const applyUploadResult = useCallback((targetDirectory: string, data: UploadResponse) => {
    const uploaded = data.uploaded ?? [];
    const skipped = data.skipped ?? [];
    const errors = data.errors ?? [];
    setUploadSummary({ targetDirectory, uploaded, skipped, errors });

    if (uploaded.length > 0) {
      setHighlightedPaths(new Set(uploaded.map((name) => joinFilePath(targetDirectory, name))));
      if (targetDirectory !== cwd) {
        setExpandedPaths((previous) => new Set(previous).add(targetDirectory));
      }
      setTreeRefreshKey((key) => key + 1);
    }
  }, [cwd]);

  const performUpload = useCallback(async (
    targetDirectory: string,
    files: File[],
    strategy: UploadConflictStrategy,
  ) => {
    setPendingConflict(null);
    setUploadError(null);
    setUploadProgress(0);
    setUploadPhase("uploading");

    try {
      const { status, data } = await uploadFiles(targetDirectory, files, strategy, setUploadProgress);
      if (status === 409 && data.conflicts?.length) {
        setPendingConflict({
          targetDirectory,
          files,
          conflicts: data.conflicts,
          nonReplaceable: data.nonReplaceable ?? [],
        });
        return;
      }
      if (status < 200 || status >= 300) {
        throw new Error(data.error ?? `Upload failed (HTTP ${status})`);
      }
      setUploadProgress(100);
      applyUploadResult(targetDirectory, data);
    } catch (uploadFailure) {
      setUploadError(uploadFailure instanceof Error ? uploadFailure.message : String(uploadFailure));
    } finally {
      setUploadPhase("idle");
    }
  }, [applyUploadResult]);

  const prepareUpload = useCallback(async (targetDirectory: string, files: File[]) => {
    if (files.length === 0 || operationBusy) return;
    setUploadSummary(null);
    setHighlightedPaths(new Set());
    setPendingConflict(null);
    setUploadError(null);
    setUploadProgress(0);
    setUploadPhase("checking");

    try {
      const res = await fetch(
        `/api/files/${encodeFilePathForApi(targetDirectory)}?type=upload-check`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileNames: files.map((file) => file.name) }),
        },
      );
      const data = await res.json().catch(() => ({})) as UploadResponse;
      if (!res.ok) throw new Error(data.error ?? `Upload check failed (HTTP ${res.status})`);

      if (data.conflicts?.length) {
        setPendingConflict({
          targetDirectory,
          files,
          conflicts: data.conflicts,
          nonReplaceable: data.nonReplaceable ?? [],
        });
        return;
      }

      await performUpload(targetDirectory, files, "error");
    } catch (uploadFailure) {
      setUploadError(uploadFailure instanceof Error ? uploadFailure.message : String(uploadFailure));
    } finally {
      setUploadPhase("idle");
    }
  }, [operationBusy, performUpload]);

  const handleUploadInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void prepareUpload(cwd, files);
  }, [cwd, prepareUpload]);

  useImperativeHandle(ref, () => ({
    openUploadPicker() {
      if (!operationBusy) uploadInputRef.current?.click();
    },
    startCreateFolder() {
      if (!operationBusy) {
        setNewFolderName("");
        setCreatingFolder(true);
      }
    },
  }), [operationBusy]);

  useEffect(() => {
    onUploadBusyChange?.(operationBusy);
  }, [onUploadBusyChange, operationBusy]);

  useEffect(() => () => onUploadBusyChange?.(false), [onUploadBusyChange]);

  useEffect(() => {
    const cwdChanged = prevCwdRef.current !== cwd;
    prevCwdRef.current = cwd;

    // Reset expanded state only when cwd changes, not on refreshKey bumps
    if (cwdChanged) {
      setExpandedPaths(new Set());
      setHighlightedPaths(new Set());
      setUploadSummary(null);
      setPendingConflict(null);
      setUploadError(null);
      setSelectedPaths(new Set());
      selectionAnchorPathRef.current = null;
    }

    setLoading(cwdChanged);
    setError(null);
    let cancelled = false;
    // Keep root dot entries in memory so a previously pinned one remains
    // visible even after the regular hidden-files view is switched off.
    fetchEntries(cwd, true)
      .then((entries) => { if (!cancelled) setRoots(entries); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cwd, refreshKey, showHidden, treeRefreshKey]);

  const showUploadFeedback = uploadBusy || pendingConflict !== null || uploadError !== null || uploadSummary !== null;

  const addUploadedFilesToChat = useCallback(() => {
    if (!uploadSummary || uploadSummary.uploaded.length === 0) return;
    onAtMentions?.(
      uploadSummary.uploaded.map((name) => getRelativeFilePath(joinFilePath(uploadSummary.targetDirectory, name), cwd)),
    );
  }, [cwd, onAtMentions, uploadSummary]);

  const clearDragState = useCallback(() => {
    setDraggedPaths([]);
    setDropTargetPath(null);
    setPinnedDraggedPath(null);
    setPinnedDropTargetPath(null);
  }, []);

  const savePinnedNames = useCallback((next: string[]) => {
    setPinnedNames(next);
    persistPinnedNames(next);
  }, [persistPinnedNames]);

  const togglePinnedPaths = useCallback((paths: string[]) => {
    const names = paths.map((filePath) => getRelativeFilePath(filePath, cwd));
    if (names.length === 0 || names.some((name) => name.includes("/"))) return;
    const allPinned = names.every((name) => pinnedNames.includes(name));
    const next = allPinned
      ? pinnedNames.filter((name) => !names.includes(name))
      : [...pinnedNames, ...names.filter((name) => !pinnedNames.includes(name))];
    savePinnedNames(next);
  }, [cwd, pinnedNames, savePinnedNames]);

  const reorderPinnedNodes = useCallback((sourcePath: string, targetPath: string, insertAfter: boolean) => {
    const sourceName = getRelativeFilePath(sourcePath, cwd);
    const targetName = getRelativeFilePath(targetPath, cwd);
    if (
      sourceName.includes("/")
      || targetName.includes("/")
      || sourceName === targetName
      || !pinnedNames.includes(sourceName)
      || !pinnedNames.includes(targetName)
    ) return;

    const next = pinnedNames.filter((name) => name !== sourceName);
    const targetIndex = next.indexOf(targetName);
    if (targetIndex < 0) return;
    next.splice(targetIndex + (insertAfter ? 1 : 0), 0, sourceName);
    savePinnedNames(next);
  }, [cwd, pinnedNames, savePinnedNames]);

  const topLevelOperationPaths = useCallback((paths: string[]) => {
    const unique = [...new Set(paths)];
    return unique.filter((candidate) => !unique.some(
      (other) => other !== candidate && candidate.startsWith(`${other}/`),
    ));
  }, []);

  const handleMove = useCallback(async (sourcePaths: string[], targetDirectory: string) => {
    const paths = topLevelOperationPaths(sourcePaths).filter((sourcePath) => sourcePath !== targetDirectory);
    if (operationBusy || paths.length === 0) return;
    setMoveBusy(true);
    setUploadError(null);
    try {
      for (const sourcePath of paths) {
        const response = await fetch(`/api/files/${encodeFilePathForApi(sourcePath)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ destinationDirectory: targetDirectory }),
        });
        const data = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(data.error ?? `Move failed (HTTP ${response.status})`);
      }
      setExpandedPaths((previous) => new Set(previous).add(targetDirectory));
      if (targetDirectory !== cwd) {
        const movedRootNames = new Set(paths.map((filePath) => getRelativeFilePath(filePath, cwd)).filter((name) => !name.includes("/")));
        if (movedRootNames.size > 0) savePinnedNames(pinnedNames.filter((name) => !movedRootNames.has(name)));
      }
      setSelectedPaths(new Set());
      selectionAnchorPathRef.current = null;
      setTreeRefreshKey((key) => key + 1);
    } catch (moveFailure) {
      setUploadError(moveFailure instanceof Error ? moveFailure.message : String(moveFailure));
    } finally {
      setMoveBusy(false);
    }
  }, [cwd, operationBusy, pinnedNames, savePinnedNames, topLevelOperationPaths]);

  const handleDelete = useCallback(async (sourcePaths: string[]) => {
    const paths = topLevelOperationPaths(sourcePaths);
    if (operationBusy || paths.length === 0) return;
    const confirmation = paths.length === 1
      ? t("files.deleteConfirm", { name: getRelativeFilePath(paths[0]!, cwd).split("/").pop()! })
      : t("files.deleteManyConfirm", { count: paths.length });
    if (!window.confirm(confirmation)) return;
    setDeletingPaths((previous) => new Set([...previous, ...paths]));
    setUploadError(null);
    try {
      for (const sourcePath of paths) {
        const response = await fetch(`/api/files/${encodeFilePathForApi(sourcePath)}`, { method: "DELETE" });
        const data = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(data.error ?? `Delete failed (HTTP ${response.status})`);
      }
      const deletedRootNames = new Set(paths.map((filePath) => getRelativeFilePath(filePath, cwd)).filter((name) => !name.includes("/")));
      if (deletedRootNames.size > 0) savePinnedNames(pinnedNames.filter((name) => !deletedRootNames.has(name)));
      setSelectedPaths(new Set());
      selectionAnchorPathRef.current = null;
      setTreeRefreshKey((key) => key + 1);
    } catch (deleteFailure) {
      setUploadError(deleteFailure instanceof Error ? deleteFailure.message : String(deleteFailure));
    } finally {
      setDeletingPaths((previous) => {
        const next = new Set(previous);
        paths.forEach((filePath) => next.delete(filePath));
        return next;
      });
    }
  }, [cwd, operationBusy, pinnedNames, savePinnedNames, t, topLevelOperationPaths]);

  const createFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name || operationBusy) return;
    setCreatingFolderBusy(true);
    setUploadError(null);
    try {
      const response = await fetch(`/api/files/${encodeFilePathForApi(cwd)}?type=mkdir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? `Create folder failed (HTTP ${response.status})`);
      setCreatingFolder(false);
      setNewFolderName("");
      setTreeRefreshKey((key) => key + 1);
    } catch (createFailure) {
      setUploadError(createFailure instanceof Error ? createFailure.message : String(createFailure));
    } finally {
      setCreatingFolderBusy(false);
    }
  }, [cwd, newFolderName, operationBusy]);

  const renameNode = useCallback(async (node: FileNode, depth: number) => {
    const name = window.prompt(t("files.renamePrompt"), node.name)?.trim();
    if (!name || name === node.name || operationBusy) return;
    setMoveBusy(true);
    setUploadError(null);
    try {
      const response = await fetch(`/api/files/${encodeFilePathForApi(node.fullPath)}?type=rename`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? `Rename failed (HTTP ${response.status})`);
      if (depth === 0 && pinnedNames.includes(node.name)) {
        savePinnedNames(pinnedNames.map((pinnedName) => pinnedName === node.name ? name : pinnedName));
      }
      setTreeRefreshKey((key) => key + 1);
    } catch (renameFailure) {
      setUploadError(renameFailure instanceof Error ? renameFailure.message : String(renameFailure));
    } finally {
      setMoveBusy(false);
    }
  }, [operationBusy, pinnedNames, savePinnedNames, t]);

  const handleContextMenu = useCallback((node: FileNode, depth: number, event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const paths = selectedPaths.has(node.fullPath) ? [...selectedPaths] : [node.fullPath];
    if (!selectedPaths.has(node.fullPath)) {
      setSelectedPaths(new Set(paths));
      selectionAnchorPathRef.current = node.fullPath;
    }
    setContextMenu({ node, depth, paths, x: event.clientX, y: event.clientY });
  }, [selectedPaths]);

  const handleRootDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const externalFiles = hasExternalFiles(event.dataTransfer);
    const internalFile = draggedPaths.length > 0 || Array.from(event.dataTransfer.types).includes("application/x-pi-web-file");
    if ((!externalFiles && !internalFile) || operationBusy) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = externalFiles ? "copy" : "move";
    setDropTargetPath(cwd);
  }, [cwd, draggedPaths.length, operationBusy]);

  const handleRootDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const files = hasExternalFiles(event.dataTransfer) ? Array.from(event.dataTransfer.files) : [];
    const rawPaths = event.dataTransfer.getData("application/x-pi-web-file");
    let sourcePaths = draggedPaths;
    if (sourcePaths.length === 0 && rawPaths) {
      try {
        const parsed: unknown = JSON.parse(rawPaths);
        sourcePaths = Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [rawPaths];
      } catch {
        sourcePaths = [rawPaths];
      }
    }
    if ((files.length === 0 && sourcePaths.length === 0) || operationBusy) return;
    event.preventDefault();
    clearDragState();
    if (files.length > 0) void prepareUpload(cwd, files);
    else void handleMove(sourcePaths, cwd);
  }, [clearDragState, cwd, draggedPaths, handleMove, operationBusy, prepareUpload]);

  const contextRootNames = contextMenu?.paths.map((filePath) => getRelativeFilePath(filePath, cwd)) ?? [];
  const canPinContextSelection = contextRootNames.length > 0 && contextRootNames.every((name) => !name.includes("/"));
  const contextSelectionIsPinned = canPinContextSelection && contextRootNames.every((name) => pinnedNames.includes(name));

  return (
    <div
      ref={explorerRef}
      onDragOver={handleRootDragOver}
      onDrop={handleRootDrop}
      onDragEnd={clearDragState}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clearDragState();
      }}
      style={{
        minHeight: "100%",
        background: dropTargetPath === cwd ? "color-mix(in srgb, var(--accent) 8%, transparent)" : undefined,
        outline: dropTargetPath === cwd ? "1px dashed var(--accent)" : undefined,
        outlineOffset: -1,
      }}
    >
      <input ref={uploadInputRef} type="file" multiple hidden onChange={handleUploadInput} />
      {creatingFolder && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void createFolder();
          }}
          style={{ display: "flex", alignItems: "center", gap: 5, height: 28, padding: "0 10px", borderBottom: "1px solid var(--border)" }}
        >
          <FolderIcon size={14} open />
          <input
            ref={newFolderInputRef}
            value={newFolderName}
            onChange={(event) => setNewFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setCreatingFolder(false);
                setNewFolderName("");
              }
            }}
            placeholder={t("files.newFolderName")}
            aria-label={t("files.newFolderName")}
            disabled={creatingFolderBusy}
            style={{ minWidth: 0, flex: 1, height: 20, padding: "0 4px", border: "1px solid var(--accent)", borderRadius: 3, outline: "none", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 12 }}
          />
        </form>
      )}
      {showUploadFeedback && (
        <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
        {uploadBusy && (
          <div role="status" aria-live="polite" aria-label={uploadPhase === "checking" ? t("files.checking") : t("files.uploading", { progress: uploadProgress })}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 14, color: "var(--text-muted)" }}>
              {uploadPhase === "checking" ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" style={{ animation: "spin 0.8s linear infinite" }} aria-hidden="true">
                  <path d="M21 12a9 9 0 1 1-5.7-8.4" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 16V4" />
                  <path d="m7 9 5-5 5 5" />
                  <path d="M5 20h14" />
                </svg>
              )}
              {uploadPhase === "uploading" && <span style={{ fontSize: 10 }}>{uploadProgress}%</span>}
            </div>
            {uploadPhase === "uploading" && (
              <div style={{ height: 3, marginTop: 4, overflow: "hidden", borderRadius: 2, background: "var(--border)" }}>
                <div style={{ width: `${uploadProgress}%`, height: "100%", background: "var(--text-muted)", transition: "width 120ms ease" }} />
              </div>
            )}
          </div>
        )}

        {pendingConflict && (
          <div role="alert" style={{ padding: 7, border: "1px solid color-mix(in srgb, #f59e0b 55%, var(--border))", borderRadius: 4, background: "color-mix(in srgb, #f59e0b 9%, var(--bg-panel))" }}>
            <div style={{ fontSize: 11, color: "var(--text)", lineHeight: 1.35, overflowWrap: "anywhere" }}>
              {t("files.conflictSummary", { count: pendingConflict.conflicts.length, countSuffix: pendingConflict.conflicts.length === 1 ? "" : "s", files: pendingConflict.conflicts.join(", ") })}
            </div>
            {pendingConflict.nonReplaceable.length > 0 && (
              <div style={{ marginTop: 3, fontSize: 10, color: "#f59e0b", lineHeight: 1.35, overflowWrap: "anywhere" }}>
                {t("files.cannotReplace", { files: pendingConflict.nonReplaceable.join(", ") })}
              </div>
            )}
            <div style={{ display: "flex", gap: 5, marginTop: 7 }}>
              <button type="button" onClick={() => void performUpload(pendingConflict.targetDirectory, pendingConflict.files, "overwrite")} style={{ height: 22, padding: "0 7px", border: "1px solid #ef4444", borderRadius: 4, background: "transparent", color: "#ef4444", cursor: "pointer", fontSize: 10 }}>
                {t("files.replace")}
              </button>
              <button type="button" onClick={() => void performUpload(pendingConflict.targetDirectory, pendingConflict.files, "skip")} style={{ height: 22, padding: "0 7px", border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg-panel)", color: "var(--text)", cursor: "pointer", fontSize: 10 }}>
                {t("files.skipExisting")}
              </button>
              <button type="button" onClick={() => setPendingConflict(null)} style={{ height: 22, padding: "0 7px", border: "none", borderRadius: 4, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 10 }}>
                {t("files.cancel")}
              </button>
            </div>
          </div>
        )}

        {uploadError && (
          <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 11, lineHeight: 1.35, color: "#f87171" }}>
            <span style={{ minWidth: 0, flex: 1, overflowWrap: "anywhere" }}>{uploadError}</span>
            <DismissButton onClick={() => setUploadError(null)} title={t("files.dismissError")} />
          </div>
        )}

        {uploadSummary && (
          <div aria-live="polite">
            <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 22, fontSize: 11 }}>
              <div style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                {uploadSummary.uploaded.length > 0 && (
                  <span title={`${uploadSummary.uploaded.length} uploaded`} aria-label={`${uploadSummary.uploaded.length} uploaded`} style={{ display: "flex", alignItems: "center", gap: 3, color: "#22c55e" }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m5 12 4 4L19 6" />
                    </svg>
                    <span>{uploadSummary.uploaded.length}</span>
                  </span>
                )}
                {uploadSummary.skipped.length > 0 && (
                  <span title={`${uploadSummary.skipped.length} skipped`} aria-label={`${uploadSummary.skipped.length} skipped`} style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--text-dim)" }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M8 12h8" />
                    </svg>
                    <span>{uploadSummary.skipped.length}</span>
                  </span>
                )}
                {uploadSummary.errors.length > 0 && (
                  <span title={`${uploadSummary.errors.length} failed`} aria-label={`${uploadSummary.errors.length} failed`} style={{ display: "flex", alignItems: "center", gap: 3, color: "#f87171" }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 3 2.5 20h19L12 3Z" />
                      <path d="M12 9v4" />
                      <path d="M12 17h.01" />
                    </svg>
                    <span>{uploadSummary.errors.length}</span>
                  </span>
                )}
              </div>
              {uploadSummary.uploaded.length > 0 && onAtMentions && (
                <button
                  type="button"
                  onClick={addUploadedFilesToChat}
                  title={uploadSummary.uploaded.length === 1 ? t("files.addUploadedFile") : t("files.addAllUploadedFiles")}
                  aria-label={uploadSummary.uploaded.length === 1 ? t("files.addUploadedFile") : t("files.addAllUploadedFiles")}
                  style={{ height: 22, padding: "0 7px", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, flexShrink: 0, border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg-panel)", color: "var(--accent)", cursor: "pointer", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}
                >
                  {t("files.mention")}
                </button>
              )}
              <DismissButton onClick={() => setUploadSummary(null)} title={t("files.dismissUploadResults")} />
            </div>
            {uploadSummary.errors.map((item) => (
              <div key={item.name} title={item.error} style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3, minWidth: 0, fontSize: 10, color: "#f87171" }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v5" />
                  <path d="M12 17h.01" />
                </svg>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
              </div>
            ))}
          </div>
        )}
        </div>
      )}

      {fileSearchOpen && (
      <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ position: "relative" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--text-dim)", pointerEvents: "none" }}>
            <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
          </svg>
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") onFileSearchOpenChange?.(false); }}
            placeholder={t("sidebar.searchFilesPlaceholder")}
            aria-label={t("sidebar.searchFiles")}
            style={{ width: "100%", boxSizing: "border-box", padding: "6px 24px", border: "1px solid var(--border)", borderRadius: 5, outline: "none", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 11 }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              title={t("sidebar.clearSearch")}
              aria-label={t("sidebar.clearSearch")}
              style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, padding: 0, border: "none", borderRadius: 4, background: "none", color: "var(--text-dim)", cursor: "pointer" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-dim)"; }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          )}
        </div>
        {hasSearchQuery && (
          <div style={{ paddingTop: 3 }}>
            {searchLoading && <div role="status" style={{ padding: "6px 2px", fontSize: 10, color: "var(--text-dim)" }}>{t("sidebar.searchingFiles")}</div>}
            {!searchLoading && searchError && <div role="alert" style={{ padding: "6px 2px", fontSize: 10, color: "#f87171" }}>{t("i18n.networkError")}</div>}
            {!searchLoading && !searchError && searchPaths.length === 0 && <div style={{ padding: "6px 2px", fontSize: 10, color: "var(--text-dim)" }}>{t("sidebar.noMatchingFiles")}</div>}
            {!searchLoading && !searchError && searchPaths.length > 0 && (
              <div>
                {searchRoots.map((node) => (
                  <TreeNode
                    key={`${searchQuery}:${node.fullPath}`}
                    node={node}
                    depth={0}
                    cwd={cwd}
                    onOpenFile={onOpenFile}
                    onAtMention={onAtMention}
                    expandedPaths={searchExpanded}
                    onToggleExpanded={(fullPath, open) => {
                      setSearchExpanded((prev) => {
                        const next = new Set(prev);
                        if (open) next.add(fullPath); else next.delete(fullPath);
                        return next;
                      });
                    }}
                    highlightedPaths={highlightedPaths}
                    draggedPaths={draggedPaths}
                    dropTargetPath={dropTargetPath}
                    deletingPaths={deletingPaths}
                    selectedPaths={selectedPaths}
                    onSelect={handleSelectNode}
                    onDragStart={(_node, paths) => setDraggedPaths(paths)}
                    onDragEnd={clearDragState}
                    onDropTarget={setDropTargetPath}
                    onDropFiles={(targetDirectory, files) => void prepareUpload(targetDirectory, files)}
                    onMove={(sourcePaths, targetDirectory) => void handleMove(sourcePaths, targetDirectory)}
                    onDelete={(node) => void handleDelete([node.fullPath])}
                    onContextMenu={handleContextMenu}
                    showHidden={showHidden}
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {(!fileSearchOpen || !hasSearchQuery) && (
        <div style={{ padding: "2px 4px" }}>
          {loading ? (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>Loading files...</div>
          ) : error ? (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "#f87171" }}>{error}</div>
          ) : (
            <>
              {pinnedRootNodes.length > 0 && (
                <div style={{ height: 22, padding: "0 8px", display: "flex", alignItems: "center", gap: 5, color: "var(--text-dim)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 17v5" /><path d="m9 3 6 6" /><path d="m15 3-6 6" /><path d="M5 12h14" /><path d="m8 12 1-3h6l1 3" />
                  </svg>
                  {t("files.pinnedSection")}
                </div>
              )}
              {pinnedRootNodes.map((node) => (
                <TreeNode
                  key={node.fullPath}
                  node={node}
                  depth={0}
                  cwd={cwd}
                  onOpenFile={onOpenFile}
                  onAtMention={onAtMention}
                  expandedPaths={expandedPaths}
                  onToggleExpanded={handleToggleExpanded}
                  refreshToken={refreshToken}
                  highlightedPaths={highlightedPaths}
                  draggedPaths={draggedPaths}
                  dropTargetPath={dropTargetPath}
                  deletingPaths={deletingPaths}
                  selectedPaths={selectedPaths}
                  onSelect={handleSelectNode}
                  onDragStart={(_node, paths) => setDraggedPaths(paths)}
                  onDragEnd={clearDragState}
                  onDropTarget={setDropTargetPath}
                  onDropFiles={(targetDirectory, files) => void prepareUpload(targetDirectory, files)}
                  onMove={(sourcePaths, targetDirectory) => void handleMove(sourcePaths, targetDirectory)}
                  onDelete={(node) => void handleDelete([node.fullPath])}
                  onContextMenu={handleContextMenu}
                  isPinned
                  pinnedDraggedPath={pinnedDraggedPath}
                  pinnedDropTargetPath={pinnedDropTargetPath}
                  onPinnedDragStart={(node) => setPinnedDraggedPath(node.fullPath)}
                  onPinnedDropTarget={setPinnedDropTargetPath}
                  onPinnedDrop={reorderPinnedNodes}
                  showHidden={showHidden}
                  t={t}
                />
              ))}
              {pinnedRootNodes.length > 0 && unpinnedRootNodes.length > 0 && (
                <div style={{ height: 1, margin: "4px 4px", background: "var(--border)" }} />
              )}
              {unpinnedRootNodes.map((node) => (
                <TreeNode
                  key={node.fullPath}
                  node={node}
                  depth={0}
                  cwd={cwd}
                  onOpenFile={onOpenFile}
                  onAtMention={onAtMention}
                  expandedPaths={expandedPaths}
                  onToggleExpanded={handleToggleExpanded}
                  refreshToken={refreshToken}
                  highlightedPaths={highlightedPaths}
                  draggedPaths={draggedPaths}
                  dropTargetPath={dropTargetPath}
                  deletingPaths={deletingPaths}
                  selectedPaths={selectedPaths}
                  onSelect={handleSelectNode}
                  onDragStart={(_node, paths) => setDraggedPaths(paths)}
                  onDragEnd={clearDragState}
                  onDropTarget={setDropTargetPath}
                  onDropFiles={(targetDirectory, files) => void prepareUpload(targetDirectory, files)}
                  onMove={(sourcePaths, targetDirectory) => void handleMove(sourcePaths, targetDirectory)}
                  onDelete={(node) => void handleDelete([node.fullPath])}
                  onContextMenu={handleContextMenu}
                  showHidden={showHidden}
                  t={t}
                />
              ))}
            </>
          )}
          {!loading && !error && roots.length === 0 && (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>
              {t("files.noFiles")}
            </div>
          )}
        </div>
      )}
      {contextMenu && (
        <div
          role="menu"
          style={{ position: "fixed", left: contextMenu.x, top: contextMenu.y, zIndex: 100, minWidth: 132, padding: 4, border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg-panel)", boxShadow: "0 6px 18px rgba(0, 0, 0, 0.2)" }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {canPinContextSelection && (
            <button type="button" role="menuitem" onClick={() => { togglePinnedPaths(contextMenu.paths); setContextMenu(null); }} style={{ width: "100%", height: 26, display: "flex", alignItems: "center", gap: 7, padding: "0 7px", border: "none", borderRadius: 3, background: "none", color: "var(--text)", cursor: "pointer", fontSize: 11, textAlign: "left" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 17v5" /><path d="m9 3 6 6" /><path d="m15 3-6 6" /><path d="M5 12h14" /><path d="m8 12 1-3h6l1 3" /></svg>
              {contextSelectionIsPinned ? t("files.unpin") : t("files.pin")}
            </button>
          )}
          {contextMenu.paths.length === 1 && (
            <button type="button" role="menuitem" onClick={() => { setContextMenu(null); void renameNode(contextMenu.node, contextMenu.depth); }} style={{ width: "100%", height: 26, display: "flex", alignItems: "center", gap: 7, padding: "0 7px", border: "none", borderRadius: 3, background: "none", color: "var(--text)", cursor: "pointer", fontSize: 11, textAlign: "left" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 20 9-9-3-3-9 9-1 4 4-1Z" /><path d="m15 8 3 3" /></svg>
              {t("files.edit")}
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => { setContextMenu(null); void handleDelete(contextMenu.paths); }} style={{ width: "100%", height: 26, display: "flex", alignItems: "center", gap: 7, padding: "0 7px", border: "none", borderRadius: 3, background: "none", color: "#ef4444", cursor: "pointer", fontSize: 11, textAlign: "left" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m6 6 1 14h10l1-14" /><path d="M10 10v6M14 10v6" /></svg>
            {t("files.delete")}
          </button>
        </div>
      )}
    </div>
  );
});
