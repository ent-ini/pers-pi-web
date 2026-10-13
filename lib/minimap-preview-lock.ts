/**
 * Per-browser choice of the minimap's lock toggle: while locked, hovering the
 * minimap does not open the turn preview. Locked is the default, so the
 * preview opens only for someone who has explicitly asked for it. ChatWindow
 * remounts per session, so the choice lives here rather than in component
 * state. Best-effort localStorage: privacy mode or quota errors fall back to
 * locked.
 */

const STORAGE_KEY = "pi-web:minimap-preview-locked";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadMinimapPreviewLocked(storage: StorageLike | null = getBrowserStorage()): boolean {
  // Locked unless the browser holds an explicit "false": a stored choice wins,
  // a first visit and an unreadable store stay locked.
  if (!storage) return true;
  try {
    return storage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveMinimapPreviewLocked(
  locked: boolean,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, String(locked));
  } catch {
    // Persistence is best-effort.
  }
}
