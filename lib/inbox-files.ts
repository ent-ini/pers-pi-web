/**
 * Client side of the "files always land in inbox" flow: upload dropped or
 * picked files to the workspace inbox and turn the saved paths into the block
 * that is appended to the outgoing message.
 */

export interface InboxFileAttachment {
  name: string;
  path: string;
  relativePath: string;
  size: number;
}

export interface InboxUploadResult {
  saved: InboxFileAttachment[];
  failed: Array<{ name: string; error: string }>;
}

export function isInboxUploadableFile(file: Pick<File, "size">): boolean {
  return file.size > 0;
}

/**
 * Append saved inbox paths to the message text. Bare paths are what Pi Web
 * turns into clickable file attachments, and the agent resolves them against
 * its own working directory.
 */
export function buildInboxAttachmentText(text: string, paths: string[]): string {
  const trimmed = text.trim();
  const unique = [...new Set(paths.filter((entry) => entry && entry.trim()))];
  if (unique.length === 0) return trimmed;
  const block = unique.join("\n");
  return trimmed ? `${trimmed}\n\n${block}` : block;
}

export async function uploadFilesToInbox(
  files: File[],
  cwd: string | null,
): Promise<InboxUploadResult> {
  if (files.length === 0) return { saved: [], failed: [] };

  const formData = new FormData();
  for (const file of files) formData.append("files", file, file.name);

  const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
  const response = await fetch(`/api/inbox${query}`, { method: "POST", body: formData });
  const payload = await response.json().catch(() => null) as
    (Partial<InboxUploadResult> & { error?: string }) | null;

  if (!response.ok) {
    throw new Error(payload?.error || `Upload failed (${response.status})`);
  }

  const saved = Array.isArray(payload?.saved) ? payload.saved : [];
  const failed = Array.isArray(payload?.failed) ? payload.failed : [];
  return { saved, failed };
}
