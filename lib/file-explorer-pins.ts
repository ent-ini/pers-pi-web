import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const DEFAULT_FILE_EXPLORER_USER_ID = "local";
const DATABASE_DIRECTORY_NAME = "pi-web";
const DATABASE_FILE_NAME = "state.sqlite";

export interface FileExplorerPinsStore {
  list(cwd: string, userId?: string): string[];
  replace(cwd: string, paths: string[], userId?: string): string[];
  close(): void;
}

declare global {
  var __piWebFileExplorerPinsStore: FileExplorerPinsStore | undefined;
  var __piWebFileExplorerPinsStorePath: string | undefined;
}

export function getPiWebDatabasePath(agentDir = getAgentDir()): string {
  return join(agentDir, DATABASE_DIRECTORY_NAME, DATABASE_FILE_NAME);
}

function initialize(database: Database.Database): void {
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS file_explorer_pins (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cwd TEXT NOT NULL,
      path TEXT NOT NULL,
      position INTEGER NOT NULL CHECK(position >= 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, cwd, path),
      UNIQUE (user_id, cwd, position)
    );
  `);
}

function normalizePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

export function createFileExplorerPinsStore(databasePath = getPiWebDatabasePath()): FileExplorerPinsStore {
  const databaseDirectory = dirname(databasePath);
  mkdirSync(databaseDirectory, { recursive: true, mode: 0o700 });
  try {
    chmodSync(databaseDirectory, 0o700);
  } catch {
    // The database remains usable on filesystems that do not support POSIX modes.
  }
  const database = new Database(databasePath);
  try {
    chmodSync(databasePath, 0o600);
  } catch {
    // The database remains usable on filesystems that do not support POSIX modes.
  }
  initialize(database);

  const ensureUser = database.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)");
  const listPins = database.prepare(`
    SELECT path
    FROM file_explorer_pins
    WHERE user_id = ? AND cwd = ?
    ORDER BY position ASC
  `);
  const deletePins = database.prepare("DELETE FROM file_explorer_pins WHERE user_id = ? AND cwd = ?");
  const insertPin = database.prepare(`
    INSERT INTO file_explorer_pins (user_id, cwd, path, position)
    VALUES (?, ?, ?, ?)
  `);
  const replacePins = database.transaction((cwd: string, paths: string[], userId: string) => {
    ensureUser.run(userId);
    deletePins.run(userId, cwd);
    paths.forEach((filePath, position) => insertPin.run(userId, cwd, filePath, position));
  });

  return {
    list(cwd, userId = DEFAULT_FILE_EXPLORER_USER_ID) {
      return (listPins.all(userId, cwd) as Array<{ path: string }>).map((row) => row.path);
    },
    replace(cwd, paths, userId = DEFAULT_FILE_EXPLORER_USER_ID) {
      const normalized = normalizePaths(paths);
      replacePins(cwd, normalized, userId);
      return normalized;
    },
    close() {
      database.close();
    },
  };
}

export function getFileExplorerPinsStore(): FileExplorerPinsStore {
  const databasePath = getPiWebDatabasePath();
  if (
    !globalThis.__piWebFileExplorerPinsStore
    || globalThis.__piWebFileExplorerPinsStorePath !== databasePath
  ) {
    globalThis.__piWebFileExplorerPinsStore?.close();
    globalThis.__piWebFileExplorerPinsStore = createFileExplorerPinsStore(databasePath);
    globalThis.__piWebFileExplorerPinsStorePath = databasePath;
  }
  return globalThis.__piWebFileExplorerPinsStore;
}
