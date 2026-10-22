/**
 * Helpers for the `[source:<client> ...]` metadata line that pi-web prepends
 * to every outgoing user message. The line is preserved in the underlying
 * message content (so the model and other clients can still see where the
 * message came from) but stripped when displayed in the pi-web UI.
 *
 * Format: a single bracketed line at the start of the message text, e.g.
 *   [source:pi-web type=text]
 * Followed by a newline and the actual user content.
 *
 * The strip regex intentionally matches any `[source:...]` prefix (not just
 * `[source:pi-web ...]`), so source tags from other clients (macOS-app,
 * Telegram, ...) are also hidden when their messages are viewed in pi-web.
 */

export const SOURCE_TAG = "[source:pi-web type=text]";

// Match a leading `[source:<token...>]` line, with optional trailing
// whitespace and at most one newline. Tolerant to other clients' variants
// (different keys, different ordering).
const SOURCE_TAG_RE = /^\[source:[^\]\n]+\]\s*\n?/;

export function withSourceTag(text: string): string {
  if (SOURCE_TAG_RE.test(text)) return text; // idempotent
  return `${SOURCE_TAG}\n${text}`;
}

export function stripSourceTag(text: string): string {
  return text.replace(SOURCE_TAG_RE, "");
}

// A source tag on a line of its own, anywhere in the text: the macOS client
// puts file attachments before the tag, so the tag is not always the first
// thing in the message. Titles use this rule — the tag is metadata, whatever
// line it sits on — while the chat keeps the stricter leading-only strip.
const SOURCE_TAG_LINE_RE = /^[ \t]*\[source:[^\]\n]+\][ \t]*$/;

export function stripSourceTagLines(text: string): string {
  if (!text.includes("[source:")) return text;
  const kept = text.split("\n").filter((line) => !SOURCE_TAG_LINE_RE.test(line));
  return kept.join("\n").trim();
}