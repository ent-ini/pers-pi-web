export type PiWebRuntimeMode = "single" | "multi";

const VALID_MODES = new Set<PiWebRuntimeMode>(["single", "multi"]);

/**
 * Resolve the server operating mode. The default deliberately preserves the
 * historical single-user behaviour, including its local Pi data directory.
 */
export function resolvePiWebRuntimeMode(value = process.env.PI_WEB_MODE): PiWebRuntimeMode {
  const normalized = value?.trim().toLowerCase() || "single";
  if (VALID_MODES.has(normalized as PiWebRuntimeMode)) return normalized as PiWebRuntimeMode;
  throw new Error('PI_WEB_MODE must be either "single" or "multi".');
}

export function isMultiuseMode(value = process.env.PI_WEB_MODE): boolean {
  return resolvePiWebRuntimeMode(value) === "multi";
}
