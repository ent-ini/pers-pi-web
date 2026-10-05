"use client";

import { useState, useCallback, useRef } from "react";

/** A drag carries files when any item is a file (not text, not a link). */
export function dragHasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  const items = Array.from(dataTransfer.items ?? []);
  if (items.length > 0) return items.some((item) => item.kind === "file");
  return Array.from(dataTransfer.files ?? []).length > 0;
}

export function useDragDrop(onDrop: (files: File[]) => void) {
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
    onDrop(files);
  }, [onDrop]);

  return { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}
