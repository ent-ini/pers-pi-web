import { useEffect, useMemo, useState } from "react";
import { collectAttachmentPaths } from "@/lib/file-attachments";
import { fetchPathKinds, getCachedPathKind, type PathKind } from "@/lib/file-path-kinds";

/**
 * The kind of every absolute path a message mentions.
 *
 * The browser cannot stat the filesystem, so the server is asked once per
 * path and the answer is cached. A path the server does not answer for keeps
 * its default: the chat renders it as a file chip, as it always did.
 */
export function usePathKinds(
  markdown: string,
  sessionId?: string | null,
  options?: { enabled?: boolean },
): Map<string, PathKind> {
  const enabled = options?.enabled ?? true;
  const paths = useMemo(() => collectAttachmentPaths(markdown), [markdown]);
  const pathKey = paths.join("\n");
  const [kinds, setKinds] = useState<Map<string, PathKind>>(() => new Map());

  useEffect(() => {
    if (!enabled) return;
    const currentPaths = pathKey ? pathKey.split("\n") : [];
    const unknown = currentPaths.filter((filePath) => getCachedPathKind(filePath) === undefined);
    if (unknown.length === 0) return;

    let cancelled = false;
    void fetchPathKinds(unknown, sessionId).then((fetched) => {
      if (cancelled) return;
      const found = [...fetched].filter(([, kind]) => kind !== "missing") as [string, PathKind][];
      if (found.length === 0) return;
      setKinds((previous) => {
        const next = new Map(previous);
        for (const [filePath, kind] of found) next.set(filePath, kind);
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, pathKey, sessionId]);

  return useMemo(() => {
    const result = new Map<string, PathKind>();
    for (const filePath of paths) {
      const kind = kinds.get(filePath) ?? getCachedPathKind(filePath);
      if (kind === "file" || kind === "directory") result.set(filePath, kind);
    }
    return result;
  }, [paths, kinds]);
}
