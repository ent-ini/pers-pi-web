"use client";

import Image from "next/image";
import { useState, type FormEvent } from "react";
import { safeLoginDestination } from "@/lib/login-destination";

function safeDestination(): string {
  const destination = new URLSearchParams(window.location.search).get("next");
  return safeLoginDestination(destination, window.location.origin);
}

export function MultiuseLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/multi/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json().catch(() => null) as { error?: unknown } | null;
      if (!response.ok) {
        setError(typeof body?.error === "string" ? body.error : "Не удалось выполнить вход.");
        return;
      }
      window.location.replace(safeDestination());
    } catch {
      setError("Не удалось связаться с сервером. Попробуйте позже.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="web-login-page">
      <div className="web-login-shell">
        <header className="web-login-brand">
          <Image src="/icons/apple-touch-icon.png" width={52} height={52} alt="" priority />
          <div>
            <h1>ИИ-помощник</h1>
            <p>Войдите с учётной записью BuhgalterBPM</p>
          </div>
        </header>
        <form className="web-login-form" onSubmit={submit}>
          <div className="web-login-composer multiuse-login-fields">
            <label className="web-login-label" htmlFor="bpm-email">Email</label>
            <input
              id="bpm-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              autoFocus
              required
              disabled={busy}
            />
            <label className="web-login-label" htmlFor="bpm-password">Пароль</label>
            <input
              id="bpm-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              disabled={busy}
            />
            <button type="submit" disabled={busy || !email || !password}>
              {busy ? "Входим…" : "Войти"}
            </button>
          </div>
          <p className="web-login-error" role="alert" aria-live="polite">{error}</p>
        </form>
      </div>
    </main>
  );
}
