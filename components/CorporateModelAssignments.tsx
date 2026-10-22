"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfigButton, ConfigField } from "./SettingsUi";
import styles from "./MultiuseAdmin.module.css";
import {
  assignmentOptions,
  assignmentRefValue,
  assignmentsError,
  assignmentsPayload,
  parseAssignmentValue,
  type CorporateAssignments,
  type CorporateModelRef,
  type CorporateProviders,
} from "@/lib/corporate-model-assignments";

type CorporateConfig = {
  providers?: CorporateProviders;
  revision?: string;
  defaultModel?: CorporateModelRef | null;
  namingModel?: CorporateModelRef | null;
};

const ENDPOINT = "/api/multi/admin/models-config";

async function readConfig(signal?: AbortSignal): Promise<CorporateConfig> {
  const response = await fetch(ENDPOINT, { cache: "no-store", signal });
  const data = await response.json() as CorporateConfig & { error?: string };
  if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

/**
 * Назначения корпоративных моделей: модель по умолчанию для новых чатов и
 * модель для автоназваний сессий.
 *
 * Отдельный блок с собственной кнопкой сохранения: назначения меняются часто
 * и не должны делить форму с подключениями и ключами. Своя кнопка и своя
 * ревизия — сохранение проверяется сервером, поэтому правка в другой вкладке
 * не затирается молча.
 */
export function CorporateModelAssignments() {
  const [config, setConfig] = useState<CorporateConfig | null>(null);
  const [assignments, setAssignments] = useState<CorporateAssignments>({ defaultModel: null, namingModel: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setFeedback("");
    void readConfig(controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setConfig(data);
      setAssignments({
        defaultModel: data.defaultModel ?? null,
        namingModel: data.namingModel ?? null,
      });
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить назначения моделей");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [attempt]);

  const options = useMemo(() => assignmentOptions(config?.providers ?? {}), [config]);
  const draftError = useMemo(() => assignmentsError(config?.providers ?? {}, assignments), [config, assignments]);

  const save = useCallback(async () => {
    if (!config || saving) return;
    const error = assignmentsError(config.providers ?? {}, assignments);
    if (error) { setError(error); setFeedback(""); return; }
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      const response = await fetch(ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assignmentsPayload(config, assignments)),
      });
      const data = await response.json() as CorporateConfig & { error?: string };
      if (!response.ok || data.error) {
        setError(response.status === 409
          ? "Назначения изменились в другой вкладке. Обновите страницу и назначите заново."
          : data.error ?? `HTTP ${response.status}`);
        return;
      }
      setConfig(data);
      setAssignments({
        defaultModel: data.defaultModel ?? null,
        namingModel: data.namingModel ?? null,
      });
      setFeedback("Назначения сохранены. Новые чаты сотрудников используют выбранную модель.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить назначения. Попробуйте ещё раз.");
    } finally {
      setSaving(false);
    }
  }, [assignments, config, saving]);

  const select = (key: keyof CorporateAssignments, label: string) => (
    <ConfigField label={label}>
      <select
        aria-label={label}
        value={assignmentRefValue(assignments[key])}
        disabled={loading || saving}
        className={styles.modelAssignmentSelect}
        onChange={(event) => setAssignments((current) => ({ ...current, [key]: parseAssignmentValue(event.target.value) }))}
      >
        <option value="">{key === "defaultModel" ? "Автоматический выбор" : "Автоназывание выключено"}</option>
        {assignments[key] && !options.some((option) => option.value === assignmentRefValue(assignments[key])) && (
          <option value={assignmentRefValue(assignments[key])} disabled>Модель недоступна — выберите другую</option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}{option.disabled ? " (выключена)" : ""}</option>
        ))}
      </select>
    </ConfigField>
  );

  return (
    <section className={styles.modelAssignments} aria-labelledby="model-assignments">
      <div className={styles.modelsEditorHeading}>
        <h2 id="model-assignments">Назначения моделей</h2>
        <p>Модель по умолчанию — для новых чатов всех сотрудников. Модель для названий — отдельная, обычно более дешёвая: она придумывает заголовок сессии после 2, 6 и 16 сообщений, ручные названия не перебиваются.</p>
      </div>
      <div className={styles.modelAssignmentsBody}>
        {select("defaultModel", "Модель по умолчанию")}
        {select("namingModel", "Модель для названий")}
        <div className={styles.modelAssignmentsActions}>
          <ConfigButton variant="primary" onClick={() => { void save(); }} disabled={loading || saving || Boolean(draftError)}>
            {saving ? "Сохраняем…" : "Сохранить назначения"}
          </ConfigButton>
          <ConfigButton onClick={() => setAttempt((value) => value + 1)} disabled={saving}>Обновить</ConfigButton>
        </div>
        {loading && <div className={styles.modelPolicyFeedback} role="status">Загружаем назначения…</div>}
        {draftError && !error && <div className={styles.modelPolicyFeedback} role="alert">{draftError}</div>}
        {error && <div className={styles.modelPolicyFeedback} role="alert">{error}</div>}
        {feedback && <div className={styles.modelPolicyFeedback} role="status">{feedback}</div>}
      </div>
    </section>
  );
}
