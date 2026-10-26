import { EventEmitter } from "node:events";
import { join } from "node:path";
import * as undici from "undici";
import { defaultAgentDir } from "./agent-dir";
import { readRegularFileText } from "./regular-file";

export { defaultAgentDir };

export const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000;

type DispatcherGlobal = typeof globalThis & {
  __piWebHttpDispatcherConfigured?: boolean;
};

const dispatcherGlobal = globalThis as DispatcherGlobal;
const originalGlobalFetch = globalThis.fetch;
const ignoreUndiciDispatcherError = (): void => {};

function parseHttpIdleTimeoutMs(value: unknown): number | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.toLowerCase() === "disabled") return 0;
    if (trimmed.length === 0) return undefined;
    return parseHttpIdleTimeoutMs(Number(trimmed));
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
}

/**
 * The global `httpIdleTimeoutMs`, read the way the pi CLI reads it, so a Web UI
 * session gets the HTTP idle timeout the user configured instead of the
 * built-in default. Only the global file counts: the dispatcher is configured
 * once at startup, before any project is selected, so a project's
 * `.pi/settings.json` cannot apply here.
 *
 * A missing file, a file that does not parse, an absent key, or a value the CLI
 * would reject yields `undefined`, which leaves `configureHttpDispatcher`'s own
 * default in place.
 */
export function readHttpIdleTimeoutMs(agentDir: string = defaultAgentDir()): number | undefined {
  let text: string | undefined;
  try {
    text = readRegularFileText(join(agentDir, "settings.json"));
  } catch {
    return undefined;
  }
  if (text === undefined) return undefined;

  let settings: unknown;
  try {
    settings = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return undefined;
  }
  if (typeof settings !== "object" || settings === null) return undefined;

  return parseHttpIdleTimeoutMs((settings as { httpIdleTimeoutMs?: unknown }).httpIdleTimeoutMs);
}

// Undici can emit an internal Client error while terminating a response body.
// The body stream still rejects; this prevents the EventEmitter error from
// terminating the Next.js process first.
function withUndiciErrorListener<T extends undici.Dispatcher>(dispatcher: T): T {
  if (dispatcher instanceof EventEmitter) {
    EventEmitter.prototype.on.call(dispatcher, "error", ignoreUndiciDispatcherError);
  }
  return dispatcher;
}

function createUndiciClient(origin: string | URL, options: object): undici.Dispatcher {
  return withUndiciErrorListener(
    new undici.Client(origin, options as undici.Client.Options),
  );
}

function createUndiciOriginDispatcher(origin: string | URL, options: object): undici.Dispatcher {
  const dispatcherOptions = options as undici.Pool.Options;
  if (dispatcherOptions.connections === 1) {
    return createUndiciClient(origin, dispatcherOptions);
  }

  return withUndiciErrorListener(
    new undici.Pool(origin, {
      ...dispatcherOptions,
      factory: createUndiciClient,
    }),
  );
}

export function configureHttpDispatcher(
  timeoutMs: number = DEFAULT_HTTP_IDLE_TIMEOUT_MS,
): void {
  if (dispatcherGlobal.__piWebHttpDispatcherConfigured) return;

  const normalizedTimeoutMs = parseHttpIdleTimeoutMs(timeoutMs);
  if (normalizedTimeoutMs === undefined) {
    throw new Error(`Invalid HTTP idle timeout: ${String(timeoutMs)}`);
  }

  const dispatcher = withUndiciErrorListener(
    new undici.EnvHttpProxyAgent({
      allowH2: false,
      bodyTimeout: normalizedTimeoutMs,
      headersTimeout: normalizedTimeoutMs,
      clientFactory: createUndiciClient,
      factory: createUndiciOriginDispatcher,
    }),
  );
  undici.setGlobalDispatcher(dispatcher);

  // Keep fetch and the dispatcher on the same undici implementation. Preserve
  // an intentional fetch override installed after this module was loaded.
  if (globalThis.fetch === originalGlobalFetch) {
    undici.install?.();
  }

  dispatcherGlobal.__piWebHttpDispatcherConfigured = true;
}
