"use client";

import { useState, useCallback, useRef } from "react";
import type { DroppedItem } from "@/lib/file-upload-client";

/** A drag carries files when any item is a file (not text, not a link). */
export function dragHasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  const items = Array.from(dataTransfer.items ?? []);
  if (items.length > 0) return items.some((item) => item.kind === "file");
  return Array.from(dataTransfer.files ?? []).length > 0;
}

/**
 * Reads a drop's files and folders. `webkitGetAsEntry()` only answers during
 * the drop event, so this has to run inside the handler. A folder is told by
 * its entry first: some browsers return no `File` for it.
 */
function droppedItems(dataTransfer: DataTransfer): DroppedItem[] {
  const items: DroppedItem[] = [];
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory) {
      items.push({ kind: "folder", name: entry.name });
      continue;
    }
    const file = item.getAsFile();
    if (file) items.push({ kind: "file", file });
  }
  if (items.length > 0) return items;
  return Array.from(dataTransfer.files).map((file) => ({ kind: "file", file }));
}

export function useDragDrop(onDrop: (items: DroppedItem[]) => void) {
  const [isDragOver, setIsDragOver] = useState(false);
  const counterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    counterRef.current += 1;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragLeave = useCallback(() => {
    counterRef.current -= 1;
    if (counterRef.current <= 0) {
      counterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer?.files ?? []);
    // preventDefault also for an empty file list: a file drop that lands on the
    // document makes the browser navigate away and lose the session.
    if (files.length === 0 && !dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    counterRef.current = 0;
    setIsDragOver(false);
    onDrop(droppedItems(e.dataTransfer));
  }, [onDrop]);

  return { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}
