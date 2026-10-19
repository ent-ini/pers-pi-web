import { randomUUID } from "node:crypto";

export function assertWorkerMounts(info, root) {
  const expected = new Map([["/home/pi/.pi", `${root}/agent`], ["/workspace", `${root}/workspace`]]);
  const mounts = info.Mounts?.filter(m => !(m.Type === "bind" && m.Destination === "/run/pi-web-models" && m.Source === `/data/pi-web/control/model-snapshots/${root.split("/").at(-1)}` && m.RW === false));
  if (!Array.isArray(mounts) || mounts.length !== expected.size) throw new Error("Worker upgrade refused: unexpected persistent mounts.");
  for (const mount of mounts) {
    if (mount.Type !== "bind" || mount.RW !== true || expected.get(mount.Destination) !== mount.Source) {
      throw new Error("Worker upgrade refused: persistent mount paths or access modes would change.");
    }
    expected.delete(mount.Destination);
  }
  if (expected.size) throw new Error("Worker upgrade refused: missing persistent mount.");
}

/** Caller holds the same per-employee lock as ensure/reset. Only containers are
 * replaced; both persistent bind mounts are supplied unchanged by create(). */
export async function replaceWorkerImage({ name, info, imageId, force = false, docker, create, start, wait }) {
  if (!force && info.Image === imageId) return info;
  const backup = `${name}_previous_${randomUUID().slice(0, 8)}`;
  const wasRunning = Boolean(info.State.Running);
  let renamed = false;
  let updated;
  try {
    if (wasRunning) await docker("POST", `/containers/${name}/stop?t=10`);
    await docker("POST", `/containers/${name}/rename?name=${backup}`);
    renamed = true;
    await create(imageId);
    await start(name);
    await wait(`http://${name}:30141`);
    updated = await docker("GET", `/containers/${name}/json`);
    if (updated.Image !== imageId || !updated.State.Running) throw new Error("New worker image did not become ready.");
  } catch (error) {
    try {
      if (renamed) {
        await docker("DELETE", `/containers/${name}?force=true`).catch((failure) => { if (!String(failure).includes(" 404 ")) throw failure; });
        await docker("POST", `/containers/${backup}/rename?name=${name}`);
      }
      if (wasRunning) { await start(name); await wait(`http://${name}:30141`); }
    } catch (rollbackError) {
      throw new Error(`Worker upgrade failed; previous container ${backup} retained for recovery. ${rollbackError.message}`);
    }
    throw error;
  }
  // A leftover stopped backup is harmless; cleanup errors must not roll back a
  // healthy worker that may already be receiving requests after readiness.
  await docker("DELETE", `/containers/${backup}`).catch((error) => console.error("[worker-image] old container cleanup failed", error));
  return updated;
}
