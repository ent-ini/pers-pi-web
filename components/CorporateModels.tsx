"use client";

import { useEffect, useState } from "react";
import { ModelsConfig } from "./ModelsConfig";
import { CorporateModelAssignments } from "./CorporateModelAssignments";
import { ConfigSwitch } from "./SettingsUi";
import styles from "./MultiuseAdmin.module.css";

async function modelSettings(init?: RequestInit): Promise<boolean> {
  const response = await fetch("/api/multi/admin/model-settings", { cache: "no-store", ...init });
  const data = await response.json() as { allowPersonalModels?: unknown; error?: string };
  if (!response.ok || typeof data.allowPersonalModels !== "boolean") throw new Error(data.error || "Не удалось загрузить настройку личных моделей");
  return data.allowPersonalModels;
}

export function CorporateModels() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setAllowed(null);
    setError("");
    void modelSettings({ signal: controller.signal }).then((value) => {
      if (!controller.signal.aborted) setAllowed(value);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не удалось загрузить настройку");
    });
    return () => controller.abort();
  }, [attempt]);

  const changePolicy = async (value: boolean) => {
    if (pending || allowed === null) return;
    setPending(true);
    setError("");
    setFeedback("");
    try {
      const saved = await modelSettings({ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allowPersonalModels: value }) });
      setAllowed(saved);
      setFeedback(saved ? "Сотрудникам разрешено подключать и использовать личные модели." : "Сотрудникам доступны только модели компании. Личные подключения сохранены, но недоступны для использования.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить настройку. Попробуйте ещё раз.");
    } finally { setPending(false); }
  };

  return <div className={styles.corporateModels}>
    <section className={styles.modelPolicy} aria-labelledby="personal-model-policy">
      <div className={styles.listCopy}>
        <h1 id="personal-model-policy">Разрешить подключать собственные модели</h1>
        <p id="personal-model-policy-description">Сотрудники смогут использовать свои API-ключи и подписки в дополнение к моделям компании. Отключение не удаляет сохранённые подключения.</p>
      </div>
      <div className={styles.modelPolicyControl}>
        <span aria-live="polite">{pending ? "Сохраняем…" : allowed === null ? "Загрузка…" : allowed ? "Разрешено" : "Запрещено"}</span>
        <ConfigSwitch checked={allowed === true} disabled={allowed === null || pending} loading={pending} label="Разрешить сотрудникам подключать собственные модели" describedBy="personal-model-policy-description" onChange={(value) => { void changePolicy(value); }} />
      </div>
      {error && <div className={styles.modelPolicyFeedback} role="alert">{error} <button className={styles.secondaryButton} disabled={pending} onClick={() => setAttempt((value) => value + 1)}>Повторить</button></div>}
      {feedback && <div className={styles.modelPolicyFeedback} role="status">{feedback}</div>}
    </section>
    <CorporateModelAssignments />
    <section className={styles.modelsEditor} aria-label="Модели компании">
      <div className={styles.modelsEditorHeading}>
        <h2>Модели компании</h2>
        <p>Общие подключения по API-ключу для всех сотрудников. Добавьте провайдера, выберите модели и сохраните. OAuth-подписки компании пока не поддерживаются.</p>
      </div>
      <ModelsConfig corporate embedded onClose={() => {}} />
    </section>
  </div>;
}
