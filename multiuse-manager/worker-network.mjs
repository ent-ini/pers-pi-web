const ICC = "com.docker.network.bridge.enable_icc";
const MASQUERADE = "com.docker.network.bridge.enable_ip_masquerade";

/** A separate outbound NAT bridge: no public worker ports, and no lateral
 * connectivity added on this bridge. Control/manager stay on the private net. */
export async function ensureEgressNetwork({ network, docker }) {
  const path = `/networks/${encodeURIComponent(network)}`;
  let info;
  try { info = await docker("GET", path); }
  catch (error) { if (!String(error).includes(" 404 ")) throw error; }
  if (!info) {
    try {
      await docker("POST", "/networks/create", {
        Name: network, Driver: "bridge", Internal: false,
        Options: { [ICC]: "false", [MASQUERADE]: "true" },
        Labels: { "pi-web.role": "worker-egress" },
      });
    } catch (error) { if (!String(error).includes(" 409 ")) throw error; }
    info = await docker("GET", path);
  }
  const natGateways = ["ipv4", "ipv6"].every((family) => (info.Options?.[`com.docker.network.bridge.gateway_mode_${family}`] ?? "nat") === "nat");
  if (info.Driver !== "bridge" || info.Internal !== false || info.Options?.[ICC] !== "false" || !natGateways
    || info.Options?.[MASQUERADE] === "false" || info.Labels?.["pi-web.role"] !== "worker-egress") {
    throw new Error("Worker egress network has unexpected isolation/NAT configuration.");
  }
}

export async function connectWorkerEgress({ name, network, docker }) {
  const attached = async () => Boolean((await docker("GET", `/containers/${name}/json`)).NetworkSettings?.Networks?.[network]);
  if (await attached()) return;
  try { await docker("POST", `/networks/${encodeURIComponent(network)}/connect`, { Container: name }); }
  catch (error) { if (!(await attached())) throw error; }
}
