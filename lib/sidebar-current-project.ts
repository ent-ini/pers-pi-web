import type { SessionInfo } from "./types";
import type { SidebarRow } from "./session-tree";
import { workspaceKeyOf } from "./workspace-memory";

/** Keep the session list local to the directory selected above it. */
export function sessionsInCurrentProject(sessions: readonly SessionInfo[], projectKey: string | null): SessionInfo[] {
  return projectKey ? sessions.filter((session) => workspaceKeyOf(session) === projectKey) : [];
}

/** Project headings belong in the path picker, not between session rows. */
export function currentProjectRows(rows: readonly SidebarRow[], projectKey: string | null): SidebarRow[] {
  if (!projectKey) return [];
  return rows.filter((row) => {
    switch (row.kind) {
      case "group":
      case "archive-group":
      case "footer-open":
        return false;
      case "spacer":
        return row.key !== "footer-spacer";
      case "group-empty":
        return row.project.key === projectKey;
      case "group-more":
        return row.projectKey === projectKey;
      case "session":
        return row.project.key === projectKey;
      default:
        return true;
    }
  });
}
