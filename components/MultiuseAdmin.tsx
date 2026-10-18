"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import { MarkdownBody } from "./MarkdownBody";
import { CorporateModels } from "./CorporateModels";
import styles from "./MultiuseAdmin.module.css";
import type { AdminEmployee as Employee } from "@/lib/multiuse-admin-users";

type Tab = "users" | "files" | "models" | "skills" | "tools";
type AdminUser = { fullName: string; role: string };
const roles: Record<string, string> = { admin: "Администратор", tech: "Тех. специалист", employee: "Сотрудник", viewer: "Наблюдатель", member: "Сотрудник" };
const workerLabels: Record<Employee["worker"], string> = { running: "Работает", stopped: "Остановлен", "not-created": "Не создан", unknown: "Недоступен" };
const statusLabels: Record<string, string> = { active: "Активен", archived: "В архиве", inactive: "Неактивен", disabled: "Отключён" };
type DefaultFile = { name: string; path: string; kind: "file" | "folder" };
type FileContextMenu = { entry: DefaultFile; x: number; y: number };

function parentDirectory(path: string) {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

async function templateRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`/api/multi/admin/template/${path}`, { cache: "no-store", ...init });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "Не удалось изменить шаблон workspace";
    throw new Error(error);
  }
  return body;
}

function parseTemplateEntries(value: unknown): DefaultFile[] {
  if (!value || typeof value !== "object" || !("entries" in value) || !Array.isArray(value.entries)) throw new Error("Сервер вернул некорректный список файлов");
  return value.entries.flatMap((entry): DefaultFile[] => {
    if (!entry || typeof entry !== "object" || !("path" in entry) || !("type" in entry) || typeof entry.path !== "string" || !["file", "directory"].includes(String(entry.type))) return [];
    const path = entry.path;
    if (!path || path.length > 512 || path.includes("\0") || path.split("/").some((part: string) => !part || part === "." || part === "..")) return [];
    return [{ path, name: path.split("/").at(-1) || path, kind: entry.type === "directory" ? "folder" : "file" }];
  });
}
type Resource = { name: string; description: string; enabled: boolean };

const initialSkills: Resource[] = [
  { name: "Работа с таблицами", description: "Анализирует таблицы, сверяет данные и объясняет результаты.", enabled: true },
  { name: "Бухгалтерские документы", description: "Помогает разбирать первичные документы и находить ошибки.", enabled: true },
  { name: "Деловая переписка", description: "Готовит письма и ответы в деловом стиле.", enabled: false },
];
const initialTools: Resource[] = [
  { name: "Чтение файлов", description: "Позволяет помощнику читать файлы из рабочего пространства сотрудника.", enabled: true },
  { name: "Создание файлов", description: "Позволяет создавать и изменять файлы в рабочем пространстве.", enabled: true },
  { name: "Поиск в интернете", description: "Доступ к поиску публичной информации в интернете.", enabled: false },
];

const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: "users", label: "Пользователи", icon: "users" },
  { id: "files", label: "Файлы по умолчанию", icon: "files" },
  { id: "models", label: "Модели", icon: "models" },
  { id: "skills", label: "Skills", icon: "skills" },
  { id: "tools", label: "Tools", icon: "tools" },
];

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    files: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></>,
    models: <><path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
    skills: <><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-2-5.8L4 11l6-2.2L12 3Z"/><path d="m19 14 1 2.5 2 1-2 1L19 21l-1-2.5-2-1 2-1 1-2.5Z"/></>,
    tools: <><path d="M14.7 6.3a5 5 0 0 0-6.4 6.4L3 18l3 3 5.3-5.3a5 5 0 0 0 6.4-6.4L14 13l-3-3 3.7-3.7Z"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></>,
    folder: <><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    edit: <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></>,
    trash: <><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2"/></>,
    close: <><path d="m18 6-12 12M6 6l12 12"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "green" | "amber" | "blue" }) {
  return <span className={`${styles.badge} ${styles[`badge_${tone}`]}`}>{children}</span>;
}

export function MultiuseAdmin() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("users");
  const [users, setUsers] = useState<Employee[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState("");
  const [workerAvailable, setWorkerAvailable] = useState(true);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const resetPending = useRef(false);
  const [resetFeedback, setResetFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const [templateRevision, setTemplateRevision] = useState("");
  const [files, setFiles] = useState<DefaultFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesError, setFilesError] = useState("");
  const [selectedFile, setSelectedFile] = useState("");
  const [directoryPath, setDirectoryPath] = useState("");
  const [fileDraft, setFileDraft] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);
  const [fileMutationPending, setFileMutationPending] = useState(false);
  const [editingFile, setEditingFile] = useState(false);
  const [fileContextMenu, setFileContextMenu] = useState<FileContextMenu | null>(null);
  const [renameTarget, setRenameTarget] = useState<DefaultFile | null>(null);
  const fileLoadVersion = useRef(0);
  const [skills, setSkills] = useState(initialSkills);
  const [tools, setTools] = useState(initialTools);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<"skill" | "tool" | "file" | "folder" | "rename" | null>(null);
  const [formName, setFormName] = useState("");
  const [formDetail, setFormDetail] = useState("");
  const [toast, setToast] = useState("");
  // Same `pi-theme` storage and toggle as the chat UI, so the admin remembers
  // the choice per browser origin (admin.buhgalterboutique.ru is its own one).
  const { isDark, setThemePreference } = useTheme();

  useEffect(() => {
    let mounted = true;
    void fetch("/api/multi/auth/session").then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (mounted) {
        setAllowed(response.ok && (body.user?.role === "admin" || body.user?.role === "tech"));
        setAdminUser(body.user || null);
      }
    }).catch(() => { if (mounted) setAllowed(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    setUsersLoading(true);
    setUsersError("");
    void fetch("/api/multi/admin/users", { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(body.users)) throw new Error(body.error || "Не удалось загрузить сотрудников BPM");
      if (!controller.signal.aborted) {
        setUsers(body.users);
        setWorkerAvailable(body.workerAvailable === true);
        setUsersLoading(false);
      }
    }).catch((error) => {
      if (!controller.signal.aborted) {
        setUsersError(error instanceof Error ? error.message : "Не удалось загрузить сотрудников BPM");
        setUsersLoading(false);
      }
    });
    return () => controller.abort();
  }, [allowed]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };
  const refreshTemplateTree = useCallback(async () => {
    setFilesLoading(true);
    setFilesError("");
    try {
      const body = await templateRequest("tree");
      setFiles(parseTemplateEntries(body));
      setTemplateRevision(body && typeof body === "object" && "revision" in body && typeof body.revision === "string" ? body.revision : "");
    } catch (error) {
      setFilesError(error instanceof Error ? error.message : "Не удалось загрузить файлы шаблона");
    } finally {
      setFilesLoading(false);
    }
  }, []);
  useEffect(() => {
    if (allowed) void refreshTemplateTree();
  }, [allowed, refreshTemplateTree]);
  useEffect(() => {
    if (!fileContextMenu) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-file-context-menu]")) return;
      setFileContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setFileContextMenu(null); };
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => { window.removeEventListener("pointerdown", closeOnPointerDown); window.removeEventListener("keydown", closeOnEscape); };
  }, [fileContextMenu]);

  const currentFile = files.find((file) => file.path === selectedFile);
  const directoryEntries = files.filter((file) => parentDirectory(file.path) === directoryPath);
  const directoryBreadcrumbs = directoryPath.split("/").filter(Boolean).map((part, index, parts) => ({
    name: part,
    path: parts.slice(0, index + 1).join("/"),
  }));
  const filteredUsers = useMemo(() => users.filter((user) => `${user.name} ${user.email} ${roles[user.role] || user.role} ${statusLabels[user.status] || user.status}`.toLowerCase().includes(search.trim().toLowerCase())), [users, search]);

  const resetWorkspace = async (user: Employee) => {
    if (resetPending.current) return;
    const legacyWarning = !user.workspaceTemplate ? "\nУ этого workspace нет истории шаблона: неизвестные старые файлы останутся, конфликтующие личные файлы не будут перезаписаны." : "";
    if (!window.confirm(`Пересоздать workspace сотрудника «${user.name}»?\nПрежние файлы шаблона, включая правки сотрудника в них, будут удалены и заменены актуальными. Личные файлы и история чатов сохранятся. Текущий ответ AI будет прерван.${legacyWarning}`)) return;
    resetPending.current = true;
    setResettingUserId(user.id);
    setResetFeedback(null);
    try {
      const response = await fetch(`/api/multi/admin/users/${encodeURIComponent(user.id)}/reset-workspace`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok !== true) throw new Error(body.error || "Не удалось пересоздать workspace");
      setUsers((items) => items.map((item) => item.id === user.id ? { ...item, worker: body.worker, workspaceTemplate: { revision: body.revision, appliedAt: body.appliedAt, trackedFiles: body.trackedFiles } } : item));
      setResetFeedback({ error: false, text: body.legacy
        ? `Workspace сотрудника «${user.name}» обновлён. Прежний шаблон не был записан: неизвестные старые файлы сохранены. Следующие пересоздания будут учитывать историю.`
        : `Workspace сотрудника «${user.name}» пересоздан: установлен актуальный шаблон. Личные файлы и чаты сохранены.` });
    } catch (error) {
      setResetFeedback({ error: true, text: error instanceof Error ? error.message : "Не удалось пересоздать workspace" });
    } finally {
      resetPending.current = false;
      setResettingUserId(null);
    }
  };

  const chooseFile = async (file: DefaultFile, startEditing = false) => {
    if (file.kind !== "file") return;
    const version = ++fileLoadVersion.current;
    setSelectedFile(file.path);
    setFileDraft("");
    setEditingFile(startEditing);
    setFileLoading(true);
    try {
      const body = await templateRequest(`file?path=${encodeURIComponent(file.path)}`);
      if (!body || typeof body !== "object" || !("content" in body) || typeof body.content !== "string") throw new Error("Сервер вернул некорректное содержимое файла");
      if (version === fileLoadVersion.current) setFileDraft(body.content);
    } catch (error) {
      if (version === fileLoadVersion.current) notify(error instanceof Error ? error.message : "Не удалось прочитать файл");
    } finally {
      if (version === fileLoadVersion.current) setFileLoading(false);
    }
  };
  const addFile = () => { setFormName(""); setModal("file"); };
  const addFolder = () => { setFormName(""); setModal("folder"); };
  const openDirectory = (path: string) => {
    fileLoadVersion.current += 1;
    setDirectoryPath(path); setSelectedFile(""); setFileDraft(""); setFileLoading(false); setEditingFile(false);
  };
  const saveFile = async () => {
    if (!currentFile || fileSaving) return;
    setFileSaving(true);
    try {
      await templateRequest("file", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: currentFile.path, content: fileDraft }) });
      setEditingFile(false);
      await refreshTemplateTree();
      notify("Изменения сохранены в шаблоне workspace");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось сохранить файл");
    } finally {
      setFileSaving(false);
    }
  };
  const deleteEntry = async (entry: DefaultFile) => {
    const description = entry.kind === "folder" ? `Удалить папку «${entry.name}» вместе со всем содержимым?` : `Удалить файл «${entry.name}» из шаблона?`;
    if (fileMutationPending || !window.confirm(description)) return;
    setFileMutationPending(true);
    try {
      await templateRequest("entry", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: entry.path }) });
      const isInsideDeletedFolder = entry.kind === "folder" && (directoryPath === entry.path || directoryPath.startsWith(`${entry.path}/`));
      if (isInsideDeletedFolder) setDirectoryPath(parentDirectory(entry.path));
      if (selectedFile === entry.path || (entry.kind === "folder" && selectedFile.startsWith(`${entry.path}/`))) {
        fileLoadVersion.current += 1;
        setSelectedFile(""); setFileDraft(""); setEditingFile(false);
      }
      await refreshTemplateTree();
      notify(entry.kind === "folder" ? "Папка удалена из шаблона workspace" : "Файл удалён из шаблона workspace");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось удалить запись");
    } finally {
      setFileMutationPending(false);
    }
  };
  const deleteFile = async () => { if (currentFile) await deleteEntry(currentFile); };
  const showFileContextMenu = (event: React.MouseEvent<HTMLButtonElement>, entry: DefaultFile) => {
    event.preventDefault();
    if (fileMutationPending) return;
    setFileContextMenu({ entry, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 196)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 98)) });
  };
  const openRename = (entry: DefaultFile) => {
    setFileContextMenu(null);
    setRenameTarget(entry); setFormName(entry.name); setModal("rename");
  };
  const renameEntry = async () => {
    if (!renameTarget || fileMutationPending) return;
    const name = formName.trim();
    if (!name || name === "." || name === ".." || name.includes("/")) {
      notify("Укажите имя без символа /");
      return;
    }
    if (name === renameTarget.name) { setModal(null); setRenameTarget(null); return; }
    const parent = parentDirectory(renameTarget.path);
    const newPath = parent ? `${parent}/${name}` : name;
    if (files.some((file) => file.path === newPath)) { notify("Файл или папка с таким именем уже существует"); return; }
    setFileMutationPending(true);
    try {
      await templateRequest("entry", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: renameTarget.path, name }) });
      const remapPath = (path: string) => path === renameTarget.path ? newPath : path.startsWith(`${renameTarget.path}/`) ? `${newPath}${path.slice(renameTarget.path.length)}` : path;
      setDirectoryPath(remapPath); setSelectedFile(remapPath);
      await refreshTemplateTree();
      setModal(null); setRenameTarget(null); setFormName("");
      notify(renameTarget.kind === "folder" ? "Папка переименована" : "Файл переименован");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось переименовать запись");
    } finally {
      setFileMutationPending(false);
    }
  };
  const toggleResource = (kind: "skills" | "tools", index: number) => {
    const update = <T extends { enabled: boolean }>(items: T[]) => items.map((item, i) => i === index ? { ...item, enabled: !item.enabled } : item);
    if (kind === "skills") setSkills((items) => update(items));
    if (kind === "tools") setTools((items) => update(items));
  };
  const addResource = async () => {
    if (!modal || !formName.trim()) return;
    if (modal === "rename") { await renameEntry(); return; }
    if (modal === "file" || modal === "folder") {
      const name = formName.trim().replace(/^\/+|\/+$/g, "");
      if (!name || name === "." || name === ".." || name.includes("/")) {
        notify("Укажите имя без символа /");
        return;
      }
      const path = directoryPath ? `${directoryPath}/${name}` : name;
      if (files.some((file) => file.path === path)) {
        notify("Файл или папка с таким именем уже существует");
        return;
      }
      setFileMutationPending(true);
      try {
        if (modal === "file") await templateRequest("file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
        else await templateRequest("directory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
        await refreshTemplateTree();
        setModal(null); setFormName("");
        if (modal === "file") await chooseFile({ name, path, kind: "file" }, true);
        notify(modal === "file" ? "Файл добавлен в шаблон workspace" : "Папка создана в шаблоне workspace");
      } catch (error) {
        notify(error instanceof Error ? error.message : "Не удалось изменить шаблон workspace");
      } finally {
        setFileMutationPending(false);
      }
      return;
    }
    if (modal === "skill") setSkills((items) => [...items, { name: formName.trim(), description: formDetail.trim() || "Описание навыка", enabled: true }]);
    if (modal === "tool") setTools((items) => [...items, { name: formName.trim(), description: formDetail.trim() || "Описание инструмента", enabled: true }]);
    setModal(null); setFormName(""); setFormDetail(""); notify("Элемент добавлен в макет");
  };
  const removeResource = (kind: "skills" | "tools", index: number, name: string) => {
    if (!window.confirm(`Удалить «${name}»?`)) return;
    if (kind === "skills") setSkills((items) => items.filter((_, i) => i !== index));
    if (kind === "tools") setTools((items) => items.filter((_, i) => i !== index));
  };

  if (allowed === null) return <main className={styles.centerState}>Проверяем права доступа…</main>;
  if (!allowed) return <main className={styles.centerState}><div className={styles.deniedIcon}>!</div><h1>Нет доступа</h1><p>Для просмотра панели нужны права администратора.</p></main>;

  const title = tabs.find((tab) => tab.id === activeTab)?.label || "Пользователи";
  const activeCount = activeTab === "users" ? usersLoading || usersError ? "—" : users.length : activeTab === "files" ? files.filter((file) => file.kind === "file").length : activeTab === "skills" ? skills.filter((item) => item.enabled).length : tools.filter((item) => item.enabled).length;

  return <main className={styles.admin}>
    <aside className={styles.sidebar}>
      <div className={styles.brand}><div className={styles.brandMark}>б</div><div><strong>Бухгалтер Бутик</strong><span>AI-платформа</span></div></div>
      <div className={styles.workspaceLabel}>УПРАВЛЕНИЕ</div>
      <nav className={styles.nav} aria-label="Разделы администрирования">
        {tabs.map((tab) => <button key={tab.id} className={`${styles.navItem} ${activeTab === tab.id ? styles.navActive : ""}`} onClick={() => { setActiveTab(tab.id); setSearch(""); }}><Icon name={tab.icon} /><span>{tab.label}</span>{tab.id === "users" && <span className={styles.navCount}>{users.length}</span>}</button>)}
      </nav>
      <div className={styles.sidebarBottom}><span className={styles.statusDot} /> Настройки в разработке<br/><small>Данные сотрудников — из BPM</small></div>
    </aside>
    <section className={styles.mainArea}>
      <header className={styles.topbar}><div className={styles.breadcrumb}>Администрирование <Icon name="chevron" size={14}/><strong>{title}</strong></div><div className={styles.topbarActions}><button className={styles.iconButton} aria-label={isDark ? "Включить светлую тему" : "Включить тёмную тему"} title={isDark ? "Светлая тема" : "Тёмная тема"} onClick={(event) => setThemePreference(isDark ? "light" : "dark", { x: event.clientX, y: event.clientY })}><Icon name={isDark ? "sun" : "moon"} size={17}/></button><div className={styles.topUser}><div className={styles.avatar}>{(adminUser?.fullName || "А")[0]}</div><div><strong>{adminUser?.fullName || "Администратор"}</strong><span>Команда Бухгалтер Бутик</span></div></div></div></header>
      <div className={`${styles.content} ${activeTab === "files" ? styles.filesContent : activeTab === "models" ? styles.modelsContent : ""}`}>
        {activeTab !== "files" && activeTab !== "models" && <><div className={styles.pageHeading}><div><div className={styles.eyebrow}>НАСТРОЙКИ AI-ЧАТА</div><h1>{title}</h1><p>{activeTab === "users" ? "Сотрудники из BuhgalterBPM и состояние их AI-workspace." : activeTab === "skills" ? "Настройте навыки, которые будут доступны сотрудникам по умолчанию." : "Управляйте инструментами, которыми AI-помощник может пользоваться."}</p></div>
          {activeTab !== "users" && <button className={styles.primaryButton} onClick={() => { setModal(activeTab === "skills" ? "skill" : "tool"); setFormName(""); setFormDetail(""); }}><Icon name="plus"/>Добавить {activeTab === "skills" ? "навык" : "инструмент"}</button>}
        </div>
        <div className={styles.statsRow}><div className={styles.statCard}><span>{activeTab === "users" ? "Всего сотрудников" : activeTab === "skills" ? "Активные навыки" : "Активные инструменты"}</span><strong>{activeCount}</strong></div><div className={styles.statCard}><span>Режим</span><strong className={styles.statStatus}><i/>{activeTab === "users" ? "Данные из BPM" : "Предварительный просмотр"}</strong></div><div className={styles.notice}><span className={styles.noticeIcon}>i</span><span>{activeTab === "users" ? "Пересоздание заменяет прежние файлы шаблона актуальными. Личные файлы и история чатов сохраняются." : "Это макет интерфейса. Изменения выполняются локально и не влияют на сотрудников."}</span></div></div></>}

        {activeTab === "users" && <section className={styles.panel}>
          <div className={styles.panelHeader}><div><h2>Сотрудники BPM</h2><p>Актуальные профили из BuhgalterBPM</p></div><label className={styles.search}><Icon name="search" size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск сотрудника"/></label></div>
          {usersLoading ? <div className={styles.emptyState}>Загружаем сотрудников…</div> : usersError ? <div className={styles.emptyState} role="alert">{usersError}. Обновите страницу, чтобы повторить попытку.</div> : <>
          {resetFeedback && <div className={styles.workspaceFeedback} role={resetFeedback.error ? "alert" : "status"}>{resetFeedback.text}</div>}
          {!workerAvailable && <div className={styles.emptyState} role="status">Состояние worker-ов сейчас недоступно. Список сотрудников загружен из BPM.</div>}
          <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>СОТРУДНИК</th><th>РОЛЬ</th><th>СТАТУС BPM</th><th>WORKER</th><th>ШАБЛОН</th><th className={styles.actionsHeading}>ДЕЙСТВИЯ</th></tr></thead><tbody>{filteredUsers.map((user) => <tr key={user.id}><td><div className={styles.employee}><div className={styles.avatar}>{user.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</div><div><strong>{user.name}</strong><span>{user.email}</span></div></div></td><td><Badge tone={user.role === "admin" || user.role === "tech" ? "blue" : "neutral"}>{roles[user.role] || user.role}</Badge></td><td><Badge tone={user.status === "active" ? "green" : "amber"}>{statusLabels[user.status] || user.status}</Badge></td><td><Badge tone={user.worker === "running" ? "green" : user.worker === "stopped" ? "amber" : "neutral"}><i className={styles.badgeDot}/>{workerLabels[user.worker]}</Badge></td><td>{user.workspaceTemplate ? <div className={styles.templateMeta}><code title={user.workspaceTemplate.revision}>{user.workspaceTemplate.revision.slice(0, 8)}</code><small>{templateRevision ? user.workspaceTemplate.revision === templateRevision ? "Актуальный" : "Есть изменения" : "Выданный шаблон"} · файлов: {user.workspaceTemplate.trackedFiles}</small></div> : <span className={styles.templateMeta}>{user.worker === "not-created" ? "Ещё не выдан" : "Нет истории"}</span>}</td><td className={styles.actionsCell}><button className={styles.secondaryButton} disabled={!workerAvailable || user.worker === "not-created" || user.worker === "unknown" || resettingUserId !== null} title={user.worker === "not-created" ? "Сотруднику нужно сначала войти в AI-чат" : "Заменить прежние файлы шаблона, сохранив личные файлы и чаты"} onClick={() => { void resetWorkspace(user); }} aria-busy={resettingUserId === user.id}><Icon name="refresh" size={15}/>{resettingUserId === user.id ? "Пересоздаём…" : "Пересоздать workspace"}</button></td></tr>)}</tbody></table>{filteredUsers.length === 0 && <div className={styles.emptyState}>Сотрудники не найдены</div>}</div>
          <footer className={styles.panelFooter}>Показано {filteredUsers.length} из {users.length} записей <span>Источник: BuhgalterBPM · шаблоны workspace отслеживаются</span></footer></>}
        </section>}

        {activeTab === "files" && <section className={`${styles.panel} ${styles.filesPanel}`}>
          <div className={`${styles.panelHeader} ${styles.fileToolbar}`}><div className={styles.fileActions}><button className={styles.primaryButton} onClick={addFile} disabled={filesLoading || fileMutationPending}><Icon name="plus"/>Добавить файл</button><button className={styles.secondaryButton} onClick={addFolder} disabled={filesLoading || fileMutationPending}><Icon name="plus" size={15}/>Новая папка</button></div></div>
          <div className={styles.fileWorkspace}><div className={styles.fileList}><div className={styles.fileListHeader}><span>ШАБЛОН WORKSPACE</span></div><div className={styles.fileBreadcrumbs}><button onClick={() => openDirectory("")}>Workspace</button>{directoryBreadcrumbs.map((crumb) => <Fragment key={crumb.path}><Icon name="chevron" size={12}/><button onClick={() => openDirectory(crumb.path)}>{crumb.name}</button></Fragment>)}</div>{filesLoading ? <div className={styles.emptyDirectory}>Загружаем файлы…</div> : filesError ? <div className={styles.emptyDirectory} role="alert">{filesError}</div> : <>{directoryEntries.map((file) => <button key={file.path} className={`${styles.fileRow} ${selectedFile === file.path ? styles.fileSelected : ""}`} onClick={() => { if (file.kind === "folder") openDirectory(file.path); else void chooseFile(file); }} onContextMenu={(event) => showFileContextMenu(event, file)} aria-haspopup="menu"><Icon name={file.kind === "folder" ? "folder" : "file"} size={16}/><span>{file.name}</span>{file.kind === "folder" && <span className={styles.fileCount}>›</span>}</button>)}{directoryEntries.length === 0 && <div className={styles.emptyDirectory}>В этой папке пока нет файлов</div>}</>}<div className={styles.fileHint}>{templateRevision && <>Версия: <code>{templateRevision.slice(0, 8)}</code>. </>}Изменения применяются при первом входе или по кнопке «Пересоздать workspace» в разделе «Пользователи». Прежние файлы шаблона заменяются, личные файлы сохраняются.</div></div>
            <div className={styles.preview}><div className={styles.previewTop}><div className={styles.previewPath}><Icon name="file" size={15}/><span>{selectedFile || "Выберите файл"}</span></div><div className={styles.previewActions}>{editingFile ? <><button className={styles.secondaryButton} onClick={() => { void chooseFile(currentFile!); }} disabled={fileSaving}>Отмена</button><button className={styles.primaryButtonSmall} onClick={() => { void saveFile(); }} disabled={fileSaving || fileLoading}><Icon name="check" size={14}/>{fileSaving ? "Сохраняем…" : "Сохранить"}</button></> : <><button className={styles.iconButton} title="Удалить файл" onClick={() => { void deleteFile(); }} disabled={!currentFile || fileLoading || fileMutationPending}><Icon name="trash" size={16}/></button><button className={styles.secondaryButton} onClick={() => setEditingFile(true)} disabled={!currentFile || fileLoading || fileMutationPending}><Icon name="edit" size={15}/>Изменить</button></>}</div></div>
              <div className={styles.previewBody}>{fileLoading ? <div className={styles.emptyPreview}><span>Загружаем файл…</span></div> : editingFile ? <textarea className={styles.editor} value={fileDraft} onChange={(event) => setFileDraft(event.target.value)} spellCheck={false} aria-label="Содержимое файла"/> : currentFile ? fileDraft ? <MarkdownBody className={styles.fileMarkdown}>{fileDraft}</MarkdownBody> : <div className={styles.emptyPreview}><Icon name="file" size={25}/><span>Файл пустой. Нажмите «Изменить», чтобы добавить содержимое.</span></div> : <div className={styles.emptyPreview}><Icon name="files" size={28}/><span>Выберите файл для предпросмотра</span></div>}</div>
              <div className={styles.previewFooter}><span>{editingFile ? "Режим редактирования" : "Предпросмотр файла"}</span><span>{fileDraft.length} символов</span></div></div></div>
        </section>}

        {activeTab === "models" && <CorporateModels />}

        {activeTab === "skills" && <section className={styles.panel}><div className={styles.panelHeader}><div><h2>Навыки по умолчанию</h2><p>Навыки задают специализированные инструкции для AI-помощника</p></div><span className={styles.countLabel}>{skills.filter((item) => item.enabled).length} включено</span></div><div className={styles.list}>{skills.map((skill, index) => <div className={styles.listItem} key={`${skill.name}-${index}`}><div className={`${styles.resourceIcon} ${styles.skillIcon}`}><Icon name="skills"/></div><div className={styles.listCopy}><strong>{skill.name}</strong><span>{skill.description}</span></div><Badge tone={skill.enabled ? "green" : "neutral"}>{skill.enabled ? "Включён" : "Выключен"}</Badge><button className={`${styles.switch} ${skill.enabled ? styles.switchOn : ""}`} aria-label={`${skill.enabled ? "Отключить" : "Включить"} навык ${skill.name}`} aria-checked={skill.enabled} role="switch" onClick={() => toggleResource("skills", index)}><i/></button><button className={styles.iconButton} aria-label={`Удалить ${skill.name}`} onClick={() => removeResource("skills", index, skill.name)}><Icon name="trash" size={16}/></button></div>)}</div><div className={styles.panelEnd}><button className={styles.secondaryButton} onClick={() => setModal("skill")}><Icon name="plus" size={15}/>Добавить навык</button></div></section>}

        {activeTab === "tools" && <section className={styles.panel}><div className={styles.panelHeader}><div><h2>Инструменты по умолчанию</h2><p>Инструменты определяют, какие действия может выполнять помощник</p></div><span className={styles.countLabel}>{tools.filter((item) => item.enabled).length} включено</span></div><div className={styles.list}>{tools.map((tool, index) => <div className={styles.listItem} key={`${tool.name}-${index}`}><div className={`${styles.resourceIcon} ${styles.toolIcon}`}><Icon name="tools"/></div><div className={styles.listCopy}><strong>{tool.name}</strong><span>{tool.description}</span></div><Badge tone={tool.enabled ? "green" : "neutral"}>{tool.enabled ? "Включён" : "Выключен"}</Badge><button className={`${styles.switch} ${tool.enabled ? styles.switchOn : ""}`} aria-label={`${tool.enabled ? "Отключить" : "Включить"} инструмент ${tool.name}`} aria-checked={tool.enabled} role="switch" onClick={() => toggleResource("tools", index)}><i/></button><button className={styles.iconButton} aria-label={`Удалить ${tool.name}`} onClick={() => removeResource("tools", index, tool.name)}><Icon name="trash" size={16}/></button></div>)}</div><div className={styles.panelEnd}><button className={styles.secondaryButton} onClick={() => setModal("tool")}><Icon name="plus" size={15}/>Добавить инструмент</button></div></section>}
      </div>
    </section>
    {fileContextMenu && <div className={styles.fileContextMenu} data-file-context-menu role="menu" aria-label={`Действия: ${fileContextMenu.entry.name}`} style={{ left: fileContextMenu.x, top: fileContextMenu.y }} onContextMenu={(event) => event.preventDefault()}><button role="menuitem" onClick={() => openRename(fileContextMenu.entry)}>Переименовать</button><button role="menuitem" className={styles.contextDanger} onClick={() => { const entry = fileContextMenu.entry; setFileContextMenu(null); void deleteEntry(entry); }}>Удалить</button></div>}
    {toast && <div className={styles.toast} role="status">{toast}</div>}
    {modal && <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) { setModal(null); setRenameTarget(null); } }}><form className={styles.modal} onSubmit={(event) => { event.preventDefault(); void addResource(); }}><div className={styles.modalHeader}><div><span className={styles.eyebrow}>НАСТРОЙКИ AI-ЧАТА</span><h2>{modal === "rename" ? `Переименовать ${renameTarget?.kind === "folder" ? "папку" : "файл"}` : `Добавить ${modal === "skill" ? "навык" : modal === "file" ? "файл" : modal === "folder" ? "папку" : "инструмент"}`}</h2></div><button type="button" className={styles.iconButton} aria-label="Закрыть" onClick={() => { setModal(null); setRenameTarget(null); }}><Icon name="close"/></button></div><label className={styles.fieldLabel}>{modal === "rename" ? "Новое имя" : modal === "skill" ? "Название навыка" : modal === "file" ? "Название файла" : modal === "folder" ? "Название папки" : "Название инструмента"}<input autoFocus value={formName} onChange={(event) => setFormName(event.target.value)} placeholder={modal === "rename" ? renameTarget?.name : modal === "file" ? "Например, Инструкция.md" : modal === "folder" ? "Например, Отчёты" : "Введите название"}/></label>{modal !== "file" && modal !== "folder" && modal !== "rename" && <label className={styles.fieldLabel}>Описание<input value={formDetail} onChange={(event) => setFormDetail(event.target.value)} placeholder={"Краткое описание"}/></label>}<div className={styles.modalActions}><button type="button" className={styles.secondaryButton} onClick={() => { setModal(null); setRenameTarget(null); }} disabled={fileMutationPending}>Отмена</button><button className={styles.primaryButton} disabled={!formName.trim() || ((modal === "file" || modal === "folder" || modal === "rename") && fileMutationPending)}><Icon name={modal === "rename" ? "edit" : "plus"}/>{fileMutationPending && (modal === "file" || modal === "folder" || modal === "rename") ? "Сохраняем…" : modal === "rename" ? "Переименовать" : "Добавить"}</button></div></form></div>}
  </main>;
}
