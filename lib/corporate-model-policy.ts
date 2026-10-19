import { readFileSync } from "node:fs";
export type CorporateModelRef = { provider: string; modelId: string };
type Snapshot = {
  defaultModel?: CorporateModelRef | null;
  namingModel?: CorporateModelRef | null;
  policyUrl?: string;
  gatewayToken?: string;
  version: 1;
  revision: string;
  allowPersonalModels: boolean;
  providers: Record<
    string,
    Record<string, unknown> & {
      models: {
        id: string;
      }[];
    }
  >;
};
export function corporateSnapshot(): Snapshot | undefined {
  const path = process.env.PI_WEB_MODEL_SNAPSHOT;
  if (!path) return undefined;
  try {
    const s = JSON.parse(readFileSync(path, "utf8"));
    if (
      s.version !== 1 ||
      typeof s.revision !== "string" ||
      typeof s.allowPersonalModels !== "boolean" ||
      !s.providers ||
      typeof s.providers !== "object" ||
      Array.isArray(s.providers)
    )
      throw new Error();
    for (const [id, p] of Object.entries(s.providers) as [
      string,
      Snapshot["providers"][string],
    ][])
      if (
        !id.startsWith("corp-") ||
        !Array.isArray(p.models) ||
        typeof p.apiKey !== "string" ||
        typeof p.baseUrl !== "string"
      )
        throw new Error();
    for (const role of [s.defaultModel, s.namingModel]) {
      if (role != null && (typeof role.provider !== "string" || typeof role.modelId !== "string" || !s.providers[role.provider]?.models.some((model: { id: string }) => model.id === role.modelId))) throw new Error();
    }
    return s;
  } catch {
    throw new Error("Corporate model policy unavailable");
  }
}
export function personalModelsAllowed(): boolean {
  return corporateSnapshot()?.allowPersonalModels ?? true;
}
export function personalModelPath(path: string): boolean {
  return /^\/api\/(auth(?:\/|$)|models-config(?:\/|$)|models\/refresh(?:\/|$)|provider-usage(?:\/|$))/.test(
    path,
  );
}
export function corporateModelAllowed(provider: string, id?: string): boolean {
  const s = corporateSnapshot();
  if (!s) return true;
  if (!provider.startsWith("corp-")) return s.allowPersonalModels;
  const p = s.providers[provider];
  return !!p && (!id || p.models.some((m) => m.id === id));
}
