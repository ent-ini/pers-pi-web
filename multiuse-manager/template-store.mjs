import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

export const MAX_TEMPLATE_FILE_BYTES = 1_000_000;

/**
 * Store for the files copied into a new employee workspace.
 *
 * It only accepts relative paths and deliberately excludes symbolic links:
 * templates are copied by the privileged worker manager, so a link must never
 * become a way to read or overwrite a host file outside the template root.
 */
export function createTemplateStore(root) {
  function pathFor(value) {
    if (typeof value !== "string" || !value || value.length > 512 || value.includes("\0")) throw new Error("Invalid path.");
    const target = resolve(root, value);
    if (target === root || !target.startsWith(`${root}${sep}`)) throw new Error("Path must stay inside the template.");
    return target;
  }

  async function ensureRoot() {
    await mkdir(root, { recursive: true, mode: 0o750 });
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Template root is not a directory.");
  }

  async function ensureParentDirectories(target) {
    const relative = target.slice(root.length + 1).split(sep).slice(0, -1);
    let current = root;
    for (const segment of relative) {
      current = resolve(current, segment);
      try {
        const info = await lstat(current);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Template parent is not a directory.");
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") await mkdir(current, { mode: 0o750 });
        else throw error;
      }
    }
  }

  async function listDirectory(directory = root, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    const result = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        result.push({ path, type: "directory" });
        result.push(...await listDirectory(resolve(directory, entry.name), path));
      } else if (entry.isFile()) {
        result.push({ path, type: "file" });
      }
    }
    return result;
  }

  return {
    async list() {
      await ensureRoot();
      return listDirectory();
    },

    async read(path) {
      await ensureRoot();
      const target = pathFor(path);
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("Template entry is not a file.");
      if (info.size > MAX_TEMPLATE_FILE_BYTES) throw new Error("Template file is too large.");
      const content = await readFile(target, "utf8");
      if (Buffer.byteLength(content, "utf8") > MAX_TEMPLATE_FILE_BYTES) throw new Error("Template file is too large.");
      return content;
    },

    async write(path, content) {
      if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > MAX_TEMPLATE_FILE_BYTES) throw new Error("Invalid file content.");
      await ensureRoot();
      const target = pathFor(path);
      try {
        const info = await lstat(target);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error("Template entry is not a file.");
      } catch (error) {
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
      }
      await ensureParentDirectories(target);
      await writeFile(target, content, { mode: 0o640 });
    },

    async createFile(path) {
      await ensureRoot();
      const target = pathFor(path);
      await ensureParentDirectories(target);
      try {
        await writeFile(target, "", { mode: 0o640, flag: "wx" });
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") throw new Error("Template entry already exists.");
        throw error;
      }
    },

    async createDirectory(path) {
      await ensureRoot();
      const target = pathFor(path);
      await ensureParentDirectories(target);
      try {
        const info = await lstat(target);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Template entry already exists and is not a directory.");
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") await mkdir(target, { mode: 0o750 });
        else throw error;
      }
    },

    async remove(path) {
      await ensureRoot();
      await rm(pathFor(path), { recursive: true, force: true });
    },
  };
}
