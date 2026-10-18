import assert from "node:assert/strict";
import test from "node:test";
import { connectWorkerEgress, ensureEgressNetwork } from "./worker-network.mjs";

const network = "pi-web-egress";
const valid = { Driver: "bridge", Internal: false, Options: { "com.docker.network.bridge.enable_icc": "false" }, Labels: { "pi-web.role": "worker-egress" } };

test("creates a dedicated NAT bridge with inter-container connectivity disabled", async () => {
  let info;
  const calls = [];
  await ensureEgressNetwork({ network, docker: async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === "GET") { if (!info) throw new Error("Docker: 404 missing"); return info; }
    assert.equal(path, "/networks/create");
    info = body;
  } });
  const body = calls.find((call) => call.method === "POST").body;
  assert.equal(body.Driver, "bridge");
  assert.equal(body.Internal, false);
  assert.equal(body.Options["com.docker.network.bridge.enable_icc"], "false");
  assert.equal(body.Options["com.docker.network.bridge.enable_ip_masquerade"], "true");
});

test("reuses the configured bridge but refuses internal, lateral, non-NAT or unowned networks", async () => {
  const calls = [];
  await ensureEgressNetwork({ network, docker: async (...args) => { calls.push(args); return valid; } });
  assert.equal(calls.length, 1);
  for (const info of [
    { ...valid, Internal: true }, { ...valid, Driver: "host" }, { ...valid, Labels: {} },
    { ...valid, Options: { "com.docker.network.bridge.enable_icc": "true" } },
    { ...valid, Options: { ...valid.Options, "com.docker.network.bridge.enable_ip_masquerade": "false" } },
    ...["routed", "nat-unprotected", "isolated"].map((mode) => ({ ...valid, Options: { ...valid.Options, "com.docker.network.bridge.gateway_mode_ipv4": mode } })),
    { ...valid, Options: { ...valid.Options, "com.docker.network.bridge.gateway_mode_ipv6": "routed" } },
  ]) await assert.rejects(ensureEgressNetwork({ network, docker: async () => info }), /unexpected isolation/);
});

test("concurrent bridge creation conflicts are resolved by re-inspection", async () => {
  let reads = 0;
  await ensureEgressNetwork({ network, docker: async (method) => {
    if (method === "POST") throw new Error("Docker: 409 already exists");
    if (++reads === 1) throw new Error("Docker: 404 missing");
    return valid;
  } });
  assert.equal(reads, 2);
});

test("attaches a running worker without replacing private networking, ports, containers or data", async () => {
  const calls = [];
  const info = { NetworkSettings: { Networks: { "pi-web-internal": {} } } };
  await connectWorkerEgress({ name: "worker", network, docker: async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === "GET") return info;
  } });
  assert.deepEqual(calls, [
    { method: "GET", path: "/containers/worker/json", body: undefined },
    { method: "POST", path: "/networks/pi-web-egress/connect", body: { Container: "worker" } },
  ]);
  assert.ok(info.NetworkSettings.Networks["pi-web-internal"]);
});

test("does not reconnect workers that already have an egress endpoint", async () => {
  const calls = [];
  await connectWorkerEgress({ name: "worker", network, docker: async (...args) => {
    calls.push(args);
    return { NetworkSettings: { Networks: { [network]: {} } } };
  } });
  assert.equal(calls.length, 1);
});

test("a raced connect is accepted only if inspection confirms the endpoint exists", async () => {
  for (const attachedAfterFailure of [true, false]) {
    let reads = 0;
    const run = connectWorkerEgress({ name: "worker", network, docker: async (method) => {
      if (method === "POST") throw new Error("connect failure");
      reads++;
      return { NetworkSettings: { Networks: reads > 1 && attachedAfterFailure ? { [network]: {} } : {} } };
    } });
    if (attachedAfterFailure) await run;
    else await assert.rejects(run, /connect failure/);
  }
});
