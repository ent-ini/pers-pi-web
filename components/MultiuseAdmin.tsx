"use client";

import { useEffect, useMemo, useState } from "react";
import { MarkdownBody } from "./MarkdownBody";
import styles from "./MultiuseAdmin.module.css";

type Tab = "users" | "files" | "models" | "skills" | "tools";
type Employee = { id: string; name: string; email: string; role: string; worker: "Работает" | "Остановлен" | "Не создан" };
type DefaultFile = { name: string; path: string; kind: "file" | "folder"; content?: string };
type Model = { name: string; provider: string; id: string; description: string; enabled: boolean };
type Resource = { name: string; description: string; enabled: boolean };

const initialUsers: Employee[] = [
  { id: "1", name: "Анна Смирнова", email: "a.smirnova@buhgalterboutique.ru", role: "Бухгалтер", worker: "Работает" },
  { id: "2", name: "Елена Кузнецова", email: "e.kuznetsova@buhgalterboutique.ru", role: "Бухгалтер", worker: "Работает" },
  { id: "3", name: "Мария Волкова", email: "m.volkova@buhgalterboutique.ru", role: "Старший бухгалтер", worker: "Остановлен" },
  { id: "4", name: "Ольга Петрова", email: "o.petrova@buhgalterboutique.ru", role: "Администратор", worker: "Не создан" },
];
const initialFiles: DefaultFile[] = [
  { name: "Инструкции", path: "Инструкции", kind: "folder" },
  { name: "Как работать с помощником.md", path: "Инструкции/Как работать с помощником.md", kind: "file", content: "# Как работать с ИИ-помощником\n\nОпишите задачу простыми словами и приложите необходимые документы.\n\n## Важно\n\n- Не отправляйте пароли и коды подтверждения.\n- Проверяйте ответы, особенно суммы и реквизиты.\n- Если ответ неполный — уточните вопрос." },
  { name: "Стиль ответов.md", path: "Стиль ответов.md", kind: "file", content: "# Стиль ответов\n\nОтвечай на русском языке, кратко и по делу.\n\nДля расчётов показывай формулу и исходные данные. Если информации недостаточно, сначала задай уточняющий вопрос." },
  { name: "Памятка по документам.txt", path: "Памятка по документам.txt", kind: "file", content: "Перед отправкой документов проверьте, что в них нет паролей, кодов подтверждения и лишних персональных данных." },
];
const initialModels: Model[] = [
  { name: "Claude Sonnet", provider: "Anthropic", id: "claude-sonnet", description: "Для анализа документов и повседневных задач", enabled: true },
  { name: "GPT-4.1", provider: "OpenAI", id: "gpt-4.1", description: "Универсальная модель для работы с текстом", enabled: true },
  { name: "Gemini Flash", provider: "Google", id: "gemini-flash", description: "Быстрые ответы и обработка больших документов", enabled: false },
];
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
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "green" | "amber" | "blue" }) {
  return <span className={`${styles.badge} ${styles[`badge_${tone}`]}`}>{children}</span>;
}

export function MultiuseAdmin() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("users");
  const [users] = useState(initialUsers);
  const [files, setFiles] = useState(initialFiles);
  const [selectedFile, setSelectedFile] = useState(initialFiles[1].path);
  const [fileDraft, setFileDraft] = useState(initialFiles[1].content || "");
  const [editingFile, setEditingFile] = useState(false);
  const [models, setModels] = useState(initialModels);
  const [skills, setSkills] = useState(initialSkills);
  const [tools, setTools] = useState(initialTools);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<"model" | "skill" | "tool" | "file" | null>(null);
  const [formName, setFormName] = useState("");
  const [formDetail, setFormDetail] = useState("");
  const [formId, setFormId] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    let mounted = true;
    void fetch("/api/multi/auth/session").then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (mounted) setAllowed(body.user?.role === "admin" || body.user?.role === "tech");
    }).catch(() => { if (mounted) setAllowed(false); });
    return () => { mounted = false; };
  }, []);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };
  const currentFile = files.find((file) => file.path === selectedFile);
  const filteredUsers = useMemo(() => users.filter((user) => `${user.name} ${user.email} ${user.role}`.toLowerCase().includes(search.toLowerCase())), [users, search]);

  const chooseFile = (file: DefaultFile) => {
    if (file.kind !== "file") return;
    setSelectedFile(file.path);
    setFileDraft(file.content || "");
    setEditingFile(false);
  };
  const addFile = () => {
    setFormName("");
    setModal("file");
  };
  const saveFile = () => {
    if (!currentFile) return;
    setFiles((current) => current.map((file) => file.path === currentFile.path ? { ...file, content: fileDraft } : file));
    setEditingFile(false);
    notify("Изменения файла сохранены в макете");
  };
  const deleteFile = () => {
    if (!currentFile || !window.confirm(`Удалить файл «${currentFile.name}» из списка по умолчанию?`)) return;
    const remaining = files.filter((file) => file.path !== currentFile.path);
    setFiles(remaining);
    const next = remaining.find((file) => file.kind === "file");
    setSelectedFile(next?.path || ""); setFileDraft(next?.content || ""); setEditingFile(false);
  };
  const resetWorkspace = (user: Employee) => {
    if (!window.confirm(`Пересоздать workspace для ${user.name}? Все пользовательские файлы будут удалены.`)) return;
    notify(`Запрос на пересоздание workspace: ${user.name} (демо)`);
  };
  const toggleResource = (kind: "models" | "skills" | "tools", index: number) => {
    const update = <T extends { enabled: boolean }>(items: T[]) => items.map((item, i) => i === index ? { ...item, enabled: !item.enabled } : item);
    if (kind === "models") setModels((items) => update(items));
    if (kind === "skills") setSkills((items) => update(items));
    if (kind === "tools") setTools((items) => update(items));
  };
  const addResource = () => {
    if (!modal || !formName.trim()) return;
    if (modal === "file") {
      const file = { name: formName.trim(), path: formName.trim(), kind: "file" as const, content: "" };
      setFiles((items) => [...items, file]); setSelectedFile(file.path); setFileDraft(""); setEditingFile(true);
    }
    if (modal === "model") setModels((items) => [...items, { name: formName.trim(), provider: formDetail.trim() || "Новый провайдер", id: formId.trim() || "model-id", description: "Добавлена в макете", enabled: true }]);
    if (modal === "skill") setSkills((items) => [...items, { name: formName.trim(), description: formDetail.trim() || "Описание навыка", enabled: true }]);
    if (modal === "tool") setTools((items) => [...items, { name: formName.trim(), description: formDetail.trim() || "Описание инструмента", enabled: true }]);
    setModal(null); setFormName(""); setFormDetail(""); setFormId(""); notify(modal === "file" ? "Файл добавлен в макет" : "Элемент добавлен в макет");
  };
  const removeResource = (kind: "models" | "skills" | "tools", index: number, name: string) => {
    if (!window.confirm(`Удалить «${name}»?`)) return;
    if (kind === "models") setModels((items) => items.filter((_, i) => i !== index));
    if (kind === "skills") setSkills((items) => items.filter((_, i) => i !== index));
    if (kind === "tools") setTools((items) => items.filter((_, i) => i !== index));
  };

  if (allowed === null) return <main className={styles.centerState}>Проверяем права доступа…</main>;
  if (!allowed) return <main className={styles.centerState}><div className={styles.deniedIcon}>!</div><h1>Нет доступа</h1><p>Для просмотра панели нужны права администратора.</p></main>;

  const title = tabs.find((tab) => tab.id === activeTab)?.label || "Пользователи";
  const activeCount = activeTab === "users" ? users.length : activeTab === "files" ? files.filter((file) => file.kind === "file").length : activeTab === "models" ? models.filter((item) => item.enabled).length : activeTab === "skills" ? skills.filter((item) => item.enabled).length : tools.filter((item) => item.enabled).length;

  return <main className={styles.admin}>
    <aside className={styles.sidebar}>
      <div className={styles.brand}><div className={styles.brandMark}>б</div><div><strong>Бухгалтер Бутик</strong><span>AI-платформа</span></div></div>
      <div className={styles.workspaceLabel}>УПРАВЛЕНИЕ</div>
      <nav className={styles.nav} aria-label="Разделы администрирования">
        {tabs.map((tab) => <button key={tab.id} className={`${styles.navItem} ${activeTab === tab.id ? styles.navActive : ""}`} onClick={() => { setActiveTab(tab.id); setSearch(""); }}><Icon name={tab.icon} /><span>{tab.label}</span>{tab.id === "users" && <span className={styles.navCount}>{users.length}</span>}</button>)}
      </nav>
      <div className={styles.sidebarBottom}><span className={styles.statusDot} /> Предварительный интерфейс<br/><small>Изменения пока не сохраняются</small></div>
    </aside>
    <section className={styles.mainArea}>
      <header className={styles.topbar}><div className={styles.breadcrumb}>Администрирование <Icon name="chevron" size={14}/><strong>{title}</strong></div><div className={styles.topUser}><div className={styles.avatar}>А</div><div><strong>Администратор</strong><span>Команда Бухгалтер Бутик</span></div><button className={styles.iconButton} aria-label="Меню пользователя"><Icon name="more"/></button></div></header>
      <div className={styles.content}>
        <div className={styles.pageHeading}><div><div className={styles.eyebrow}>НАСТРОЙКИ AI-ЧАТА</div><h1>{title}</h1><p>{activeTab === "users" ? "Управляйте доступом сотрудников и их рабочими пространствами." : activeTab === "files" ? "Подготовьте файлы и инструкции, которые появятся в workspace сотрудников." : activeTab === "models" ? "Выберите модели, доступные сотрудникам в чате." : activeTab === "skills" ? "Настройте навыки, которые будут доступны сотрудникам по умолчанию." : "Управляйте инструментами, которыми AI-помощник может пользоваться."}</p></div>
          {activeTab !== "users" && activeTab !== "files" && <button className={styles.primaryButton} onClick={() => { setModal(activeTab === "models" ? "model" : activeTab === "skills" ? "skill" : "tool"); setFormName(""); setFormDetail(""); setFormId(""); }}><Icon name="plus"/>Добавить {activeTab === "models" ? "модель" : activeTab === "skills" ? "навык" : "инструмент"}</button>}
          {activeTab === "files" && <button className={styles.primaryButton} onClick={addFile}><Icon name="plus"/>Добавить файл</button>}
        </div>
        <div className={styles.statsRow}><div className={styles.statCard}><span>{activeTab === "users" ? "Всего сотрудников" : activeTab === "files" ? "Файлы в шаблоне" : activeTab === "models" ? "Активные модели" : activeTab === "skills" ? "Активные навыки" : "Активные инструменты"}</span><strong>{activeCount}</strong></div><div className={styles.statCard}><span>Режим</span><strong className={styles.statStatus}><i/>Предварительный просмотр</strong></div><div className={styles.notice}><span className={styles.noticeIcon}>i</span><span>Это макет интерфейса. Изменения выполняются локально и не влияют на сотрудников.</span></div></div>

        {activeTab === "users" && <section className={styles.panel}>
          <div className={styles.panelHeader}><div><h2>Сотрудники</h2><p>Список пользователей корпоративного AI-чата</p></div><label className={styles.search}><Icon name="search" size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск сотрудника"/><kbd>⌘ K</kbd></label></div>
          <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>СОТРУДНИК</th><th>РОЛЬ</th><th>WORKER</th><th className={styles.actionsHeading}>ДЕЙСТВИЯ</th></tr></thead><tbody>{filteredUsers.map((user) => <tr key={user.id}><td><div className={styles.employee}><div className={styles.avatar}>{user.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</div><div><strong>{user.name}</strong><span>{user.email}</span></div></div></td><td><Badge tone={user.role === "Администратор" ? "blue" : "neutral"}>{user.role}</Badge></td><td><Badge tone={user.worker === "Работает" ? "green" : user.worker === "Остановлен" ? "amber" : "neutral"}><i className={styles.badgeDot}/>{user.worker}</Badge></td><td className={styles.actionsCell}><button className={styles.secondaryButton} onClick={() => resetWorkspace(user)}><Icon name="refresh" size={15}/>Пересоздать workspace</button></td></tr>)}</tbody></table>{filteredUsers.length === 0 && <div className={styles.emptyState}>Сотрудники не найдены</div>}</div>
          <footer className={styles.panelFooter}>Показано {filteredUsers.length} из {users.length} записей <span>Демонстрационные данные · подключение BuhgalterBPM будет позже</span></footer>
        </section>}

        {activeTab === "files" && <section className={`${styles.panel} ${styles.filesPanel}`}>
          <div className={styles.panelHeader}><div><h2>Файлы по умолчанию</h2><p>Эти файлы копируются в workspace при его создании</p></div><button className={styles.secondaryButton} onClick={() => notify("Создание папок будет подключено вместе с backend")}><Icon name="plus" size={15}/>Новая папка</button></div>
          <div className={styles.fileWorkspace}><div className={styles.fileList}><div className={styles.fileListHeader}><span>ШАБЛОН WORKSPACE</span><button className={styles.iconButton} onClick={() => notify("Меню файлов будет подключено с backend")} aria-label="Действия"><Icon name="more"/></button></div>{files.map((file) => <button key={file.path} className={`${styles.fileRow} ${selectedFile === file.path ? styles.fileSelected : ""}`} onClick={() => chooseFile(file)}><Icon name={file.kind === "folder" ? "folder" : "file"} size={16}/><span>{file.name}</span>{file.kind === "folder" && <span className={styles.fileCount}>›</span>}</button>)}<div className={styles.fileHint}>Файлы-шаблоны доступны всем сотрудникам. При изменении шаблона уже созданные workspace автоматически не меняются.</div></div>
            <div className={styles.preview}><div className={styles.previewTop}><div className={styles.previewPath}><Icon name="file" size={15}/><span>{selectedFile || "Выберите файл"}</span></div><div className={styles.previewActions}>{editingFile ? <><button className={styles.secondaryButton} onClick={() => { setFileDraft(currentFile?.content || ""); setEditingFile(false); }}>Отмена</button><button className={styles.primaryButtonSmall} onClick={saveFile}><Icon name="check" size={14}/>Сохранить</button></> : <><button className={styles.iconButton} title="Удалить файл" onClick={deleteFile} disabled={!currentFile}><Icon name="trash" size={16}/></button><button className={styles.secondaryButton} onClick={() => setEditingFile(true)} disabled={!currentFile}><Icon name="edit" size={15}/>Изменить</button></>}</div></div>
              <div className={styles.previewBody}>{editingFile ? <textarea className={styles.editor} value={fileDraft} onChange={(event) => setFileDraft(event.target.value)} spellCheck={false} aria-label="Содержимое файла"/> : currentFile ? fileDraft ? <MarkdownBody className={styles.fileMarkdown}>{fileDraft}</MarkdownBody> : <div className={styles.emptyPreview}><Icon name="file" size={25}/><span>Файл пустой. Нажмите «Изменить», чтобы добавить содержимое.</span></div> : <div className={styles.emptyPreview}><Icon name="files" size={28}/><span>Выберите файл для предпросмотра</span></div>}</div>
              <div className={styles.previewFooter}><span>{editingFile ? "Режим редактирования" : "Предпросмотр файла"}</span><span>{fileDraft.length} символов</span></div></div></div>
        </section>}

        {activeTab === "models" && <section className={styles.resourceGrid}>{models.map((model, index) => <article className={styles.resourceCard} key={`${model.id}-${index}`}><div className={styles.resourceTop}><div className={`${styles.resourceIcon} ${styles.modelIcon}`}><Icon name="models" size={19}/></div><button className={styles.iconButton} aria-label={`Удалить ${model.name}`} onClick={() => removeResource("models", index, model.name)}><Icon name="trash" size={16}/></button></div><div className={styles.modelProvider}>{model.provider}</div><h2>{model.name}</h2><p>{model.description}</p><div className={styles.resourceMeta}><code>{model.id}</code><label className={styles.switchLabel}><span>{model.enabled ? "Доступна" : "Выключена"}</span><button className={`${styles.switch} ${model.enabled ? styles.switchOn : ""}`} aria-label={`${model.enabled ? "Отключить" : "Включить"} модель ${model.name}`} aria-checked={model.enabled} role="switch" onClick={() => toggleResource("models", index)}><i/></button></label></div></article>)}<button className={styles.addCard} onClick={() => { setModal("model"); setFormName(""); setFormDetail(""); setFormId(""); }}><span><Icon name="plus" size={20}/></span><strong>Добавить модель</strong><small>Настроить модель для сотрудников</small></button></section>}

        {activeTab === "skills" && <section className={styles.panel}><div className={styles.panelHeader}><div><h2>Навыки по умолчанию</h2><p>Навыки задают специализированные инструкции для AI-помощника</p></div><span className={styles.countLabel}>{skills.filter((item) => item.enabled).length} включено</span></div><div className={styles.list}>{skills.map((skill, index) => <div className={styles.listItem} key={`${skill.name}-${index}`}><div className={`${styles.resourceIcon} ${styles.skillIcon}`}><Icon name="skills"/></div><div className={styles.listCopy}><strong>{skill.name}</strong><span>{skill.description}</span></div><Badge tone={skill.enabled ? "green" : "neutral"}>{skill.enabled ? "Включён" : "Выключен"}</Badge><button className={`${styles.switch} ${skill.enabled ? styles.switchOn : ""}`} aria-label={`${skill.enabled ? "Отключить" : "Включить"} навык ${skill.name}`} aria-checked={skill.enabled} role="switch" onClick={() => toggleResource("skills", index)}><i/></button><button className={styles.iconButton} aria-label={`Удалить ${skill.name}`} onClick={() => removeResource("skills", index, skill.name)}><Icon name="trash" size={16}/></button></div>)}</div><div className={styles.panelEnd}><button className={styles.secondaryButton} onClick={() => setModal("skill")}><Icon name="plus" size={15}/>Добавить навык</button></div></section>}

        {activeTab === "tools" && <section className={styles.panel}><div className={styles.panelHeader}><div><h2>Инструменты по умолчанию</h2><p>Инструменты определяют, какие действия может выполнять помощник</p></div><span className={styles.countLabel}>{tools.filter((item) => item.enabled).length} включено</span></div><div className={styles.list}>{tools.map((tool, index) => <div className={styles.listItem} key={`${tool.name}-${index}`}><div className={`${styles.resourceIcon} ${styles.toolIcon}`}><Icon name="tools"/></div><div className={styles.listCopy}><strong>{tool.name}</strong><span>{tool.description}</span></div><Badge tone={tool.enabled ? "green" : "neutral"}>{tool.enabled ? "Включён" : "Выключен"}</Badge><button className={`${styles.switch} ${tool.enabled ? styles.switchOn : ""}`} aria-label={`${tool.enabled ? "Отключить" : "Включить"} инструмент ${tool.name}`} aria-checked={tool.enabled} role="switch" onClick={() => toggleResource("tools", index)}><i/></button><button className={styles.iconButton} aria-label={`Удалить ${tool.name}`} onClick={() => removeResource("tools", index, tool.name)}><Icon name="trash" size={16}/></button></div>)}</div><div className={styles.panelEnd}><button className={styles.secondaryButton} onClick={() => setModal("tool")}><Icon name="plus" size={15}/>Добавить инструмент</button></div></section>}
      </div>
    </section>
    {toast && <div className={styles.toast} role="status">{toast}</div>}
    {modal && <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}><form className={styles.modal} onSubmit={(event) => { event.preventDefault(); addResource(); }}><div className={styles.modalHeader}><div><span className={styles.eyebrow}>НАСТРОЙКИ AI-ЧАТА</span><h2>Добавить {modal === "model" ? "модель" : modal === "skill" ? "навык" : modal === "file" ? "файл" : "инструмент"}</h2></div><button type="button" className={styles.iconButton} aria-label="Закрыть" onClick={() => setModal(null)}><Icon name="close"/></button></div><label className={styles.fieldLabel}>{modal === "model" ? "Название модели" : modal === "skill" ? "Название навыка" : modal === "file" ? "Название файла" : "Название инструмента"}<input autoFocus value={formName} onChange={(event) => setFormName(event.target.value)} placeholder={modal === "model" ? "Например, Claude Sonnet" : modal === "file" ? "Например, Инструкция.md" : "Введите название"}/></label>{modal !== "file" && <label className={styles.fieldLabel}>{modal === "model" ? "Провайдер" : "Описание"}<input value={formDetail} onChange={(event) => setFormDetail(event.target.value)} placeholder={modal === "model" ? "Например, Anthropic" : "Краткое описание"}/></label>}{modal === "model" && <label className={styles.fieldLabel}>ID модели<input value={formId} onChange={(event) => setFormId(event.target.value)} placeholder="Например, claude-sonnet"/><span className={styles.fieldHint}>Подключение модели к провайдеру будет добавлено на следующем этапе.</span></label>}<div className={styles.modalActions}><button type="button" className={styles.secondaryButton} onClick={() => setModal(null)}>Отмена</button><button className={styles.primaryButton} disabled={!formName.trim()}><Icon name="plus"/>Добавить</button></div></form></div>}
  </main>;
}
