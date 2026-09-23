import type { AgentMessage, AssistantContentBlock, AssistantMessage, ThinkingContent, ToolCallContent } from "./types";

interface DisplayOptions {
  isStreaming?: boolean;
}

export function getThinkingPreview(thinking: string): string {
  return thinking.trimStart().match(/^[^\r\n]{0,240}/u)?.[0].trimEnd() ?? "";
}

export function isMessageGroupAnchor(message: { role?: AgentMessage["role"]; customType?: string }): boolean {
  // A background subagent completion starts a new displayed turn, same as a
  // user message or compaction summary. Other custom messages stay inside the turn.
  return message.role === "user"
    || (message.role === "custom" && (
      message.customType === "compaction"
      || message.customType === "pi-web:subagent-notification"
    ));
}

export function isEmptyThinkingBlock(block: AssistantContentBlock, options: DisplayOptions = {}): block is ThinkingContent {
  return block.type === "thinking" && !block.deferred && !options.isStreaming && block.thinking.trim() === "";
}

export function getDisplayableAssistantBlocks(
  message: AssistantMessage,
  options: DisplayOptions = {},
): AssistantContentBlock[] {
  return (message.content ?? []).filter((block) => !isEmptyThinkingBlock(block, options));
}

export function getAssistantErrorMessage(
  message: AssistantMessage,
  options: DisplayOptions = {},
): string | null {
  if (options.isStreaming || message.stopReason !== "error") return null;
  return message.errorMessage?.trim() || "Unknown provider error";
}

/**
 * A turn that ended on `stopReason: "length"` spent its whole output budget
 * (often on reasoning alone) and produced no final answer; without a notice it
 * looks like a hung session. The copy lives in i18n (`chat.truncatedByOutputLimit`).
 */
export function isAssistantTruncated(
  message: AssistantMessage,
  options: DisplayOptions = {},
): boolean {
  return !options.isStreaming && message.stopReason === "length";
}

function isFinalAnswerBlock(block: AssistantContentBlock): boolean {
  return block.type === "text" || block.type === "image";
}

export function splitFinalAssistantBlocks(
  message: AssistantMessage,
  options: DisplayOptions = {},
): { answerBlocks: AssistantContentBlock[]; processBlocks: AssistantContentBlock[] } {
  const blocks = getDisplayableAssistantBlocks(message, options);
  const lastProcessIndex = blocks.findLastIndex((block) => !isFinalAnswerBlock(block));
  if (lastProcessIndex === -1) {
    return { answerBlocks: blocks, processBlocks: [] };
  }
  return {
    answerBlocks: blocks.slice(lastProcessIndex + 1),
    processBlocks: blocks.slice(0, lastProcessIndex + 1),
  };
}

/** A contiguous part of an assistant message for the completed-turn view.
 * `blockIndexOffset` keeps links to persisted block indices valid after the
 * message is rendered in separate process/details and visible-content views. */
export interface AssistantDisplaySegment {
  kind: "process" | "content";
  blocks: AssistantContentBlock[];
  blockIndexOffset: number;
}

/**
 * Separates an assistant message into technical process blocks (thinking and
 * tool calls) and user-visible content (text and images). Unlike
 * splitFinalAssistantBlocks(), this preserves text emitted between tool calls
 * so it can remain visible when surrounding process details are collapsed.
 */
export function splitAssistantBlocksForDisplay(
  message: AssistantMessage,
  options: DisplayOptions = {},
): AssistantDisplaySegment[] {
  const content = message.content ?? [];
  const segments: AssistantDisplaySegment[] = [];
  let kind: AssistantDisplaySegment["kind"] | null = null;
  let startIndex = -1;
  let endIndex = -1;

  const finish = () => {
    if (kind === null || startIndex < 0 || endIndex < 0) return;
    segments.push({
      kind,
      blocks: content.slice(startIndex, endIndex + 1),
      blockIndexOffset: startIndex,
    });
  };

  content.forEach((block, index) => {
    if (isEmptyThinkingBlock(block, options)) return;
    const nextKind: AssistantDisplaySegment["kind"] = isFinalAnswerBlock(block) ? "content" : "process";
    if (kind !== null && kind !== nextKind) finish();
    if (kind !== nextKind) startIndex = index;
    kind = nextKind;
    endIndex = index;
  });
  finish();

  return segments;
}

export function countToolCallBlocks(blocks: AssistantContentBlock[]): number {
  return blocks.filter((block): block is ToolCallContent => block.type === "toolCall").length;
}
