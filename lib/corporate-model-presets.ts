import { getModels, getProviders } from "@earendil-works/pi-ai/compat";
import type { Api, Model } from "@earendil-works/pi-ai";

const supportedApis = new Set([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
]);
const labels: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  minimax: "MiniMax",
  "minimax-cn": "MiniMax China",
  deepseek: "DeepSeek",
  openrouter: "OpenRouter",
  groq: "Groq",
  nvidia: "NVIDIA",
  together: "Together AI",
  moonshotai: "Moonshot AI",
  "moonshotai-cn": "Moonshot AI China",
  "kimi-coding": "Kimi Coding",
  xai: "xAI",
};

/** Pinned SDK metadata only. Never opens auth.json, creates a runtime or fetches a provider. */
export function corporateModelPresets() {
  return getProviders().flatMap((id) => {
    // Subscription-only providers need native auth beyond the four compatible APIs.
    if (id === "github-copilot") return [];
    const groups = new Map<string, Model<Api>[]>();
    for (const model of getModels(id)) {
      if (
        !supportedApis.has(model.api) ||
        !model.baseUrl?.startsWith("https://") ||
        /[{}$]/.test(model.baseUrl)
      )
        continue;
      const group = `${model.api}\n${model.baseUrl}`;
      const models = groups.get(group) || [];
      models.push(model);
      groups.set(group, models);
    }
    return [...groups.entries()].map(([key, models], index) => {
      const [api, baseUrl] = key.split("\n");
      const suffix = groups.size > 1 ? `-${index + 1}` : "";
      return {
        id: `${id}${suffix}`,
        displayName: `${labels[id] || id}${groups.size > 1 ? ` · ${api}` : ""}`,
        provider: {
          api,
          baseUrl,
          // Admin can import a different selection or add models manually.
          models: models.slice(0, 200).map((model) => ({
            id: model.id,
            name: model.name,
            reasoning: model.reasoning,
            input: model.input,
            ...(model.compat
              ? {
                  compat: Object.fromEntries(
                    Object.entries(model.compat).filter(
                      ([key]) => key !== "allowedFallbackModels",
                    ),
                  ),
                }
              : {}),
            contextWindow: model.contextWindow,
            maxTokens: model.maxTokens,
            cost: {
              input: model.cost.input,
              output: model.cost.output,
              cacheRead: model.cost.cacheRead,
              cacheWrite: model.cost.cacheWrite,
            },
          })),
        },
      };
    });
  });
}
