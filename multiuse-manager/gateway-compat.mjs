// Preserve endpoint-derived defaults before replacing a model's baseUrl/provider
// with the private gateway. Mirrors detectCompat in the pinned pi-ai 1.1.0
// openai-completions adapter; explicit provider/model overrides always win.
export function gatewayCompat(provider, config, model = {}) {
  const explicit = { ...config.compat, ...model.compat };
  if ((model.api || config.api) !== "openai-completions") return explicit;
  const baseUrl = config.baseUrl.toLowerCase();
  const zai =
    ["zai", "zai-coding-cn"].includes(provider) ||
    baseUrl.includes("api.z.ai") ||
    baseUrl.includes("open.bigmodel.cn");
  const together =
    provider === "together" || /api\.together\.(ai|xyz)/.test(baseUrl);
  const moonshot =
    ["moonshotai", "moonshotai-cn"].includes(provider) ||
    baseUrl.includes("api.moonshot.");
  const openrouter =
    provider === "openrouter" || baseUrl.includes("openrouter.ai");
  const cloudflareWorkers =
    provider === "cloudflare-workers-ai" ||
    baseUrl.includes("api.cloudflare.com");
  const cloudflareGateway =
    provider === "cloudflare-ai-gateway" ||
    baseUrl.includes("gateway.ai.cloudflare.com");
  const nvidia =
    provider === "nvidia" || baseUrl.includes("integrate.api.nvidia.com");
  const antLing =
    provider === "ant-ling" || baseUrl.includes("api.ant-ling.com");
  const cerebras = provider === "cerebras" || baseUrl.includes("cerebras.ai");
  const deepseek = provider === "deepseek" || baseUrl.includes("deepseek.com");
  const grok = provider === "xai" || baseUrl.includes("api.x.ai");
  const chutes = baseUrl.includes("chutes.ai");
  const nonStandard =
    nvidia ||
    cerebras ||
    grok ||
    together ||
    chutes ||
    deepseek ||
    zai ||
    moonshot ||
    provider === "opencode" ||
    baseUrl.includes("opencode.ai") ||
    cloudflareWorkers ||
    cloudflareGateway ||
    antLing;
  const maxTokens =
    chutes ||
    deepseek ||
    moonshot ||
    cloudflareGateway ||
    together ||
    nvidia ||
    antLing ||
    zai;
  return {
    supportsStore: !nonStandard,
    supportsDeveloperRole:
      (openrouter && /^(anthropic|openai)\//.test(model.id || "")) ||
      (!nonStandard && !openrouter),
    supportsReasoningEffort: !(
      grok ||
      zai ||
      moonshot ||
      together ||
      cloudflareGateway ||
      nvidia ||
      antLing
    ),
    supportsUsageInStreaming: true,
    supportsFinishReason: true,
    maxTokensField: maxTokens ? "max_tokens" : "max_completion_tokens",
    requiresReasoningContentOnAssistantMessages: deepseek,
    thinkingFormat: deepseek
      ? "deepseek"
      : zai
        ? "zai"
        : together
          ? "together"
          : antLing
            ? "ant-ling"
            : openrouter
              ? "openrouter"
              : "openai",
    ...(openrouter && (model.id || "").startsWith("anthropic/")
      ? { cacheControlFormat: "anthropic" }
      : {}),
    sendSessionAffinityHeaders: openrouter,
    sessionAffinityFormat: openrouter ? "openrouter" : "openai",
    supportsLongCacheRetention: !(
      together ||
      cloudflareWorkers ||
      cloudflareGateway ||
      nvidia ||
      antLing
    ),
    ...explicit,
  };
}
