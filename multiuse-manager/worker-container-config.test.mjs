import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { load as parseYaml } from "js-yaml";
import { WORKER_RESTART_POLICY, workerHostConfig } from "./worker-container-config.mjs";

const base = {
  network: "pi-web-internal",
  root: "/data/pi-web/users/553ea4ac-091f-4306-bb7c-027443646f16",
  snapshotDir: "/data/pi-web/control/model-snapshots/553ea4ac-091f-4306-bb7c-027443646f16",
};

test("worker containers carry a restart policy so docker brings them back after a host reboot", () => {
  const config = workerHostConfig(base);
  assert.equal(config.RestartPolicy?.Name, "unless-stopped");
  assert.equal(WORKER_RESTART_POLICY, "unless-stopped");
});

test("the restart policy does not loosen the worker isolation", () => {
  const config = workerHostConfig(base);
  assert.equal(config.NetworkMode, "pi-web-internal");
  assert.equal(config.ReadonlyRootfs, true);
  assert.deepEqual(config.CapDrop, ["ALL"]);
  assert.deepEqual(config.SecurityOpt, ["no-new-privileges:true"]);
  assert.equal(config.PidsLimit, 256);
  assert.equal(config.Memory, 2147483648);
  assert.equal(config.NanoCpus, 2000000000);
});

test("worker bind mounts stay read-only snapshot plus writable agent and workspace", () => {
  const config = workerHostConfig(base);
  assert.deepEqual(config.Mounts, [
    { Type: "bind", Source: base.snapshotDir, Target: "/run/pi-web-models", ReadOnly: true },
    { Type: "bind", Source: `${base.root}/agent`, Target: "/home/pi/.pi", ReadOnly: false },
    { Type: "bind", Source: `${base.root}/workspace`, Target: "/workspace", ReadOnly: false },
  ]);
});

test("compose services ask docker to always restart them", () => {
  const compose = parseYaml(readFileSync(new URL("../docker-compose.multi.yml", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(compose.services).sort(), ["pi-web", "worker-manager"]);
  for (const service of Object.values(compose.services)) assert.equal(service.restart, "always");
});
