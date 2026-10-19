import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  corporateSnapshot,
  corporateModelAllowed,
} from "./corporate-model-policy";
// Patch the SDK boundary once, including runtimes retained by existing sessions and
// runtimes created by subagents. Every operation rereads the manager-owned mount.
const installed = Symbol.for("pi-web.corporate-model-policy");
const proto = ModelRuntime.prototype as unknown as Record<
  string | symbol,
  unknown
>;
if (proto && !proto[installed]) {
  proto[installed] = true;
  const revisions = new WeakMap<object, string>();
  const registered = new WeakMap<object, string[]>();
  const syncing = new WeakSet<object>();
  const register = proto.registerProvider as (id: string, p: unknown) => void;
  const unregister = proto.unregisterProvider as (id: string) => void;
  function managedModel(
    snapshot: ReturnType<typeof corporateSnapshot>,
    provider: string,
    id: string,
  ) {
    const config = snapshot?.providers[provider];
    const model = config?.models.find((entry) => entry.id === id);
    return model
      ? {
          ...model,
          type: "chat",
          provider,
          api: (model as Record<string, unknown>).api || config!.api,
          baseUrl: config!.baseUrl,
          headers: undefined,
        }
      : undefined;
  }
  function sync(runtime: object) {
    const s = corporateSnapshot();
    if (s && revisions.get(runtime) !== s.revision && !syncing.has(runtime)) {
      syncing.add(runtime);
      try {
        for (const id of registered.get(runtime) || [])
          unregister.call(runtime, id);
        for (const [id, p] of Object.entries(s.providers))
          register.call(runtime, id, p);
        registered.set(runtime, Object.keys(s.providers));
        revisions.set(runtime, s.revision);
      } finally {
        syncing.delete(runtime);
      }
    }
    return s;
  }
  for (const name of [
    "registerProvider",
    "unregisterProvider",
    "registerNativeProvider",
    "registerVirtualModel",
    "unregisterVirtualModel",
  ]) {
    const original = proto[name] as (...args: unknown[]) => unknown;
    proto[name] = function (this: object, ...args: unknown[]) {
      const first = args[0] as
        | string
        | {
            id?: string;
            provider?: string;
          };
      const id =
        typeof first === "string" ? first : first.provider || first.id || "";
      if (process.env.PI_WEB_MODEL_SNAPSHOT && id.startsWith("corp-"))
        throw new Error("Corporate provider registration is manager-owned");
      return original.apply(this, args);
    };
  }
  const listMethods = [
    "getProviders",
    "getModels",
    "getModelsOfType",
    "getAllModels",
    "getAvailableOfType",
    "getAllAvailable",
    "getAvailable",
    "getAvailableSnapshot",
    "getRegisteredProviderIds",
  ];
  for (const name of listMethods) {
    const original = proto[name] as (...args: unknown[]) => unknown;
    proto[name] = function (this: object, ...args: unknown[]) {
      const snapshot = sync(this);
      const filter = (items: unknown) =>
        (
          items as {
            provider?: string;
            id?: string;
          }[]
        )
          .filter((m) =>
            typeof m === "string"
              ? corporateModelAllowed(m)
              : corporateModelAllowed(
                  m.provider || m.id || "",
                  m.provider ? m.id : undefined,
                ),
          )
          .map((model) => {
            const item = model as { provider?: string; id?: string };
            return snapshot && item.provider?.startsWith("corp-") && item.id
              ? managedModel(snapshot, item.provider, item.id)
              : model;
          });
      const result = original.apply(this, args);
      return result instanceof Promise ? result.then(filter) : filter(result);
    };
  }
  const modelReads = ["getModel", "getModelOfType", "getPhysicalModel"];
  for (const name of modelReads) {
    const original = proto[name] as (...args: unknown[]) => unknown;
    proto[name] = function (this: object, ...args: unknown[]) {
      const snapshot = sync(this);
      const offset = name === "getModelOfType" ? 1 : 0;
      const provider = args[offset] as string;
      if (snapshot && provider.startsWith("corp-"))
        return name === "getModelOfType" && args[0] !== "chat"
          ? undefined
          : managedModel(snapshot, provider, args[offset + 1] as string);
      return corporateModelAllowed(
        args[offset] as string,
        args[offset + 1] as string,
      )
        ? original.apply(this, args)
        : undefined;
    };
  }
  for (const name of [
    "getAuth",
    "checkAuth",
    "hasConfiguredAuth",
    "getProvider",
    "getCompatibilityRequestConfig",
    "resolveModel",
    "stream",
    "complete",
    "streamSimple",
    "completeSimple",
    "streamDeferred",
    "fetchDeferred",
    "cancelDeferred",
    "generateImages",
    "classify",
  ]) {
    const original = proto[name] as (...args: unknown[]) => unknown;
    proto[name] = function (this: object, ...args: unknown[]) {
      const s = sync(this);
      const first = args[0] as
        | string
        | {
            provider: string;
            id: string;
          };
      const provider = typeof first === "string" ? first : first.provider;
      const id = typeof first === "string" ? undefined : first.id;
      if (!corporateModelAllowed(provider, id)) {
        if (["checkAuth", "getProvider", "hasConfiguredAuth"].includes(name))
          return name === "hasConfiguredAuth" ? false : undefined;
        throw new Error("Model disabled by corporate policy");
      }
      const company =
        s && provider.startsWith("corp-") ? s.providers[provider] : undefined;
      if (company) {
        if (name === "getCompatibilityRequestConfig")
          return { authHeader: true };
        if (id) args[0] = managedModel(s, provider, id);
        // Do not resolve corporate auth through employee models.json at all:
        // it can otherwise append an employee-owned Authorization header.
        if (args[2] && typeof args[2] === "object") {
          const options = { ...(args[2] as Record<string, unknown>) };
          delete options.apiKey;
          delete options.headers;
          delete options.baseUrl;
          args[2] = options;
        }
      }
      const invoke = () =>
        name === "getAuth" && company
          ? Promise.resolve({
              auth: { apiKey: company.apiKey, baseUrl: company.baseUrl },
              source: "Company gateway",
            })
          : original.apply(this, args);
      if (name === "getAuth" && s?.policyUrl && s.gatewayToken) {
        return (async () => {
          const response = await fetch(s.policyUrl!, {
            headers: { authorization: `Bearer ${s.gatewayToken}` },
            signal: AbortSignal.timeout(5000),
            redirect: "error",
            cache: "no-store",
          });
          if (!response.ok)
            throw new Error("Corporate model policy unavailable");
          const live = await response.json();
          if (
            provider.startsWith("corp-")
              ? id
                ? !live.models?.[provider]?.includes(id)
                : !live.models?.[provider]
              : live.allowPersonalModels !== true
          )
            throw new Error("Model disabled by corporate policy");
          return invoke();
        })();
      }
      return invoke();
    };
  }
}
