import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import {
  getAllowedFileRoots,
  isExistingFilePathAllowed,
  isFilePathAllowed,
  isWindowsAbsolutePath,
} from "@/lib/file-access";
import { getFileExplorerPinsStore } from "@/lib/file-explorer-pins";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const MAX_PINNED_PATHS = 500;
const MAX_PINNED_NAME_LENGTH = 255;

function isRootEntryName(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_PINNED_NAME_LENGTH
    && value !== "."
    && value !== ".."
    && !value.includes("/")
    && !value.includes("\\")
    && !value.includes("\0");
}

function parsePaths(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_PINNED_PATHS) return null;
  if (!value.every(isRootEntryName)) return null;
  const paths = value as string[];
  return new Set(paths).size === paths.length ? paths : null;
}

function existingRootEntryNames(cwd: string, paths: string[]): string[] {
  return paths.filter((entryName) => {
    if (!isRootEntryName(entryName)) return false;
    try {
      fs.lstatSync(path.join(cwd, entryName));
      return true;
    } catch {
      return false;
    }
  });
}

async function validateCwd(value: string | null): Promise<{ cwd: string } | { response: NextResponse }> {
  const cwd = value?.trim() ?? "";
  if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
    return { response: NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 }) };
  }

  const allowedRoots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, allowedRoots)) {
    return { response: NextResponse.json({ error: "Access denied" }, { status: 403 }) };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(cwd);
  } catch {
    return { response: NextResponse.json({ error: "Directory not found" }, { status: 404 }) };
  }
  if (!stat.isDirectory()) {
    return { response: NextResponse.json({ error: "Not a directory" }, { status: 400 }) };
  }
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return { response: NextResponse.json({ error: "Access denied" }, { status: 403 }) };
  }

  return { cwd };
}

export async function GET(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  try {
    const result = await validateCwd(request.nextUrl.searchParams.get("cwd"));
    if ("response" in result) return result.response;
    const store = getFileExplorerPinsStore();
    const storedPaths = store.list(result.cwd);
    const paths = existingRootEntryNames(result.cwd, storedPaths);
    if (paths.length !== storedPaths.length) store.replace(result.cwd, paths);
    return NextResponse.json({ paths });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(request)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await request.json().catch(() => null) as { cwd?: unknown; paths?: unknown } | null;
    const result = await validateCwd(typeof body?.cwd === "string" ? body.cwd : null);
    if ("response" in result) return result.response;
    const paths = parsePaths(body?.paths);
    if (!paths) {
      return NextResponse.json(
        { error: `paths must contain up to ${MAX_PINNED_PATHS} unique root-level file or folder names` },
        { status: 400 },
      );
    }
    return NextResponse.json({ paths: getFileExplorerPinsStore().replace(result.cwd, paths) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
