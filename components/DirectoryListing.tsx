"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { encodeFilePathForApi, getFileDirectory } from "@/lib/file-paths";
import { FolderIcon, getFileIcon } from "./FileIcons";

interface DirectoryEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: string;
}

interface Props {
  directoryPath: string;
  /** Open a file of this folder in the file viewer. */
  onOpenFile?: (filePath: string) => void;
  /** Open a subfolder of this folder. */
  onOpenDirectory?: (directoryPath: string) => void;
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The listing of a folder a chat message named.
 *
 * A mentioned folder is not a file, so the file viewer cannot open it. This
 * panel lists what is inside, and every entry opens the way the explorer
 * opens it: a file in the viewer, a folder in another folder panel.
 */
export function DirectoryListing({ directoryPath, onOpenFile, onOpenDirectory }: Props) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<DirectoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);

    const url = `/api/files/${encodeFilePathForApi(directoryPath)}?type=list`;
    void fetch(url)
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { entries?: DirectoryEntry[]; error?: string } | null;
        if (cancelled) return;
        if (!response.ok) {
          setError(body?.error ?? response.statusText);
          return;
        }
        setEntries(body?.entries ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("network-error");
      });

    return () => {
      cancelled = true;
    };
  }, [directoryPath, reloadKey]);

  const parent = getFileDirectory(directoryPath);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, fontSize: 13 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--text-dim)",
          wordBreak: "break-all",
        }}
      >
        <FolderIcon size={14} />
        <span style={{ flex: 1 }}>{directoryPath}</span>
        {parent && parent !== directoryPath && (
          <button
            type="button"
            onClick={() => onOpenDirectory?.(parent)}
            title={t("files.directoryParent")}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-dim)",
              cursor: "pointer",
              fontSize: 11,
              padding: "2px 6px",
            }}
          >
            ..
          </button>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {error ? (
          <div style={{ padding: 12, color: "var(--text-dim)" }}>
            {error === "Access denied" ? t("files.directoryDenied") : error}
          </div>
        ) : entries === null ? (
          <div style={{ padding: 12, color: "var(--text-dim)" }}>{t("files.loading")}</div>
        ) : entries.length === 0 ? (
          <div style={{ padding: 12, color: "var(--text-dim)" }}>{t("files.directoryEmpty")}</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {entries.map((entry) => {
                const entryPath = `${directoryPath.replace(/\/+$/, "")}/${entry.name}`;
                return (
                  <tr key={entry.name}>
                    <td style={{ padding: "4px 12px", whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        onClick={() => (entry.isDir ? onOpenDirectory?.(entryPath) : onOpenFile?.(entryPath))}
                        title={entryPath}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          background: "transparent",
                          border: "none",
                          color: "var(--text)",
                          cursor: "pointer",
                          fontFamily: "var(--font-mono)",
                          fontSize: 12,
                          padding: 0,
                        }}
                      >
                        {entry.isDir ? <FolderIcon size={13} /> : getFileIcon(entry.name, 13)}
                        <span>{entry.name}</span>
                      </button>
                    </td>
                    <td style={{ padding: "4px 12px", color: "var(--text-dim)", fontSize: 11, textAlign: "right", whiteSpace: "nowrap" }}>
                      {entry.isDir ? "" : formatSize(entry.size)}
                    </td>
                    <td style={{ padding: "4px 12px", color: "var(--text-dim)", fontSize: 11, textAlign: "right", whiteSpace: "nowrap" }}>
                      {entry.modified ? new Date(entry.modified).toLocaleString() : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {error && (
        <div style={{ padding: "6px 12px", borderTop: "1px solid var(--border)" }}>
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-dim)",
              cursor: "pointer",
              fontSize: 11,
              padding: "2px 8px",
            }}
          >
            {t("files.retry")}
          </button>
        </div>
      )}
    </div>
  );
}
