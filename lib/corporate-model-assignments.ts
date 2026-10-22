// Назначения корпоративных моделей: модель по умолчанию для новых чатов и
// модель для автоназваний сессий.
//
// Логика без React, чтобы её можно было покрыть тестами и переиспользовать
// и в админке, и в её API-слое. Формат значения — тот же, что у ролей в
// `components/models-config-api.ts`: JSON-объект `{ provider, modelId }`.

export type CorporateModelRef = { provider: string; modelId: string };

export type CorporateModelEntry = { id: string; name?: string; enabled?: boolean };

export type CorporateProviderEntry = {
  enabled?: boolean;
  baseUrl?: string;
  models?: CorporateModelEntry[];
};

export type CorporateProviders = Record<string, CorporateProviderEntry>;

export type CorporateAssignments = {
  defaultModel: CorporateModelRef | null;
  namingModel: CorporateModelRef | null;
};

export type AssignmentOption = {
  value: string;
  label: string;
  disabled: boolean;
};

/** Значение select'а: JSON-ссылка на модель либо пустая строка («не назначено»). */
export function assignmentRefValue(ref: CorporateModelRef | null | undefined): string {
  return ref ? JSON.stringify({ provider: ref.provider, modelId: ref.modelId }) : "";
}

/** Разбор значения select'а обратно в ссылку на модель. */
export function parseAssignmentValue(value: string): CorporateModelRef | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { provider?: unknown; modelId?: unknown };
    if (typeof parsed.provider === "string" && typeof parsed.modelId === "string") {
      return { provider: parsed.provider, modelId: parsed.modelId };
    }
  } catch {
    // Не наш формат — считаем, что назначения нет.
  }
  return null;
}

/** Все модели компании как варианты выбора: подпись — «модель · провайдер». */
export function assignmentOptions(providers: CorporateProviders = {}): AssignmentOption[] {
  return Object.entries(providers).flatMap(([provider, entry]) =>
    (entry.models ?? [])
      .filter((model) => Boolean(model.id))
      .map((model) => ({
        value: assignmentRefValue({ provider, modelId: model.id }),
        label: `${model.name || model.id} · ${provider}`,
        disabled: entry.enabled === false || model.enabled === false,
      })),
  );
}

/**
 * Назначение должно указывать на включённую модель включённого провайдера:
 * выключенная модель в списке остаётся видна (иначе нельзя понять, что
 * назначение сломано), но выбрать её нельзя.
 */
export function assignmentsError(
  providers: CorporateProviders = {},
  assignments: Partial<CorporateAssignments> = {},
): string | null {
  for (const [key, title] of [
    ["defaultModel", "Модель по умолчанию"],
    ["namingModel", "Модель для названий"],
  ] as const) {
    const ref = assignments[key];
    if (!ref) continue;
    const provider = providers[ref.provider];
    if (
      !provider
      || provider.enabled === false
      || !(provider.models ?? []).some((model) => model.id === ref.modelId && model.enabled !== false)
    ) {
      return `${title} недоступна. Включите её, выберите другую или очистите назначение.`;
    }
  }
  return null;
}

/** Тело PUT-запроса: провайдеры и ревизия — как пришли, роли — новые. */
export function assignmentsPayload(
  state: { providers?: CorporateProviders; revision?: string },
  assignments: Partial<CorporateAssignments>,
): { providers: CorporateProviders; revision: string; defaultModel: CorporateModelRef | null; namingModel: CorporateModelRef | null } {
  return {
    providers: state.providers ?? {},
    revision: state.revision ?? "",
    defaultModel: assignments.defaultModel ?? null,
    namingModel: assignments.namingModel ?? null,
  };
}
