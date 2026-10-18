import assert from "node:assert/strict";
import test from "node:test";
import { assertWorkerMounts, replaceWorkerImage } from "./worker-image.mjs";

test("upgrade mount validation refuses different/missing/read-only/extra bind sources before stopping a worker", () => {
  const root = "/data/pi-web/users/test";
  const mounts = [
    { Type: "bind", Source: `${root}/agent`, Destination: "/home/pi/.pi", RW: true },
    { Type: "bind", Source: `${root}/workspace`, Destination: "/workspace", RW: true },
  ];
  assert.doesNotThrow(() => assertWorkerMounts({ Mounts: mounts }, root));
  for (const changed of [undefined, [], mounts.slice(1), [...mounts, { Type: "bind", Source: "/other", Destination: "/other", RW: true }],
    [{ ...mounts[0], Source: "/migrated/agent" }, mounts[1]],
    [{ ...mounts[0], RW: false }, mounts[1]],
    [{ ...mounts[0], Type: "volume" }, mounts[1]], [mounts[0], mounts[0]]]) {
    assert.throws(() => assertWorkerMounts({ Mounts: changed }, root), /upgrade refused/);
  }
});

function fixture({ running = true, failCreate = false, failReady = false } = {}) {
  const name = "pi_worker_test";
  const oldId = "sha256:old";
  const imageId = "sha256:new";
  const original = { Image: oldId, State: { Running: running } };
  const containers = new Map([[name, original]]);
  const calls = [];
  const options = {
    name, info: original, imageId,
    docker: async (method, path) => {
      calls.push(`${method} ${path}`);
      const match = /^\/containers\/([^/?]+)(.*)$/.exec(path);
      const [, container, suffix] = match;
      const info = containers.get(container);
      if (!info) throw new Error("Docker: 404 missing");
      if (suffix.startsWith("/stop")) { info.State.Running = false; return; }
      if (suffix.startsWith("/rename")) {
        const target = new URL(`http://docker${path}`).searchParams.get("name");
        assert.ok(!containers.has(target));
        containers.delete(container); containers.set(target, info); return;
      }
      if (method === "DELETE") {
        assert.ok(path.includes("force=true") || !info.State.Running);
        containers.delete(container); return;
      }
      if (suffix === "/json") return info;
      throw new Error(`Unexpected ${method} ${path}`);
    },
    create: async (image) => {
      calls.push(`create ${image}`);
      if (failCreate) throw new Error("create failed");
      assert.ok(!containers.has(name));
      containers.set(name, { Image: image, State: { Running: false } });
    },
    start: async (container) => { calls.push(`start ${container}`); containers.get(container).State.Running = true; },
    wait: async (url) => {
      calls.push(`wait ${url}`);
      if (failReady && containers.get(name).Image === imageId) throw new Error("readiness failed");
    },
  };
  return { name, oldId, imageId, original, containers, calls, options };
}

test("matching immutable image requires no container replacement", async () => {
  const f = fixture();
  assert.equal(await replaceWorkerImage({ ...f.options, imageId: f.oldId }), f.original);
  assert.deepEqual(f.calls, []);
});

test("keeps the previous container until the new image is ready, then deletes only that stopped container", async () => {
  const f = fixture();
  const result = await replaceWorkerImage(f.options);
  assert.equal(result.Image, f.imageId);
  assert.equal(result.State.Running, true);
  assert.equal(f.containers.size, 1);
  assert.ok(f.calls[0].includes("/stop?t=10"));
  assert.ok(f.calls[1].includes("/rename?name="));
  assert.equal(f.calls[2], `create ${f.imageId}`);
  assert.match(f.calls.at(-1), /^DELETE .*_previous_/);
  assert.ok(f.calls.findIndex((call) => call.startsWith("wait ")) < f.calls.findIndex((call) => call.startsWith("DELETE ")));
});

for (const failure of ["create", "ready"]) {
  test(`failed ${failure} restores the original container/name and restarts it without deleting data`, async () => {
    const f = fixture({ failCreate: failure === "create", failReady: failure === "ready" });
    await assert.rejects(replaceWorkerImage(f.options), failure === "create" ? /create failed/ : /readiness failed/);
    assert.equal(f.containers.size, 1);
    assert.equal(f.containers.get(f.name), f.original);
    assert.equal(f.containers.get(f.name).State.Running, true);
    assert.ok(f.calls.some((call) => call.includes(`/rename?name=${f.name}`)));
    assert.equal(f.calls.filter((call) => call.startsWith("create ")).length, 1);
  });
}

test("rollback preserves a previously stopped worker's stopped state", async () => {
  const f = fixture({ running: false, failCreate: true });
  await assert.rejects(replaceWorkerImage(f.options), /create failed/);
  assert.equal(f.containers.get(f.name).State.Running, false);
  assert.ok(!f.calls.some((call) => call.startsWith("start ")));
});

test("a cleanup error does not undo a ready replacement", async (t) => {
  const f = fixture();
  const docker = f.options.docker;
  f.options.docker = (method, path) => method === "DELETE" && path.includes("_previous_")
    ? Promise.reject(new Error("cleanup unavailable")) : docker(method, path);
  t.mock.method(console, "error", () => {});
  const result = await replaceWorkerImage(f.options);
  assert.equal(result.Image, f.imageId);
  assert.equal(f.containers.get(f.name).State.Running, true);
  assert.equal(f.containers.size, 2, "stopped backup is retained for later cleanup");
});
