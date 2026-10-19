// User-facing form checks only; the manager independently validates the full schema.
type ModelRef = { provider: string; modelId: string };
type ModelRoles = { defaultModel?: ModelRef | null; namingModel?: ModelRef | null };

export function retargetCorporateModelRoles<T extends ModelRoles>(draft: T, from: { provider: string; modelId?: string }, to: { provider: string; modelId?: string }): T {
  const next = { ...draft };
  for (const key of ["defaultModel", "namingModel"] as const) {
    const role = draft[key];
    if (role?.provider === from.provider && (from.modelId === undefined || role.modelId === from.modelId)) next[key] = { provider: to.provider, modelId: to.modelId ?? role.modelId };
  }
  return next;
}

export function corporateModelDraftError(providers: Record<string, { baseUrl?: string; enabled?: boolean; models?: { id: string; enabled?: boolean }[] }> = {}, roles: ModelRoles = {}): string | null {
  for (const [name, provider] of Object.entries(providers)) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) return "Имя провайдера: до 64 строчных латинских букв, цифр, дефисов или подчёркиваний; первый символ — буква или цифра.";
    try {
      const url = new URL(provider.baseUrl || "");
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
    } catch { return `Укажите HTTPS Base URL без пароля и параметров для «${name}».`; }
    if ((provider.models?.length || 0) > 200) return `У «${name}» больше 200 моделей. Удалите лишние или разделите подключение на несколько провайдеров.`;
    if (provider.models?.some((model) => !model.id.trim())) return `Укажите ID каждой модели в «${name}» или удалите пустые строки.`;
  }
  for (const [key, title] of [["defaultModel", "Модель по умолчанию"], ["namingModel", "Модель для названий"]] as const) {
    const role = roles[key];
    if (role && (!providers[role.provider] || providers[role.provider].enabled === false || !providers[role.provider].models?.some((model) => model.id === role.modelId && model.enabled !== false))) return `${title} недоступна. Включите её, выберите другую или очистите назначение.`;
  }
  return null;
}

export function modelsConfigApiPath(path: string, corporate: boolean): string {
  if (!corporate) return path;
  if (path !== "/api/models-config" && !path.startsWith("/api/models-config/")) {
    throw new Error("Корпоративный редактор не обращается к личным провайдерам");
  }
  return path.replace("/api/models-config", "/api/multi/admin/models-config");
}
