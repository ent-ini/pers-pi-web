// Docker only brings a container back after a host reboot when the container
// itself carries a restart policy. Workers were created without one, so the
// whole corporate stack stayed down until somebody logged in again. Keep the
// policy here so it is visible and testable, not buried in a create call.
export const WORKER_RESTART_POLICY = "unless-stopped";

export function workerHostConfig({ network, root, snapshotDir }) {
  return {
    NetworkMode: network,
    RestartPolicy: { Name: WORKER_RESTART_POLICY },

    ReadonlyRootfs: true,
    CapDrop: ["ALL"],
    SecurityOpt: ["no-new-privileges:true"],
    PidsLimit: 256,
    Memory: 2147483648,
    NanoCpus: 2000000000,
    Tmpfs: { "/tmp": "rw,noexec,nosuid,size=256m" },
    Mounts: [
      { Type: "bind", Source: snapshotDir, Target: "/run/pi-web-models", ReadOnly: true },
      { Type: "bind", Source: `${root}/agent`, Target: "/home/pi/.pi", ReadOnly: false },
      { Type: "bind", Source: `${root}/workspace`, Target: "/workspace", ReadOnly: false },
    ],
  };
}
