import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import {
  getAllowedFileRoots,
  isExistingFilePathAllowed,
  isFilePathAllowed,
} from "@/lib/file-access";
import { isFilePathReferencedByEntries, isValidSessionId } from "@/lib/session-file-references-core";
import { getSessionEntries, resolveSessionPath } from "@/lib/session-reader";
import type { SessionEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

// A message rarely names more than a handful of paths, but a pasted log can
// name dozens. The cap keeps one request from turning into a stat storm.
const MAX_PATHS = 50;

/**
 * GET /api/file-kinds - what is each mentioned path: a file or a directory.
 *
 * The chat renders a file mention as a chip with its name and a directory
 * mention as a chip with the whole path, so the browser needs to know the
 * kind of a path it cannot stat itself.
 *
 * Authorization follows the file rules: a path inside an allowed root, or a
 * path the session itself mentions (a chat link opens such a file). A path
 * that may not be talked about is answered as "missing" rather than refused,
 * so the answer never reveals whether it exists.
 */
export async function GET(request: NextRequest) {
  const requested = request.nextUrl.searchParams.getAll("paths")
    .map((value) => value.trim())
    .filter((value) => value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\"))
    .slice(0, MAX_PATHS);
  const sessionId = request.nextUrl.searchParams.get("sessionId");

  const kinds: Record<string, "file" | "directory"> = {};
  if (requested.length === 0) return NextResponse.json({ kinds });

  const allowedRoots = await getAllowedFileRoots();
  let entries: SessionEntry[] | null = null;
  if (isValidSessionId(sessionId)) {
    try {
      const sessionPath = await resolveSessionPath(sessionId as string);
      if (sessionPath) entries = getSessionEntries(sessionPath);
    } catch {
      entries = null;
    }
  }

  for (const filePath of requested) {
    const allowed = isFilePathAllowed(filePath, allowedRoots)
      && isExistingFilePathAllowed(filePath, allowedRoots);
    const referenced = !allowed && entries !== null
      && isFilePathReferencedByEntries(filePath, entries);
    if (!allowed && !referenced) continue;

    try {
      const stat = fs.statSync(filePath);
      kinds[filePath] = stat.isDirectory() ? "directory" : "file";
    } catch {
      // A path that vanished between the mention and the lookup stays absent.
    }
  }

  return NextResponse.json({ kinds });
}
