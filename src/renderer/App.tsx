import { useEffect, useMemo, useRef, useState } from "react";
import appIcon from "../../assets/app-icon.png";
import {
  Archive,
  ArchiveRestore,
  Activity,
  AlertTriangle,
  BookCopy,
  BookOpenText,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Cloud,
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
  GitFork,
  Import,
  Library,
  Menu,
  MoreHorizontal,
  LogIn,
  PanelLeftClose,
  PauseCircle,
  PlayCircle,
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
import type { AppRuntimeSettings, AppUpdateStatus, CatalogProjectResearchItem, CatalogStatus, DesktopMigrationPreview, GitHubAccountStatus, GitHubRepositoryVisibility, GitHubSyncStatus, ProjectStatusRecord, ProjectSummary, ResearchRole, ResearchSearchHit, ScanCandidate, TemporaryCleanupPreview, VsCodeStatus } from "@/shared/types";
import { createWorkbench } from "./demo";
import { AppUpdateProgress } from "./AppUpdateProgress";
import { useProjectGitHubStatuses } from "./github-status-store";
import { OnboardingWizard, type OnboardingResult } from "./OnboardingWizard";
import { NeedsAttentionView } from "./NeedsAttentionView";
import { ProjectView } from "./ProjectView";
import { TemplateLibraryView } from "./TemplateLibraryView";
import { DesktopMigrationWizard } from "./DesktopMigrationWizard";
import { calculateVirtualRange, PROJECT_VIRTUALIZATION_THRESHOLD } from "./library-virtualization";

const runtime = createWorkbench();

type LibraryFilter = "all" | "favorites" | "recent" | "archived";
type ExtendedLibraryFilter = LibraryFilter | "trashed";
type LibraryScope =
  | { kind: "standard" }
  | { kind: "templates" }
  | { kind: "research" }
  | { kind: "attention" }
  | { kind: "organize" }
  | { kind: "issue"; issue: "path" | "sync" | "pdf"; label: string }
  | { kind: "collection"; id: string }
  | { kind: "smart"; id: string };

function IconButton({ label, children, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
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
  } else if (status?.configured && status.state === "changes") {
    label = "待同步";
    tone = "pending";
    icon = <Clock3 size={12} />;
  } else if (status?.configured && status.state === "synced") {
    label = "已同步";
    tone = "success";
    icon = <CheckCircle2 size={12} />;
  } else if (status?.configured && status.state === "ready") {
    label = "已连接";
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
  availableTags: string[];
  onFilterChange: (filter: ExtendedLibraryFilter) => void;
  onActiveTagChange: (tag: string | null) => void;
  onManage: (project: ProjectSummary) => void;
  onProjectsChange: React.Dispatch<React.SetStateAction<ProjectSummary[]>>;
  onNotify: (message: string) => void;
  isDemo: boolean;
  openImportNonce: number;
  scopeTitle?: string;
  scopeDescription?: string;
  scopedProjectIds?: string[];
  issueFilterOverride?: "all" | "path" | "sync" | "pdf";
}

function ProjectCachedSyncBadge({ record }: { record?: ProjectStatusRecord }) {
  const state = record?.snapshot.syncState;
  const configured = Boolean(state && state !== "notConfigured");
  return <ProjectSyncBadge status={state ? {
    projectId: record!.snapshot.projectId,
    available: state !== "unavailable",
    configured,
    repository: configured,
    remoteUrl: "",
    autoSync: configured,
    useLfsForDocuments: false,
    lfsAvailable: false,
    state,
    changedFiles: [],
    largeFiles: [],
    ahead: 0,
    behind: 0,
    identity: { name: "", email: "", configured: false, source: "none" },
    message: record?.snapshot.syncMessage ?? (record?.freshness === "stale" ? "状态可能已过期" : undefined)
  } as GitHubSyncStatus : undefined} />;
}

const RESEARCH_ROLE_LABELS: Record<ResearchRole, string> = {
  primarySource: "主要原稿",
  reference: "普通参考",
  translationSource: "翻译原稿",
  data: "数据",
  supplement: "补充材料"
};

type ResearchLibraryFilter = "all" | "pending" | "localOnly" | ResearchRole;

function GlobalResearchLibrary({
  api,
  projects,
  onOpenProject,
  onNotify
}: {
  api: WorkbenchApi;
  projects: ProjectSummary[];
  onOpenProject: (project: ProjectSummary) => void;
  onNotify: (message: string) => void;
}) {
  const [entries, setEntries] = useState<CatalogProjectResearchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ResearchLibraryFilter>("all");
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const projectsById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.research.listGlobal()
      .then((next) => {
        if (cancelled) return;
        setEntries(next);
        setSelectedWorkId((current) => current && next.some((entry) => entry.workId === current) ? current : (next[0]?.workId ?? null));
      })
      .catch((error: unknown) => !cancelled && onNotify(error instanceof Error ? error.message : "无法读取研究资料库"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [api, onNotify]);

  const groups = useMemo(() => {
    const grouped = new Map<string, CatalogProjectResearchItem[]>();
    for (const entry of entries) grouped.set(entry.workId, [...(grouped.get(entry.workId) ?? []), entry]);
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return Array.from(grouped.entries()).map(([workId, workEntries]) => ({
      workId,
      entries: workEntries,
      item: workEntries[0].item
    })).filter((group) => {
      const allAttachments = group.entries.flatMap((entry) => entry.item.attachments);
      const allLinks = group.entries.flatMap((entry) => entry.item.links);
      if (filter === "pending" && !group.entries.some((entry) => entry.item.links.length === 0)) return false;
      if (filter === "localOnly" && !allAttachments.some((attachment) => attachment.availability === "localOnly")) return false;
      if (filter !== "all" && filter !== "pending" && filter !== "localOnly" && !allLinks.some((link) => link.role === filter)) return false;
      if (!normalizedQuery) return true;
      const searchText = group.entries.flatMap((entry) => {
        const item = entry.item;
        return [item.title, ...item.authors, item.year, item.doi, item.arxivId, item.isbn,
          ...item.attachments.map((attachment) => attachment.name), projectsById.get(entry.projectId)?.name];
      }).filter(Boolean).join(" ").toLocaleLowerCase();
      return searchText.includes(normalizedQuery);
    }).sort((left, right) => {
      const leftTitle = left.item.title || left.item.attachments[0]?.name || left.workId;
      const rightTitle = right.item.title || right.item.attachments[0]?.name || right.workId;
      return leftTitle.localeCompare(rightTitle, "zh-CN");
    });
  }, [entries, filter, projectsById, query]);
  const selected = groups.find((group) => group.workId === selectedWorkId) ?? groups[0];
  const filterItems: Array<{ id: ResearchLibraryFilter; label: string; count: number }> = [
    { id: "all", label: "全部资料", count: new Set(entries.map((entry) => entry.workId)).size },
    { id: "pending", label: "待关联", count: new Set(entries.filter((entry) => entry.item.links.length === 0).map((entry) => entry.workId)).size },
    { id: "localOnly", label: "仅本机", count: new Set(entries.filter((entry) => entry.item.attachments.some((attachment) => attachment.availability === "localOnly")).map((entry) => entry.workId)).size },
    ...Object.entries(RESEARCH_ROLE_LABELS).map(([id, label]) => ({
      id: id as ResearchRole,
      label,
      count: new Set(entries.filter((entry) => entry.item.links.some((link) => link.role === id)).map((entry) => entry.workId)).size
    }))
  ];

  return (
    <section className="global-research-page" aria-label="研究资料库">
      <header className="page-heading global-research-heading">
        <div><span className="page-heading-icon"><Library size={22} /></span><div><h1>研究资料</h1><p>在一个视图中查看论文、书籍、数据与它们关联的 LaTeX 项目。</p></div></div>
        <label className="global-research-search"><Search size={17} /><input aria-label="搜索研究资料" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、作者、DOI、附件或项目" />{query && <IconButton label="清除搜索" onClick={() => setQuery("")}><X size={15} /></IconButton>}</label>
      </header>
      <div className="global-research-layout">
        <nav className="global-research-filters" aria-label="研究资料筛选">
          <strong>资料视图</strong>
          {filterItems.map((item) => <button key={item.id} className={filter === item.id ? "active" : ""} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}><span>{item.label}</span><small>{item.count}</small></button>)}
        </nav>
        <div className="global-research-list" role="listbox" aria-label="研究资料列表">
          {loading ? <div className="research-library-empty"><RefreshCw className="spin" size={22} /><p>正在整理本机资料索引…</p></div> : groups.length === 0 ? <div className="research-library-empty"><Library size={28} /><h2>{entries.length ? "没有符合条件的资料" : "还没有研究资料"}</h2><p>{entries.length ? "尝试清除搜索或切换资料视图。" : "进入任一项目的“研究资料”页，从 references 文件夹建立资料记录。"}</p></div> : groups.map((group) => {
            const item = group.item;
            const title = item.title || item.attachments[0]?.name || "未命名资料";
            const projectCount = new Set(group.entries.map((entry) => entry.projectId)).size;
            const attachments = group.entries.flatMap((entry) => entry.item.attachments);
            const localOnly = attachments.some((attachment) => attachment.availability === "localOnly");
            return <button key={group.workId} type="button" role="option" aria-selected={selected?.workId === group.workId} className={`global-research-row ${selected?.workId === group.workId ? "selected" : ""}`} onClick={() => setSelectedWorkId(group.workId)}><span className="research-type-icon"><BookOpenText size={19} /></span><span className="global-research-copy"><strong>{title}</strong><small>{[item.authors.slice(0, 3).join("、"), item.year, `${projectCount} 个项目`].filter(Boolean).join(" · ")}</small></span><span className={localOnly ? "research-availability local" : "research-availability repository"}>{localOnly ? "含仅本机附件" : "手机可用"}</span><ChevronRight size={16} /></button>;
          })}
        </div>
        <aside className="global-research-inspector" aria-label="资料检查器">
          {selected ? <>
            <span className="inspector-eyebrow">资料检查器</span>
            <h2>{selected.item.title || selected.item.attachments[0]?.name || "未命名资料"}</h2>
            <p>{selected.item.authors.length ? selected.item.authors.join("、") : "尚未填写作者"}</p>
            <dl>
              <div><dt>年份</dt><dd>{selected.item.year ?? "—"}</dd></div>
              <div><dt>DOI / arXiv</dt><dd>{selected.item.doi || selected.item.arxivId || "—"}</dd></div>
              <div><dt>附件</dt><dd>{selected.entries.reduce((sum, entry) => sum + entry.item.attachments.length, 0)}</dd></div>
              <div><dt>使用项目</dt><dd>{new Set(selected.entries.map((entry) => entry.projectId)).size}</dd></div>
            </dl>
            <div className="research-project-links">
              <strong>关联项目</strong>
              {selected.entries.map((entry) => {
                const project = projectsById.get(entry.projectId);
                if (!project) return null;
                const roles = Array.from(new Set(entry.item.links.map((link) => RESEARCH_ROLE_LABELS[link.role])));
                return <button key={`${entry.projectId}:${entry.item.id}`} onClick={() => onOpenProject(project)}><span><strong>{project.name}</strong><small>{roles.length ? roles.join("、") : "待关联"}</small></span><ChevronRight size={15} /></button>;
              })}
            </div>
          </> : <div className="research-library-empty"><Library size={24} /><p>选择一份资料查看关联项目和附件状态。</p></div>}
        </aside>
      </div>
    </section>
  );
}

function LibraryView({ api, projects, filter, activeTag, availableTags, onFilterChange, onActiveTagChange, onManage, onProjectsChange, onNotify, isDemo, openImportNonce, scopeTitle, scopeDescription, scopedProjectIds, issueFilterOverride }: LibraryViewProps) {
  const [query, setQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [candidates, setCandidates] = useState<ScanCandidate[]>([]);
  const [scanning, setScanning] = useState(false);
  const [menuProjectId, setMenuProjectId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number; maxHeight: number } | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [copyProject, setCopyProject] = useState<ProjectSummary | null>(null);
  const [copyName, setCopyName] = useState("");
  const [copying, setCopying] = useState(false);
  const [projectStatus, setProjectStatus] = useState<Record<string, ProjectStatusRecord>>({});
  const [cleanupProject, setCleanupProject] = useState<ProjectSummary | null>(null);
  const [cleanupPreview, setCleanupPreview] = useState<TemporaryCleanupPreview | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [syncOnImport, setSyncOnImport] = useState(false);
  const [importVisibility, setImportVisibility] = useState<GitHubRepositoryVisibility>("private");
  const [importingPath, setImportingPath] = useState<string | null>(null);
  const [selectedImportPaths, setSelectedImportPaths] = useState<string[]>([]);
  const [focusedProjectId, setFocusedProjectId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<"recent" | "name" | "size" | "sync">("recent");
  const [issueFilter, setIssueFilter] = useState<"all" | "path" | "sync" | "pdf">("all");
  const [libraryDensity, setLibraryDensity] = useState<"comfortable" | "compact">("comfortable");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listViewportRef = useRef<HTMLDivElement>(null);
  const libraryFiltersRef = useRef<HTMLDetailsElement>(null);
  const [listScrollTop, setListScrollTop] = useState(0);
  const [listViewportHeight, setListViewportHeight] = useState(650);
  const statusSnapshots = useMemo(() => Object.fromEntries(
    Object.entries(projectStatus).map(([projectId, record]) => [projectId, record.snapshot])
  ), [projectStatus]);

  useEffect(() => {
    let cancelled = false;
    void api.projectStatus.list().then((records) => {
      if (!cancelled) setProjectStatus(Object.fromEntries(records.map((record) => [record.snapshot.projectId, record])));
    }).catch(() => undefined);
    const unsubscribe = api.projectStatus.onEvent((event) => {
      if (!cancelled) setProjectStatus((current) => ({ ...current, [event.projectId]: event.record }));
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [api]);

  useEffect(() => {
    if (!focusedProjectId || isDemo) return;
    void api.projectStatus.refresh(focusedProjectId).catch(() => undefined);
  }, [api, focusedProjectId, isDemo]);

  useEffect(() => {
    if (issueFilterOverride) setIssueFilter(issueFilterOverride);
  }, [issueFilterOverride]);

  useEffect(() => {
    if (openImportNonce > 0) setImportOpen(true);
  }, [openImportNonce]);

  useEffect(() => {
    if (importOpen) return;
    setCandidates([]);
    setSelectedImportPaths([]);
    setSyncOnImport(false);
    setImportVisibility("private");
  }, [importOpen]);

  useEffect(() => {
    if (!menuProjectId) return;
    const closeOnPointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest(".project-menu, .project-menu-backdrop, [data-project-menu-trigger]")) closeProjectMenu(false);
    };
    const handleMenuKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeProjectMenu(true);
        return;
      }
      if (event.key === "Tab") {
        const menu = document.getElementById(`project-menu-${menuProjectId}`);
        const focusable = Array.from(menu?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') ?? []);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !menu?.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const closeOnResize = () => closeProjectMenu(false);
    document.addEventListener("mousedown", closeOnPointerDown);
    document.addEventListener("keydown", handleMenuKeyboard);
    window.addEventListener("resize", closeOnResize);
    return () => {
      document.removeEventListener("mousedown", closeOnPointerDown);
      document.removeEventListener("keydown", handleMenuKeyboard);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [menuProjectId]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const filtered = projects
      .filter((project) => {
        if (filter === "trashed") {
          if (!project.trashed) return false;
        } else {
          if (project.trashed) return false;
          if (filter === "favorites" && (!project.favorite || project.archived)) return false;
          if (filter === "archived" && !project.archived) return false;
          if (filter !== "archived" && project.archived) return false;
        }
        if (scopedProjectIds && !scopedProjectIds.includes(project.id)) return false;
        if (activeTag && !project.tags.includes(activeTag)) return false;
        if (normalized && ![project.name, project.rootPath, ...project.classNames, ...project.tags].join(" ").toLocaleLowerCase().includes(normalized)) return false;
        if (issueFilter === "path" && project.pathAvailable) return false;
        if (issueFilter === "pdf" && Boolean(statusSnapshots[project.id]?.mainPdfPath)) return false;
        if (issueFilter === "sync") {
          const state = statusSnapshots[project.id]?.syncState;
          if (!state || !new Set(["blocked", "error", "needsPull", "unavailable", "changes", "retrying"]).has(state)) return false;
        }
        return true;
      });
    return filtered.sort((a, b) => {
      if (sortMode === "name") return a.name.localeCompare(b.name, "zh-CN");
      if (sortMode === "size") return (statusSnapshots[b.id]?.storageBytes ?? -1) - (statusSnapshots[a.id]?.storageBytes ?? -1) || a.name.localeCompare(b.name, "zh-CN");
      if (sortMode === "sync") {
        const rank = (project: ProjectSummary) => {
          const state = statusSnapshots[project.id]?.syncState;
          if (state === "blocked" || state === "error" || state === "needsPull" || state === "unavailable") return 0;
          if (state === "changes" || state === "retrying") return 1;
          if (state === "syncing" || state === "queued") return 2;
          if (state && state !== "notConfigured") return 3;
          return 4;
        };
        return rank(a) - rank(b) || a.name.localeCompare(b.name, "zh-CN");
      }
      return (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? "") || a.name.localeCompare(b.name, "zh-CN");
    });
  }, [projects, filter, query, activeTag, issueFilter, sortMode, statusSnapshots, scopedProjectIds]);

  const focusedProject = visible.find((project) => project.id === focusedProjectId) ?? null;
  const isProjectListVirtualized = visible.length >= PROJECT_VIRTUALIZATION_THRESHOLD;
  const virtualRowHeight = libraryDensity === "compact" ? 66 : 82;
  const virtualRange = useMemo(() => calculateVirtualRange({
    itemCount: visible.length,
    rowHeight: virtualRowHeight,
    scrollTop: listScrollTop,
    viewportHeight: listViewportHeight
  }), [visible.length, virtualRowHeight, listScrollTop, listViewportHeight]);
  const renderedProjects = useMemo(() => {
    const startIndex = isProjectListVirtualized ? virtualRange.startIndex : 0;
    const endIndex = isProjectListVirtualized ? virtualRange.endIndex : visible.length;
    return visible.slice(startIndex, endIndex).map((project, offset) => ({ project, index: startIndex + offset }));
  }, [isProjectListVirtualized, virtualRange.startIndex, virtualRange.endIndex, visible]);

  useEffect(() => {
    if (!isProjectListVirtualized) return;
    const viewport = listViewportRef.current;
    if (!viewport) return;
    const updateHeight = () => setListViewportHeight(viewport.clientHeight || 650);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [isProjectListVirtualized]);

  useEffect(() => {
    setListScrollTop(0);
    if (listViewportRef.current) listViewportRef.current.scrollTop = 0;
  }, [query, filter, activeTag, issueFilter, sortMode, libraryDensity, scopedProjectIds]);

  useEffect(() => {
    const handleLibraryShortcuts = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== "f") return;
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener("keydown", handleLibraryShortcuts);
    return () => window.removeEventListener("keydown", handleLibraryShortcuts);
  }, []);

  useEffect(() => {
    setSelectedProjectIds((current) => {
      const next = current.filter((id) => visible.some((project) => project.id === id));
      return next.length === current.length ? current : next;
    });
    setFocusedProjectId((current) => current && visible.some((project) => project.id === current) ? current : null);
  }, [visible]);

  async function toggleFavorite(project: ProjectSummary) {
    const favorite = !project.favorite;
    await updateProject(project, { favorite });
  }

  async function updateProject(project: ProjectSummary, patch: Partial<Pick<ProjectSummary, "name" | "favorite" | "archived" | "trashed" | "tags" | "lifecycle" | "protectionState">>) {
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
    const patch = archived
      ? { archived: true, lifecycle: "archived" as const }
      : { archived: false, lifecycle: "active" as const };
    if (await updateProject(project, patch)) onNotify(archived ? `已归档「${project.name}」` : `已将「${project.name}」移出归档`);
  }

  async function moveToTrash(project: ProjectSummary) {
    if (await updateProject(project, { trashed: true })) onNotify(`已从项目库移除「${project.name}」；磁盘文件没有删除`);
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
      const editor = await api.editor.status();
      if (!editor.available) {
        onNotify(editor.diagnostics?.[0] ?? "未检测到 VS Code 或 VSCodium；安装后请重启客户端");
        return;
      }
      await api.editor.openProject(project.id);
      onProjectsChange((current) => current.map((item) => item.id === project.id ? { ...item, lastOpenedAt: new Date().toISOString() } : item));
      onNotify(editor.latexWorkshop.state === "notFound"
        ? `已在 VS Code 中打开 ${project.name}；未检测到 LaTeX Workshop`
        : `已在 VS Code 中打开 ${project.name}`);
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

  async function updateSelected(patch: Partial<Pick<ProjectSummary, "archived" | "trashed" | "lifecycle">>) {
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
    const action = patch.trashed === false ? "恢复" : patch.trashed ? "从项目库移除" : "归档";
    onNotify(failedIds.length ? `已${action} ${successCount} 个项目，${failedIds.length} 个项目更新失败` : `已${action} ${successCount} 个项目${patch.trashed ? "；磁盘文件未删除" : ""}`);
  }

  function openProjectMenu(
    project: ProjectSummary,
    anchor: HTMLElement,
    options?: { forceOpen?: boolean; clientX?: number; clientY?: number }
  ) {
    const nextId = options?.forceOpen ? project.id : menuProjectId === project.id ? null : project.id;
    setMenuProjectId(nextId);
    setTagDraft(nextId ? project.tags.join(", ") : "");
    if (nextId) {
      if (window.innerWidth > 760) {
        const rect = anchor.getBoundingClientRect();
        const maxHeight = Math.min(620, window.innerHeight - 24);
        const menuRightEdge = Math.max(272, Math.min(options?.clientX ?? rect.right, window.innerWidth - 12));
        setMenuPosition({
          top: Math.max(12, Math.min(options?.clientY ?? rect.bottom + 8, window.innerHeight - maxHeight - 12)),
          right: Math.max(12, window.innerWidth - menuRightEdge),
          maxHeight
        });
      } else {
        setMenuPosition(null);
      }
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`#project-menu-${project.id} .project-menu-close`)?.focus());
    } else {
      setMenuPosition(null);
    }
  }

  function closeProjectMenu(restoreFocus: boolean) {
    const projectId = menuProjectId;
    setMenuProjectId(null);
    setMenuPosition(null);
    if (restoreFocus && projectId) {
      requestAnimationFrame(() => document.getElementById(`project-menu-trigger-${projectId}`)?.focus());
    }
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
      const scanned = await api.library.scan(root, { maxDepth: 3 });
      setCandidates(scanned);
      const knownRoots = new Set(projects.map((project) => project.rootPath.toLocaleLowerCase()));
      const importable = scanned.filter((candidate) => !knownRoots.has(candidate.rootPath.toLocaleLowerCase()));
      setSelectedImportPaths(importable.length === 1 ? [importable[0].rootPath] : []);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "扫描失败");
    } finally {
      setScanning(false);
    }
  }

  async function importSelectedCandidates() {
    const selectedCandidates = candidates.filter((candidate) => selectedImportPaths.includes(candidate.rootPath));
    if (!selectedCandidates.length) return;
    const importedItems: ProjectSummary[] = [];
    const failures: string[] = [];
    for (const candidate of selectedCandidates) {
      setImportingPath(candidate.rootPath);
      try {
        const imported = await api.library.import(candidate);
        importedItems.push(imported);
        onProjectsChange((current) => [...current.filter((item) => item.id !== imported.id), imported]);
        if (syncOnImport) {
          try {
            await api.github.createRepository(imported.id, {
              repositoryName: suggestedGitHubRepositoryName(imported.name, imported.id),
              visibility: importVisibility,
              autoSync: true,
              useLfsForDocuments: true
            });
          } catch (error) {
            failures.push(`${candidate.name}：项目已导入，但 GitHub 建仓失败（${error instanceof Error ? error.message : "未知错误"}）`);
          }
        }
      } catch (error) {
        failures.push(`${candidate.name}：${error instanceof Error ? error.message : "导入失败"}`);
      }
    }
    setImportingPath(null);
    setSelectedImportPaths([]);
    if (!failures.length) {
      setImportOpen(false);
      onNotify(`已导入 ${importedItems.length} 个项目${syncOnImport ? "并创建同步仓库" : ""}`);
      return;
    }
    setCandidates((current) => current.filter((candidate) => !importedItems.some((project) => project.rootPath.toLocaleLowerCase() === candidate.rootPath.toLocaleLowerCase())));
    onNotify(`已导入 ${importedItems.length} 个项目，${failures.length} 项需要处理：${failures.slice(0, 2).join("；")}`);
  }

  async function saveAsTemplate(project: ProjectSummary) {
    if (isDemo) {
      onNotify("浏览器演示模式不会写入模板库");
      return;
    }
    try {
      const template = await api.templates.createFromProject(project.id, { name: project.name, description: `由项目“${project.name}”保存的个人模板。`, category: "other" });
      onNotify(`已将「${project.name}」保存为模板「${template.name}」`);
      setMenuProjectId(null);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "保存模板失败");
    }
  }

  return (
    <section className="library-page" data-testid="project-library">
      <header className="page-header">
        <div className="page-heading">
          <span className="page-heading-icon" aria-hidden="true"><FolderKanban size={23} /></span>
          <div>
            <h1>{scopeTitle ?? (filter === "favorites" ? "收藏项目" : filter === "recent" ? "最近使用" : filter === "archived" ? "已归档" : filter === "trashed" ? "已移除项目" : activeTag ? `标签：${activeTag}` : "项目库")}</h1>
            <p className="muted">{scopeDescription ?? `${visible.length} 个项目 · 本地为主 · ${Object.values(statusSnapshots).filter((status) => status.syncState && status.syncState !== "notConfigured").length} 项已连接 GitHub`}</p>
          </div>
        </div>
        <div className="header-actions">
          <button className="button secondary" onClick={() => setImportOpen(true)}><Import size={17} />导入项目</button>
        </div>
      </header>

      {!scopeTitle && <nav className="desktop-v1-library-segments" aria-label="项目库视图">
        {([
          ["all", "全部项目"],
          ["recent", "最近使用"],
          ["favorites", "收藏项目"]
        ] as const).map(([id, label]) => <button key={id} className={filter === id && !activeTag ? "active" : ""} aria-current={filter === id && !activeTag ? "page" : undefined} onClick={() => { onActiveTagChange(null); onFilterChange(id); }}>{label}</button>)}
      </nav>}

      <div className="library-toolbar">
        <label className="search-field">
          <Search size={17} />
          <input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、路径、标签或文档类" aria-label="搜索项目" />
          {query && <IconButton label="清除搜索" onClick={() => setQuery("")}><X size={15} /></IconButton>}
        </label>
        <div className="library-view-options" aria-label="项目列表视图选项">
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as typeof sortMode)} aria-label="项目排序">
            <option value="recent">最近使用</option><option value="name">名称</option><option value="size">大小</option><option value="sync">同步状态</option>
          </select>
          <select value={issueFilter} onChange={(event) => setIssueFilter(event.target.value as typeof issueFilter)} aria-label="项目问题筛选">
            <option value="all">全部状态</option><option value="sync">同步需处理</option><option value="path">路径失效</option><option value="pdf">缺少主 PDF</option>
          </select>
          <button className="icon-button" aria-label={libraryDensity === "compact" ? "使用舒适密度" : "使用紧凑密度"} title={libraryDensity === "compact" ? "舒适密度" : "紧凑密度"} onClick={() => setLibraryDensity((value) => value === "compact" ? "comfortable" : "compact")}><Settings2 size={17} /></button>
          <details ref={libraryFiltersRef} className="desktop-v1-library-filter-menu">
            <summary className="icon-button" role="button" aria-label="更多项目筛选" title="更多项目筛选"><MoreHorizontal size={17} /></summary>
            <div className="desktop-v1-library-filter-popover">
              <strong>其他视图</strong>
              <button className={filter === "archived" ? "active" : ""} onClick={() => { libraryFiltersRef.current?.removeAttribute("open"); onActiveTagChange(null); onFilterChange("archived"); }}>已归档</button>
              <button className={filter === "trashed" ? "active danger-text" : "danger-text"} onClick={() => { libraryFiltersRef.current?.removeAttribute("open"); onActiveTagChange(null); onFilterChange("trashed"); }}>已移除</button>
              {availableTags.length > 0 && <><strong>按标签</strong><nav aria-label="标签筛选"><button aria-label="显示全部标签" className={!activeTag ? "active" : ""} onClick={() => { libraryFiltersRef.current?.removeAttribute("open"); onActiveTagChange(null); onFilterChange("all"); }}>全部标签</button>{availableTags.map((tag) => <button key={tag} aria-label={`筛选标签：${tag}`} className={activeTag === tag ? "active" : ""} onClick={() => { libraryFiltersRef.current?.removeAttribute("open"); onFilterChange("all"); onActiveTagChange(tag); }}>{tag}</button>)}</nav></>}
            </div>
          </details>
        </div>
        {selectedProjectIds.length > 0 && (
          <div className="bulk-actions" role="toolbar" aria-label="批量项目操作">
            <strong>已选 {selectedProjectIds.length} 项</strong>
            {filter === "trashed"
              ? <button className="button secondary" onClick={() => void updateSelected({ trashed: false })}><ArchiveRestore size={15} />恢复</button>
              : <><button className="button secondary" onClick={() => void updateSelected({ archived: true, lifecycle: "archived" })}><Archive size={15} />归档</button><button className="button secondary danger-text" onClick={() => void updateSelected({ trashed: true })}><Trash2 size={15} />从项目库移除</button></>}
          </div>
        )}
      </div>

      {visible.length ? (
        <div className={`library-list-layout ${focusedProject ? "with-inspector" : ""}`}>
        <div
          className={`project-table density-${libraryDensity} ${isProjectListVirtualized ? "is-virtualized" : ""}`}
          role="table"
          aria-label="项目列表"
          aria-rowcount={visible.length + 1}
          data-testid="project-list"
          data-virtualized={isProjectListVirtualized ? "true" : "false"}
        >
          <div className="project-table-head" role="row" aria-rowindex={1}>
            <span role="columnheader" className="project-check-cell">
              <input
                type="checkbox"
                aria-label="选择当前页面所有项目"
                checked={visible.length > 0 && visible.every((project) => selectedProjectIds.includes(project.id))}
                onChange={(event) => setSelectedProjectIds(event.target.checked ? visible.map((project) => project.id) : [])}
              />
            </span>
            <span role="columnheader">标题</span>
            <span role="columnheader">同步</span>
            <span role="columnheader">最近使用</span>
            <span role="columnheader" className="project-actions-heading">操作</span>
          </div>
          <div
            ref={listViewportRef}
            className="project-table-body"
            role="rowgroup"
            onScroll={(event) => {
              if (!isProjectListVirtualized) return;
              setListScrollTop(event.currentTarget.scrollTop);
              if (menuProjectId) setMenuProjectId(null);
            }}
          >
          {isProjectListVirtualized && virtualRange.offsetTop > 0 && <div className="project-row-spacer" role="presentation" aria-hidden="true" style={{ height: virtualRange.offsetTop }} />}
          {renderedProjects.map(({ project, index }) => (
            <article
              className={`project-row ${!project.pathAvailable ? "path-missing" : ""} ${focusedProjectId === project.id ? "selected" : ""}`}
              key={project.id}
              data-testid={`project-row-${project.id}`}
              role="row"
              aria-rowindex={index + 2}
              tabIndex={filter === "trashed" ? -1 : 0}
              aria-label={filter === "trashed" ? `${project.name}，请先恢复项目` : `${project.name}，单击选择，Enter 查看详情，Ctrl+Enter 或双击打开文件夹`}
              aria-selected={focusedProjectId === project.id}
              onClick={() => setFocusedProjectId(project.id)}
              onDoubleClick={() => { if (filter !== "trashed") void openProjectFolder(project); }}
              onContextMenu={(event) => {
                if (filter === "trashed") return;
                event.preventDefault();
                event.stopPropagation();
                setFocusedProjectId(project.id);
                openProjectMenu(project, event.currentTarget, {
                  forceOpen: true,
                  clientX: event.clientX,
                  clientY: event.clientY
                });
              }}
              onKeyDown={(event) => {
                if (filter !== "trashed" && event.key === "Enter" && event.target === event.currentTarget) {
                  event.preventDefault();
                  if (event.ctrlKey || event.metaKey) void openProjectFolder(project);
                  else onManage(project);
                }
                if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "a" && event.target === event.currentTarget) {
                  event.preventDefault();
                  setSelectedProjectIds(visible.map((item) => item.id));
                }
                if (event.key === " " && event.target === event.currentTarget) { event.preventDefault(); setFocusedProjectId(project.id); }
              }}
            >
              <span role="cell" className="project-check-cell" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                <input type="checkbox" checked={selectedProjectIds.includes(project.id)} onChange={() => toggleSelected(project.id)} aria-label={`选择项目 ${project.name}`} />
              </span>
              <div role="cell" className="project-main">
                <span className="project-folder-icon" aria-hidden="true"><FolderKanban size={19} /></span>
                <div className="project-copy">
                  <div className="project-title-line">
                    <button className="project-title-button" onClick={(event) => { event.stopPropagation(); setFocusedProjectId(project.id); }}>{project.name}</button>
                    {project.favorite && <Star className="project-favorite-mark" size={14} fill="currentColor" aria-label="已收藏" />}
                    {!project.pathAvailable && <span className="badge danger">路径不可用</span>}
                  </div>
                  <p className="project-path" title={project.rootPath}>{project.rootPath}</p>
                  <p className="project-inline-meta"><span>{project.targetCount} 个入口</span><span>{project.classNames.join(" · ") || "未识别文档类"}</span><span>{statusSnapshots[project.id]?.storageBytes !== undefined ? `${formatBytes(statusSnapshots[project.id]!.storageBytes!)} · ${statusSnapshots[project.id]?.fileCount ?? 0} 个文件` : "尚未刷新大小"}</span>{(isDemo ? ["success", "warning"].includes(project.lastBuildStatus ?? "") : Boolean(statusSnapshots[project.id]?.mainPdfPath)) && <span className="pdf-ready-label">主 PDF 可用</span>}</p>
                  <div className="tag-row">
                    {project.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
                  </div>
                </div>
              </div>
              <div role="cell" className="project-sync-cell"><ProjectCachedSyncBadge record={projectStatus[project.id]} /></div>
              <div role="cell" className="project-time"><Clock3 size={14} /><span>{relativeTime(project.lastOpenedAt)}</span></div>
              <div role="cell" className="project-actions" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                {filter === "trashed" ? (
                  <>
                    <IconButton label={`恢复项目 ${project.name}`} onClick={() => void restoreProject(project)}><ArchiveRestore size={18} /></IconButton>
                  </>
                ) : (
                  <>
                    <button className="button secondary project-manage-button" aria-label={`管理项目 ${project.name}`} onClick={() => onManage(project)} disabled={!project.pathAvailable}>项目详情</button>
                    <IconButton
                      id={`project-menu-trigger-${project.id}`}
                      label={`更多操作 ${project.name}`}
                      aria-expanded={menuProjectId === project.id}
                      aria-haspopup="dialog"
                      aria-controls={`project-menu-${project.id}`}
                      data-project-menu-trigger
                      onClick={(event) => openProjectMenu(project, event.currentTarget)}
                    ><MoreHorizontal size={18} /></IconButton>
                  </>
                )}
              </div>
              {menuProjectId === project.id && (
                <>
                  <button className="project-menu-backdrop" aria-hidden="true" tabIndex={-1} onClick={() => closeProjectMenu(true)} />
                  <div id={`project-menu-${project.id}`} className="project-menu" role="dialog" aria-label={`项目操作 ${project.name}`} style={menuPosition ?? undefined} onClick={(event) => event.stopPropagation()}>
                    <header className="project-menu-header">
                      <div><small>项目操作</small><strong id={`project-menu-title-${project.id}`} title={project.name}>{project.name}</strong></div>
                      <IconButton className="project-menu-close" label={`关闭项目操作 ${project.name}`} onClick={() => closeProjectMenu(true)}><X size={17} /></IconButton>
                    </header>
                    <div className="project-menu-tag-editor">
                      <label><span><Tags size={14} />标签</span><input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveTags(project)} placeholder="用逗号分隔" /></label>
                      <button aria-label={`保存标签 ${project.name}`} onClick={() => saveTags(project)}><Check size={15} />保存</button>
                    </div>
                    <div className="project-menu-section">
                      <p>打开</p>
                      <button aria-label={`打开项目文件夹 ${project.name}`} onClick={() => { setMenuProjectId(null); void openProjectFolder(project); }} disabled={!project.pathAvailable}><FolderOpen size={15} />打开项目文件夹</button>
                      <button aria-label={`在 VS Code 中打开 ${project.name}`} onClick={() => { setMenuProjectId(null); void openProjectInVsCode(project); }} disabled={!project.pathAvailable}><Code2 size={15} />在 VS Code 中打开</button>
                      <button aria-label={`打开最新 PDF ${project.name}`} onClick={() => { setMenuProjectId(null); void openLatestPdf(project); }} disabled={!project.pathAvailable || (!isDemo && !statusSnapshots[project.id]?.mainPdfPath)}><FileDown size={15} />打开最新 PDF</button>
                    </div>
                    <div className="project-menu-section">
                      <p>导出与维护</p>
                      <button aria-label={`复制项目 ${project.name}`} onClick={() => beginCopy(project)} disabled={!project.pathAvailable}><Copy size={15} />复制项目</button>
                      <button aria-label={`导出 ZIP ${project.name}`} onClick={() => { setMenuProjectId(null); void exportZip(project); }} disabled={!project.pathAvailable}><Download size={15} />导出源码 ZIP</button>
                      <button aria-label={`导出 PDF ${project.name}`} onClick={() => { setMenuProjectId(null); void exportPdf(project); }} disabled={!isDemo && !statusSnapshots[project.id]?.mainPdfPath}><FileDown size={15} />导出最新 PDF</button>
                      <button aria-label={`清理临时文件 ${project.name}`} onClick={() => void beginTemporaryCleanup(project)} disabled={!project.pathAvailable}><Eraser size={15} />清理临时文件</button>
                    </div>
                    <div className="project-menu-section">
                      <p>项目库</p>
                      <button aria-label={`${project.favorite ? "取消收藏" : "收藏项目"} ${project.name}`} onClick={() => { setMenuProjectId(null); void toggleFavorite(project); }}><Star size={15} fill={project.favorite ? "currentColor" : "none"} />{project.favorite ? "取消收藏" : "收藏项目"}</button>
                      <button aria-label={`重新定位路径 ${project.name}`} onClick={() => void relinkProject(project)}><FolderInput size={15} />重新定位路径</button>
                      <button aria-label={`保存为模板 ${project.name}`} onClick={() => void saveAsTemplate(project)}><CopyPlus size={15} />保存为模板</button>
                      <button aria-label={`${project.archived ? "取消归档" : "归档项目"} ${project.name}`} onClick={() => { setMenuProjectId(null); void setArchived(project, !project.archived); }}>{project.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}{project.archived ? "取消归档" : "归档项目"}</button>
                      <button aria-label={`从项目库移除 ${project.name}`} className="danger-text" onClick={() => { setMenuProjectId(null); void moveToTrash(project); }}><Trash2 size={15} />从项目库移除</button>
                    </div>
                  </div>
                </>
              )}
            </article>
          ))}
          {isProjectListVirtualized && virtualRange.offsetBottom > 0 && <div className="project-row-spacer" role="presentation" aria-hidden="true" style={{ height: virtualRange.offsetBottom }} />}
          </div>
        </div>
        {focusedProject && <aside className="project-inspector" aria-label={`项目快速检查 ${focusedProject.name}`}>
          <header><span className="project-inspector-icon"><FolderKanban size={22} /></span><div><small>快速检查</small><h2>{focusedProject.name}</h2></div><IconButton label="关闭快速检查" onClick={() => setFocusedProjectId(null)}><X size={17} /></IconButton></header>
          <p className="project-inspector-description">{focusedProject.description?.trim() || "还没有项目说明。可在项目详情中补充研究主题、进度或下一步。"}</p>
          <dl><div><dt>项目阶段</dt><dd><select aria-label={`项目阶段 ${focusedProject.name}`} value={focusedProject.lifecycle ?? (focusedProject.archived ? "archived" : "active")} onChange={(event) => void updateProject(focusedProject, { lifecycle: event.target.value as ProjectSummary["lifecycle"] })}><option value="active">活跃</option><option value="paused">暂停</option><option value="completed">已完成</option><option value="archived">已归档</option></select></dd></div><div><dt>保护状态</dt><dd>{focusedProject.protectionState === "both" ? "GitHub + 本地备份" : focusedProject.protectionState === "github" ? "GitHub" : focusedProject.protectionState === "localBackup" ? "本地备份" : "未受保护"}</dd></div><div><dt>存储空间</dt><dd>{statusSnapshots[focusedProject.id]?.storageBytes !== undefined ? formatBytes(statusSnapshots[focusedProject.id]!.storageBytes!) : "尚未刷新"}</dd></div><div><dt>研究资料</dt><dd>{statusSnapshots[focusedProject.id]?.researchCount ?? "尚未刷新"}</dd></div><div><dt>主 PDF</dt><dd>{statusSnapshots[focusedProject.id]?.mainPdfPath ? "可用" : "尚未设置"}</dd></div><div><dt>同步</dt><dd><ProjectCachedSyncBadge record={projectStatus[focusedProject.id]} /></dd></div><div><dt>最近使用</dt><dd>{relativeTime(focusedProject.lastOpenedAt)}</dd></div></dl>
          <div className="project-inspector-actions"><button className="button primary" onClick={() => void openProjectFolder(focusedProject)} disabled={!focusedProject.pathAvailable}><FolderOpen size={16} />打开文件夹</button><button className="button secondary" onClick={() => onManage(focusedProject)} disabled={!focusedProject.pathAvailable}>项目详情</button><button className="button secondary" onClick={() => void openProjectInVsCode(focusedProject)} disabled={!focusedProject.pathAvailable}><Code2 size={16} />VS Code</button></div>
        </aside>}
        </div>
      ) : (
        <div className="empty-state"><Search size={28} /><h2>{filter === "trashed" ? "没有已移除项目" : "没有匹配的项目"}</h2><p>{filter === "trashed" ? "从项目库移除只会删除本机索引，真实文件仍留在原位置。" : "调整搜索词、标签或资料库范围。"}</p></div>
      )}

      {copyProject && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !copying && setCopyProject(null)}>
          <section className="modal copy-dialog" role="dialog" aria-modal="true" aria-labelledby="copy-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <div><h2 id="copy-title">复制项目</h2><p>创建独立的本地副本</p></div>
              <IconButton label="关闭" onClick={() => setCopyProject(null)} disabled={copying}><X size={18} /></IconButton>
            </header>
            <div className="copy-dialog-content">
              <div className="copy-source"><Copy size={20} /><div><strong>{copyProject.name}</strong><span title={copyProject.rootPath}>{copyProject.rootPath}</span></div></div>
              <label><span>副本名称</span><input value={copyName} onChange={(event) => setCopyName(event.target.value)} maxLength={120} autoFocus onKeyDown={(event) => event.key === "Enter" && void confirmCopy()} /></label>
              <p>下一步选择父目录。客户端会创建新的项目文件夹和项目标识，不复制构建缓存，也不会继承原项目的 GitHub 远端关系。</p>
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
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setImportOpen(false)} onKeyDown={(event) => { if (event.key === "Escape") setImportOpen(false); }}>
          <section className="modal import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <div><p className="eyebrow">本地项目库</p><h2 id="import-title">导入 LaTeX 项目</h2><span>只登记项目位置，不复制或修改源文件</span></div>
              <IconButton label="关闭" onClick={() => setImportOpen(false)}><X size={18} /></IconButton>
            </header>
            <ol className="import-progress" aria-label="导入进度">
              {["选择目录", "选择项目", "导入方式"].map((label, index) => {
                const step = candidates.length === 0 ? 0 : selectedImportPaths.length ? 2 : 1;
                return <li key={label} className={index < step ? "completed" : index === step ? "current" : "locked"} aria-current={index === step ? "step" : undefined}><span>{index < step ? <Check size={14} /> : index + 1}</span><strong>{label}</strong></li>;
              })}
            </ol>
            <div className="import-stage import-source-stage">
              <div className="import-stage-heading"><span>1</span><div><strong>从电脑中选择目录</strong><p>可选择单个项目，也可选择资料库。默认向下扫描 3 层。</p></div></div>
              <button className="button primary" onClick={() => void scanLibrary()} disabled={scanning}>{scanning ? <><RefreshCw size={16} className="spin" />正在扫描…</> : <><FolderInput size={16} />{candidates.length ? "重新选择目录" : "选择目录"}</>}</button>
            </div>
            <div className={`import-stage import-project-stage ${candidates.length ? "ready" : "locked"}`}>
              <div className="import-stage-heading"><span>2</span><div><strong>选择要加入项目库的项目</strong><p>{candidates.length ? `已识别 ${candidates.length} 个项目，可一次选择多个。` : "选择目录后，这里会列出识别到的 LaTeX 主文件。"}</p></div></div>
              {candidates.length > 1 && <div className="candidate-select-all"><label><input type="checkbox" checked={selectedImportPaths.length > 0 && candidates.filter((candidate) => !projects.some((project) => project.rootPath.toLocaleLowerCase() === candidate.rootPath.toLocaleLowerCase())).every((candidate) => selectedImportPaths.includes(candidate.rootPath))} onChange={(event) => { const importable = candidates.filter((candidate) => !projects.some((project) => project.rootPath.toLocaleLowerCase() === candidate.rootPath.toLocaleLowerCase())).map((candidate) => candidate.rootPath); setSelectedImportPaths(event.target.checked ? importable : []); }} />选择全部可导入项目</label><span>已选 {selectedImportPaths.length} 项</span></div>}
              <div className="candidate-list">
                {candidates.length === 0 && <div className="import-empty"><BookOpenText size={24} /><span>等待选择目录</span><small>扫描过程只读，不会改写 `.tex`、`.bib` 或 `.cls`。</small></div>}
                {candidates.map((candidate) => {
                  const selected = selectedImportPaths.includes(candidate.rootPath);
                  const duplicate = projects.some((project) => project.rootPath.toLocaleLowerCase() === candidate.rootPath.toLocaleLowerCase());
                  return <label className={`candidate ${selected ? "selected" : ""} ${duplicate ? "duplicate" : ""}`} key={candidate.rootPath}>
                    <input className="candidate-native-checkbox" type="checkbox" aria-label={`选择导入项目 ${candidate.name}`} checked={selected} onChange={(event) => setSelectedImportPaths((current) => event.target.checked ? [...current.filter((path) => path !== candidate.rootPath), candidate.rootPath] : current.filter((path) => path !== candidate.rootPath))} disabled={importingPath !== null || duplicate} />
                    <span className="candidate-icon"><BookOpenText size={19} /></span>
                    <span className="candidate-copy"><strong>{candidate.name}{duplicate && <em className="duplicate-label">已在项目库</em>}</strong><small title={candidate.rootPath}>{candidate.rootPath}</small><em>{candidate.entries.length} 个入口 · {candidate.entries.map((entry) => `${entry.relativePath} (${entry.className})`).join("、")}</em></span>
                    <span className="candidate-radio candidate-checkbox" aria-hidden="true">{selected ? <Check size={14} /> : null}</span>
                  </label>;
                })}
              </div>
            </div>
            <div className={`import-stage import-sync-choice ${selectedImportPaths.length ? "ready" : "locked"}`}>
              <div className="import-stage-heading"><span>3</span><div><strong>选择导入方式</strong><p>默认只加入本机项目库；GitHub 同步可稍后再开启。</p></div></div>
              <label className="sync-toggle"><span><strong>为所选项目分别创建 GitHub 仓库并自动同步</strong><small>后续新增、修改和删除会在停止变化约 10 秒后安全同步</small></span><input type="checkbox" aria-label="导入后启用 GitHub 自动同步" checked={syncOnImport} onChange={(event) => setSyncOnImport(event.target.checked)} disabled={!selectedImportPaths.length} /></label>
              {syncOnImport && <div className="import-sync-options"><label><span>新仓库可见性</span><select value={importVisibility} onChange={(event) => setImportVisibility(event.target.value as GitHubRepositoryVisibility)}><option value="private">私有（推荐）</option><option value="public">公开</option></select></label><p>{importVisibility === "public" ? "公开仓库中的源码和原始文稿对所有人可见；首次上传前仍会进行安全检查。" : "仓库名会根据项目名称自动生成，登录凭据由 GitHub CLI 管理。"}</p></div>}
            </div>
            <footer className="import-actions">
              <div><ShieldCheck size={17} /><span>源文件保持原位；同步前会扫描私钥、令牌和大型文件。</span></div>
              <button className="button primary" disabled={!selectedImportPaths.length || importingPath !== null} onClick={() => void importSelectedCandidates()}>{importingPath ? <><RefreshCw size={16} className="spin" />正在导入 {selectedImportPaths.findIndex((path) => path === importingPath) + 1}/{selectedImportPaths.length}…</> : syncOnImport ? `导入 ${selectedImportPaths.length} 项并开启同步` : `加入 ${selectedImportPaths.length} 项到本机项目库`}</button>
            </footer>
            {isDemo && <p className="demo-note">演示模式不会写入目录；桌面客户端中选择后会进入迁移预览。</p>}
          </section>
        </div>
      )}

    </section>
  );
}

function SettingsView({ api, isDemo, projects, onNotify, runtimeSettings, onRuntimeSettingsChange, onOpenOnboarding }: {
  api: WorkbenchApi;
  isDemo: boolean;
  projects: ProjectSummary[];
  onNotify: (message: string) => void;
  runtimeSettings: AppRuntimeSettings;
  onRuntimeSettingsChange: (settings: AppRuntimeSettings) => void;
  onOpenOnboarding: () => void;
}) {
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);
  const [account, setAccount] = useState<GitHubAccountStatus | null>(null);
  const [editorStatus, setEditorStatus] = useState<VsCodeStatus | null>(null);
  const [busy, setBusy] = useState<"settings" | "check" | "download" | "install" | "github" | "editor" | null>(null);
  const [section, setSection] = useState<"general" | "editor" | "account" | "updates" | "about">("general");

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
    const unsubscribe = api.updates.onEvent((next) => { if (!cancelled) setStatus(next); });
    return () => { cancelled = true; clearInterval(timer); unsubscribe(); };
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

  async function refreshEditorStatus() {
    try {
      setEditorStatus(await api.editor.status());
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法检测 VS Code");
    }
  }

  useEffect(() => { void refreshEditorStatus(); }, [api]);

  async function chooseEditor() {
    setBusy("editor");
    try {
      const next = await api.editor.selectExecutable();
      if (!next) return;
      setEditorStatus(next);
      onRuntimeSettingsChange(await api.runtime.settings());
      onNotify(`已使用 ${next.executablePath ?? "所选编辑器"}`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法保存编辑器路径");
    } finally {
      setBusy(null);
    }
  }

  async function resetEditor() {
    setBusy("editor");
    try {
      const next = await api.editor.resetExecutable();
      setEditorStatus(next);
      onRuntimeSettingsChange(await api.runtime.settings());
      onNotify(next.available ? "已恢复自动检测编辑器" : "已清除手动路径，当前未检测到编辑器");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法恢复自动检测");
    } finally {
      setBusy(null);
    }
  }

  async function testEditor() {
    const project = [...projects]
      .filter((item) => !item.trashed && item.pathAvailable)
      .sort((left, right) => (right.lastOpenedAt ?? "").localeCompare(left.lastOpenedAt ?? ""))[0];
    if (!project) {
      onNotify("请先导入一个路径可用的项目，再测试打开。");
      return;
    }
    setBusy("editor");
    try {
      await api.editor.openProject(project.id);
      onNotify(`测试成功：已在编辑器中打开 ${project.name}`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "编辑器测试打开失败");
    } finally {
      setBusy(null);
    }
  }

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
    const operation = api.updates.download();
    setBusy(null);
    try {
      const next = await operation;
      setStatus(next);
      onNotify(next.message ?? "更新下载完成");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "下载更新失败");
    } finally {
      setBusy(null);
    }
  }

  async function cancelUpdate() {
    setBusy("download");
    try {
      const next = await api.updates.cancel();
      setStatus(next);
      onNotify(next.message ?? "更新下载已取消");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法取消更新下载");
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
          : status.state === "cancelled" ? "下载已暂停"
            : status.state === "unavailable" ? "自动更新不可用"
              : status.state === "error" ? "更新检查失败"
                : status.state === "checking" ? "正在检查"
                  : "等待检查";

  return (
    <section className="app-settings-page">
      <header className="settings-page-heading"><span><Settings2 size={22} /></span><div><h1>设置</h1><p>这些设置只保存在这台电脑，不会写入任何 LaTeX 项目。</p></div></header>
      <nav className="settings-section-tabs" aria-label="设置分类" role="tablist">
        <button role="tab" aria-selected={section === "general"} className={section === "general" ? "active" : ""} onClick={() => setSection("general")}>外观与常规</button>
        <button role="tab" aria-selected={section === "editor"} className={section === "editor" ? "active" : ""} onClick={() => setSection("editor")}>外部编辑器</button>
        <button role="tab" aria-selected={section === "account"} className={section === "account" ? "active" : ""} onClick={() => setSection("account")}>账号与同步</button>
        <button role="tab" aria-selected={section === "updates"} className={section === "updates" ? "active" : ""} onClick={() => setSection("updates")}>客户端更新</button>
        <button role="tab" aria-selected={section === "about"} className={section === "about" ? "active" : ""} onClick={() => setSection("about")}>关于</button>
      </nav>
      {section === "general" && <section className="settings-card runtime-settings-card">
        <header><div><h2>外观与操作</h2><p>玻璃效果会根据 Windows 版本和性能自动降级，关闭后使用高不透明霜化表面。</p></div><Settings2 size={20} /></header>
        <div className="settings-choice-grid">
          <label><span>主题</span><select value={runtimeSettings.theme} onChange={(event) => void saveRuntimeSettings({ ...runtimeSettings, theme: event.target.value as AppRuntimeSettings["theme"] }, "已更新界面主题")}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
          <label><span>列表密度</span><select value={runtimeSettings.density} onChange={(event) => void saveRuntimeSettings({ ...runtimeSettings, density: event.target.value as AppRuntimeSettings["density"] }, "已更新项目列表密度")}><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label>
          <label><span>液态玻璃</span><select value={runtimeSettings.glassMode} onChange={(event) => void saveRuntimeSettings({ ...runtimeSettings, glassMode: event.target.value as AppRuntimeSettings["glassMode"] }, "已更新液态玻璃效果")}><option value="auto">自动</option><option value="full">完整</option><option value="off">关闭</option></select></label>
        </div>
        <div className="settings-toggle-list">
          <label className="sync-toggle"><span><strong>关闭窗口后留在托盘</strong><small>托盘菜单可重新打开、同步全部或彻底退出</small></span><input type="checkbox" checked={runtimeSettings.closeToTray} disabled={busy !== null} onChange={(event) => void saveRuntimeSettings({ ...runtimeSettings, closeToTray: event.target.checked }, event.target.checked ? "关闭窗口后将继续在托盘运行" : "关闭窗口将退出客户端")} /></label>
        </div>
        <div className="update-actions"><button className="button secondary" onClick={onOpenOnboarding}><BookOpenText size={16} />重新打开新手向导</button></div>
      </section>}
      {section === "editor" && <section className="settings-card editor-settings-card">
        <header><div><h2>VS Code 与 LaTeX Workshop</h2><p>客户端只负责定位项目和文件；源码编辑与正式编译仍交给外部编辑器。</p></div><Code2 size={20} /></header>
        <div className={`desktop-v1-editor-status ${editorStatus?.available ? "ready" : "attention"}`}>
          <span>{editorStatus?.available ? <CheckCircle2 size={21} /> : <AlertTriangle size={21} />}</span>
          <div>
            <strong>{editorStatus?.available ? (editorStatus.editor === "codium" ? "VSCodium 已就绪" : "VS Code 已就绪") : "尚未检测到兼容编辑器"}</strong>
            <code>{editorStatus?.executablePath ?? "请选择 Code.exe、Code - Insiders.exe 或 VSCodium.exe"}</code>
            <p>{editorStatus?.latexWorkshop.state === "installed" ? `LaTeX Workshop 已安装${editorStatus.latexWorkshop.version ? ` · ${editorStatus.latexWorkshop.version}` : ""}` : "未检测到 LaTeX Workshop；仍可打开项目，但编辑器内 LaTeX 功能可能不可用。"}</p>
            {editorStatus?.diagnostics?.map((diagnostic) => <small key={diagnostic}>{diagnostic}</small>)}
          </div>
        </div>
        <div className="update-actions">
          <button className="button primary" disabled={busy !== null || !editorStatus?.available} onClick={() => void testEditor()}><ExternalLink size={16} />测试打开最近项目</button>
          <button className="button secondary" disabled={busy !== null || isDemo} onClick={() => void chooseEditor()}><FolderInput size={16} />选择程序</button>
          <button className="button ghost" disabled={busy !== null || isDemo} onClick={() => void resetEditor()}><RefreshCw size={16} />重新自动检测</button>
          {!editorStatus?.available && projects.find((item) => item.pathAvailable) && <button className="button ghost" onClick={() => navigator.clipboard.writeText(projects.find((item) => item.pathAvailable)?.rootPath ?? "").then(() => onNotify("已复制项目路径"))}><Copy size={16} />复制项目路径</button>}
        </div>
      </section>}
      {section === "account" && <>
      <section className="settings-card github-login-settings-card">
        <header><div><h2>GitHub 连接</h2><p>登录一次后，即可在导入项目时自动创建仓库和开启同步。</p></div><GitFork size={20} /></header>
        <div className={`github-settings-account ${account?.authenticated ? "account-ready" : "account-required"}`}>
          <span>{account?.authenticated ? <CheckCircle2 size={21} /> : <LogIn size={21} />}</span>
          <div><strong>{account?.authenticated ? `已登录：${account.login}` : account?.message ?? "正在检查 GitHub CLI…"}</strong><p>{account?.authenticated ? `${account.name ?? account.login} · 凭据由 GitHub CLI 安全管理` : "登录会打开 GitHub 官方网页，本软件不会保存密码或访问令牌。"}</p></div>
          <button className="button secondary" onClick={() => void refreshGitHubAccount()} disabled={busy !== null}><RefreshCw size={16} />刷新</button>
          {!account?.authenticated && <button className="button primary" onClick={() => void beginGitHubLogin()} disabled={busy !== null}>{busy === "github" ? <RefreshCw size={16} className="spin" /> : <LogIn size={16} />}{account?.cliAvailable === false ? "安装 GitHub CLI" : "登录 GitHub"}</button>}
        </div>
      </section>
      <section className="settings-card runtime-settings-card">
        <header><div><h2>后台运行与同步</h2><p>关闭主窗口后仍可通过 Windows 托盘安全同步项目。</p></div><HardDrive size={20} /></header>
        <div className="settings-toggle-list">
          <label className="sync-toggle"><span><strong>暂停所有自动同步</strong><small>暂停后保留待同步变化，恢复时继续处理队列</small></span><input type="checkbox" checked={runtimeSettings.syncPaused} disabled={busy !== null} onChange={(event) => void saveRuntimeSettings({ ...runtimeSettings, syncPaused: event.target.checked }, event.target.checked ? "已暂停所有自动同步" : "已恢复自动同步")} /></label>
        </div>
      </section>
      </>}
      {section === "updates" && <section className="settings-card update-settings-card">
        <header><div><h2>客户端更新</h2><p>通过官方 GitHub Release 获取经过校验的 Windows 安装包。</p></div><Download size={20} /></header>
        <div className={`app-update-summary update-${status.state}`}>
          <span className="update-summary-icon">{checking || downloading ? <RefreshCw size={20} className="spin" /> : status.state === "downloaded" || status.state === "upToDate" ? <CheckCircle2 size={20} /> : <Download size={20} />}</span>
          <div><strong>{stateLabel}</strong><p>{status.message}</p></div>
          <div className="update-version"><span>当前版本</span><strong>{status.currentVersion}</strong>{status.latestVersion && status.latestVersion !== status.currentVersion && <small>最新 {status.latestVersion}</small>}</div>
        </div>
        <AppUpdateProgress status={status} busy={busy !== null} onCancel={() => void cancelUpdate()} onRetry={() => void downloadUpdate()} />
        <div className="settings-toggle-list">
          <label className="sync-toggle"><span><strong>自动检查更新</strong><small>启动客户端后自动检查最新正式版本</small></span><input type="checkbox" checked={status.autoCheck} disabled={busy !== null} onChange={(event) => void saveSettings({ autoCheck: event.target.checked, autoDownload: status.autoDownload })} /></label>
          <label className="sync-toggle"><span><strong>发现新版本后自动下载</strong><small>下载完成后由你确认安装，不会在工作中突然重启</small></span><input type="checkbox" checked={status.autoDownload} disabled={busy !== null || !status.autoCheck} onChange={(event) => void saveSettings({ autoCheck: status.autoCheck, autoDownload: event.target.checked })} /></label>
        </div>
        <div className="update-actions">
          <button className="button secondary" onClick={() => void checkNow()} disabled={busy !== null}>{checking ? <RefreshCw size={16} className="spin" /> : <RefreshCw size={16} />}立即检查</button>
          {status.state === "available" && <button className="button primary" onClick={() => void downloadUpdate()} disabled={busy !== null}>{downloading ? <RefreshCw size={16} className="spin" /> : <Download size={16} />}下载 {status.latestVersion}</button>}
          {(status.state === "cancelled" || status.state === "error") && status.canRetry && <button className="button primary" onClick={() => void downloadUpdate()} disabled={busy !== null}><RefreshCw size={16} />继续下载</button>}
          {status.state === "downloaded" && <button className="button primary" onClick={() => void installUpdate()} disabled={busy !== null}>{busy === "install" ? <RefreshCw size={16} className="spin" /> : <Check size={16} />}安装并退出客户端</button>}
          <button className="button ghost" onClick={() => void openReleasePage()}>打开 Release 页面</button>
        </div>
        <div className="private-update-note"><ShieldCheck size={17} /><div><strong>安全更新</strong><p>直接从公开 GitHub Release 下载，不需要 GitHub CLI；安装前会核对签名清单、文件大小和 SHA-256。</p></div></div>
        {isDemo && <p className="demo-note">浏览器演示模式不会访问 GitHub 或下载程序。</p>}
      </section>}
      {section === "about" && <section className="settings-card about-settings-card">
        <header><div><h2>关于 LaTeX 项目管理器</h2><p>本地优先的 LaTeX 项目、研究资料与安全同步工作台。</p></div><BookOpenText size={20} /></header>
        <div className="product-repository-address"><GitFork size={17} /><div><strong>开源项目地址</strong><code>github.com/Ararataki-number-one/latex-project-manager</code></div><button className="button secondary" onClick={() => void openProductPage()}><ExternalLink size={15} />打开 GitHub</button></div>
        <div className="about-version-row"><span>当前版本</span><strong>{status.currentVersion}</strong></div>
      </section>}
    </section>
  );
}

function SyncCenterView({ api, projects, paused, onPausedChange, onOpenProject, onNotify }: {
  api: WorkbenchApi;
  projects: ProjectSummary[];
  paused: boolean;
  onPausedChange: (paused: boolean) => void;
  onOpenProject: (project: ProjectSummary) => void;
  onNotify: (message: string) => void;
}) {
  const [busy, setBusy] = useState<"sync" | "pause" | null>(null);
  const [operations, setOperations] = useState<import("@/shared/types").OperationSnapshot[]>([]);
  const availableProjects = useMemo(() => projects.filter((project) => project.pathAvailable && !project.trashed), [projects]);
  const { statuses, refresh } = useProjectGitHubStatuses(api, availableProjects);
  useEffect(() => {
    let cancelled = false;
    void api.operations.list(undefined, 200).then((items) => { if (!cancelled) setOperations(items); }).catch(() => undefined);
    const unsubscribe = api.operations.onEvent((snapshot) => {
      if (!cancelled) setOperations((current) => [snapshot, ...current.filter((item) => item.id !== snapshot.id)].slice(0, 200));
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [api]);

  async function syncAll() {
    setBusy("sync");
    try {
      await api.github.syncAll();
      await refresh();
      onNotify("所有已连接项目已进入安全同步队列");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法同步全部项目");
    } finally { setBusy(null); }
  }

  async function togglePaused() {
    setBusy("pause");
    try {
      if (paused) await api.github.resumeAll(); else await api.github.pauseAll();
      onPausedChange(!paused);
      await refresh();
      onNotify(paused ? "已恢复全部自动同步" : "已暂停全部自动同步");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法更新同步状态");
    } finally { setBusy(null); }
  }

  const configured = availableProjects.filter((project) => statuses[project.id]?.configured);
  const attention = configured.filter((project) => ["blocked", "error", "needsPull", "unavailable"].includes(statuses[project.id]?.state));
  const pending = configured.filter((project) => statuses[project.id]?.state === "changes");
  const active = configured.filter((project) => ["queued", "syncing", "retrying"].includes(statuses[project.id]?.state));
  const activeOperations = operations.filter((item) => ["queued", "running", "waiting"].includes(item.state));
  const problemOperations = operations.filter((item) => ["failed", "blocked"].includes(item.state));
  const operationLabel = (kind: import("@/shared/types").OperationSnapshot["kind"]) => ({ import: "导入", file: "文件", sync: "同步", backup: "备份", restore: "恢复", export: "导出", cleanup: "清理", update: "更新", index: "索引", migration: "迁移" })[kind];

  async function retryOperation(id: string) {
    try {
      const next = await api.operations.retry(id);
      setOperations((current) => [next, ...current.filter((item) => item.id !== id)]);
      onNotify("操作已重新排队；相关服务会在可用时继续处理。");
    } catch (error) { onNotify(error instanceof Error ? error.message : "无法重试操作"); }
  }

  async function cancelOperation(id: string) {
    try {
      const next = await api.operations.cancel(id);
      setOperations((current) => [next, ...current.filter((item) => item.id !== id)]);
    } catch (error) { onNotify(error instanceof Error ? error.message : "无法取消操作"); }
  }

  return <section className="sync-center-page">
    <header className="sync-center-heading">
      <div><span className="page-heading-icon"><Activity size={22} /></span><div><h1>活动</h1><p>导入、文件、同步、备份、导出和更新都集中在这里 · {activeOperations.length} 项进行中 · {problemOperations.length} 项需要处理</p></div></div>
      <div><button className="button secondary" disabled={busy !== null} onClick={() => void togglePaused()}>{paused ? <PlayCircle size={17} /> : <PauseCircle size={17} />}{paused ? "恢复自动同步" : "暂停自动同步"}</button><button className="button primary" disabled={busy !== null || paused} onClick={() => void syncAll()}><RefreshCw size={17} className={busy === "sync" ? "spin" : ""} />同步全部</button></div>
    </header>
    {paused && <div className="sync-center-paused"><PauseCircle size={18} /><div><strong>自动同步已暂停</strong><p>本地变化仍会保留，恢复后继续处理队列。</p></div></div>}
    <div className="sync-center-summary" aria-label="活动概况"><span><small>历史活动</small><strong>{operations.length}</strong></span><span className={activeOperations.length ? "active" : ""}><small>进行中</small><strong>{activeOperations.length}</strong></span><span className={problemOperations.length ? "attention" : ""}><small>需要处理</small><strong>{problemOperations.length}</strong></span><span><small>GitHub 已连接</small><strong>{configured.length}</strong></span></div>
    <div className="sync-center-explainer"><ShieldCheck size={17} /><span>成功操作保持安静；失败和安全阻止会一直保留，直到解决或重新尝试。</span></div>
    <section className="desktop-v1-activity-panel" aria-labelledby="activity-history-title">
      <header className="desktop-v1-activity-panel-heading">
        <div><h2 id="activity-history-title">活动记录</h2><p>长时间任务的进度、结果与恢复操作会保留在这里。</p></div>
        <span>{operations.length} 条</span>
      </header>
      <div className="desktop-v1-operation-list" aria-label="活动记录">
        {operations.map((operation) => <article key={operation.id} className={`desktop-v1-operation operation-${operation.state}`}>
          <span className="desktop-v1-operation-kind">{operationLabel(operation.kind)}</span>
          <div><strong>{operation.title}</strong><p>{operation.message ?? "等待状态更新"}</p>{operation.recoveryAction && <small className="desktop-v1-operation-recovery">建议：{operation.recoveryAction}</small>}<small>{new Date(operation.updatedAt).toLocaleString("zh-CN")}{operation.projectId ? ` · ${projects.find((project) => project.id === operation.projectId)?.name ?? "项目"}` : ""}{operation.failureCode ? ` · 诊断码 ${operation.failureCode}` : ""}</small></div>
          {operation.progress !== undefined && <progress max={1} value={operation.progress} aria-label={`${operation.title}进度`} />}
          <span className={`desktop-v1-operation-state state-${operation.state}`}>{operation.state === "succeeded" || operation.state === "completed" ? "已完成" : operation.state === "running" ? "进行中" : operation.state === "queued" ? "排队中" : operation.state === "waiting" ? "等待中" : operation.state === "blocked" ? "已阻止" : operation.state === "failed" ? "失败" : "已取消"}</span>
          <div>{operation.cancellable && <button className="button ghost compact" onClick={() => void cancelOperation(operation.id)}>取消</button>}{operation.retryable && ["failed", "blocked", "cancelled"].includes(operation.state) && <button className="button secondary compact" onClick={() => void retryOperation(operation.id)}>重试</button>}</div>
        </article>)}
        {!operations.length && <div className="empty-state compact"><Activity size={24} /><h2>还没有后台活动</h2><p>导入、同步、备份或更新后会在这里留下记录。</p></div>}
      </div>
    </section>
    <section className="desktop-v1-activity-panel" aria-labelledby="activity-github-title">
      <header className="desktop-v1-activity-panel-heading">
        <div><h2 id="activity-github-title">GitHub 项目状态</h2><p>只展示已加入项目库的项目，不会自动处理分叉或冲突。</p></div>
        <div className="desktop-v1-activity-counters" aria-label="GitHub 同步概况"><span>{active.length} 进行中</span><span>{pending.length} 待推送</span><span className={attention.length ? "attention" : ""}>{attention.length} 异常</span></div>
      </header>
      <div className="sync-project-list" aria-label="项目同步状态">
        {availableProjects.map((project) => {
          const status = statuses[project.id];
          return <article key={project.id} className={`sync-project-row ${status && ["blocked", "error", "needsPull"].includes(status.state) ? "needs-attention" : ""}`}>
            <span className="project-folder-icon"><FolderKanban size={18} /></span>
            <div className="sync-project-copy"><strong>{project.name}</strong><span>{status?.message ?? "正在读取同步状态…"}</span></div>
            <ProjectSyncBadge status={status} />
            <span className="sync-project-time">{status?.lastSyncAt ? `上次成功 ${relativeTime(status.lastSyncAt)}` : "尚未成功同步"}</span>
            <button className="button secondary compact" onClick={() => onOpenProject(project)}>查看同步</button>
          </article>;
        })}
        {!availableProjects.length && <div className="empty-state"><Cloud size={28} /><h2>还没有可同步项目</h2><p>先导入一个本地 LaTeX 项目，再选择是否连接 GitHub。</p></div>}
      </div>
    </section>
  </section>;
}

const SEARCH_KIND_LABELS: Record<ResearchSearchHit["kind"], string> = {
  project: "项目",
  file: "文件",
  heading: "章节",
  label: "标签",
  citation: "引用",
  bib: "文献条目",
  research: "研究资料"
};

function GlobalSearchPalette({
  api,
  projects,
  open,
  onClose,
  onOpenProject,
  onNotify
}: {
  api: WorkbenchApi;
  projects: ProjectSummary[];
  open: boolean;
  onClose: () => void;
  onOpenProject: (project: ProjectSummary, tab: "overview" | "references") => void;
  onNotify: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ResearchSearchHit[]>([]);
  const [indexing, setIndexing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [indexRevision, setIndexRevision] = useState(0);
  const lastIndexAt = useRef(0);
  const previousFocus = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const projectsById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.requestAnimationFrame(() => inputRef.current?.focus());
    setActiveIndex(0);
    if (Date.now() - lastIndexAt.current < 10 * 60 * 1000) {
      return () => previousFocus.current?.focus();
    }
    lastIndexAt.current = Date.now();
    setIndexing(true);
    api.researchSearch.indexAll()
      .catch((error: unknown) => onNotify(error instanceof Error ? error.message : "无法更新本地搜索索引"))
      .finally(() => { setIndexing(false); setIndexRevision((value) => value + 1); });
    return () => previousFocus.current?.focus();
  }, [api, onNotify, open]);

  useEffect(() => {
    if (!open || !query.trim()) { setResults([]); setSearching(false); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      api.researchSearch.query(query.trim(), undefined, 40)
        .then((next) => { if (!cancelled) { setResults(next); setActiveIndex(0); } })
        .catch((error: unknown) => !cancelled && onNotify(error instanceof Error ? error.message : "无法搜索本机资料"))
        .finally(() => !cancelled && setSearching(false));
    }, 160);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [api, indexRevision, onNotify, open, query]);

  async function openResult(result: ResearchSearchHit) {
    const project = projectsById.get(result.projectId);
    if (!project) { onNotify("搜索结果对应的项目已不在项目库中"); return; }
    onClose();
    if (result.kind === "project" || result.kind === "research" || !result.relativePath) {
      onOpenProject(project, result.kind === "research" ? "references" : "overview");
      return;
    }
    try {
      await api.editor.openFile(project.id, result.relativePath, result.line);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法在 VS Code 中打开搜索结果");
    }
  }

  if (!open) return null;
  return (
    <div className="global-search-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="global-search-dialog" role="dialog" aria-modal="true" aria-label="全局搜索" onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
        if (event.key !== "Tab") return;
        const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('input, button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])];
        if (focusable.length === 0) return;
        const current = focusable.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey
          ? (current <= 0 ? focusable.length - 1 : current - 1)
          : (current >= focusable.length - 1 ? 0 : current + 1);
        event.preventDefault();
        focusable[next].focus();
      }}>
        <header><Search size={20} /><input ref={inputRef} role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="global-search-results" aria-activedescendant={results[activeIndex] ? `global-search-result-${results[activeIndex].id}` : undefined} aria-label="搜索项目、文件和研究资料" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((current) => Math.min(Math.max(0, results.length - 1), current + 1)); }
          else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((current) => Math.max(0, current - 1)); }
          else if (event.key === "Enter" && results[activeIndex]) { event.preventDefault(); void openResult(results[activeIndex]); }
        }} placeholder="搜索项目、章节、label、cite、BibTeX 或研究资料" /><kbd>Esc</kbd></header>
        <div className="global-search-status">{indexing ? <><RefreshCw size={13} className="spin" />正在增量更新本机索引</> : searching ? <><RefreshCw size={13} className="spin" />正在搜索</> : query.trim() ? `${results.length} 个结果` : "只在本机搜索，不上传全文或路径"}</div>
        <div id="global-search-results" className="global-search-results" role="listbox" aria-label="全局搜索结果">
          {!query.trim() ? <div className="global-search-empty"><Search size={28} /><strong>快速定位整个研究工作区</strong><p>输入项目名、章节标题、LaTeX label、引用键或论文信息。</p></div> : !searching && results.length === 0 ? <div className="global-search-empty"><Search size={25} /><strong>没有找到结果</strong><p>检查关键词，或等待上方的本机索引更新完成。</p></div> : results.map((result, index) => {
            const project = projectsById.get(result.projectId);
            return <button id={`global-search-result-${result.id}`} key={result.id} role="option" aria-selected={index === activeIndex} className={index === activeIndex ? "active" : ""} onMouseEnter={() => setActiveIndex(index)} onClick={() => void openResult(result)}><span className="global-search-kind">{SEARCH_KIND_LABELS[result.kind]}</span><span className="global-search-result-copy"><strong>{result.title}</strong><small>{[project?.name, result.detail, result.relativePath && `${result.relativePath}${result.line ? `:${result.line}` : ""}`].filter(Boolean).join(" · ")}</small></span><ChevronRight size={16} /></button>;
          })}
        </div>
        <footer><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 打开</span><span>源码结果在 VS Code 中定位</span></footer>
      </section>
    </div>
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
  const [syncCenterOpen, setSyncCenterOpen] = useState(false);
  const [selectedProjectTab, setSelectedProjectTab] = useState<"overview" | "files" | "references" | "github">("overview");
  const [runtimeSettings, setRuntimeSettings] = useState<AppRuntimeSettings>({
    closeToTray: true,
    onboardingCompleted: false,
    syncPaused: false,
    theme: "system",
    density: "comfortable",
    glassMode: "auto"
  });
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [showOnboardingHint, setShowOnboardingHint] = useState(false);
  const [openImportNonce, setOpenImportNonce] = useState(0);
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus | null>(null);
  const [libraryScope, setLibraryScope] = useState<LibraryScope>({ kind: "standard" });
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [desktopMigration, setDesktopMigration] = useState<DesktopMigrationPreview | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setGlobalSearchOpen(true);
      } else if (event.key === "Escape") {
        setGlobalSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function closeCompactNavigation() {
    if (window.matchMedia("(max-width: 780px)").matches) setNavOpen(false);
  }

  async function refreshProjects() {
    const items = await runtime.api.library.list();
    setProjects(items);
  }

  useEffect(() => {
    Promise.all([runtime.api.library.list(), runtime.api.runtime.settings(), runtime.api.library.catalogStatus()])
      .then(([items, settings, nextCatalogStatus]) => {
        setProjects(items);
        setRuntimeSettings(settings);
        setCatalogStatus(nextCatalogStatus);
        if (!settings.onboardingCompleted) {
          if (items.length === 0) setOnboardingOpen(true);
          else setShowOnboardingHint(true);
        }
        if (!settings.desktopMigrationCompletedAt && nextCatalogStatus.writable !== false) {
          void runtime.api.desktopMigration.preview().then(setDesktopMigration).catch((error) => setToast(error instanceof Error ? error.message : "无法预览旧版本迁移"));
        }
      })
      .catch((error) => setToast(error instanceof Error ? error.message : "无法读取客户端设置"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const compact = window.matchMedia("(max-width: 780px)");
    const handleBreakpoint = (event: MediaQueryListEvent) => setNavOpen(!event.matches);
    compact.addEventListener("change", handleBreakpoint);
    return () => compact.removeEventListener("change", handleBreakpoint);
  }, []);

  useEffect(() => {
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      document.documentElement.dataset.theme = runtimeSettings.theme === "system"
        ? (systemDark.matches ? "dark" : "light")
        : runtimeSettings.theme;
      document.documentElement.dataset.themePreference = runtimeSettings.theme;
    };
    applyTheme();
    if (runtimeSettings.theme === "system") systemDark.addEventListener("change", applyTheme);
    document.documentElement.dataset.density = runtimeSettings.density;
    document.documentElement.dataset.glass = runtimeSettings.glassMode;
    return () => {
      systemDark.removeEventListener("change", applyTheme);
      delete document.documentElement.dataset.theme;
      delete document.documentElement.dataset.themePreference;
      delete document.documentElement.dataset.density;
      delete document.documentElement.dataset.glass;
    };
  }, [runtimeSettings.theme, runtimeSettings.density, runtimeSettings.glassMode]);

  async function completeOnboarding(result: OnboardingResult) {
    try {
      const saved = await runtime.api.runtime.setSettings({ ...runtimeSettings, onboardingCompleted: true });
      setRuntimeSettings(saved);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "无法保存新手向导状态");
    }
    setOnboardingOpen(false);
    setShowOnboardingHint(false);
    if (result.imported.length) {
      setProjects((current) => [...current.filter((project) => !result.imported.some((item) => item.id === project.id)), ...result.imported]);
    }
    setSelected(null);
    setSettingsOpen(false);
    setSyncCenterOpen(false);
    setFilter("all");
    setLibraryScope({ kind: "standard" });
  }

  async function applyDesktopMigration(resolutions: Record<string, import("@/shared/types").DesktopMigrationConflictResolution>) {
    if (!desktopMigration) return;
    try {
      const result = await runtime.api.desktopMigration.apply(desktopMigration.id, { resolutions });
      await refreshProjects();
      if (result.localResources.failures.length > 0) {
        const nextPreview = await runtime.api.desktopMigration.preview().catch(() => null);
        setDesktopMigration(nextPreview);
        setToast(`项目库数据已安全合并，但有 ${result.localResources.failures.length} 个本机资源尚未复制；旧版数据仍保留，请稍后重试迁移。`);
        return;
      }
      const saved = await runtime.api.runtime.setSettings({ ...runtimeSettings, desktopMigrationCompletedAt: result.appliedAt });
      setRuntimeSettings(saved);
      setDesktopMigration(null);
      const conflictNote = result.localResources.conflicts.length > 0
        ? `；${result.localResources.conflicts.length} 个同名本机资源保留正式版内容`
        : "";
      setToast(`项目库迁移完成：新增 ${result.imported} 个，合并 ${result.merged} 个，跳过 ${result.skipped} 个${conflictNote}。旧数据库仍保留。`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "项目库迁移失败");
    }
  }

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const tags = useMemo(() => Array.from(new Set(projects.filter((project) => !project.trashed).flatMap((project) => project.tags))).sort((a, b) => a.localeCompare(b, "zh-CN")), [projects]);
  const scopeMeta = useMemo(() => {
    if (libraryScope.kind === "research") {
      return { title: "研究资料", description: "按项目整理论文、PDF 与电子书；进入项目后查看和管理 references 文件夹。", ids: undefined, issue: "all" as const };
    }
    if (libraryScope.kind === "organize") {
      const ids = projects.filter((project) => !project.archived && !project.trashed && (!project.tags.length || !project.description?.trim())).map((project) => project.id);
      return { title: "待整理", description: "还没有标签或项目说明的项目，适合集中补充研究主题与进度。", ids, issue: "all" as const };
    }
    if (libraryScope.kind === "issue") {
      return { title: libraryScope.label, description: "由本机状态实时生成的智能视图，不会移动项目文件。", ids: undefined, issue: libraryScope.issue };
    }
    return { title: undefined, description: undefined, ids: undefined, issue: "all" as const };
  }, [libraryScope, projects]);
  const libraryVisible = !selected && !settingsOpen && !syncCenterOpen;

  function goLibrary(nextFilter: ExtendedLibraryFilter = filter) {
    setFilter(nextFilter);
    setLibraryScope({ kind: "standard" });
    setActiveTag(null);
    setSelected(null);
    setSettingsOpen(false);
    setSyncCenterOpen(false);
    closeCompactNavigation();
    void refreshProjects().catch((error) => {
      setToast(error instanceof Error ? error.message : "无法刷新项目库");
    });
  }

  function goScopedLibrary(scope: LibraryScope) {
    setFilter("all");
    setActiveTag(null);
    setLibraryScope(scope);
    setSelected(null);
    setSettingsOpen(false);
    setSyncCenterOpen(false);
    closeCompactNavigation();
  }

  if (loading) {
    return <div className="app-loading"><img className="brand-icon loading-brand-icon" src={appIcon} alt="" aria-hidden="true" /><p>正在读取本地项目库…</p></div>;
  }

  return (
    <div className={`app-shell ${navOpen ? "nav-open" : "nav-closed"}`}>
      <aside className="app-sidebar" aria-label="应用侧栏">
        <div className="brand-row">
          <img className="brand-icon" src={appIcon} alt="" aria-hidden="true" />
          <div className="brand-copy"><strong>LaTeX 管理器</strong><span>Project Manager</span></div>
          <IconButton label="收起侧栏" onClick={() => setNavOpen(false)}><PanelLeftClose size={17} /></IconButton>
        </div>
        <nav className="main-nav" aria-label="资料库导航">
          <p className="sidebar-section-label">工作区</p>
          <button className={libraryVisible && libraryScope.kind === "standard" ? "active" : ""} aria-current={libraryVisible && libraryScope.kind === "standard" ? "page" : undefined} onClick={() => goLibrary("all")}><BookOpenText size={18} /><span>项目库</span><small>{projects.filter((item) => !item.archived && !item.trashed).length}</small></button>
          <button className={libraryVisible && libraryScope.kind === "research" ? "active" : ""} aria-current={libraryVisible && libraryScope.kind === "research" ? "page" : undefined} onClick={() => goScopedLibrary({ kind: "research" })}><Library size={18} /><span>研究资料</span></button>
          <button className={libraryVisible && libraryScope.kind === "templates" ? "active" : ""} aria-current={libraryVisible && libraryScope.kind === "templates" ? "page" : undefined} onClick={() => goScopedLibrary({ kind: "templates" })}><BookCopy size={18} /><span>模板库</span></button>
          <button className={libraryVisible && libraryScope.kind === "attention" ? "active" : ""} aria-current={libraryVisible && libraryScope.kind === "attention" ? "page" : undefined} onClick={() => goScopedLibrary({ kind: "attention" })}><AlertTriangle size={18} /><span>需要处理</span>{projects.some((project) => !project.trashed && (!project.pathAvailable || !project.protectionState || project.protectionState === "unprotected")) && <small className="desktop-v1-attention-dot" aria-label="存在需要处理的项目" />}</button>
        </nav>
        <div className="sidebar-spacer" />
        <nav className="sidebar-settings-nav" aria-label="应用导航">
          <button className={syncCenterOpen ? "active" : ""} aria-current={syncCenterOpen ? "page" : undefined} onClick={() => { setSelected(null); setSettingsOpen(false); setSyncCenterOpen(true); closeCompactNavigation(); }}><Activity size={18} /><span>活动</span></button>
          <button className={settingsOpen ? "active" : ""} aria-current={settingsOpen ? "page" : undefined} onClick={() => { setSelected(null); setSyncCenterOpen(false); setSettingsOpen(true); closeCompactNavigation(); }}><Settings2 size={18} /><span>设置</span></button>
        </nav>
        <div className={`toolchain-card ${catalogStatus && catalogStatus.writable === false ? "catalog-temporary" : ""}`}>
          <span className={`toolchain-indicator ${catalogStatus && catalogStatus.writable === false ? "warning" : "ready"}`} />
          <div><strong>{catalogStatus && catalogStatus.writable === false ? "项目库只读" : "本地项目索引"}</strong><span>{catalogStatus && catalogStatus.writable === false ? "写入操作已安全阻止" : "GitHub 为可选同步"}</span></div>
          {catalogStatus && catalogStatus.writable === false ? <AlertTriangle size={16} /> : <HardDrive size={16} />}
        </div>
        {runtime.isDemo && <div className="demo-badge">浏览器演示 · 只读数据</div>}
      </aside>
      {navOpen && <button className="sidebar-scrim" aria-label="关闭侧栏" onClick={() => setNavOpen(false)} />}

      <main className="app-main">
        <div className="window-strip">
          {!navOpen && <IconButton label="打开侧栏" onClick={() => setNavOpen(true)}><Menu size={19} /></IconButton>}
          {!selected && <span className="window-title">{settingsOpen ? "设置" : syncCenterOpen ? "活动" : libraryScope.kind === "attention" ? "需要处理" : "LaTeX 项目管理器"}</span>}
          {selected && <button className="breadcrumb-home" onClick={() => goLibrary()}><BookOpenText size={15} />项目库</button>}
          {selected && <><span className="breadcrumb-separator">/</span><span className="breadcrumb-current">{selected.name}</span></>}
          <button className="global-search-trigger" aria-label="全局搜索" onClick={() => setGlobalSearchOpen(true)}><Search size={15} /><span>全局搜索</span><kbd>Ctrl K</kbd></button>
          <span className="window-drag-space" />
          <span className={`local-only ${runtimeSettings.syncPaused ? "sync-paused" : ""}`}>{runtimeSettings.syncPaused ? <PauseCircle size={13} /> : <ShieldCheck size={13} />}{runtimeSettings.syncPaused ? "同步已暂停" : "本地优先"}</span>
        </div>
        {catalogStatus && (catalogStatus.writable === false || catalogStatus.warnings.length > 0) && (
          <aside className="catalog-persistence-warning" role="alert" aria-label="项目索引存储警告">
            <AlertTriangle size={18} />
            <div>
              <strong>{catalogStatus.mode === "readOnly" ? "项目库来自更高版本，当前只读" : "项目库数据库不可写"}</strong>
              <p>{catalogStatus.readOnlyReason ?? (catalogStatus.warnings.join("；") || "为防止假保存和数据丢失，导入、标签、设置、同步记录及其他持久写入已暂停。请恢复数据库后重启客户端。")}</p>
            </div>
          </aside>
        )}
        {selected ? (
          <ProjectView key={selected.id} api={runtime.api} project={selected} isDemo={runtime.isDemo} initialTab={selectedProjectTab} onBack={() => goLibrary()} onNotify={setToast} onProjectChange={(updated) => { setSelected(updated); setProjects((current) => current.map((project) => project.id === updated.id ? updated : project)); }} />
        ) : settingsOpen ? (
          <SettingsView api={runtime.api} isDemo={runtime.isDemo} projects={projects} onNotify={setToast} runtimeSettings={runtimeSettings} onRuntimeSettingsChange={setRuntimeSettings} onOpenOnboarding={() => setOnboardingOpen(true)} />
        ) : syncCenterOpen ? (
          <SyncCenterView api={runtime.api} projects={projects} paused={runtimeSettings.syncPaused} onPausedChange={(paused) => setRuntimeSettings((current) => ({ ...current, syncPaused: paused }))} onOpenProject={(project) => { setSelectedProjectTab("github"); setSelected(project); setSyncCenterOpen(false); }} onNotify={setToast} />
        ) : (
          <>
            {showOnboardingHint && <aside className="onboarding-hint" aria-label="新手向导提示"><div><BookOpenText size={18} /><span><strong>整理第一个项目</strong><small>只读扫描本机目录，不需要账号或工具链。</small></span></div><button className="button secondary" onClick={() => setOnboardingOpen(true)}>开始</button><IconButton label="不再提示" onClick={() => void completeOnboarding({ imported: [], dismissed: true })}><X size={16} /></IconButton></aside>}
            {libraryScope.kind === "research" ? <GlobalResearchLibrary api={runtime.api} projects={projects} onNotify={setToast} onOpenProject={(project) => { setSelectedProjectTab("references"); setSettingsOpen(false); setSyncCenterOpen(false); setSelected(project); }} /> : libraryScope.kind === "templates" ? <TemplateLibraryView api={runtime.api} projects={projects} isDemo={runtime.isDemo} onNotify={setToast} onProjectsChange={setProjects} onOpenProject={(project) => { setSelectedProjectTab("overview"); setSettingsOpen(false); setSyncCenterOpen(false); setSelected(project); }} /> : libraryScope.kind === "attention" ? <NeedsAttentionView api={runtime.api} projects={projects} onProjectsChange={setProjects} onNotify={setToast} onOpenSettings={() => { setSelected(null); setSyncCenterOpen(false); setSettingsOpen(true); }} onOpenActivity={() => { setSelected(null); setSettingsOpen(false); setSyncCenterOpen(true); }} onOpenProject={(project, tab) => { setSelectedProjectTab(tab); setSettingsOpen(false); setSyncCenterOpen(false); setSelected(project); }} /> : <LibraryView api={runtime.api} projects={projects} filter={filter} activeTag={activeTag} availableTags={tags} onFilterChange={(next) => { setFilter(next); setLibraryScope({ kind: "standard" }); }} onActiveTagChange={(tag) => { setActiveTag(tag); setLibraryScope({ kind: "standard" }); }} scopeTitle={scopeMeta.title} scopeDescription={scopeMeta.description} scopedProjectIds={scopeMeta.ids} issueFilterOverride={scopeMeta.issue} onManage={(project) => { setSelectedProjectTab("overview"); setSettingsOpen(false); setSyncCenterOpen(false); setSelected(project); }} onProjectsChange={setProjects} onNotify={setToast} isDemo={runtime.isDemo} openImportNonce={openImportNonce} />}
          </>
        )}
      </main>
      <GlobalSearchPalette api={runtime.api} projects={projects} open={globalSearchOpen} onClose={() => setGlobalSearchOpen(false)} onNotify={setToast} onOpenProject={(project, tab) => { setSelectedProjectTab(tab); setSettingsOpen(false); setSyncCenterOpen(false); setSelected(project); }} />
      {desktopMigration && <DesktopMigrationWizard preview={desktopMigration} onApply={applyDesktopMigration} onLater={() => setDesktopMigration(null)} />}
      {onboardingOpen && <OnboardingWizard api={runtime.api} projects={projects} onComplete={(result) => void completeOnboarding(result)} onNotify={setToast} />}
      {toast && <div className="toast" role="status">{toast}<IconButton label="关闭通知" onClick={() => setToast(null)}><X size={15} /></IconButton></div>}
    </div>
  );
}
