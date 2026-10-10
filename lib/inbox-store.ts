import fs from "fs";
import path from "path";

/**
 * Files dropped into the chat or picked with the attach button are always
 * written to the workspace `inbox/` folder. A deployment can point that folder
 * somewhere else (for example a shared drop directory) with PI_WEB_INBOX_DIR.
 */
export const INBOX_DIR_NAME = "inbox";
export const MAX_INBOX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_INBOX_TOTAL_BYTES = 100 * 1024 * 1024;

const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f\\/:*?"<>|]/g;

/** Deployment-wide inbox location, or null when the workspace folder is used. */
export function getInboxRootOverride(): string | null {
  const configured = process.env.PI_WEB_INBOX_DIR?.trim();
  if (!configured || !path.isAbsolute(configured)) return null;
  return configured;
}

/**
 * Reduce a browser-supplied file name to a single safe path segment. Anything
 * that would escape the inbox or confuse the filesystem is replaced instead of
 * rejected so an odd name never blocks an otherwise fine upload.
 */
export function sanitizeInboxFileName(name: string | null | undefined): string {
  const base = path.basename((name ?? "").replace(/\\/g, "/"));
  const cleaned = base.replace(UNSAFE_NAME_CHARS, "_").replace(/^\.+/, "").trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return "file";
  return cleaned.slice(0, 200);
}

/** Split a name into stem and extension, keeping dotfiles intact. */
export function splitInboxFileName(fileName: string): { stem: string; ext: string } {
  const ext = path.extname(fileName);
  if (!ext || ext === fileName) return { stem: fileName, ext: "" };
  return { stem: fileName.slice(0, -ext.length), ext };
}

/** Never overwrite: an existing `photo.png` becomes `photo-2.png`. */
export function uniqueInboxFileName(directory: string, fileName: string): string {
  if (!fs.existsSync(path.join(directory, fileName))) return fileName;
  const { stem, ext } = splitInboxFileName(fileName);
  for (let counter = 2; counter < 10_000; counter += 1) {
    const candidate = `${stem}-${counter}${ext}`;
    if (!fs.existsSync(path.join(directory, candidate))) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

/**
 * Path shown to the agent: relative to the workspace when the inbox lives
 * inside it, absolute otherwise (deployment-wide override directory).
 */
export function inboxRelativePath(destination: string, cwd: string | null | undefined): string {
  if (cwd && path.isAbsolute(cwd)) {
    const relative = path.relative(cwd, destination);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      return relative.split(path.sep).join("/");
    }
  }
  return destination;
}

/** Absolute inbox directory for a workspace, created on demand. */
export function resolveInboxDirectory(cwd: string | null | undefined): string | null {
  const override = getInboxRootOverride();
  const base = override ?? (cwd && path.isAbsolute(cwd) ? cwd : null);
  if (!base) return null;
  return override ? base : path.join(base, INBOX_DIR_NAME);
}

export interface InboxSaveResult {
  name: string;
  path: string;
  relativePath: string;
  size: number;
}

export interface InboxSaveFailure {
  name: string;
  error: string;
}

export interface InboxSaveOutcome {
  saved: InboxSaveResult[];
  failed: InboxSaveFailure[];
}

/**
 * Write dropped files into the workspace inbox. Bytes are handed in already read
 * so this stays independent of the transport (multipart route or CLI).
 */
export function saveFilesToInbox(
  directory: string,
  files: Array<{ name: string; bytes: Buffer }>,
  cwd?: string | null,
): InboxSaveOutcome {
  fs.mkdirSync(directory, { recursive: true });
  const realDirectory = fs.realpathSync(directory);
  const saved: InboxSaveResult[] = [];
  const failed: InboxSaveFailure[] = [];

  for (const file of files) {
    const fileName = uniqueInboxFileName(realDirectory, sanitizeInboxFileName(file.name));
    const destination = path.join(realDirectory, fileName);
    try {
      // `wx` fails on a symlink or a file created between the name check and
      // the write, so an inbox symlink can never redirect an upload.
      fs.writeFileSync(destination, file.bytes, { flag: "wx" });
      saved.push({
        name: fileName,
        path: destination,
        relativePath: inboxRelativePath(destination, cwd ?? null),
        size: file.bytes.byteLength,
      });
    } catch (error) {
      failed.push({ name: fileName, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { saved, failed };
}
