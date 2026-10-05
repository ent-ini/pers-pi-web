import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";
import { isApiRequestAllowed } from "@/lib/request-security";
import { parseFormDataWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import {
  MAX_INBOX_FILE_BYTES,
  MAX_INBOX_TOTAL_BYTES,
  getInboxRootOverride,
  resolveInboxDirectory,
  saveFilesToInbox,
} from "@/lib/inbox-store";

// Multipart boundaries and headers are not file bytes, but must be bounded too.
const MAX_INBOX_REQUEST_BYTES = MAX_INBOX_TOTAL_BYTES + 1024 * 1024;

/**
 * POST /api/inbox?cwd=<workspace>
 * Stores chat attachments (drag & drop, attach button, pasted images) in the
 * workspace `inbox/` folder and returns the paths the agent can open.
 */
export async function POST(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const rawCwd = request.nextUrl.searchParams.get("cwd");
  const cwd = rawCwd && rawCwd.trim() ? rawCwd.trim() : null;
  if (!cwd && !getInboxRootOverride()) {
    return NextResponse.json({ error: "Workspace directory is unknown" }, { status: 400 });
  }

  // Without a deployment-wide override the write target is derived from the
  // client-supplied cwd, so it must be a workspace the file APIs may touch.
  if (cwd && !getInboxRootOverride()) {
    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
  }

  const directory = resolveInboxDirectory(cwd);
  if (!directory) {
    return NextResponse.json({ error: "Inbox directory could not be resolved" }, { status: 400 });
  }

  let formData: FormData;
  try {
    formData = await parseFormDataWithinLimit(request, MAX_INBOX_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "Uploads must total 100MB or less" }, { status: 413 });
    }
    throw error;
  }

  const files = formData.getAll("files").filter((entry): entry is File => typeof entry !== "string");
  if (files.length === 0) {
    return NextResponse.json({ error: "No files selected" }, { status: 400 });
  }
  if (files.some((file) => file.size > MAX_INBOX_FILE_BYTES)) {
    return NextResponse.json({ error: "Each upload must be 25MB or smaller" }, { status: 413 });
  }
  if (files.reduce((total, file) => total + file.size, 0) > MAX_INBOX_TOTAL_BYTES) {
    return NextResponse.json({ error: "Uploads must total 100MB or less" }, { status: 413 });
  }

  try {
    const payload = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        bytes: Buffer.from(await file.arrayBuffer()),
      })),
    );
    const { saved, failed } = saveFilesToInbox(directory, payload, cwd);
    return NextResponse.json(
      { saved, failed },
      { status: failed.length > 0 && saved.length === 0 ? 207 : 200 },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
