/**
 * What a mentioned path is on disk.
 *
 * The browser cannot stat the filesystem, so the server decides. Only the two
 * kinds the chat UI renders differently are worth keeping: a file chip shows
 * its name, a directory chip shows the whole path.
 */
export type PathKind = "file" | "directory";

/** A path that is known not to exist (yet). */
export type PathKindResult = PathKind | "missing";

interface PathKindEntry {
  kind: PathKindResult;
  expiresAt: number;
}

const MAX_CACHED_PATHS = 500;
// A file keeps its kind for a while: a chat may mention it again minutes
// later, and re-asking the server on every render is wasteful.
const KNOWN_KIND_TTL_MS = 5 * 60_000;
// A missing path is re-checked soon: the model often mentions a path in the
// same breath as the tool call that creates it.
const MISSING_KIND_TTL_MS = 30_000;

const pathKindCache = new Map<string, PathKindEntry>();

/** The cached kind of a path, if it is still fresh. */
export function getCachedPathKind(filePath: string): PathKindResult | undefined {
  const entry = pathKindCache.get(filePath);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    pathKindCache.delete(filePath);
    return undefined;
  }
  return entry.kind;
}

export function cachePathKind(filePath: string, kind: PathKindResult): void {
  if (pathKindCache.size >= MAX_CACHED_PATHS && !pathKindCache.has(filePath)) {
    const oldest = pathKindCache.keys().next().value;
    if (oldest !== undefined) pathKindCache.delete(oldest);
  }
  pathKindCache.set(filePath, {
    kind,
    expiresAt: Date.now() + (kind === "missing" ? MISSING_KIND_TTL_MS : KNOWN_KIND_TTL_MS),
  });
}

/** The paths whose kind is not known yet. */
export function collectUnknownPaths(paths: string[]): string[] {
  return paths.filter((filePath) => getCachedPathKind(filePath) === undefined);
}

/**
 * Ask the server what each path is.
 *
 * Paths the server may not talk about are answered as "missing": the client
 * must not learn whether a path outside the allowed roots exists.
 */
export async function fetchPathKinds(
  paths: string[],
  sessionId?: string | null,
): Promise<Map<string, PathKindResult>> {
  const kinds = new Map<string, PathKindResult>();
  if (paths.length === 0) return kinds;

  const params = new URLSearchParams();
  for (const filePath of paths) params.append("paths", filePath);
  if (sessionId) params.set("sessionId", sessionId);

  try {
    const response = await fetch(`/api/file-kinds?${params.toString()}`);
    if (!response.ok) return kinds;
    const body = await response.json().catch(() => null) as { kinds?: Record<string, string> } | null;
    const reported = body?.kinds ?? {};
    for (const filePath of paths) {
      const kind = reported[filePath];
      const result: PathKindResult = kind === "file" || kind === "directory" ? kind : "missing";
      kinds.set(filePath, result);
      cachePathKind(filePath, result);
    }
  } catch {
    // A failed lookup leaves the paths unknown: the chat renders them as
    // plain file chips, exactly as before this feature existed.
    return kinds;
  }

  return kinds;
}
