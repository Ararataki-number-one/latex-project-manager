import { useEffect, useMemo, useState } from "react";
import {
  BookCopy,
  BookOpenText,
  ChevronRight,
  FileText,
  FolderInput,
  Layers3,
  Plus,
  Presentation,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import type { WorkbenchApi } from "@/shared/ipc";
import type { ProjectSummary, TemplateCreateOptions, TemplateInfo } from "@/shared/types";

type CategoryFilter = "all" | TemplateInfo["category"];

const CATEGORY_LABELS: Record<TemplateInfo["category"], string> = {
  article: "文章",
  book: "书籍",
  presentation: "演示",
  other: "其他"
};

const CATEGORY_ICONS = {
  article: FileText,
  book: BookOpenText,
  presentation: Presentation,
  other: Layers3
};

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function CloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="icon-button" aria-label={label} title={label} onClick={onClick}><X size={17} /></button>;
}

export function TemplateLibraryView({
  api,
  projects,
  isDemo,
  onNotify,
  onProjectsChange,
  onOpenProject
}: {
  api: WorkbenchApi;
  projects: ProjectSummary[];
  isDemo: boolean;
  onNotify: (message: string) => void;
  onProjectsChange: React.Dispatch<React.SetStateAction<ProjectSummary[]>>;
  onOpenProject: (project: ProjectSummary) => void;
}) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [sourceProjectId, setSourceProjectId] = useState("");
  const [saveDraft, setSaveDraft] = useState<TemplateCreateOptions>({ name: "", description: "", category: "other" });
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TemplateInfo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dialogReturnFocus, setDialogReturnFocus] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!createOpen && !saveOpen && !deleteTarget) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || creating || saving || deleting) return;
      event.preventDefault();
      closeDialogs();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [createOpen, creating, deleteTarget, deleting, saveOpen, saving]);

  async function refresh(preferredId?: string) {
    setLoading(true);
    try {
      const next = await api.templates.list();
      setTemplates(next);
      setSelectedId((current) => {
        const wanted = preferredId ?? current;
        return wanted && next.some((item) => item.id === wanted) ? wanted : (next[0]?.id ?? null);
      });
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法读取模板库");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [api]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return templates.filter((template) => {
      if (category !== "all" && template.category !== category) return false;
      if (!normalized) return true;
      return `${template.name} ${template.description} ${template.className ?? ""} ${CATEGORY_LABELS[template.category]}`
        .toLocaleLowerCase().includes(normalized);
    });
  }, [category, query, templates]);
  const builtIns = filtered.filter((item) => item.source === "builtin");
  const userTemplates = filtered.filter((item) => item.source === "user");
  const selected = filtered.find((item) => item.id === selectedId)
    ?? templates.find((item) => item.id === selectedId)
    ?? filtered[0]
    ?? null;

  function openCreate(template: TemplateInfo) {
    setDialogReturnFocus(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setSelectedId(template.id);
    setProjectName(template.name);
    setCreateOpen(true);
  }

  function openSave() {
    const first = projects.find((project) => project.pathAvailable && !project.trashed);
    if (!first) {
      onNotify("请先把一个现有 LaTeX 项目加入项目库");
      return;
    }
    setDialogReturnFocus(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setSourceProjectId(first.id);
    setSaveDraft({ name: first.name, description: `由项目“${first.name}”保存的个人模板。`, category: "other" });
    setSaveOpen(true);
  }

  function closeDialogs() {
    setCreateOpen(false);
    setSaveOpen(false);
    setDeleteTarget(null);
    window.setTimeout(() => dialogReturnFocus?.focus(), 0);
  }

  async function createProject() {
    if (!selected || !projectName.trim() || creating) return;
    if (isDemo) {
      onNotify("浏览器演示模式不会创建项目目录");
      return;
    }
    const parentRoot = await api.dialogs.openDirectory();
    if (!parentRoot) return;
    setCreating(true);
    let projectRoot: string | null = null;
    try {
      projectRoot = await api.templates.instantiate(selected.id, parentRoot, projectName.trim());
      const candidates = await api.library.scan(projectRoot, { maxDepth: 0 });
      const normalizedRoot = projectRoot.toLocaleLowerCase();
      const candidate = candidates.find((item) => item.rootPath.toLocaleLowerCase() === normalizedRoot) ?? candidates[0];
      if (!candidate) throw new Error("模板已复制，但没有检测到 LaTeX 主文件。");
      const imported = await api.library.import(candidate);
      onProjectsChange((current) => [...current.filter((item) => item.id !== imported.id), imported]);
      setCreateOpen(false);
      onNotify(`已从“${selected.name}”创建项目“${imported.name}”`);
      onOpenProject(imported);
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建项目失败";
      onNotify(projectRoot ? `项目已创建在 ${projectRoot}，但自动加入项目库失败：${message}` : message);
    } finally {
      setCreating(false);
    }
  }

  async function saveProjectAsTemplate() {
    if (!sourceProjectId || !saveDraft.name.trim() || saving) return;
    if (isDemo) {
      onNotify("浏览器演示模式不会写入模板库");
      return;
    }
    setSaving(true);
    try {
      const template = await api.templates.createFromProject(sourceProjectId, {
        ...saveDraft,
        name: saveDraft.name.trim(),
        description: saveDraft.description?.trim()
      });
      await refresh(template.id);
      setSaveOpen(false);
      onNotify(`已保存个人模板“${template.name}”，原项目没有被修改`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "保存模板失败");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await api.templates.delete(deleteTarget.id);
      setDeleteTarget(null);
      await refresh();
      onNotify(`已删除个人模板“${deleteTarget.name}”`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "删除模板失败");
    } finally {
      setDeleting(false);
    }
  }

  function renderGroup(title: string, subtitle: string, items: TemplateInfo[]) {
    if (!items.length) return null;
    return <section className="template-library-group" aria-label={title}>
      <header><div><h2>{title}</h2><p>{subtitle}</p></div><span>{items.length}</span></header>
      <div role="listbox" aria-label={`${title}列表`}>
        {items.map((template) => {
          const Icon = CATEGORY_ICONS[template.category];
          const active = selected?.id === template.id;
          return <button key={template.id} type="button" role="option" aria-selected={active} className={`template-library-row ${active ? "selected" : ""}`} onClick={() => setSelectedId(template.id)} onDoubleClick={() => openCreate(template)}>
            <span className="template-library-row-icon"><Icon size={20} /></span>
            <span className="template-library-row-copy"><strong>{template.name}</strong><small>{CATEGORY_LABELS[template.category]} · {template.className ?? "通用文档类"}</small></span>
            <ChevronRight size={16} />
          </button>;
        })}
      </div>
    </section>;
  }

  return <section className="template-library-page" data-testid="template-library" aria-label="模板库">
    <header className="template-library-heading">
      <div className="template-library-title"><span><BookCopy size={23} /></span><div><h1>模板库</h1><p>把可靠的项目结构重复使用，不会改动模板来源或现有项目。</p></div></div>
      <button className="button primary" type="button" onClick={openSave}><Plus size={16} />保存现有项目为模板</button>
    </header>
    <div className="template-library-toolbar" aria-label="模板搜索与筛选">
      <label><Search size={17} /><input aria-label="搜索模板" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、说明或文档类" />{query && <CloseButton label="清除模板搜索" onClick={() => setQuery("")} />}</label>
      <div role="group" aria-label="模板类型">
        {(["all", "article", "book", "presentation", "other"] as CategoryFilter[]).map((item) => <button key={item} type="button" className={category === item ? "active" : ""} aria-pressed={category === item} onClick={() => setCategory(item)}>{item === "all" ? "全部" : CATEGORY_LABELS[item]}</button>)}
      </div>
    </div>
    <div className="template-library-layout">
      <div className="template-library-catalog">
        {loading ? <div className="template-library-empty"><RefreshCw size={24} className="spin" /><p>正在准备模板库…</p></div> : filtered.length === 0 ? <div className="template-library-empty"><Search size={25} /><h2>没有符合条件的模板</h2><p>尝试清除搜索或选择“全部”。</p></div> : <>{renderGroup("内置模板", "随客户端提供的安全起点", builtIns)}{renderGroup("我的模板", "从本机项目保存，不会修改原项目", userTemplates)}</>}
      </div>
      <aside className="template-library-inspector" aria-label="模板详情">
        {selected ? <>
          <span className="template-library-source">{selected.source === "builtin" ? <><Sparkles size={14} />内置模板</> : <><BookCopy size={14} />我的模板</>}</span>
          <div className="template-library-preview"><span>{(() => { const Icon = CATEGORY_ICONS[selected.category]; return <Icon size={34} />; })()}</span></div>
          <h2>{selected.name}</h2>
          <p>{selected.description}</p>
          <dl>
            <div><dt>模板类型</dt><dd>{CATEGORY_LABELS[selected.category]}</dd></div>
            <div><dt>文档类</dt><dd>{selected.className ?? "通用"}</dd></div>
            <div><dt>文件</dt><dd>{selected.fileCount} 个</dd></div>
            <div><dt>大小</dt><dd>{formatBytes(selected.totalBytes)}</dd></div>
          </dl>
          <div className="template-library-actions">
            <button className="button primary" type="button" onClick={() => openCreate(selected)}><FolderInput size={16} />使用此模板新建项目</button>
            {selected.source === "user" && <button className="button danger-subtle" type="button" onClick={() => { setDialogReturnFocus(document.activeElement instanceof HTMLElement ? document.activeElement : null); setDeleteTarget(selected); }}><Trash2 size={16} />删除个人模板</button>}
          </div>
          <small className="template-library-safety">创建项目时会复制模板内容并生成新的项目身份；模板本身保持只读。</small>
        </> : <div className="template-library-empty"><BookCopy size={26} /><p>选择一个模板查看详情。</p></div>}
      </aside>
    </div>

    {createOpen && selected && <div className="modal-backdrop" role="presentation" onMouseDown={() => !creating && closeDialogs()}><section className="modal template-library-modal" role="dialog" aria-modal="true" aria-labelledby="template-create-title" onMouseDown={(event) => event.stopPropagation()}><header className="modal-header"><div><p className="eyebrow">从模板新建</p><h2 id="template-create-title">{selected.name}</h2></div><CloseButton label="关闭新建项目窗口" onClick={closeDialogs} /></header><div className="template-library-form"><label><span>新项目名称</span><input autoFocus value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={120} placeholder="例如：概率方法读书笔记" /></label><p>下一步选择父目录。客户端会创建新的同名文件夹，并在完成后加入项目库。</p></div><footer className="template-library-modal-actions"><button className="button secondary" disabled={creating} onClick={closeDialogs}>取消</button><button className="button primary" disabled={!projectName.trim() || creating} onClick={() => void createProject()}>{creating ? <><RefreshCw size={16} className="spin" />正在创建…</> : <><FolderInput size={16} />选择位置并创建</>}</button></footer></section></div>}

    {saveOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => !saving && closeDialogs()}><section className="modal template-library-modal" role="dialog" aria-modal="true" aria-labelledby="template-save-title" onMouseDown={(event) => event.stopPropagation()}><header className="modal-header"><div><p className="eyebrow">我的模板</p><h2 id="template-save-title">保存现有项目为模板</h2></div><CloseButton label="关闭保存模板窗口" onClick={closeDialogs} /></header><div className="template-library-form"><label><span>来源项目</span><select autoFocus value={sourceProjectId} onChange={(event) => { const id = event.target.value; const project = projects.find((item) => item.id === id); setSourceProjectId(id); if (project) setSaveDraft((current) => ({ ...current, name: project.name, description: `由项目“${project.name}”保存的个人模板。` })); }}>{projects.filter((project) => project.pathAvailable && !project.trashed).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label><span>模板名称</span><input value={saveDraft.name} onChange={(event) => setSaveDraft((current) => ({ ...current, name: event.target.value }))} maxLength={160} /></label><label><span>用途说明</span><textarea value={saveDraft.description ?? ""} onChange={(event) => setSaveDraft((current) => ({ ...current, description: event.target.value }))} maxLength={1000} rows={3} /></label><label><span>模板类型</span><select value={saveDraft.category} onChange={(event) => setSaveDraft((current) => ({ ...current, category: event.target.value as TemplateInfo["category"] }))}>{Object.entries(CATEGORY_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><p>只会读取并复制项目文件；原项目不会被重命名、移动或改写。构建缓存、Git 历史和本机恢复数据不会进入模板。</p></div><footer className="template-library-modal-actions"><button className="button secondary" disabled={saving} onClick={closeDialogs}>取消</button><button className="button primary" disabled={!sourceProjectId || !saveDraft.name.trim() || saving} onClick={() => void saveProjectAsTemplate()}>{saving ? <><RefreshCw size={16} className="spin" />正在保存…</> : <><BookCopy size={16} />保存到我的模板</>}</button></footer></section></div>}

    {deleteTarget && <div className="modal-backdrop" role="presentation" onMouseDown={() => !deleting && closeDialogs()}><section className="modal template-library-confirm" role="alertdialog" aria-modal="true" aria-labelledby="template-delete-title" aria-describedby="template-delete-description" onMouseDown={(event) => event.stopPropagation()}><header className="modal-header"><div><p className="eyebrow">删除个人模板</p><h2 id="template-delete-title">删除“{deleteTarget.name}”？</h2></div><CloseButton label="关闭删除确认" onClick={closeDialogs} /></header><p id="template-delete-description">只会删除模板库中的副本，不会删除或修改创建它的原项目。此操作无法撤销。</p><footer className="template-library-modal-actions"><button className="button secondary" disabled={deleting} onClick={closeDialogs}>取消</button><button className="button danger" disabled={deleting} onClick={() => void deleteTemplate()}>{deleting ? "正在删除…" : "确认删除模板"}</button></footer></section></div>}
  </section>;
}
