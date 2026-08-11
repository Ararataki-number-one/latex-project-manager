import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  BookOpenText,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Code2,
  CloudOff,
  Copy,
  CopyPlus,
  Download,
  Eraser,
  ExternalLink,
  FileDown,
  FolderInput,
  FolderKanban,
  FolderOpen,
  HardDrive,
  Heart,
  GitFork,
  Import,
  Menu,
  MoreHorizontal,
  LogIn,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Star,
  Tags,
  Trash2,
  X
} from "lucide-react";
import type { WorkbenchApi } from "@/shared/ipc";
import type { AppRuntimeSettings, AppUpdateStatus, GitHubAccountStatus, GitHubRepositoryVisibility, GitHubSyncStatus, ProjectStorageInfo, ProjectSummary, ScanCandidate, TemplateInfo, TemporaryCleanupPreview } from "@/shared/types";
import { createWorkbench } from "./demo";
import { OnboardingWizard } from "./OnboardingWizard";
import { ProjectView } from "./ProjectView";

const runtime = createWorkbench();

type LibraryFilter = "all" | "favorites" | "recent" | "archived";
type ExtendedLibraryFilter = LibraryFilter | "trashed";

const TAG_COLORS = ["#e5484d", "#8e4ec6", "#3e63dd", "#0d9f6e", "#e5a000", "#00a2c7", "#cd2b31"];

function IconButton({ label, children, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}

function StatusDot({ pathAvailable, pdfAvailable }: { pathAvailable: boolean; pdfAvailable: boolean }) {
  const value = !pathAvailable ? "failed" : pdfAvailable ? "success" : "idle";
  const label = !pathAvailable ? "项目路径不可用" : pdfAvailable ? "已找到主 PDF" : "尚未找到主 PDF";
  return <span className={`status-dot status-${value}`} title={label} aria-label={label} />;
}

function ProjectSyncBadge({ status }: { status?: GitHubSyncStatus }) {
  let label = "未同步";
  let tone = "idle";
  let icon = <CloudOff size={12} />;
  if (status?.state === "syncing") {
    label = "同步中";
    tone = "running";
    icon = <RefreshCw size={12} className="spin" />;
  } else if (status?.state === "queued") {
    label = "排队中";
    tone = "running";
    icon = <Clock3 size={12} />;
  } else if (status?.state === "retrying") {
    label = "等待重试";
    tone = "warning";
    icon = <RefreshCw size={12} />;
  } else if (status?.state === "blocked") {
    label = "安全阻止";
    tone = "error";
    icon = <ShieldCheck size={12} />;
  } else if (status?.configured && status.state === "synced") {
    label = "已同步";
    tone = "success";
    icon = <CheckCircle2 size={12} />;
  } else if (status?.configured && new Set(["error", "needsPull", "unavailable"]).has(status.state)) {
    label = "同步失败";
    tone = "error";
    icon = <CloudOff size={12} />;
  }
  return <span className={`project-sync-badge sync-${tone}`} aria-label={`GitHub 状态：${label}`} title={status?.message ?? label}>{icon}{label}</span>;
}

function relativeTime(value?: string) {
  if (!value) return "从未打开";
  const delta = Date.now() - new Date(value).getTime();
  const days = Math.floor(delta / 86_400_000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 30) return `${days} 天前`;
  return new Date(value).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function suggestedGitHubRepositoryName(name: string, fallbackId: string): string {
  const normalized = name
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 80);
  return normalized || `latex-project-${fallbackId.slice(0, 8).toLocaleLowerCase("en-US")}`;
}

interface LibraryViewProps {
  api: WorkbenchApi;
  projects: ProjectSummary[];
  filter: ExtendedLibraryFilter;
  activeTag: string | null;
  onManage: (project: ProjectSummary) => void;
  onProjectsChange: React.Dispatch<React.SetStateAction<ProjectSummary[]>>;
  onNotify: (message: string) => void;
  isDemo: boolean;
  openImportNonce: number;
}

function LibraryView({ api, projects, filter, activeTag, onManage, onProjectsChange, onNotify, isDemo, openImportNonce }: LibraryViewProps) {
  const [query, setQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [candidates, setCandidates] = useState<ScanCandidate[]>([]);
  const [scanning, setScanning] = useState(false);
  const [menuProjectId, setMenuProjectId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [copyProject, setCopyProject] = useState<ProjectSummary | null>(null);
  const [copyName, setCopyName] = useState("");
  const [copying, setCopying] = useState(false);
  const [pdfAvailability, setPdfAvailability] = useState<Record<string, boolean>>({});
  const [projectStorage, setProjectStorage] = useState<Record<string, ProjectStorageInfo>>({});
  const [syncStatuses, setSyncStatuses] = useState<Record<string, GitHubSyncStatus>>({});
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templateProjectName, setTemplateProjectName] = useState("");
  const [templateCreating, setTemplateCreating] = useState(false);
  const [cleanupProject, setCleanupProject] = useState<ProjectSummary | null>(null);
  const [cleanupPreview, setCleanupPreview] = useState<TemporaryCleanupPreview | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [syncOnImport, setSyncOnImport] = useState(false);
  const [importVisibility, setImportVisibility] = useState<GitHubRepositoryVisibility>("private");
  const [importingPath, setImportingPath] = useState<string | null>(null);

  useEffect(() => {
    if (openImportNonce > 0) setImportOpen(true);
  }, [openImportNonce]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return projects
      .filter((project) => {
        if (filter === "trashed") {
          if (!project.trashed) return false;
        } else {
          if (project.trashed) return false;
          if (filter === "favorites" && (!project.favorite || project.archived)) return false;
          if (filter === "archived" && !project.archived) return false;
          if (filter !== "archived" && project.archived) return false;
        }
        if (activeTag && !project.tags.includes(activeTag)) return false;
        return !normalized || [project.name, project.rootPath, ...project.classNames, ...project.tags].join(" ").toLocaleLowerCase().includes(normalized);
      })
      .sort((a, b) => (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? "") || a.name.localeCompare(b.name, "zh-CN"));
  }, [projects, filter, query, activeTag]);

  useEffect(() => {
    setSelectedProjectIds((current) => current.filter((id) => visible.some((project) => project.id === id)));
  }, [visible]);

  useEffect(() => {
    let cancelled = false;
    const candidates = projects.filter((project) => project.pathAvailable && !project.trashed);
    const entries: Array<readonly [string, boolean]> = [];
    const storageEntries: Array<readonly [string, ProjectStorageInfo]> = [];
    let nextIndex = 0;
    const worker = async () => {
      while (!cancelled) {
        const project = candidates[nextIndex++];
        if (!project) return;
        try {
          entries.push([project.id, Boolean(await api.library.lastSuccessfulPdf(project.id))] as const);
        } catch {
          entries.push([project.id, false] as const);
        }
        try {
          storageEntries.push([project.id, await api.library.storageInfo(project.id)] as const);
        } catch {
          // Keep the previous measurement when a project is temporarily unavailable.
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, candidates.length) }, () => worker())).then(() => {
      if (!cancelled) {
        setPdfAvailability((current) => ({ ...current, ...Object.fromEntries(entries) }));
        setProjectStorage((current) => ({ ...current, ...Object.fromEntries(storageEntries) }));
      }
    });
    return () => { cancelled = true; };
  }, [api, isDemo, projects]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      const candidates = projects.filter((project) => project.pathAvailable && !project.trashed);
      const entries: Array<readonly [string, GitHubSyncStatus]> = [];
      let nextIndex = 0;
      const worker = async () => {
        while (!cancelled) {
          const project = candidates[nextIndex++];
          if (!project) return;
          try {
            entries.push([project.id, await api.github.status(project.id)] as const);
          } catch {
            // The badge remains in its previous state if Git is busy or temporarily unavailable.
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, candidates.length) }, () => worker()));
      if (!cancelled) {
        setSyncStatuses((current) => ({ ...current, ...Object.fromEntries(entries) }));
        timer = setTimeout(() => { void refresh(); }, 8_000);
      }
    };
    void refresh();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [api, projects]);

  async function toggleFavorite(project: ProjectSummary) {
    const favorite = !project.favorite;
    await updateProject(project, { favorite });
  }

  async function updateProject(project: ProjectSummary, patch: Partial<Pick<ProjectSummary, "name" | "favorite" | "archived" | "trashed" | "tags">>) {
    onProjectsChange((current) => current.map((item) => item.id === project.id ? { ...item, ...patch } : item));
    try {
      const updated = await api.library.update(project.id, patch);
      onProjectsChange((current) => current.map((item) => item.id === project.id ? updated : item));
      return true;
    } catch (error) {
      onProjectsChange((current) => current.map((item) => item.id === project.id ? project : item));
      onNotify(error instanceof Error ? error.message : "项目索引更新失败");
      return false;
    }
  }

  async function setArchived(project: ProjectSummary, archived: boolean) {
    if (await updateProject(project, { archived })) onNotify(archived ? `已归档「${project.name}」` : `已将「${project.name}」移出归档`);
  }

  async function moveToTrash(project: ProjectSummary) {
    if (await updateProject(project, { trashed: true })) onNotify(`已将「${project.name}」移入项目库回收站；磁盘文件未删除`);
  }

  async function restoreProject(project: ProjectSummary) {
    if (await updateProject(project, { trashed: false })) onNotify(`已恢复「${project.name}」`);
  }

  async function openProjectFolder(project: ProjectSummary) {
    if (!project.pathAvailable) {
      onNotify("项目路径不可用，请先重新定位目录。");
      return;
    }
    if (isDemo) {
      onProjectsChange((current) => current.map((item) => item.id === project.id ? { ...item, lastOpenedAt: new Date().toISOString() } : item));
      onNotify(`演示模式：已模拟打开 ${project.name} 的文件夹`);
      return;
    }
    try {
      await api.library.openFolder(project.id);
      onProjectsChange((current) => current.map((item) => item.id === project.id ? { ...item, lastOpenedAt: new Date().toISOString() } : item));
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法打开项目文件夹");
    }
  }

  async function relinkProject(project: ProjectSummary) {
    const rootPath = await api.dialogs.openDirectory();
    if (!rootPath) return;
    try {
      const next = await api.library.relink(project.id, rootPath);
      onProjectsChange((current) => current.map((item) => item.id === project.id ? next : item));
      setMenuProjectId(null);
      onNotify(`已将 ${project.name} 重新定位到 ${rootPath}`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "路径重定位失败");
    }
  }

  async function openProjectInVsCode(project: ProjectSummary) {
    if (!project.pathAvailable) {
      onNotify("项目路径不可用，请先重新定位目录。");
      return;
    }
    if (isDemo) {
      onProjectsChange((current) => current.map((item) => item.id === project.id ? { ...item, lastOpenedAt: new Date().toISOString() } : item));
      onNotify("演示模式：已模拟在 VS Code 中打开项目");
      return;
    }
    try {
      await api.library.openInVsCode(project.id);
      onProjectsChange((current) => current.map((item) => item.id === project.id ? { ...item, lastOpenedAt: new Date().toISOString() } : item));
      onNotify(`已在 VS Code 中打开 ${project.name}`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法打开 VS Code 项目");
    }
  }

  function beginCopy(project: ProjectSummary) {
    setMenuProjectId(null);
    setCopyProject(project);
    setCopyName(`${project.name} - 副本`);
  }

  async function confirmCopy() {
    if (!copyProject || !copyName.trim()) return;
    const destinationParent = await api.dialogs.openDirectory();
    if (!destinationParent) return;
    setCopying(true);
    try {
      const copied = await api.library.copy(copyProject.id, destinationParent, copyName.trim());
      onProjectsChange((current) => [...current.filter((item) => item.id !== copied.id), copied]);
      setCopyProject(null);
      onNotify(`已创建项目副本「${copied.name}」`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "复制项目失败");
    } finally {
      setCopying(false);
    }
  }

  async function exportZip(project: ProjectSummary) {
    try {
      const result = await api.library.exportZip(project.id);
      if (!result.canceled && result.path) onNotify(`源码 ZIP 已导出到 ${result.path}`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "导出 ZIP 失败");
    }
  }

  async function exportPdf(project: ProjectSummary) {
    try {
      const result = await api.library.exportLastSuccessfulPdf(project.id);
      if (!result.canceled && result.path) onNotify(`PDF 已导出到 ${result.path}`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "导出 PDF 失败");
    }
  }

  async function openLatestPdf(project: ProjectSummary) {
    try {
      await api.library.openLastSuccessfulPdf(project.id);
      if (isDemo) onNotify("演示模式：已模拟打开最新 PDF");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法打开最新 PDF");
    }
  }

  async function beginTemporaryCleanup(project: ProjectSummary) {
    setMenuProjectId(null);
    setCleanupProject(project);
    setCleanupPreview(null);
    setCleanupBusy(true);
    try {
      setCleanupPreview(await api.library.previewTemporaryCleanup(project.id));
    } catch (error) {
      setCleanupProject(null);
      onNotify(error instanceof Error ? error.message : "无法扫描临时文件");
    } finally {
      setCleanupBusy(false);
    }
  }

  async function confirmTemporaryCleanup() {
    if (!cleanupProject || !cleanupPreview || cleanupPreview.fileCount === 0) return;
    setCleanupBusy(true);
    try {
      const result = await api.library.applyTemporaryCleanup(cleanupProject.id, cleanupPreview.planId);
      setCleanupProject(null);
      setCleanupPreview(null);
      onNotify(`已清理 ${result.fileCount} 个临时文件，释放 ${formatBytes(result.freedBytes)}`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "临时文件清理失败");
    } finally {
      setCleanupBusy(false);
    }
  }

  function toggleSelected(projectId: string) {
    setSelectedProjectIds((current) => current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId]);
  }

  async function updateSelected(patch: Partial<Pick<ProjectSummary, "archived" | "trashed">>) {
    const targets = projects.filter((project) => selectedProjectIds.includes(project.id));
    const results = await Promise.allSettled(targets.map((project) => api.library.update(project.id, patch)));
    const updated = new Map<string, ProjectSummary>();
    const failedIds: string[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") updated.set(result.value.id, result.value);
      else failedIds.push(targets[index].id);
    });
    onProjectsChange((current) => current.map((project) => updated.get(project.id) ?? project));
    setSelectedProjectIds(failedIds);
    const successCount = targets.length - failedIds.length;
    const action = patch.trashed === false ? "恢复" : patch.trashed ? "移入项目库回收站" : "归档";
    onNotify(failedIds.length ? `已${action} ${successCount} 个项目，${failedIds.length} 个项目更新失败` : `已${action} ${successCount} 个项目${patch.trashed ? "；磁盘文件未删除" : ""}`);
  }

  function openProjectMenu(project: ProjectSummary) {
    const nextId = menuProjectId === project.id ? null : project.id;
    setMenuProjectId(nextId);
    setTagDraft(nextId ? project.tags.join(", ") : "");
  }

  function saveTags(project: ProjectSummary) {
    const tags = Array.from(new Set(tagDraft.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean)));
    void updateProject(project, { tags });
    setMenuProjectId(null);
    onNotify("项目标签已更新");
  }

  async function scanLibrary() {
    setScanning(true);
    try {
      const root = await api.dialogs.openDirectory();
      if (!root) return;
      setCandidates(await api.library.scan(root, { maxDepth: 3 }));
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "扫描失败");
    } finally {
      setScanning(false);
    }
  }

  async function importCandidate(candidate: ScanCandidate) {
    setImportingPath(candidate.rootPath);
    try {
      const imported = await api.library.import(candidate);
      onProjectsChange([...projects.filter((item) => item.id !== imported.id), imported]);
      if (syncOnImport) {
        try {
          const result = await api.github.createRepository(imported.id, {
            repositoryName: suggestedGitHubRepositoryName(imported.name, imported.id),
            visibility: importVisibility,
            autoSync: true,
            useLfsForDocuments: true
          });
          setImportOpen(false);
          onNotify(result.state === "synced" ? `已导入 ${candidate.name}，并创建 GitHub ${importVisibility === "public" ? "公开" : "私有"}仓库` : (result.message ?? `已导入 ${candidate.name}`));
        } catch (error) {
          setImportOpen(false);
          onNotify(`项目已导入，但 GitHub 自动建仓失败：${error instanceof Error ? error.message : "未知错误"}`);
        }
      } else {
        setImportOpen(false);
        onNotify(`已导入 ${candidate.name}`);
      }
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "导入失败");
    } finally {
      setImportingPath(null);
    }
  }

  async function openTemplates() {
    try {
      const items = await api.templates.list();
      setTemplates(items);
      setSelectedTemplateId(items[0]?.id ?? null);
      setTemplateProjectName(items[0]?.name ?? "");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法读取模板目录");
      return;
    }
    setTemplateOpen(true);
  }

  async function saveAsTemplate(project: ProjectSummary) {
    if (isDemo) {
      onNotify("浏览器演示模式不会写入模板库");
      return;
    }
    try {
      const template = await api.templates.create(project.rootPath, project.name);
      onNotify(`已将「${project.name}」保存为模板「${template.name}」`);
      setMenuProjectId(null);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "保存模板失败");
    }
  }

  async function instantiateTemplate() {
    const template = templates.find((item) => item.id === selectedTemplateId);
    if (!template || !templateProjectName.trim()) return;
    if (isDemo) {
      onNotify("浏览器演示模式不会创建项目目录");
      return;
    }
    const parentRoot = await api.dialogs.openDirectory();
    if (!parentRoot) return;
    setTemplateCreating(true);
    let projectRoot: string | null = null;
    try {
      projectRoot = await api.templates.instantiate(template.id, parentRoot, templateProjectName);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "从模板创建项目失败");
      setTemplateCreating(false);
      return;
    }
    try {
      const candidates = await api.library.scan(projectRoot, { maxDepth: 0 });
      const candidate = candidates.find((item) => item.rootPath.toLocaleLowerCase() === projectRoot.toLocaleLowerCase()) ?? candidates[0];
      if (!candidate) throw new Error("模板已复制，但未找到可导入的 LaTeX 主文件。");
      const imported = await api.library.import(candidate);
      onProjectsChange([...projects.filter((item) => item.id !== imported.id), imported]);
      setTemplateOpen(false);
      onNotify(`已从「${template.name}」创建 ${imported.name}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知导入错误";
      onNotify(`项目已创建在 ${projectRoot}，但自动导入失败：${detail}`);
    } finally {
      setTemplateCreating(false);
    }
  }

  return (
    <section className="library-page" data-testid="project-library">
      <header className="page-header">
        <div className="page-heading">
          <span className="page-heading-icon" aria-hidden="true"><FolderKanban size={23} /></span>
          <div>
            <p className="eyebrow">LaTeX 项目管理</p>
            <h1>{filter === "favorites" ? "收藏项目" : filter === "recent" ? "最近使用" : filter === "archived" ? "已归档" : filter === "trashed" ? "回收站" : activeTag ? `标签：${activeTag}` : "你的项目"}</h1>
            <p className="muted">{visible.length} 个项目 · 文件只保存在这台电脑上</p>
          </div>
        </div>
        <div className="header-actions">
          <button className="button secondary" onClick={() => setImportOpen(true)}><Import size={17} />导入项目</button>
          <button className="button primary" onClick={() => void openTemplates()}><Plus size={17} />从模板新建</button>
        </div>
      </header>

      <div className="library-toolbar">
        <label className="search-field">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、路径、标签或文档类" aria-label="搜索项目" />
          {query && <IconButton label="清除搜索" onClick={() => setQuery("")}><X size={15} /></IconButton>}
        </label>
        {selectedProjectIds.length > 0 && (
          <div className="bulk-actions" role="toolbar" aria-label="批量项目操作">
            <strong>已选 {selectedProjectIds.length} 项</strong>
            {filter === "trashed"
              ? <button className="button secondary" onClick={() => void updateSelected({ trashed: false })}><ArchiveRestore size={15} />恢复</button>
              : <><button className="button secondary" onClick={() => void updateSelected({ archived: true })}><Archive size={15} />归档</button><button className="button secondary danger-text" onClick={() => void updateSelected({ trashed: true })}><Trash2 size={15} />移入回收站</button></>}
          </div>
        )}
      </div>

      {visible.length ? (
        <div className="project-table" role="table" aria-label="项目列表" data-testid="project-list">
          <div className="project-table-head" role="row">
            <span role="columnheader" className="project-check-cell">
              <input
                type="checkbox"
                aria-label="选择当前页面所有项目"
                checked={visible.length > 0 && visible.every((project) => selectedProjectIds.includes(project.id))}
                onChange={(event) => setSelectedProjectIds(event.target.checked ? visible.map((project) => project.id) : [])}
              />
            </span>
            <span role="columnheader">标题</span>
            <span role="columnheader">文档</span>
            <span role="columnheader">最近使用</span>
            <span role="columnheader" className="project-actions-heading">操作</span>
          </div>
          {visible.map((project) => (
            <article
              className={`project-row ${!project.pathAvailable ? "path-missing" : ""}`}
              key={project.id}
              data-testid={`project-row-${project.id}`}
              role="row"
              tabIndex={filter === "trashed" ? -1 : 0}
              aria-label={filter === "trashed" ? `${project.name}，请先恢复项目` : `${project.name}，打开项目文件夹`}
              onClick={() => { if (filter !== "trashed") void openProjectFolder(project); }}
              onKeyDown={(event) => {
                if (filter !== "trashed" && event.key === "Enter" && event.target === event.currentTarget) void openProjectFolder(project);
              }}
            >
              <span role="cell" className="project-check-cell" onClick={(event) => event.stopPropagation()}>
                <input type="checkbox" checked={selectedProjectIds.includes(project.id)} onChange={() => toggleSelected(project.id)} aria-label={`选择项目 ${project.name}`} />
              </span>
              <div role="cell" className="project-main">
                <span className="project-folder-icon" aria-hidden="true"><FolderKanban size={19} /></span>
                <div className="project-copy">
                  <div className="project-title-line">
                    <StatusDot pathAvailable={project.pathAvailable} pdfAvailable={isDemo ? ["success", "warning"].includes(project.lastBuildStatus ?? "") : pdfAvailability[project.id] === true} />
                    <button className="project-title-button" disabled={filter === "trashed"} onClick={(event) => { event.stopPropagation(); if (filter !== "trashed") void openProjectFolder(project); }}>{project.name}</button>
                    <ProjectSyncBadge status={syncStatuses[project.id]} />
                    {project.favorite && <Star className="project-favorite-mark" size={14} fill="currentColor" aria-label="已收藏" />}
                    {!project.pathAvailable && <span className="badge danger">路径不可用</span>}
                  </div>
                  <p className="project-path" title={project.rootPath}>{project.rootPath}</p>
                  <div className="tag-row">
                    {project.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
                  </div>
                </div>
              </div>
              <div role="cell" className="project-meta">
                <strong>{project.targetCount} 个文档目标</strong>
                <span>{project.classNames.join(" · ") || "未识别文档类"}</span>
                <span>{projectStorage[project.id] ? `${formatBytes(projectStorage[project.id].totalBytes)} · ${projectStorage[project.id].fileCount} 个文件` : "正在统计大小…"}</span>
              </div>
              <div role="cell" className="project-time"><Clock3 size={14} /><span>{relativeTime(project.lastOpenedAt)}</span></div>
              <div role="cell" className="project-actions" onClick={(event) => event.stopPropagation()}>
                {filter === "trashed" ? (
                  <>
                    <IconButton label={`恢复项目 ${project.name}`} onClick={() => void restoreProject(project)}><ArchiveRestore size={18} /></IconButton>
                  </>
                ) : (
                  <>
                    <IconButton label={`管理项目 ${project.name}`} className="manage-action" onClick={() => onManage(project)} disabled={!project.pathAvailable}><Settings2 size={18} /></IconButton>
                    <span className="action-divider" />
                    <IconButton label={`复制项目 ${project.name}`} onClick={() => beginCopy(project)} disabled={!project.pathAvailable}><Copy size={18} /></IconButton>
                    <IconButton label={`导出 ZIP ${project.name}`} className="compact-hide" onClick={() => void exportZip(project)} disabled={!project.pathAvailable}><Download size={18} /></IconButton>
                    <IconButton label={`导出 PDF ${project.name}`} className="compact-hide" onClick={() => void exportPdf(project)} disabled={!project.pathAvailable || (!isDemo && pdfAvailability[project.id] !== true)}><FileDown size={18} /></IconButton>
                    <IconButton label={`清理临时文件 ${project.name}`} className="compact-hide" onClick={() => void beginTemporaryCleanup(project)} disabled={!project.pathAvailable}><Eraser size={18} /></IconButton>
                    <IconButton label={`${project.archived ? "取消归档" : "归档项目"} ${project.name}`} className="compact-hide" onClick={() => void setArchived(project, !project.archived)}>{project.archived ? <ArchiveRestore size={18} /> : <Archive size={18} />}</IconButton>
                    <IconButton label={`移入回收站 ${project.name}`} className="trash-action compact-hide" onClick={() => void moveToTrash(project)}><Trash2 size={18} /></IconButton>
                    <IconButton label={`更多操作 ${project.name}`} onClick={() => openProjectMenu(project)}><MoreHorizontal size={18} /></IconButton>
                  </>
                )}
              </div>
              {menuProjectId === project.id && (
                <div className="project-menu" onClick={(event) => event.stopPropagation()}>
                  <label><span><Tags size={14} />标签</span><input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveTags(project)} placeholder="用逗号分隔" /></label>
                  <button onClick={() => saveTags(project)}><Check size={15} />保存标签</button>
                  <button onClick={() => void openProjectFolder(project)} disabled={!project.pathAvailable}><FolderOpen size={15} />打开项目文件夹</button>
                  <button onClick={() => void openProjectInVsCode(project)} disabled={!project.pathAvailable}><Code2 size={15} />在 VS Code 中打开</button>
                  <button onClick={() => void openLatestPdf(project)} disabled={!project.pathAvailable || (!isDemo && pdfAvailability[project.id] !== true)}><FileDown size={15} />打开最新 PDF</button>
                  <button onClick={() => void beginTemporaryCleanup(project)} disabled={!project.pathAvailable}><Eraser size={15} />清理临时文件</button>
                  <button onClick={() => void toggleFavorite(project)}><Star size={15} fill={project.favorite ? "currentColor" : "none"} />{project.favorite ? "取消收藏" : "收藏项目"}</button>
                  <button onClick={() => void relinkProject(project)}><FolderInput size={15} />重新定位路径</button>
                  <button onClick={() => void saveAsTemplate(project)}><CopyPlus size={15} />保存为模板</button>
                  <button className="mobile-menu-action" onClick={() => beginCopy(project)}><Copy size={15} />复制项目</button>
                  <button className="mobile-menu-action" onClick={() => void exportZip(project)}><Download size={15} />导出源码 ZIP</button>
                  <button className="mobile-menu-action" onClick={() => void exportPdf(project)} disabled={!isDemo && pdfAvailability[project.id] !== true}><FileDown size={15} />导出最新 PDF</button>
                  <button className="mobile-menu-action" onClick={() => void setArchived(project, !project.archived)}>{project.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}{project.archived ? "取消归档" : "归档项目"}</button>
                  <button className="mobile-menu-action danger-text" onClick={() => void moveToTrash(project)}><Trash2 size={15} />移入回收站</button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state"><Search size={28} /><h2>{filter === "trashed" ? "回收站为空" : "没有匹配的项目"}</h2><p>{filter === "trashed" ? "移入回收站的项目会显示在这里，真实文件仍留在原位置。" : "调整搜索词、标签或资料库范围。"}</p></div>
      )}

      {copyProject && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !copying && setCopyProject(null)}>
          <section className="modal copy-dialog" role="dialog" aria-modal="true" aria-labelledby="copy-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <div><p className="eyebrow">本地项目副本 · Duplicate</p><h2 id="copy-title">复制项目</h2></div>
              <IconButton label="关闭" onClick={() => setCopyProject(null)} disabled={copying}><X size={18} /></IconButton>
            </header>
            <div className="copy-dialog-content">
              <div className="copy-source"><Copy size={20} /><div><strong>{copyProject.name}</strong><span title={copyProject.rootPath}>{copyProject.rootPath}</span></div></div>
              <label><span>副本名称</span><input value={copyName} onChange={(event) => setCopyName(event.target.value)} maxLength={120} autoFocus onKeyDown={(event) => event.key === "Enter" && void confirmCopy()} /></label>
              <p>下一步选择父目录。客户端会创建新的项目文件夹与项目标识，不复制构建缓存。</p>
            </div>
            <footer className="modal-actions"><button className="button secondary" onClick={() => setCopyProject(null)} disabled={copying}>取消</button><button className="button primary" onClick={() => void confirmCopy()} disabled={!copyName.trim() || copying}>{copying ? "正在复制…" : "选择位置并复制"}</button></footer>
          </section>
        </div>
      )}

      {cleanupProject && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !cleanupBusy && setCleanupProject(null)}>
          <section className="modal cleanup-dialog" role="dialog" aria-modal="true" aria-labelledby="cleanup-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <div><p className="eyebrow">安全扫描 · Cleanup</p><h2 id="cleanup-title">清理临时文件</h2></div>
              <IconButton label="关闭" onClick={() => setCleanupProject(null)} disabled={cleanupBusy}><X size={18} /></IconButton>
            </header>
            <div className="cleanup-dialog-content">
              <div className="cleanup-project"><Eraser size={20} /><div><strong>{cleanupProject.name}</strong><span title={cleanupProject.rootPath}>{cleanupProject.rootPath}</span></div></div>
              {cleanupBusy && !cleanupPreview ? (
                <div className="cleanup-loading">正在扫描 LaTeX 辅助文件和工作台缓存…</div>
              ) : cleanupPreview && cleanupPreview.fileCount > 0 ? (
                <>
                  <div className="cleanup-summary"><div><strong>{cleanupPreview.fileCount}</strong><span>个临时文件</span></div><div><strong>{formatBytes(cleanupPreview.totalBytes)}</strong><span>预计释放空间</span></div><div><strong>{cleanupPreview.directoryCount}</strong><span>个缓存目录</span></div></div>
                  <div className="cleanup-categories">{cleanupPreview.categories.map((category) => <span key={category.name}>{category.name}<strong>{category.count}</strong></span>)}</div>
                  <div className="cleanup-samples"><strong>部分文件</strong>{cleanupPreview.samplePaths.map((path) => <code key={path}>{path}</code>)}</div>
                  <p className="cleanup-warning">只清理 `.aux`、`.log`、`.toc`、SyncTeX 等辅助文件和本软件的构建缓存；保留 `.tex`、`.bib`、PDF、原始文稿、项目配置和恢复快照。确认后永久删除所列临时文件。</p>
                </>
              ) : cleanupPreview ? (
                <div className="cleanup-empty"><Eraser size={24} /><strong>项目已经很干净</strong><span>没有找到可以安全清理的临时文件。</span></div>
              ) : null}
            </div>
            <footer className="modal-actions"><button className="button secondary" onClick={() => setCleanupProject(null)} disabled={cleanupBusy}>{cleanupPreview?.fileCount ? "取消" : "关闭"}</button>{Boolean(cleanupPreview?.fileCount) && <button className="button danger" onClick={() => void confirmTemporaryCleanup()} disabled={cleanupBusy}>{cleanupBusy ? "正在清理…" : "确认清理"}</button>}</footer>
          </section>
        </div>
      )}

      {importOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setImportOpen(false)}>
          <section className="modal import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <div><p className="eyebrow">只读扫描 · Read-only scan</p><h2 id="import-title">导入 LaTeX 项目</h2></div>
              <IconButton label="关闭" onClick={() => setImportOpen(false)}><X size={18} /></IconButton>
            </header>
            <div className="scan-callout">
              <FolderInput size={22} />
              <div><strong>选择资料库或项目目录</strong><p>默认递归 3 层，只识别入口，不修改任何 `.tex` 文件。</p></div>
              <button className="button primary" onClick={() => void scanLibrary()} disabled={scanning}>{scanning ? "正在扫描…" : "选择目录"}</button>
            </div>
            <div className="import-sync-choice">
              <label className="sync-toggle"><span><strong>导入后启用 GitHub 自动同步</strong><small>自动创建新仓库，并同步新增、删除和文件内容修改</small></span><input type="checkbox" checked={syncOnImport} onChange={(event) => setSyncOnImport(event.target.checked)} /></label>
              {syncOnImport && <div className="import-sync-options"><label><span>新仓库可见性</span><select value={importVisibility} onChange={(event) => setImportVisibility(event.target.value as GitHubRepositoryVisibility)}><option value="private">私有（推荐）</option><option value="public">公开</option></select></label><p>仓库名会根据项目名称自动生成。请先在“设置 → GitHub 连接”登录账号。</p></div>}
            </div>
            <div className="candidate-list">
              {candidates.length === 0 && <p className="empty-inline">扫描结果会显示在这里。浏览器演示模式可返回两组模拟项目。</p>}
              {candidates.map((candidate) => (
                <div className="candidate" key={candidate.rootPath}>
                  <BookOpenText size={20} />
                  <div><strong>{candidate.name}</strong><p>{candidate.rootPath}</p><span>{candidate.entries.length} 个入口：{candidate.entries.map((entry) => `${entry.relativePath} (${entry.className})`).join("、")}</span></div>
                  <button className="button secondary" disabled={importingPath !== null} onClick={() => void importCandidate(candidate)}>{importingPath === candidate.rootPath ? "正在导入…" : syncOnImport ? "导入并同步" : "选择"}</button>
                </div>
              ))}
            </div>
            {isDemo && <p className="demo-note">演示模式不会写入目录；桌面客户端中选择后会进入迁移预览。</p>}
          </section>
        </div>
      )}

      {templateOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setTemplateOpen(false)}>
          <section className="modal template-dialog" role="dialog" aria-modal="true" aria-labelledby="template-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="modal-header"><div><p className="eyebrow">项目模板 · Templates</p><h2 id="template-title">从模板新建</h2></div><IconButton label="关闭" onClick={() => setTemplateOpen(false)}><X size={18} /></IconButton></header>
            <div className="template-list">
              {templates.map((template) => <button className={`template-item ${selectedTemplateId === template.id ? "selected" : ""}`} key={template.id} onClick={() => { setSelectedTemplateId(template.id); setTemplateProjectName(template.name); }}><div className="template-icon"><BookOpenText size={20} /></div><div><strong>{template.name}</strong><p>{template.description}</p><span>{template.className ?? "通用文档类"} · {template.assetPins.length} 个固定资源</span></div><ChevronRight size={17} /></button>)}
              {templates.length === 0 && <p className="empty-inline">暂未发现模板。</p>}
            </div>
            {selectedTemplateId && <div className="template-create-form"><label><span>项目名称</span><input value={templateProjectName} onChange={(event) => setTemplateProjectName(event.target.value)} maxLength={120} /></label><div><p>将在你选择的父目录中创建同名新文件夹；已存在的目录不会被覆盖。</p><button className="button primary" disabled={!templateProjectName.trim() || templateCreating || isDemo} onClick={() => void instantiateTemplate()}><FolderInput size={16} />{templateCreating ? "正在创建…" : "选择位置并创建"}</button></div></div>}
            {isDemo && <p className="demo-note">演示模式只展示模板元数据，不会创建目录。</p>}
          </section>
        </div>
      )}
    </section>
  );
}

function SettingsView({ api, isDemo, onNotify, runtimeSettings, onRuntimeSettingsChange, onOpenOnboarding }: {
  api: WorkbenchApi;
  isDemo: boolean;
  onNotify: (message: string) => void;
  runtimeSettings: AppRuntimeSettings;
  onRuntimeSettingsChange: (settings: AppRuntimeSettings) => void;
  onOpenOnboarding: () => void;
}) {
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);
  const [account, setAccount] = useState<GitHubAccountStatus | null>(null);
  const [busy, setBusy] = useState<"settings" | "check" | "download" | "install" | "github" | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await api.updates.status();
        if (!cancelled) setStatus(next);
      } catch (error) {
        if (!cancelled) onNotify(error instanceof Error ? error.message : "无法读取更新状态");
      }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 8_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [api, onNotify]);

  async function refreshGitHubAccount() {
    try {
      setAccount(await api.github.authStatus());
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法读取 GitHub 登录状态");
    }
  }

  useEffect(() => {
    void refreshGitHubAccount();
    const timer = setInterval(() => { if (!account?.authenticated) void refreshGitHubAccount(); }, 6_000);
    return () => clearInterval(timer);
  }, [account?.authenticated]);

  async function beginGitHubLogin() {
    setBusy("github");
    try {
      if (account?.cliAvailable === false) {
        await api.github.openCliDownload();
        onNotify("已打开 GitHub CLI 下载页；安装完成后重启客户端");
      } else {
        const next = await api.github.beginLogin();
        setAccount(next);
        onNotify(next.message);
      }
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法启动 GitHub 登录");
    } finally {
      setBusy(null);
    }
  }

  async function openProductPage() {
    try {
      await api.github.openProductPage();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法打开软件项目地址");
    }
  }

  async function saveSettings(next: { autoCheck: boolean; autoDownload: boolean }) {
    setBusy("settings");
    try {
      const value = await api.updates.setSettings(next);
      setStatus(value);
      onNotify(next.autoCheck ? "已开启客户端自动检查更新" : "已关闭客户端自动检查更新");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法保存更新设置");
    } finally {
      setBusy(null);
    }
  }

  async function saveRuntimeSettings(next: AppRuntimeSettings, message: string) {
    setBusy("settings");
    try {
      const saved = await api.runtime.setSettings(next);
      onRuntimeSettingsChange(saved);
      onNotify(message);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法保存后台运行设置");
    } finally {
      setBusy(null);
    }
  }

  async function checkNow() {
    setBusy("check");
    try {
      const next = await api.updates.check();
      setStatus(next);
      onNotify(next.message ?? "更新检查完成");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "检查更新失败");
    } finally {
      setBusy(null);
    }
  }

  async function downloadUpdate() {
    setBusy("download");
    try {
      const next = await api.updates.download();
      setStatus(next);
      onNotify(next.message ?? "更新下载完成");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "下载更新失败");
    } finally {
      setBusy(null);
    }
  }

  async function installUpdate() {
    setBusy("install");
    try {
      await api.updates.install();
      onNotify("已打开更新安装包，客户端即将退出");
    } catch (error) {
      setBusy(null);
      onNotify(error instanceof Error ? error.message : "无法安装更新");
    }
  }

  async function openReleasePage() {
    try {
      await api.updates.openRelease();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法打开 Release 页面");
    }
  }

  if (!status) return <div className="resource-loading"><RefreshCw size={19} className="spin" />正在读取客户端设置…</div>;
  const checking = busy === "check" || status.state === "checking";
  const downloading = busy === "download" || status.state === "downloading";
  const stateLabel = status.state === "upToDate" ? "已是最新版本"
    : status.state === "available" ? "发现新版本"
      : status.state === "downloading" ? "正在下载"
        : status.state === "downloaded" ? "更新已下载"
          : status.state === "unavailable" ? "自动更新不可用"
            : status.state === "error" ? "更新检查失败"
              : status.state === "checking" ? "正在检查"
                : "等待检查";

  return (
    <section className="app-settings-page">
      <header className="settings-page-heading"><span><Settings2 size={22} /></span><div><p className="eyebrow">客户端偏好</p><h1>设置</h1><p>更新设置只保存在这台电脑，不会写入任何 LaTeX 项目。</p></div></header>
      <section className="settings-card github-login-settings-card">
        <header><div><h2>GitHub 连接</h2><p>登录一次后，即可在导入项目时自动创建仓库和开启同步。</p></div><GitFork size={20} /></header>
        <div className={`github-settings-account ${account?.authenticated ? "account-ready" : "account-required"}`}>
          <span>{account?.authenticated ? <CheckCircle2 size={21} /> : <LogIn size={21} />}</span>
          <div><strong>{account?.authenticated ? `已登录：${account.login}` : account?.message ?? "正在检查 GitHub CLI…"}</strong><p>{account?.authenticated ? `${account.name ?? account.login} · 凭据由 GitHub CLI 安全管理` : "登录会打开 GitHub 官方网页，本软件不会保存密码或访问令牌。"}</p></div>
          <button className="button secondary" onClick={() => void refreshGitHubAccount()} disabled={busy !== null}><RefreshCw size={16} />刷新</button>
          {!account?.authenticated && <button className="button primary" onClick={() => void beginGitHubLogin()} disabled={busy !== null}>{busy === "github" ? <RefreshCw size={16} className="spin" /> : <LogIn size={16} />}{account?.cliAvailable === false ? "安装 GitHub CLI" : "登录 GitHub"}</button>}
        </div>
        <div className="product-repository-address"><GitFork size={17} /><div><strong>本软件项目地址</strong><code>github.com/Ararataki-number-one/latex-project-manager</code></div><button className="button ghost" onClick={() => void openProductPage()}><ExternalLink size={15} />打开</button></div>
      </section>
      <section className="settings-card runtime-settings-card">
        <header><div><h2>后台运行与同步</h2><p>关闭主窗口后仍可通过 Windows 托盘安全同步项目。</p></div><HardDrive size={20} /></header>
        <div className="settings-toggle-list">
          <label className="sync-toggle"><span><strong>关闭窗口后留在托盘</strong><small>默认开启；从托盘菜单可以重新打开或彻底退出</small></span><input type="checkbox" checked={runtimeSettings.closeToTray} disabled={busy !== null} onChange={(event) => void saveRuntimeSettings({ ...runtimeSettings, closeToTray: event.target.checked }, event.target.checked ? "关闭窗口后将继续在托盘运行" : "关闭窗口将退出客户端")} /></label>
          <label className="sync-toggle"><span><strong>暂停所有自动同步</strong><small>暂停后保留待同步变化，恢复时继续处理队列</small></span><input type="checkbox" checked={runtimeSettings.syncPaused} disabled={busy !== null} onChange={(event) => void saveRuntimeSettings({ ...runtimeSettings, syncPaused: event.target.checked }, event.target.checked ? "已暂停所有自动同步" : "已恢复自动同步")} /></label>
        </div>
        <div className="update-actions"><button className="button secondary" onClick={onOpenOnboarding}><BookOpenText size={16} />重新打开新手向导</button></div>
      </section>
      <section className="settings-card update-settings-card">
        <header><div><h2>客户端更新</h2><p>通过官方 GitHub Release 获取经过校验的 Windows 安装包。</p></div><Download size={20} /></header>
        <div className={`app-update-summary update-${status.state}`}>
          <span className="update-summary-icon">{checking || downloading ? <RefreshCw size={20} className="spin" /> : status.state === "downloaded" || status.state === "upToDate" ? <CheckCircle2 size={20} /> : <Download size={20} />}</span>
          <div><strong>{stateLabel}</strong><p>{status.message}</p></div>
          <div className="update-version"><span>当前版本</span><strong>{status.currentVersion}</strong>{status.latestVersion && status.latestVersion !== status.currentVersion && <small>最新 {status.latestVersion}</small>}</div>
        </div>
        <div className="settings-toggle-list">
          <label className="sync-toggle"><span><strong>自动检查更新</strong><small>启动客户端后自动检查最新正式版本</small></span><input type="checkbox" checked={status.autoCheck} disabled={busy !== null} onChange={(event) => void saveSettings({ autoCheck: event.target.checked, autoDownload: status.autoDownload })} /></label>
          <label className="sync-toggle"><span><strong>发现新版本后自动下载</strong><small>下载完成后由你确认安装，不会在工作中突然重启</small></span><input type="checkbox" checked={status.autoDownload} disabled={busy !== null || !status.autoCheck} onChange={(event) => void saveSettings({ autoCheck: status.autoCheck, autoDownload: event.target.checked })} /></label>
        </div>
        <div className="update-actions">
          <button className="button secondary" onClick={() => void checkNow()} disabled={busy !== null || !status.githubCliAvailable}>{checking ? <RefreshCw size={16} className="spin" /> : <RefreshCw size={16} />}立即检查</button>
          {status.state === "available" && <button className="button primary" onClick={() => void downloadUpdate()} disabled={busy !== null}>{downloading ? <RefreshCw size={16} className="spin" /> : <Download size={16} />}下载 {status.latestVersion}</button>}
          {status.state === "downloaded" && <button className="button primary" onClick={() => void installUpdate()} disabled={busy !== null}>{busy === "install" ? <RefreshCw size={16} className="spin" /> : <Check size={16} />}安装并退出客户端</button>}
          <button className="button ghost" onClick={() => void openReleasePage()}>打开 Release 页面</button>
        </div>
        <div className="private-update-note"><ShieldCheck size={17} /><div><strong>安全更新</strong><p>{status.githubCliAvailable ? "使用本机 GitHub CLI 获取 GitHub Release；客户端不会读取或保存你的访问令牌。" : "这台电脑未检测到 GitHub CLI，因此只能在浏览器中手动下载。"}</p></div></div>
        {isDemo && <p className="demo-note">浏览器演示模式不会访问 GitHub 或下载程序。</p>}
      </section>
    </section>
  );
}

export default function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selected, setSelected] = useState<ProjectSummary | null>(null);
  const [filter, setFilter] = useState<ExtendedLibraryFilter>("all");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(() => window.innerWidth > 780);
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [runtimeSettings, setRuntimeSettings] = useState<AppRuntimeSettings>({ closeToTray: true, onboardingCompleted: false, syncPaused: false });
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [showOnboardingHint, setShowOnboardingHint] = useState(false);
  const [openImportNonce, setOpenImportNonce] = useState(0);

  async function refreshProjects() {
    const items = await runtime.api.library.list();
    setProjects(items);
  }

  useEffect(() => {
    Promise.all([runtime.api.library.list(), runtime.api.runtime.settings()])
      .then(([items, settings]) => {
        setProjects(items);
        setRuntimeSettings(settings);
        if (!settings.onboardingCompleted) {
          if (items.length === 0) setOnboardingOpen(true);
          else setShowOnboardingHint(true);
        }
      })
      .catch((error) => setToast(error instanceof Error ? error.message : "无法读取客户端设置"))
      .finally(() => setLoading(false));
  }, []);

  async function completeOnboarding(openImport: boolean) {
    try {
      const saved = await runtime.api.runtime.setSettings({ ...runtimeSettings, onboardingCompleted: true });
      setRuntimeSettings(saved);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "无法保存新手向导状态");
    }
    setOnboardingOpen(false);
    setShowOnboardingHint(false);
    if (openImport) {
      setSelected(null);
      setSettingsOpen(false);
      setFilter("all");
      setOpenImportNonce((value) => value + 1);
    }
  }

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const tags = useMemo(() => Array.from(new Set(projects.filter((project) => !project.trashed).flatMap((project) => project.tags))).sort((a, b) => a.localeCompare(b, "zh-CN")), [projects]);
  const navItems: Array<{ id: ExtendedLibraryFilter; label: string; icon: typeof BookOpenText; count?: number }> = [
    { id: "all", label: "项目库", icon: BookOpenText, count: projects.filter((item) => !item.archived && !item.trashed).length },
    { id: "favorites", label: "收藏", icon: Heart, count: projects.filter((item) => item.favorite && !item.archived && !item.trashed).length },
    { id: "recent", label: "最近使用", icon: Clock3 },
    { id: "archived", label: "已归档", icon: Archive, count: projects.filter((item) => item.archived && !item.trashed).length },
    { id: "trashed", label: "回收站", icon: Trash2, count: projects.filter((item) => item.trashed).length }
  ];

  function goLibrary(nextFilter: ExtendedLibraryFilter = filter) {
    setFilter(nextFilter);
    setActiveTag(null);
    setSelected(null);
    setSettingsOpen(false);
    void refreshProjects().catch((error) => {
      setToast(error instanceof Error ? error.message : "无法刷新项目库");
    });
  }

  if (loading) {
    return <div className="app-loading"><div className="brand-mark">T<sub>E</sub>X</div><p>正在读取本地项目库…</p></div>;
  }

  return (
    <div className={`app-shell ${navOpen ? "nav-open" : "nav-closed"}`}>
      <aside className="app-sidebar" aria-label="应用侧栏">
        <div className="brand-row">
          <div className="brand-mark">T<sub>E</sub>X</div>
          <div className="brand-copy"><strong>LaTeX 管理器</strong><span>Project Manager</span></div>
          <IconButton label="收起侧栏" onClick={() => setNavOpen(false)}><PanelLeftClose size={17} /></IconButton>
        </div>
        <p className="sidebar-section-label">工作区</p>
        <nav className="main-nav" aria-label="资料库导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={!selected && !settingsOpen && filter === item.id ? "active" : ""} aria-current={!selected && !settingsOpen && filter === item.id ? "page" : undefined} onClick={() => goLibrary(item.id)} title={item.label}>
                <Icon size={18} /><span>{item.label}</span>{item.count !== undefined && <small>{item.count}</small>}
              </button>
            );
          })}
        </nav>
        <section className="sidebar-tags">
          <header><Tags size={15} /><strong>项目标签</strong></header>
          <nav aria-label="标签筛选">
            <button className={!selected && !settingsOpen && filter === "all" && activeTag === null ? "active" : ""} aria-label="显示全部标签" aria-pressed={!selected && !settingsOpen && filter === "all" && activeTag === null} onClick={() => goLibrary("all")}>
              <span className="tag-color all-tags" /><span>全部标签</span><small>{projects.filter((project) => !project.archived && !project.trashed).length}</small>
            </button>
            {tags.map((tag, index) => (
              <button
                className={!selected && !settingsOpen && activeTag === tag ? "active" : ""}
                aria-label={`筛选标签：${tag}`}
                aria-pressed={!selected && !settingsOpen && activeTag === tag}
                key={tag}
                onClick={() => { setActiveTag(tag); setFilter("all"); setSelected(null); }}
              >
                <span className="tag-color" style={{ backgroundColor: TAG_COLORS[index % TAG_COLORS.length] }} /><span>{tag}</span><small>{projects.filter((project) => !project.archived && !project.trashed && project.tags.includes(tag)).length}</small>
              </button>
            ))}
          </nav>
        </section>
        <div className="sidebar-spacer" />
        <nav className="sidebar-settings-nav" aria-label="应用导航"><button className={settingsOpen ? "active" : ""} aria-current={settingsOpen ? "page" : undefined} onClick={() => { setSelected(null); setSettingsOpen(true); }}><Settings2 size={18} /><span>设置</span></button></nav>
        <div className="toolchain-card">
          <span className="toolchain-indicator ready" />
          <div><strong>本地项目索引</strong><span>GitHub 为可选同步</span></div>
          <HardDrive size={16} />
        </div>
        {runtime.isDemo && <div className="demo-badge">浏览器演示 · 只读数据</div>}
      </aside>
      {navOpen && <button className="sidebar-scrim" aria-label="关闭侧栏" onClick={() => setNavOpen(false)} />}

      <main className="app-main">
        <div className="window-strip">
          {!navOpen && <IconButton label="打开侧栏" onClick={() => setNavOpen(true)}><Menu size={19} /></IconButton>}
          {!selected && <span className="window-title">{settingsOpen ? "设置" : "LaTeX 项目管理器"}</span>}
          {selected && <button className="breadcrumb-home" onClick={() => goLibrary()}><BookOpenText size={15} />项目库</button>}
          {selected && <><span className="breadcrumb-separator">/</span><span className="breadcrumb-current">{selected.name}</span></>}
          <span className="window-drag-space" />
          <span className="local-only"><ShieldCheck size={13} />本地模式</span>
        </div>
        {selected ? (
          <ProjectView api={runtime.api} project={selected} isDemo={runtime.isDemo} onBack={() => goLibrary()} onNotify={setToast} />
        ) : settingsOpen ? (
          <SettingsView api={runtime.api} isDemo={runtime.isDemo} onNotify={setToast} runtimeSettings={runtimeSettings} onRuntimeSettingsChange={setRuntimeSettings} onOpenOnboarding={() => setOnboardingOpen(true)} />
        ) : (
          <>
            {showOnboardingHint && <aside className="onboarding-hint" aria-label="v0.5 新手向导提示"><div><BookOpenText size={18} /><span><strong>v0.5 新手向导</strong><small>检查 Git、GitHub、VS Code，并完成第一个安全同步项目。</small></span></div><button className="button secondary" onClick={() => setOnboardingOpen(true)}>开始</button><IconButton label="不再提示" onClick={() => void completeOnboarding(false)}><X size={16} /></IconButton></aside>}
            <LibraryView api={runtime.api} projects={projects} filter={filter} activeTag={activeTag} onManage={(project) => { setSettingsOpen(false); setSelected(project); }} onProjectsChange={setProjects} onNotify={setToast} isDemo={runtime.isDemo} openImportNonce={openImportNonce} />
          </>
        )}
      </main>
      {onboardingOpen && <OnboardingWizard api={runtime.api} onComplete={(openImport) => void completeOnboarding(openImport)} onNotify={setToast} />}
      {toast && <div className="toast" role="status">{toast}<IconButton label="关闭通知" onClick={() => setToast(null)}><X size={15} /></IconButton></div>}
    </div>
  );
}
