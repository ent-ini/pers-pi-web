import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { MultiuseConfig } from "./multiuse-config";

export const PI_WEB_MULTI_SESSION_COOKIE = "pi_web_multi_session";
// Corporate sessions are intentionally persistent enough for a work week.
export const PI_WEB_MULTI_SESSION_MAX_AGE = 7 * 24 * 60 * 60;

export interface MultiuseIdentity {
  id: string;
  email: string;
  fullName: string;
  status: string;
  role: string;
}

export interface MultiuseSession {
  accessToken: string;
  identity: MultiuseIdentity;
  expiresAt: number;
}

type SerializedSession = {
  version: 1;
  expiresAt: number;
  accessToken: string;
  identity: MultiuseIdentity;
};

function keyFor(secret: string): Buffer {
  return createHash("sha256").update(`pi-web-multi-session:${secret}`, "utf8").digest();
}

function encode(value: Buffer): string {
  return value.toString("base64url");
}

function decode(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return null;
  }
}

function isIdentity(value: unknown): value is MultiuseIdentity {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return ["id", "email", "fullName", "status", "role"].every((key) => (
    typeof candidate[key] === "string" && candidate[key].trim().length > 0
  ));
}

/** Read the expiry claim of a BPM bearer token without trusting its signature.
 * The token is only used to bound our own session lifetime; BPM stays the one
 * that validates it. Returns null when the token carries no usable expiry. */
export function bpmTokenExpiresAt(accessToken: string): number | null {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isSafeInteger(payload.exp) ? payload.exp : null;
  } catch {
    return null;
  }
}

/** Encrypt BPM's bearer token before placing it in the HttpOnly session cookie. */
export function createMultiuseSessionToken(
  accessToken: string,
  identity: MultiuseIdentity,
  config: MultiuseConfig,
  now = Date.now(),
  iv = randomBytes(12),
): string {
  const week = Math.floor(now / 1000) + PI_WEB_MULTI_SESSION_MAX_AGE;
  // The session must never outlive the BPM token inside it: a refreshed cookie
  // with a dead token looks alive in the chat but fails every BPM re-check.
  const tokenExpiry = bpmTokenExpiresAt(accessToken);
  const expiresAt = tokenExpiry === null ? week : Math.min(week, tokenExpiry);
  const payload: SerializedSession = { version: 1, expiresAt, accessToken, identity };
  const cipher = createCipheriv("aes-256-gcm", keyFor(config.sessionSecret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return `v1.${encode(iv)}.${encode(ciphertext)}.${encode(cipher.getAuthTag())}`;
}

/** Return null for expired, malformed, or tampered cookies without leaking why. */
export function readMultiuseSessionToken(
  token: string | undefined,
  config: MultiuseConfig,
  now = Date.now(),
): MultiuseSession | null {
  if (!token) return null;
  const match = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!match) return null;
  const [iv, ciphertext, tag] = match.slice(1).map(decode);
  if (!iv || !ciphertext || !tag || iv.length !== 12 || tag.length !== 16) return null;

  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFor(config.sessionSecret), iv);
    decipher.setAuthTag(tag);
    const parsed: unknown = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const payload = parsed as Partial<SerializedSession>;
    const expiresAt = payload.expiresAt;
    if (
      payload.version !== 1
      || typeof expiresAt !== "number"
      || !Number.isSafeInteger(expiresAt)
      || expiresAt <= Math.floor(now / 1000)
      || typeof payload.accessToken !== "string"
      || !payload.accessToken
      || !isIdentity(payload.identity)
    ) return null;
    // A BPM token that has expired cannot authorise anything any more, so the
    // session it lives in is dead as well: send the user back to the login
    // form instead of letting them hit a broken admin panel later.
    const tokenExpiry = bpmTokenExpiresAt(payload.accessToken);
    if (tokenExpiry !== null && tokenExpiry <= Math.floor(now / 1000)) return null;
    return { accessToken: payload.accessToken, identity: payload.identity, expiresAt };
  } catch {
    return null;
  }
}
