"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ConfigButton, ConfigEmptyState, ConfigPanelShell } from "./SettingsUi";

/** UI affordance only; worker and runtime enforce the same policy server-side. */
export function PersonalModelsPolicy({ children, embedded, onClose }: {
  children: ReactNode; embedded: boolean; onClose: () => void;
}) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/model-policy", { cache: "no-store", signal: controller.signal });
        const data = await response.json() as { allowPersonalModels?: unknown };
        if (!response.ok || typeof data.allowPersonalModels !== "boolean") throw new Error("Invalid model policy");
        if (!controller.signal.aborted) { setAllowed(data.allowPersonalModels); setError(false); }
      } catch {
        if (!controller.signal.aborted) { setAllowed(null); setError(true); }
      }
    }
    void load();
    const refresh = () => { void load(); };
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); window.removeEventListener("focus", refresh); };
  }, [attempt]);

  if (allowed === true) return children;
  return <ConfigPanelShell embedded={embedded} title="Модели" closeLabel="Закрыть" onClose={onClose}>
    <ConfigEmptyState>
      {error ? <div role="alert">Не удалось проверить настройки компании. <ConfigButton onClick={() => { setError(false); setAttempt((value) => value + 1); }}>Повторить</ConfigButton></div>
        : allowed === null ? <span role="status">Проверяем настройки моделей…</span>
          : <div role="status">Подключение личных моделей отключено администратором. Выберите модель компании в чате. Сохранённые личные подключения не удалены.</div>}
    </ConfigEmptyState>
  </ConfigPanelShell>;
}
