import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { serialize } from "./workspace-reset.mjs";
import { gatewayCompat } from "./gateway-compat.mjs";
export const APIs = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
];
const fail = (status = 400) => {
  throw Object.assign(
    new Error("Corporate model configuration unavailable or invalid"),
    { status },
  );
};
const record = (v) => v && typeof v === "object" && !Array.isArray(v);
const fields = (v, allowed) => {
  if (!record(v) || Object.keys(v).some((k) => !allowed.includes(k))) fail();
};
const literal = (v) => {
  if (
    typeof v !== "string" ||
    v.length > 8192 ||
    /[\r\n\0$]/.test(v) ||
    /^\s*!/.test(v)
  )
    fail();
  return v;
};
const text = (v, max = 256) => {
  if (typeof v !== "string" || !v || v.length > max || /[\x00-\x1f]/.test(v))
    fail();
};
export function validateProviders(providers) {
  if (!record(providers) || Object.keys(providers).length > 50) fail();
  for (const [id, p] of Object.entries(providers)) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) fail();
    fields(p, [
      "baseUrl",
      "api",
      "apiKey",
      "headers",
      "compat",
      "models",
      "enabled",
    ]);
    if (!APIs.includes(p.api)) fail();
    text(p.baseUrl, 2048);
    let u;
    try {
      u = new URL(p.baseUrl);
    } catch {
      fail();
    }
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      /^(localhost|127\.|169\.254\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(
        u.hostname,
      )
    )
      fail();
    if (p.enabled !== undefined && typeof p.enabled !== "boolean") fail();
    if (p.apiKey !== undefined) literal(p.apiKey);
    validateHeaders(p.headers);
    validateCompat(p.compat);
    if (p.models === undefined) p.models = [];
    if (!Array.isArray(p.models) || p.models.length > 200) fail();
    const seen = new Set();
    for (const m of p.models) {
      fields(m, [
        "id",
        "name",
        "api",
        "reasoning",
        "thinkingLevelMap",
        "input",
        "contextWindow",
        "maxTokens",
        "cost",
        "headers",
        "compat",
        "enabled",
      ]);
      text(m.id);
      if (
        seen.has(m.id) ||
        /[?#%\\]/.test(m.id) ||
        m.id.split("/").includes("..")
      )
        fail();
      seen.add(m.id);
      if (m.name !== undefined) text(m.name);
      if (m.api !== undefined && m.api !== p.api) fail();
      for (const k of ["reasoning", "enabled"])
        if (m[k] !== undefined && typeof m[k] !== "boolean") fail();
      for (const k of ["contextWindow", "maxTokens"])
        if (
          m[k] !== undefined &&
          (!Number.isInteger(m[k]) || m[k] < 1 || m[k] > 10000000)
        )
          fail();
      if (
        m.input !== undefined &&
        (!Array.isArray(m.input) ||
          !m.input.length ||
          m.input.length > 2 ||
          m.input.some((v) => !["text", "image"].includes(v)))
      )
        fail();
      if (m.cost !== undefined) {
        fields(m.cost, ["input", "output", "cacheRead", "cacheWrite", "tiers"]);
        if (m.cost.tiers !== undefined) {
          if (!Array.isArray(m.cost.tiers) || m.cost.tiers.length > 20) fail();
          for (const tier of m.cost.tiers) {
            fields(tier, [
              "inputTokensAbove",
              "input",
              "output",
              "cacheRead",
              "cacheWrite",
            ]);
            if (
              !Number.isSafeInteger(tier.inputTokensAbove) ||
              tier.inputTokensAbove < 0
            )
              fail();
            for (const rate of ["input", "output", "cacheRead", "cacheWrite"])
              if (typeof tier[rate] !== "number") fail();
            for (const v of Object.values(tier))
              if (
                typeof v !== "number" ||
                !Number.isFinite(v) ||
                v < 0 ||
                v > 10000000
              )
                fail();
          }
        }
        for (const v of Object.entries(m.cost)
          .filter(([k]) => k !== "tiers")
          .map(([, v]) => v))
          if (
            typeof v !== "number" ||
            !Number.isFinite(v) ||
            v < 0 ||
            v > 1000000
          )
            fail();
      }
      if (m.thinkingLevelMap !== undefined) {
        fields(m.thinkingLevelMap, [
          "off",
          "minimal",
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
        ]);
        for (const v of Object.values(m.thinkingLevelMap))
          if (v !== null) text(v, 64);
      }
      validateHeaders(m.headers);
      validateCompat(m.compat);
    }
  }
  return providers;
}
function validateCompat(value) {
  if (value === undefined) return;
  const booleans = [
    "supportsStore",
    "supportsDeveloperRole",
    "supportsReasoningEffort",
    "supportsUsageInStreaming",
    "supportsFinishReason",
    "requiresToolResultName",
    "requiresAssistantAfterToolResult",
    "requiresThinkingAsText",
    "requiresMistralToolIds",
    "requiresReasoningContentOnAssistantMessages",
    "supportsStrictMode",
    "supportsMidConvoSystemMessages",
    "supportsMidConvoToolAdditions",
    "supportsOpenAIGrammarTools",
    "forceAdaptiveThinking",
    "supportsAdaptiveThinking",
    "supportsLongCacheRetention",
    "sendSessionAffinityHeaders",
    "zaiToolStream",
    "supportsThinkingTokenBudget",
    "supportsAdditionalTools",
    "supportsToolSearch",
    "supportsExplicitPromptCacheMode",
    "supportsMaxOutputTokens",
    "supportsEagerToolInputStreaming",
    "supportsCacheControlOnTools",
    "supportsTemperature",
    "allowEmptySignature",
    "supportsStrictTools",
    "supportsMidConvoEffort",
    "supportsMidConvoToolChanges",
  ];
  const enums = {
    maxTokensField: ["max_tokens", "max_completion_tokens"],
    thinkingFormat: [
      "openai",
      "openrouter",
      "deepseek",
      "together",
      "baseten",
      "zai",
      "qwen",
      "chat-template",
      "qwen-chat-template",
      "string-thinking",
      "ant-ling",
    ],
    sessionAffinityFormat: ["openai", "openai-nosession", "openrouter"],
    cacheControlFormat: ["anthropic"],
    thinkingTokenBudgetField: [
      "thinking_token_budget",
      "thinking_budget",
      "thinking_budget_tokens",
    ],
  };
  fields(value, [
    ...booleans,
    ...Object.keys(enums),
    "chatTemplateArgs",
    "chatTemplateKwargs",
  ]);
  for (const [key, entry] of Object.entries(value)) {
    if (booleans.includes(key)) {
      if (typeof entry !== "boolean") fail();
    } else if (enums[key]) {
      if (!enums[key].includes(entry)) fail();
    } else {
      if (!record(entry) || Object.keys(entry).length > 32) fail();
      for (const argument of Object.values(entry)) {
        if (record(argument)) {
          fields(argument, ["$var"]);
          if (
            ![
              "thinking.enabled",
              "thinking.effort",
              "thinking.budget",
            ].includes(argument.$var)
          )
            fail();
        } else if (
          !(
            typeof argument === "boolean" ||
            (typeof argument === "string" && argument.length <= 256) ||
            (typeof argument === "number" && Number.isFinite(argument)) ||
            argument === null
          )
        )
          fail();
      }
    }
  }
}
function validateHeaders(h) {
  if (h === undefined) return;
  if (!record(h) || Object.keys(h).length > 32) fail();
  for (const [k, v] of Object.entries(h)) {
    if (
      !/^[a-zA-Z0-9-]{1,100}$/.test(k) ||
      /^(host|connection|content-length|transfer-encoding|cookie|proxy-.*)$/i.test(
        k,
      )
    )
      fail();
    literal(v);
  }
}
function validateRole(reference, providers) {
  if (reference == null) return null;
  fields(reference, ["provider", "modelId"]);
  const provider = Object.hasOwn(providers, reference.provider) ? providers[reference.provider] : undefined;
  if (typeof reference.provider !== "string" || typeof reference.modelId !== "string" || !provider || provider.enabled === false || !provider.models.some((model) => model.id === reference.modelId && model.enabled !== false)) {
    throw Object.assign(new Error("Assigned model must be available"), { status: 400, publicMessage: "Модель по умолчанию и модель для названий должны быть включены. Сначала измените или очистите назначение." });
  }
  return { provider: reference.provider, modelId: reference.modelId };
}

export function createCorporateModels({
  root,
  secret,
  gatewayUrl = "http://worker-manager:3030/gateway",
}) {
  const key = createHmac("sha256", secret)
    .update("pi-web/corporate-models/encryption/v1")
    .digest();
  const path = `${root}/models.enc`;
  const token = (id) =>
    createHmac("sha256", secret)
      .update(`pi-web/corporate-models/gateway/v1/${id}`)
      .digest("hex");
  async function read() {
    let raw;
    try {
      raw = await readFile(path, "utf8");
    } catch (e) {
      if (e.code === "ENOENT")
        return {
          revision: "initial",
          modelRevision: "initial",
          allowPersonalModels: true,
          providers: {},
          defaultModel: null,
          namingModel: null,
        };
      fail(503);
    }
    try {
      const e = JSON.parse(raw);
      if (e.version !== 1) fail();
      const d = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(e.iv, "base64"),
      );
      d.setAAD(Buffer.from("pi-web/corporate-models/v1"));
      d.setAuthTag(Buffer.from(e.tag, "base64"));
      const s = JSON.parse(
        Buffer.concat([
          d.update(Buffer.from(e.data, "base64")),
          d.final(),
        ]).toString(),
      );
      validateProviders(s.providers);
      s.defaultModel = validateRole(s.defaultModel, s.providers);
      s.namingModel = validateRole(s.namingModel, s.providers);
      if (
        typeof s.allowPersonalModels !== "boolean" ||
        typeof s.revision !== "string"
      )
        fail();
      s.modelRevision ??= s.revision;
      if (typeof s.modelRevision !== "string") fail();
      return s;
    } catch {
      fail(503);
    }
  }
  const reference = (v) =>
    `retain:${createHmac("sha256", key).update(v).digest("hex")}`;
  function secrets(s) {
    const map = new Map();
    walk(s.providers, (v) => {
      map.set(reference(v), v);
      return v;
    });
    return map;
  }
  function walk(providers, fn) {
    const copy = structuredClone(providers);
    for (const p of Object.values(copy)) {
      if (p.apiKey) p.apiKey = fn(p.apiKey);
      for (const h of [p.headers, ...(p.models || []).map((m) => m.headers)])
        if (h) for (const k of Object.keys(h)) h[k] = fn(h[k]);
    }
    return copy;
  }
  const masked = (s) => ({
    providers: walk(s.providers, reference),
    revision: s.modelRevision ?? s.revision,
    defaultModel: s.defaultModel ?? null,
    namingModel: s.namingModel ?? null,
  });
  async function save(s) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", key, iv);
    c.setAAD(Buffer.from("pi-web/corporate-models/v1"));
    const data = Buffer.concat([c.update(JSON.stringify(s)), c.final()]);
    const tmp = `${path}.${randomUUID()}`;
    await writeFile(
      tmp,
      JSON.stringify({
        version: 1,
        iv: iv.toString("base64"),
        tag: c.getAuthTag().toString("base64"),
        data: data.toString("base64"),
      }),
      { mode: 0o600, flush: true },
    );
    await rename(tmp, path);
  }
  async function resolve(providers) {
    const refs = secrets(await read());
    return validateProviders(
      walk(providers, (v) =>
        v.startsWith("retain:") ? (refs.get(v) ?? fail(409)) : v,
      ),
    );
  }
  async function update(payload, policy = false) {
    return serialize(path, async () => {
      const s = await read();
      if (policy) {
        fields(payload, ["allowPersonalModels"]);
        if (typeof payload.allowPersonalModels !== "boolean") fail();
        s.allowPersonalModels = payload.allowPersonalModels;
      } else {
        fields(payload, ["providers", "revision", "defaultModel", "namingModel"]);
        if (payload.revision !== s.modelRevision) fail(409);
        const providers = await resolve(payload.providers);
        const defaultModel = validateRole(Object.hasOwn(payload, "defaultModel") ? payload.defaultModel : s.defaultModel, providers);
        const namingModel = validateRole(Object.hasOwn(payload, "namingModel") ? payload.namingModel : s.namingModel, providers);
        s.providers = providers;
        s.defaultModel = defaultModel;
        s.namingModel = namingModel;
        s.modelRevision = randomUUID();
      }
      s.revision = randomUUID();
      await save(s);
      await publishAll(s);
      return policy
        ? { allowPersonalModels: s.allowPersonalModels }
        : masked(s);
    });
  }
  // Snapshot credentials authenticate to the gateway only; upstream credentials never leave this store.
  async function snapshot(id, s = undefined) {
    s ??= await read();
    const providers = {};
    for (const [pid, p] of Object.entries(s.providers))
      if (p.enabled !== false)
        providers[`corp-${pid}`] = {
          api: p.api,
          compat: gatewayCompat(pid, p),
          baseUrl: `${gatewayUrl}/${id}/${pid}`,
          apiKey: token(id),
          models: p.models
            .filter((m) => m.enabled !== false)
            .map((source) => {
              const m = structuredClone(source);
              delete m.headers;
              delete m.enabled;
              return {
                name: m.id,
                reasoning: false,
                input: ["text"],
                contextWindow: 128000,
                maxTokens: 8192,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                ...m,
                cost: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  ...m.cost,
                },
                compat: gatewayCompat(pid, p, m),
              };
            }),
        };
    return {
      version: 1,
      revision: s.revision,
      allowPersonalModels: s.allowPersonalModels,
      policyUrl: `${gatewayUrl}/${id}/policy`,
      gatewayToken: token(id),
      providers,
      defaultModel: s.defaultModel ? { ...s.defaultModel, provider: `corp-${s.defaultModel.provider}` } : null,
      namingModel: s.namingModel ? { ...s.namingModel, provider: `corp-${s.namingModel.provider}` } : null,
    };
  }
  const issued = new Set();
  async function publishSnapshot(id, s) {
    issued.add(id);
    const dir = `${root}/model-snapshots/${id}`;
    await mkdir(dir, { recursive: true, mode: 0o755 });
    const tmp = `${dir}/snapshot.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(await snapshot(id, s)), {
      mode: 0o644,
      flush: true,
    });
    await rename(tmp, `${dir}/snapshot.json`);
    return dir;
  }
  async function publishAll(s) {
    for (const id of await readdir(`${root}/model-snapshots`).catch((e) => {
      if (e.code === "ENOENT") return [];
      throw e;
    }))
      if (/^[0-9a-f-]{36}$/.test(id)) issued.add(id);
    for (const id of issued) await publishSnapshot(id, s);
  }
  return {
    read,
    masked,
    update,
    resolve,
    token,
    snapshot,
    publish: (id) => serialize(path, () => publishSnapshot(id)),
    authenticate(id, value) {
      const expected = Buffer.from(token(id));
      const actual = Buffer.from(value || "");
      return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
      );
    },
  };
}
