import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, chown, cp, lchown, lstat, mkdir, open, readFile, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createTemplateStore } from "./template-store.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const deepestFirst = (a, b) => b.split("/").length - a.split("/").length;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class WorkspaceTemplateError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}

function validPath(path) {
  return typeof path === "string" && path.length > 0 && path.length <= 512 && !path.includes("\0")
    && !path.startsWith("/") && path.split("/").every((part) => part && part !== "." && part !== "..");
}

// Callers serialize template reads with edits; the returned bytes form one immutable revision.
export async function snapshotTemplate(root) {
  const store = createTemplateStore(root);
  const entries = await store.list();
  const files = new Map();
  for (const entry of entries) {
    if (!validPath(entry.path)) throw new WorkspaceTemplateError("Некорректный путь в шаблоне.");
    if (entry.type === "file") {
      const content = await store.read(entry.path);
      files.set(entry.path, content);
      entry.sha256 = hash(content);
    }
  }
  return { entries, files, revision: hash(JSON.stringify(entries)) };
}

async function tree(root) {
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new WorkspaceTemplateError("Workspace должен быть обычной папкой.");
  const result = new Map();
  async function walk(prefix = "") {
    for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const type = entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other";
      result.set(path, type);
      if (type === "directory") await walk(path);
    }
  }
  await walk();
  return result;
}

// No recursive deletion of template directories: they may contain personal files.
function planUpdate(existing, previous, next) {
  const result = new Map(existing);
  const removeFiles = [];
  const removeDirectories = [];
  for (const entry of previous) {
    if (entry.type !== "file" || !result.has(entry.path)) continue;
    // A user replacing a template file with a directory must not lose its contents.
    if (result.get(entry.path) === "directory") throw new WorkspaceTemplateError(`Вместо файла шаблона «${entry.path}» появилась папка. Переместите её перед пересозданием.`);
    // Unlinking a leaf symlink is safe; never follow it or any linked parent.
    removeFiles.push(entry.path);
    result.delete(entry.path);
  }
  for (const entry of previous.filter((e) => e.type === "directory").sort((a, b) => deepestFirst(a.path, b.path))) {
    if (result.get(entry.path) === "directory" && ![...result.keys()].some((path) => path.startsWith(`${entry.path}/`))) {
      result.delete(entry.path);
      removeDirectories.push(entry.path);
    }
  }
  for (const entry of next) {
    const parent = dirname(entry.path);
    if (parent !== "." && result.get(parent) !== "directory") throw new WorkspaceTemplateError(`Нельзя создать «${entry.path}»: родительская папка недоступна.`);
    const current = result.get(entry.path);
    if (current && !(current === "directory" && entry.type === "directory")) {
      throw new WorkspaceTemplateError(`Конфликт с личным файлом или папкой «${entry.path}». Переместите его перед пересозданием workspace.`);
    }
    result.set(entry.path, entry.type);
  }
  return { removeFiles, removeDirectories };
}

async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function syncTree(path) {
  const info = await lstat(path);
  if (info.isDirectory()) {
    for (const entry of await readdir(path)) await syncTree(join(path, entry));
    await syncDirectory(path);
  } else if (info.isFile()) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try { await handle.sync(); } finally { await handle.close(); }
  }
  // Symlink entries are persisted by fsync of their parent, never followed.
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally { await rm(temporary, { force: true }); }
}

async function clearPending(path) {
  await rm(path, { force: true });
  await syncDirectory(dirname(path));
}

/** State is manager-owned, outside both worker mounts. Never trust a worker-supplied manifest. */
export function createWorkspaceTemplates({ stateRoot, uid = 10001, gid = 10001 }) {
  function manifestPath(employeeId) {
    if (!UUID.test(employeeId)) throw new WorkspaceTemplateError("Некорректный идентификатор сотрудника.", 400);
    return join(stateRoot, `${employeeId.toLowerCase()}.json`);
  }
  async function read(employeeId) {
    let value;
    try { value = JSON.parse(await readFile(manifestPath(employeeId), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
    if (value?.version !== 1 || typeof value.revision !== "string" || typeof value.appliedAt !== "string"
      || !Array.isArray(value.entries) || value.entries.some((entry) => !validPath(entry.path) || !["file", "directory"].includes(entry.type))) {
      throw new WorkspaceTemplateError("История шаблона повреждена. Пересоздание остановлено.");
    }
    return value;
  }
  async function own(path, directory = false) {
    await chown(path, uid, gid);
    await chmod(path, directory ? 0o700 : 0o600);
  }
  async function restoreOwnership(path) {
    const info = await lstat(path);
    if (info.isSymbolicLink()) { await lchown(path, uid, gid); return; }
    await chown(path, uid, gid);
    if (info.isDirectory()) for (const entry of await readdir(path)) await restoreOwnership(join(path, entry));
  }
  async function assertHealthy(employeeId) {
    const pendingPath = `${manifestPath(employeeId)}.pending`;
    try {
      const pending = JSON.parse(await readFile(pendingPath, "utf8"));
      const failure = new WorkspaceTemplateError(`Предыдущее пересоздание прервано. Worker заблокирован до проверки резервной копии: ${pending.backup}.`, 409);
      failure.keepStopped = true;
      throw failure;
    } catch (error) {
      if (error.code === "ENOENT") return;
      error.keepStopped = true;
      throw error;
    }
  }
  return {
    read,
    assertHealthy,
    async apply(employeeId, workspace, snapshot) {
      const statePath = manifestPath(employeeId);
      const pendingPath = `${statePath}.pending`;
      await assertHealthy(employeeId);
      const previous = await read(employeeId);
      const existing = await tree(workspace);
      const plan = planUpdate(existing, previous?.entries || [], snapshot.entries);
      const manifest = { version: 1, revision: snapshot.revision, appliedAt: new Date().toISOString(), entries: snapshot.entries };
      // Keep the mountpoint inode: existing Docker bind mounts must see the new files.
      // A complete pre-change copy also keeps personal files recoverable on IO errors.
      await mkdir(stateRoot, { recursive: true, mode: 0o700 });
      await syncDirectory(dirname(stateRoot));
      const backup = join(stateRoot, `${employeeId}.${randomUUID()}.backup`);
      await cp(workspace, backup, { recursive: true, verbatimSymlinks: true });
      await syncTree(backup);
      await atomicJson(pendingPath, { backup, previous, next: manifest });
      let committed = false;
      try {
        for (const path of plan.removeFiles) await rm(join(workspace, path));
        for (const path of plan.removeDirectories) await rmdir(join(workspace, path));
        for (const entry of snapshot.entries) {
          const target = join(workspace, entry.path);
          if (entry.type === "directory") {
            if (!existing.has(entry.path) || plan.removeDirectories.includes(entry.path) || plan.removeFiles.includes(entry.path)) {
              await mkdir(target, { mode: 0o700 });
              await own(target, true);
            }
          } else {
            // wx is a final safety net against accidentally overwriting an untracked file.
            await writeFile(target, snapshot.files.get(entry.path), { mode: 0o600, flag: "wx" });
            await own(target);
          }
        }
        await syncTree(workspace);
        await atomicJson(statePath, manifest);
        committed = true;
      } catch (error) {
        try {
          for (const entry of await readdir(workspace)) await rm(join(workspace, entry), { recursive: true, force: true });
          await cp(backup, workspace, { recursive: true, verbatimSymlinks: true });
          await restoreOwnership(workspace);
          await syncTree(workspace);
          // The manifest write may have succeeded immediately before another IO error.
          if (previous) await atomicJson(statePath, previous);
          else await rm(statePath, { force: true });
          await clearPending(pendingPath);
        } catch (restoreError) {
          const failure = new WorkspaceTemplateError(`Не удалось восстановить workspace. Worker оставлен остановленным. Резервная копия: ${backup}. ${restoreError.message}`, 500);
          failure.keepStopped = true;
          throw failure;
        }
        await rm(backup, { recursive: true, force: true });
        throw error;
      }
      // Manifest + workspace are durable now. Never roll back after attempting
      // to unlink the marker: unlink may succeed even if directory fsync fails.
      try { await clearPending(pendingPath); }
      catch {
        const failure = new WorkspaceTemplateError("Шаблон обновлён, но не удалось завершить транзакцию. Worker остановлен; требуется проверка истории шаблона администратором.", 500);
        failure.keepStopped = true;
        throw failure;
      }
      // Backup cleanup failure is harmless after the durable commit boundary.
      if (committed) await rm(backup, { recursive: true, force: true }).catch((error) => console.error("[workspace-template] backup cleanup failed", error));
      return { revision: manifest.revision, appliedAt: manifest.appliedAt, trackedFiles: manifest.entries.filter((entry) => entry.type === "file").length, legacy: !previous };
    },
  };
}
