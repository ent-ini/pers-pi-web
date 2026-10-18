import assert from "node:assert/strict";
import test from "node:test";
import { resetStoppedWorker, serialize } from "./workspace-reset.mjs";

function setup({ running = true, failure, missing = false } = {}) {
  const calls = [];
  return { calls, options: {
    name: "worker",
    docker: async (method, path) => {
      calls.push(`${method} ${path}`);
      if (missing) throw new Error("Docker GET: 404 not found");
      return { State: { Running: running } };
    },
    apply: async () => { calls.push("apply"); if (failure) throw failure; return { revision: "new" }; },
    start: async () => { calls.push("start"); },
    wait: async () => { calls.push("ready"); },
  } };
}

test("stops the worker before changing files and restarts it after success", async () => {
  const { calls, options } = setup();
  assert.deepEqual(await resetStoppedWorker(options), { revision: "new", worker: "running" });
  assert.deepEqual(calls, ["GET /containers/worker/json", "POST /containers/worker/stop?t=10", "apply", "start", "ready"]);
});

test("failed reset restarts the worker after rollback; a stopped/missing worker remains stopped", async () => {
  const { calls, options } = setup({ failure: new Error("conflict") });
  await assert.rejects(resetStoppedWorker(options), /conflict/);
  assert.deepEqual(calls.slice(-3), ["apply", "start", "ready"]);
  for (const config of [{ running: false }, { missing: true }]) {
    const stopped = setup(config);
    assert.equal((await resetStoppedWorker(stopped.options)).worker, "stopped");
    assert.deepEqual(stopped.calls, ["GET /containers/worker/json", "apply"]);
  }
});

test("does not start the worker if rollback itself failed", async () => {
  const failure = Object.assign(new Error("restore failed"), { keepStopped: true });
  const { calls, options } = setup({ failure });
  await assert.rejects(resetStoppedWorker(options), /restore failed/);
  assert.ok(!calls.includes("start"));
});

test("ensure/login is serialized with reset for the same employee, not unrelated employees", async () => {
  const calls = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const reset = serialize("employee", async () => { calls.push("reset"); await gate; calls.push("reset done"); throw new Error("failure"); });
  const ensured = serialize("employee", () => calls.push("ensure"));
  await serialize("another", () => calls.push("other employee"));
  assert.deepEqual(calls, ["reset", "other employee"]);
  release();
  await assert.rejects(reset, /failure/);
  await ensured;
  assert.deepEqual(calls, ["reset", "other employee", "reset done", "ensure"]);
});
