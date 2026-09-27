export interface MultiuseConfig {
  bpmApiUrl: string;
  sessionSecret: string;
}

type Environment = Record<string, string | undefined>;

function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required in multiuser mode.`);
  return value;
}

function normalizeApiUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PI_WEB_BPM_API_URL must be an absolute HTTP(S) URL.");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PI_WEB_BPM_API_URL must be an HTTP(S) origin without a path or credentials.");
  }
  return url.origin;
}

/** Configuration used only by the corporate operating mode. */
export function getMultiuseConfig(env: Environment = process.env): MultiuseConfig {
  const sessionSecret = required(env, "PI_WEB_MULTI_SESSION_SECRET");
  if (sessionSecret.length < 32) {
    throw new Error("PI_WEB_MULTI_SESSION_SECRET must be at least 32 characters long.");
  }
  return {
    bpmApiUrl: normalizeApiUrl(required(env, "PI_WEB_BPM_API_URL")),
    sessionSecret,
  };
}
