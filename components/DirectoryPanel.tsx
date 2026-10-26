"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import { CheckIcon, FolderIcon, RefreshIcon, SearchIcon, TerminalIcon, UploadIcon } from "./SidebarIcons";

interface Props {
  /** The folder a chat message named. */
  directoryPath: string;
  /** Open a file of this folder in the file viewer. */
  onOpenFile: (filePath: string, fileName: string) => void;
  /** Open a terminal in this folder. */
  onOpenTerminal?: (cwd: string) => void;
}

const TOOL_BUTTON_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  padding: 0,
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "transparent",
  color: "var(--text-dim)",
  cursor: "pointer",
};

/**
 * A folder a chat message named, shown the way the Files section shows a
 * project: the same explorer, rooted at that folder, under a header row with
 * the same keys.
 */
export function DirectoryPanel({ directoryPath, onOpenFile, onOpenTerminal }: Props) {
  const { t } = useI18n();
  const explorerRef = useRef<FileExplorerHandle>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshDone, setRefreshDone] = useState(false);
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [fileManager, setFileManager] = useState<{ supported: boolean; reason: string | null; platform?: string } | null>(null);
  const [fileManagerError, setFileManagerError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/open-in-explorer")
      .then((response) => response.json().catch(() => null))
      .then((body) => {
        if (cancelled || !body) return;
        setFileManager(body as { supported: boolean; reason: string | null; platform?: string });
      })
      .catch(() => { /* the key stays hidden */ });
    return () => { cancelled = true; };
  }, []);

  const openInFileManager = async () => {
    setFileManagerError(null);
    try {
      const response = await fetch("/api/open-in-explorer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: directoryPath }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        setFileManagerError(body.error ?? `HTTP ${response.status}`);
      }
    } catch (error) {
      setFileManagerError(error instanceof Error ? error.message : String(error));
    }
  };

  const fileManagerLabel = t(
    fileManager?.platform === "darwin"
      ? "sidebar.openInFinder"
      : fileManager?.platform === "win32"
        ? "sidebar.openInExplorer"
        : "sidebar.openInFileManager",
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* The Files section's header row: what this folder is, then the keys
          that work on a folder. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 8px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
        }}
      >
        <FolderIcon size={14} />
        <span
          title={directoryPath}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "var(--font-mono)",
            color: "var(--text-dim)",
          }}
        >
          {directoryPath}
        </span>
        <div role="group" aria-label={t("sidebar.fileActions")} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {onOpenTerminal && (
            <button
              type="button"
              onClick={() => onOpenTerminal(directoryPath)}
              title={t("terminal.open")}
              aria-label={t("terminal.open")}
              style={TOOL_BUTTON_STYLE}
            >
              <TerminalIcon size={13} />
            </button>
          )}
          {fileManager?.supported && (
            <button
              type="button"
              onClick={() => void openInFileManager()}
              title={fileManagerLabel}
              aria-label={fileManagerLabel}
              style={TOOL_BUTTON_STYLE}
            >
              <FolderIcon size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={() => explorerRef.current?.openUploadPicker()}
            title={t("sidebar.uploadFilesTitle")}
            aria-label={t("sidebar.uploadFilesTitle")}
            style={TOOL_BUTTON_STYLE}
          >
            <UploadIcon size={13} />
          </button>
          <button
            type="button"
            onClick={() => {
              setRefreshKey((key) => key + 1);
              setRefreshDone(true);
              setTimeout(() => setRefreshDone(false), 2000);
            }}
            title={t("sidebar.refreshExplorer")}
            aria-label={t("sidebar.refreshExplorer")}
            style={TOOL_BUTTON_STYLE}
          >
            {refreshDone ? <CheckIcon size={13} /> : <RefreshIcon size={13} />}
          </button>
          <button
            type="button"
            onClick={() => setFileSearchOpen((open) => !open)}
            title={t("sidebar.searchFiles")}
            aria-label={t("sidebar.searchFiles")}
            aria-expanded={fileSearchOpen}
            aria-controls="file-search-input"
            style={TOOL_BUTTON_STYLE}
          >
            <SearchIcon size={13} />
          </button>
        </div>
      </div>

      {fileManagerError && (
        <div role="alert" style={{ padding: "4px 8px", fontSize: 11, color: "#f87171" }}>
          {fileManagerError}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <FileExplorer
          ref={explorerRef}
          cwd={directoryPath}
          onOpenFile={onOpenFile}
          refreshKey={refreshKey}
          fileSearchOpen={fileSearchOpen}
          onFileSearchOpenChange={setFileSearchOpen}
        />
      </div>
    </div>
  );
}
