import type { FileViewerState } from "@/lib/file-viewer-state";
import type { Tab } from "./TabBar";

export interface FileWorkspaceState {
  tabs: Tab[];
  activeTabId: string | null;
  open: boolean;
}

// A parked workspace keeps the generation its tabs were live in: the viewer
// that unmounts after the switch reports under it, so its state lands in these
// tabs even when the workspace switched to has the same file open.
export interface ParkedFileWorkspace extends FileWorkspaceState {
  generation: number;
}

export function switchFileWorkspace(
  states: Map<string, ParkedFileWorkspace>,
  currentKey: string | null,
  nextKey: string,
  current: FileWorkspaceState,
  generation: number,
): FileWorkspaceState {
  if (currentKey === nextKey) return current;
  if (currentKey) states.set(currentKey, { ...current, generation });
  const parked = states.get(nextKey);
  if (!parked) return { tabs: [], activeTabId: null, open: false };
  // Live tabs are never parked: the map holds only the workspaces left.
  states.delete(nextKey);
  return { tabs: parked.tabs, activeTabId: parked.activeTabId, open: parked.open };
}

interface OpenFileTabInput {
  fileName: string;
  filePath: string;
  sourceSessionId?: string | null;
  tabId: string;
  /** A directory tab lists a folder instead of showing a file. */
  kind?: "directory";
}

export function openFileTab(tabs: Tab[], input: OpenFileTabInput): Tab[] {
  const existing = tabs.find((tab) => tab.id === input.tabId);
  if (!existing) {
    return [...tabs, {
      id: input.tabId,
      label: input.fileName,
      filePath: input.filePath,
      sourceSessionId: input.sourceSessionId,
      kind: input.kind,
      viewerRevision: 0,
    }];
  }

  if (!input.sourceSessionId || existing.sourceSessionId === input.sourceSessionId) return tabs;
  return tabs.map((tab) => tab.id === input.tabId
    ? {
        ...tab,
        sourceSessionId: input.sourceSessionId,
        viewerRevision: (tab.viewerRevision ?? 0) + 1,
      }
    : tab,
  );
}

export function saveParkedFileViewerState(
  states: Map<string, ParkedFileWorkspace>,
  generation: number,
  tabId: string,
  viewerRevision: number,
  viewerState: FileViewerState,
): void {
  for (const [key, workspace] of states) {
    if (workspace.generation !== generation) continue;
    states.set(key, { ...workspace, tabs: saveFileViewerState(workspace.tabs, tabId, viewerRevision, viewerState) });
    return;
  }
}

export function saveFileViewerState(
  tabs: Tab[],
  tabId: string,
  viewerRevision: number,
  viewerState: FileViewerState,
): Tab[] {
  const index = tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1 || (tabs[index].viewerRevision ?? 0) !== viewerRevision) return tabs;

  const next = [...tabs];
  next[index] = { ...next[index], viewerState };
  return next;
}
