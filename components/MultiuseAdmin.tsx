"use client";

import { useCallback, useEffect, useState } from "react";

type Employee = { id: string; email: string; fullName: string; role: string; provisionedAt: string; lastLoginAt: string; running: boolean };
type Entry = { path: string; type: "file" | "directory" };

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`/api/multi/admin/${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
  return body;
}

export function MultiuseAdmin() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [users, setUsers] = useState<Employee[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [path, setPath] = useState("README.md");
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const [userData, treeData] = await Promise.all([api("users"), api("template/tree")]);
    setUsers(userData.users || []); setEntries(treeData.entries || []);
  }, []);

  useEffect(() => {
    void fetch("/api/multi/auth/session").then(async (response) => {
      const body = await response.json().catch(() => ({}));
      const role = body.user?.role;
      setAllowed(role === "admin" || role === "tech");
      if (role === "admin" || role === "tech") await refresh();
    }).catch(() => setAllowed(false));
  }, [refresh]);

  const run = useCallback(async (action: () => Promise<void>) => {
    setMessage("");
    try { await action(); await refresh(); setMessage("Сохранено."); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }, [refresh]);
  const openFile = useCallback((nextPath: string) => void run(async () => {
    const data = await api(`template/file?path=${encodeURIComponent(nextPath)}`);
    setPath(nextPath); setContent(data.content || "");
  }), [run]);

  if (allowed === null) return <main style={{ padding: 32 }}>Проверяем права…</main>;
  if (!allowed) return <main style={{ padding: 32 }}>Доступ к администрированию запрещён.</main>;

  return <main style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 20px", fontFamily: "var(--font-sans, sans-serif)" }}>
    <h1>Администрирование ИИ-помощника</h1>
    <p style={{ color: "var(--text-muted)" }}>Шаблон применяется при первом создании workspace и при явном пересоздании workspace сотрудника.</p>
    {message && <p role="status">{message}</p>}
    <section style={{ display: "grid", gridTemplateColumns: "minmax(250px, 1fr) minmax(360px, 2fr)", gap: 20, marginTop: 24 }}>
      <div><h2>Шаблон файлов</h2>
        <button onClick={() => void run(async () => { await api("template/directory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) }); })}>Создать папку</button>{" "}
        <button onClick={() => void run(async () => { await api("template/entry", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) }); })}>Удалить путь</button>
        <ul style={{ paddingLeft: 18 }}>{entries.map((entry) => <li key={entry.path}><button disabled={entry.type === "directory"} onClick={() => openFile(entry.path)}>{entry.type === "directory" ? "📁 " : "📄 "}{entry.path}</button></li>)}</ul>
      </div>
      <div><h2>Файл или путь</h2>
        <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="например, instructions/README.md" style={{ width: "100%", boxSizing: "border-box", padding: 8 }} />
        <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={16} style={{ width: "100%", boxSizing: "border-box", marginTop: 10, padding: 8, fontFamily: "monospace" }} />
        <button onClick={() => void run(async () => { await api("template/file", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, content }) }); })}>Сохранить файл</button>
      </div>
    </section>
    <section style={{ marginTop: 36 }}><h2>Созданные рабочие пространства</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th align="left">Сотрудник</th><th align="left">Роль</th><th align="left">Worker</th><th /></tr></thead><tbody>
        {users.map((user) => <tr key={user.id}><td>{user.fullName || user.id}<br /><small>{user.email}</small></td><td>{user.role}</td><td>{user.running ? "запущен" : "остановлен"}</td><td><button onClick={() => { if (confirm(`Пересоздать workspace ${user.fullName || user.email}? Чаты сохранятся, все файлы в workspace будут удалены.`)) void run(async () => { await api(`users/${user.id}/reset-workspace`, { method: "POST" }); }); }}>Пересоздать workspace</button></td></tr>)}
      </tbody></table>
    </section>
  </main>;
}
