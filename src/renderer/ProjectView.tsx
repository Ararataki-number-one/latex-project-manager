import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Braces,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleSlash2,
  Clock3,
  Code2,
  Eye,
  EyeOff,
  ExternalLink,
  FileCode2,
  FileOutput,
  Files,
  FolderKanban,
  FolderOpen,
  GitFork,
  LayoutDashboard,
  ListTree,
  LoaderCircle,
  Package,
  PanelLeft,
  Plus,
  Settings2,
  ShieldCheck,
  TextCursorInput,
  Trash2,
  X,
} from "lucide-react";
import type { WorkbenchApi } from "@/shared/ipc";
import type {
  AssetPin,
  BuildProfile,
  ChapterState,
  DocumentTarget,
  PackageSpec,
  ProjectManifest,
  ProjectPdfInfo,
  ProjectSummary,
  StructureNode,
  ToolchainInfo
} from "@/shared/types";
import { ELEGANTBOOK_OPTIONS } from "@/shared/elegantbook";
import { flushLatestManifest, ManifestPersistenceCoordinator } from "./manifest-persistence";
import { collectTargetAssets, describeClass, packageNotices } from "./project-display";
import { getVsCodeApi, type VsCodeStatusView } from "./vscode-bridge";
import { GitHubSyncTab, ReferencesTab } from "./ProjectResources";

type ProjectTab = "overview" | "references" | "github";

interface ProjectViewProps {
  api: WorkbenchApi;
  project: ProjectSummary;
  isDemo: boolean;
  onBack: () => void;
  onNotify: (message: string) => void;
}

const optionLabels: Record<string, { label: string; help?: string }> = {
  color: { label: "主题色", help: "color" },
  lang: { label: "语言", help: "lang" },
  result: { label: "答案与证明", help: "result" },
  mode: { label: "定理样式", help: "mode" },
  device: { label: "页面设备", help: "device" },
  math: { label: "数学字体", help: "math" },
  marginpar: { label: "边注", help: "marginpar" },
  toc: { label: "目录栏数", help: "toc（不是是否插入目录）" },
  scheme: { label: "中文章号", help: "scheme" },
  chinesefont: { label: "中文字体方案", help: "chinesefont" },
  usesamecnt: { label: "共用定理计数器", help: "usesamecnt" },
  citestyle: { label: "引用样式", help: "citestyle" },
  bibstyle: { label: "文献样式", help: "bibstyle" },
  thmcnt: { label: "定理计数层级", help: "thmcnt" },
  bibend: { label: "文献后端", help: "bibend" },
  titlestyle: { label: "章标题样式", help: "titlestyle" }
};

const phaseLabels: Record<StructureNode["phase"], string> = {
  frontmatter: "前置内容 · frontmatter",
  mainmatter: "正文 · mainmatter",
  appendix: "附录 · appendix",
  backmatter: "后置内容 · backmatter"
};

const chapterStates: Array<{ value: ChapterState; label: string; shortLabel: string; icon: typeof Eye }> = [
  { value: "full", label: "编入正文 · full", shortLabel: "正文", icon: Eye },
  { value: "titleOnly", label: "仅标题 · title only", shortLabel: "仅标题", icon: TextCursorInput },
  { value: "hidden", label: "排除 · hidden", shortLabel: "排除", icon: EyeOff }
];

function IconButton({ label, children, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>;
}

export function ProjectView({ api, project, isDemo, onBack, onNotify }: ProjectViewProps) {
  const [manifest, setManifest] = useState<ProjectManifest | null>(null);
  const [manifestDirty, setManifestDirty] = useState(false);
  const manifestVersion = useRef("");
  const manifestRef = useRef<ProjectManifest | null>(null);
  const manifestPersistence = useMemo(
    () => new ManifestPersistenceCoordinator((nextManifest) => api.manifest.write(project.rootPath, nextManifest)),
    [api, project.rootPath]
  );
  const [activeTab, setActiveTab] = useState<ProjectTab>("overview");
  const [targetId, setTargetId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [migrationOnly, setMigrationOnly] = useState(false);
  const [initializingManifest, setInitializingManifest] = useState(false);
  const [migrationLoadError, setMigrationLoadError] = useState<string | null>(null);
  const [toolchain, setToolchain] = useState<ToolchainInfo | null>(null);
  const [projectPdf, setProjectPdf] = useState<ProjectPdfInfo | null>(null);
  const [vsCodeStatus, setVsCodeStatus] = useState<VsCodeStatusView | null>(null);

  const target = manifest?.targets.find((item) => item.id === targetId) ?? manifest?.targets[0];
  const profile = target?.profiles.find((item) => item.id === profileId) ?? target?.profiles[0];

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.manifest.read(project.rootPath), api.toolchains.list()])
      .then(([nextManifest, toolchains]) => {
        if (cancelled) return;
        setManifest(nextManifest);
        manifestRef.current = nextManifest;
        manifestVersion.current = nextManifest.updatedAt;
        manifestPersistence.markPersisted(nextManifest.updatedAt);
        setTargetId(nextManifest.targets[0]?.id ?? "");
        setProfileId(nextManifest.targets[0]?.profiles[0]?.id ?? "");
        setToolchain(toolchains[0] ?? null);
      })
      .catch(async (error: unknown) => {
        if (cancelled) return;
        try {
          const candidates = await api.library.scan(project.rootPath, { maxDepth: 3 });
          const candidate = candidates.find((item) => item.rootPath.toLowerCase() === project.rootPath.toLowerCase()) ?? candidates[0];
          const entry = candidate?.entries[0]?.relativePath;
          if (!entry) throw new Error("没有找到可迁移的 documentclass 入口");
          const preview = await api.migration.preview(project.rootPath, entry);
          if (cancelled) return;
          setManifest(preview.manifest);
          manifestRef.current = preview.manifest;
          manifestVersion.current = preview.manifest.updatedAt;
          setTargetId(preview.manifest.targets[0]?.id ?? "");
          setProfileId(preview.manifest.targets[0]?.profiles[0]?.id ?? "");
          setMigrationOnly(true);
          setActiveTab("overview");
        } catch (migrationError) {
          const message = migrationError instanceof Error ? migrationError.message : error instanceof Error ? error.message : "无法读取项目清单";
          setMigrationLoadError(message);
          onNotify(message);
        }
      });
    return () => { cancelled = true; };
  }, [api, project.rootPath, onNotify, manifestPersistence]);

  useEffect(() => {
    let cancelled = false;
    void api.library.lastSuccessfulPdf(project.id)
      .then((pdf) => { if (!cancelled) setProjectPdf(pdf); })
      .catch(() => { if (!cancelled) setProjectPdf(null); });
    return () => { cancelled = true; };
  }, [api, project.id]);

  useEffect(() => {
    const vscode = getVsCodeApi(api);
    if (!vscode) {
      setVsCodeStatus({ available: false, latexWorkshop: { state: "unknown" } });
      return;
    }
    void vscode.status()
      .then(setVsCodeStatus)
      .catch(() => setVsCodeStatus({ available: false, latexWorkshop: { state: "unknown" } }));
  }, [api]);

  useEffect(() => {
    if (!manifest || !manifestDirty || isDemo) return;
    const submittedVersion = manifest.updatedAt;
    const timer = setTimeout(() => {
      void manifestPersistence.save(manifest)
        .then(() => {
          if (manifestVersion.current === submittedVersion) setManifestDirty(false);
        })
        .catch((error: unknown) => onNotify(error instanceof Error ? error.message : "无法保存项目清单"));
    }, 450);
    return () => clearTimeout(timer);
  }, [isDemo, manifest, manifestDirty, manifestPersistence, onNotify]);

  function selectTarget(nextId: string) {
    const next = manifest?.targets.find((item) => item.id === nextId);
    if (!next) return;
    setTargetId(nextId);
    setProfileId(next.profiles[0]?.id ?? "");
  }

  function patchTarget(updater: (current: DocumentTarget) => DocumentTarget) {
    if (!manifest || !target) return;
    const now = Date.now();
    const previousTime = Date.parse(manifest.updatedAt);
    const updatedAt = new Date(Math.max(now, Number.isFinite(previousTime) ? previousTime + 1 : now)).toISOString();
    const nextManifest = {
      ...manifest,
      updatedAt,
      targets: manifest.targets.map((item) => item.id === target.id ? updater(item) : item)
    };
    manifestRef.current = nextManifest;
    manifestVersion.current = updatedAt;
    setManifest(nextManifest);
    setManifestDirty(true);
  }

  function patchProfile(updater: (current: BuildProfile) => BuildProfile) {
    if (!profile) return;
    patchTarget((current) => ({ ...current, profiles: current.profiles.map((item) => item.id === profile.id ? updater(item) : item) }));
  }

  function duplicateProfile() {
    if (!profile) return;
    const duplicate: BuildProfile = {
      ...profile,
      id: `${profile.id}-copy-${Date.now().toString(36)}`,
      name: `${profile.name} 副本`,
      chapterState: { ...profile.chapterState },
      enabledBlocks: { ...profile.enabledBlocks },
      order: [...profile.order],
      focusNodes: profile.focusNodes ? [...profile.focusNodes] : undefined
    };
    patchTarget((current) => ({ ...current, profiles: [...current.profiles, duplicate] }));
    setProfileId(duplicate.id);
    onNotify(`已创建并切换到编译方案“${duplicate.name}”`);
  }

  async function initializeManagementManifest() {
    if (!manifest || !migrationOnly || initializingManifest) return;
    setInitializingManifest(true);
    try {
      const written = await api.manifest.write(project.rootPath, manifest);
      setManifest(written);
      manifestRef.current = written;
      manifestVersion.current = written.updatedAt;
      manifestPersistence.markPersisted(written.updatedAt);
      setManifestDirty(false);
      setMigrationOnly(false);
      onNotify("管理清单已建立；只写入 .latex-workbench/project.json，未修改 LaTeX 源文件。");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法建立项目管理清单");
    } finally {
      setInitializingManifest(false);
    }
  }

  async function openProjectInVsCode() {
    const vscode = getVsCodeApi(api);
    if (!vscode || vsCodeStatus?.available === false) {
      onNotify("未检测到 VS Code 或 VSCodium");
      return;
    }
    try {
      await vscode.openProject(project.rootPath);
      onNotify(isDemo ? "演示模式：已模拟打开 VS Code 项目" : "已在 VS Code 中打开项目");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法在 VS Code 中打开项目");
    }
  }

  async function openProjectFolder() {
    if (!project.pathAvailable) {
      onNotify("项目路径不可用，请先在项目库中重新定位目录");
      return;
    }
    if (isDemo) {
      onNotify(`演示模式：已模拟打开 ${project.name} 的文件夹`);
      return;
    }
    try {
      await api.library.openFolder(project.id);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法打开项目文件夹");
    }
  }

  async function openFileInVsCode(relativePath: string, line?: number) {
    const vscode = getVsCodeApi(api);
    if (!vscode || vsCodeStatus?.available === false) {
      onNotify("未检测到 VS Code 或 VSCodium");
      return;
    }
    try {
      await vscode.openFile(project.rootPath, relativePath, line);
      onNotify(isDemo ? "演示模式：已模拟打开 VS Code 文件" : `已在 VS Code 中打开 ${relativePath}${line ? `:${line}` : ""}`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法在 VS Code 中打开文件");
    }
  }

  async function openProfileInVsCode() {
    const vscode = getVsCodeApi(api);
    if (!target || !profile || !vscode || vsCodeStatus?.available === false) {
      onNotify("未检测到 VS Code 或 VSCodium");
      return;
    }
    if (!isDemo) {
      try {
        const saved = await flushLatestManifest(manifestPersistence, () => manifestRef.current);
        if (manifestVersion.current === saved.updatedAt) setManifestDirty(false);
      } catch (error) {
        onNotify(`${error instanceof Error ? error.message : "无法保存项目清单"}；未打开当前方案`);
        return;
      }
    }
    try {
      const wrapperPath = await vscode.openProfile(project.rootPath, target.id, profile.id);
      onNotify(isDemo ? "演示模式：已模拟打开当前方案" : `已在 VS Code 中打开方案入口 ${wrapperPath}`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法在 VS Code 中打开当前方案");
    }
  }

  if (!manifest || !target || !profile) {
    if (migrationLoadError) return <div className="project-loading migration-load-error"><AlertCircle size={24} /><div><strong>无法进入迁移预览</strong><span>{migrationLoadError}</span><button className="button secondary" onClick={onBack}>返回项目库</button></div></div>;
    return <div className="project-loading"><LoaderCircle size={22} className="spin" />正在读取项目结构…</div>;
  }

  const tabs: Array<{ id: ProjectTab; label: string; term: string; icon: typeof Code2 }> = migrationOnly
    ? [
        { id: "overview", label: "项目介绍", term: "About", icon: BookOpen },
        { id: "references", label: "原始文稿", term: "References", icon: Files },
        { id: "github", label: "GitHub", term: "同步 · Sync", icon: GitFork }
      ]
    : [
        { id: "overview", label: "项目介绍", term: "About", icon: BookOpen },
        { id: "references", label: "原始文稿", term: "References", icon: Files },
        { id: "github", label: "GitHub", term: "同步 · Sync", icon: GitFork }
      ];

  return (
    <section className="project-page">
      <header className="project-header">
        <IconButton label="返回项目库" className="back-button" onClick={onBack}><ArrowLeft size={19} /></IconButton>
        <div className="project-identity">
          <span className="project-avatar" aria-hidden="true"><FolderKanban size={21} /></span>
          <div className="project-heading"><p className="eyebrow">{target.classConfig.name} · {target.engine}</p><h1>{project.name}</h1><p className="project-root" title={project.rootPath}>{project.rootPath}</p></div>
        </div>
        <div className="target-context">
          <label><span>文档目标 · Target</span><select value={target.id} onChange={(event) => selectTarget(event.target.value)}>{manifest.targets.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.entry}</option>)}</select></label>
          <label><span>编译方案 · Profile</span><select value={profile.id} onChange={(event) => setProfileId(event.target.value)}>{target.profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div>
      </header>

      <nav className="project-tabs" aria-label="项目页面" role="tablist">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return <button role="tab" aria-selected={activeTab === tab.id} className={activeTab === tab.id ? "active" : ""} key={tab.id} onClick={() => setActiveTab(tab.id)}><Icon size={17} /><span>{tab.label}</span><small>{tab.term}</small></button>;
        })}
      </nav>

      {migrationOnly && <div className="pending-migration-banner"><AlertTriangle size={16} /><span>该项目尚未建立管理清单；这里只显示只读分析，不会接管或改写 LaTeX 源文件。</span><button disabled={initializingManifest} onClick={() => void initializeManagementManifest()}>{initializingManifest ? "正在建立…" : "建立管理清单"}</button></div>}

      {activeTab === "overview" && (
        <ProjectIntroductionTab
          manifest={manifest}
          project={project}
          target={target}
          profile={profile}
          projectPdf={projectPdf}
          toolchain={toolchain}
          vsCodeStatus={vsCodeStatus}
          onSelectTarget={selectTarget}
          onOpenFolder={() => void openProjectFolder()}
          onOpenProject={() => void openProjectInVsCode()}
          onOpenEntry={() => void openFileInVsCode(target.entry)}
        />
      )}
      {activeTab === "references" && <ReferencesTab api={api} project={project} isDemo={isDemo} onNotify={onNotify} />}
      {activeTab === "github" && <GitHubSyncTab api={api} project={project} isDemo={isDemo} onNotify={onNotify} />}
    </section>
  );
}

interface ProjectIntroductionTabProps {
  manifest: ProjectManifest;
  project: ProjectSummary;
  target: DocumentTarget;
  profile: BuildProfile;
  projectPdf: ProjectPdfInfo | null;
  toolchain: ToolchainInfo | null;
  vsCodeStatus: VsCodeStatusView | null;
  onSelectTarget: (id: string) => void;
  onOpenFolder: () => void;
  onOpenProject: () => void;
  onOpenEntry: () => void;
}

function ProjectIntroductionTab({
  manifest,
  project,
  target,
  profile,
  projectPdf,
  toolchain,
  vsCodeStatus,
  onSelectTarget,
  onOpenFolder,
  onOpenProject,
  onOpenEntry
}: ProjectIntroductionTabProps) {
  const editorLabel = vsCodeStatus?.editor === "codium" ? "VSCodium" : "VS Code";
  const pdfName = projectPdf?.path.split(/[\\/]/).at(-1) ?? "尚未发现 PDF";
  const pdfDetail = projectPdf
    ? `${(projectPdf.size / 1024 / 1024).toFixed(1)} MB · ${new Date(projectPdf.modifiedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`
    : "等待 VS Code / LaTeX Workshop 生成";
  const workshop = vsCodeStatus?.latexWorkshop.state === "installed"
    ? `已安装${vsCodeStatus.latexWorkshop.version ? ` · ${vsCodeStatus.latexWorkshop.version}` : ""}`
    : "未检测到";

  return (
    <main className="overview-page introduction-page">
      <header className="overview-heading introduction-heading">
        <div className="overview-heading-copy">
          <span className="overview-heading-icon" aria-hidden="true"><BookOpen size={21} /></span>
          <div><p className="eyebrow">项目管理</p><h2>项目介绍</h2><p>{target.name} · {target.entry}</p></div>
        </div>
        <div className="overview-primary-actions">
          <button className="button primary" onClick={onOpenFolder} disabled={!project.pathAvailable}><FolderOpen size={16} />打开项目文件夹</button>
          <button className="button secondary" onClick={onOpenProject} disabled={vsCodeStatus?.available === false}><Code2 size={16} />在 {editorLabel} 中打开</button>
          <button className="button secondary" onClick={onOpenEntry} disabled={vsCodeStatus?.available === false}><ExternalLink size={16} />打开主文件</button>
        </div>
      </header>

      <div className="introduction-grid">
        <section className="overview-section introduction-targets">
          <header><div><h3>文档入口</h3><p>{manifest.targets.length} 个主文件，选择后可查看对应信息。</p></div></header>
          <div className="overview-target-table">
            {manifest.targets.map((item) => (
              <button className={item.id === target.id ? "selected" : ""} aria-pressed={item.id === target.id} key={item.id} onClick={() => onSelectTarget(item.id)}>
                <span className="target-file-icon"><FileCode2 size={17} /></span>
                <span className="target-name"><strong>{item.name}</strong><small>{item.entry}</small></span>
                <span><small>文档类</small><strong>{item.classConfig.name}</strong></span>
                <span><small>引擎</small><strong>{item.engine === "auto" ? "自动检测" : item.engine}</strong></span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </section>

        <section className="overview-section introduction-details">
          <header><div><h3>基本信息</h3><p>只显示日常管理需要的信息。</p></div></header>
          <div className="introduction-facts">
            <div><span>当前入口</span><strong title={target.entry}>{target.entry}</strong></div>
            <div><span>当前方案</span><strong>{profile.name}</strong></div>
            <div><span>文档类与引擎</span><strong>{target.classConfig.name} · {target.engine === "auto" ? "自动检测" : target.engine}</strong></div>
            <div><span>TeX 工具链</span><strong>{toolchain ? `${toolchain.name === "texlive" ? "TeX Live" : toolchain.name} ${toolchain.version ?? ""}` : "未检测到"}</strong></div>
            <div><span>{editorLabel}</span><strong>{vsCodeStatus?.available ? "已就绪" : "未检测到"}</strong></div>
            <div><span>LaTeX Workshop</span><strong>{workshop}</strong></div>
            <div className="introduction-pdf"><span>最近 PDF</span><strong>{pdfName}</strong><small>{pdfDetail}</small></div>
          </div>
        </section>
      </div>
    </main>
  );
}

interface OverviewTabProps {
  manifest: ProjectManifest;
  project: ProjectSummary;
  target: DocumentTarget;
  profile: BuildProfile;
  projectPdf: ProjectPdfInfo | null;
  readOnly: boolean;
  toolchain: ToolchainInfo | null;
  vsCodeStatus: VsCodeStatusView | null;
  onSelectTarget: (id: string) => void;
  onSelectProfile: (id: string) => void;
  onOpenFolder: () => void;
  onOpenProject: () => void;
  onOpenProfile: () => void;
  onOpenEntry: () => void;
  onOpenStructure: () => void;
  onOpenConfiguration: () => void;
}

function OverviewTab({
  manifest,
  project,
  target,
  profile,
  projectPdf,
  readOnly,
  toolchain,
  vsCodeStatus,
  onSelectTarget,
  onSelectProfile,
  onOpenFolder,
  onOpenProject,
  onOpenProfile,
  onOpenEntry,
  onOpenStructure,
  onOpenConfiguration
}: OverviewTabProps) {
  const contentNodes = target.structure.filter((node) => ["part", "chapter", "input", "appendix"].includes(node.kind));
  const chapterCounts = contentNodes.reduce((counts, node) => {
    const state = profile.chapterState[node.id] ?? "full";
    counts[state] += 1;
    return counts;
  }, { full: 0, titleOnly: 0, hidden: 0 } as Record<ChapterState, number>);
  const profileCount = manifest.targets.reduce((count, item) => count + item.profiles.length, 0);
  const packageProblems = target.packages.filter((item) => item.diagnostic && item.diagnostic !== "ok");
  const pdfStatus = projectPdf ? "success" : "idle";
  const pdfTime = projectPdf ? new Date(projectPdf.modifiedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "尚未发现";
  const pdfName = projectPdf?.path.split(/[\\/]/).at(-1) ?? "没有可用 PDF";
  const pdfSize = projectPdf ? `${(projectPdf.size / 1024 / 1024).toFixed(1)} MB` : "—";
  const editorLabel = vsCodeStatus?.editor === "codium" ? "VSCodium" : "VS Code";

  const healthItems: Array<{ id: string; state: "ok" | "warning" | "error" | "checking"; title: string; detail: string }> = [
    {
      id: "root",
      state: project.pathAvailable ? "ok" : "error",
      title: "项目路径",
      detail: project.pathAvailable ? "根目录可访问" : "路径不可用，需要重新定位"
    },
    {
      id: "toolchain",
      state: toolchain ? "ok" : "error",
      title: "TeX 工具链",
      detail: toolchain ? `${toolchain.name === "texlive" ? "TeX Live" : toolchain.name} ${toolchain.version ?? ""} · latexmk` : "未检测到可用发行版"
    },
    {
      id: "vscode",
      state: vsCodeStatus === null ? "checking" : vsCodeStatus.available ? "ok" : "warning",
      title: "外部编辑器",
      detail: vsCodeStatus === null ? "正在检测 VS Code" : vsCodeStatus.available ? `${editorLabel} 已就绪` : "未检测到 VS Code 或 VSCodium"
    },
    {
      id: "latex-workshop",
      state: vsCodeStatus === null || vsCodeStatus.latexWorkshop.state === "unknown" ? "checking" : vsCodeStatus.latexWorkshop.state === "installed" ? "ok" : "warning",
      title: "LaTeX Workshop",
      detail: vsCodeStatus?.latexWorkshop.state === "installed" ? `已安装${vsCodeStatus.latexWorkshop.version ? ` · ${vsCodeStatus.latexWorkshop.version}` : ""}` : vsCodeStatus?.latexWorkshop.state === "notFound" ? "未检测到扩展" : "状态未知"
    },
    {
      id: "packages",
      state: packageProblems.some((item) => item.diagnostic === "missing" || item.diagnostic === "conflict") ? "error" : packageProblems.length ? "warning" : "ok",
      title: "宏包诊断",
      detail: packageProblems.length ? `${packageProblems.length} 项需要处理` : `${target.packages.length} 个宏包无阻断问题`
    },
    {
      id: "class",
      state: target.classConfig.source === "project" && !target.classConfig.sourceHash ? "warning" : "ok",
      title: "文档类资源",
      detail: target.classConfig.sourceHash ? `${target.classConfig.name}.cls 已按哈希固定` : `${target.classConfig.name}.cls · ${target.classConfig.source ?? "来源未知"}`
    }
  ];

  return (
    <main className="overview-page">
      <header className="overview-heading">
        <div className="overview-heading-copy">
          <span className="overview-heading-icon" aria-hidden="true"><LayoutDashboard size={21} /></span>
          <div>
            <p className="eyebrow">项目管理</p>
            <h2>项目总览</h2>
            <p>{target.name} · {profile.name} · {target.entry}</p>
          </div>
        </div>
        <div className="overview-primary-actions">
          <button className="button primary" onClick={onOpenFolder} disabled={!project.pathAvailable}><FolderOpen size={16} />打开项目文件夹</button>
          <button className="button secondary" onClick={onOpenProject} disabled={vsCodeStatus?.available === false}><Code2 size={16} />在 {editorLabel} 中打开</button>
          {!readOnly && <button className="button secondary" onClick={onOpenProfile} disabled={vsCodeStatus?.available === false} title="生成当前章节方案入口，并交给 LaTeX Workshop 编译"><FileOutput size={16} />在 {editorLabel} 打开当前方案</button>}
          <button className="button secondary" onClick={onOpenEntry} disabled={vsCodeStatus?.available === false}><ExternalLink size={16} />打开原始主文件</button>
        </div>
      </header>

      <div className="overview-metrics" aria-label="项目摘要">
        <div><span className="metric-icon"><FileCode2 size={17} /></span><div className="metric-copy"><span>文档目标 · Targets</span><strong>{manifest.targets.length}</strong><small>{manifest.targets.map((item) => item.entry).join(" · ")}</small></div></div>
        <div><span className="metric-icon"><ListTree size={17} /></span><div className="metric-copy"><span>编译方案 · Profiles</span><strong>{profileCount}</strong><small>当前：{profile.name}</small></div></div>
        <div><span className="metric-icon"><Eye size={17} /></span><div className="metric-copy"><span>当前输出章节</span><strong>{chapterCounts.full}</strong><small>{chapterCounts.titleOnly} 仅标题 · {chapterCounts.hidden} 排除</small></div></div>
        <div className={`metric-build status-${pdfStatus}`}><span className="metric-icon"><FileOutput size={17} /></span><div className="metric-copy"><span>最近 PDF · Latest PDF</span><strong>{projectPdf ? pdfName : "尚未发现"}</strong><small>{pdfTime}</small></div></div>
      </div>

      <section className="overview-section target-section">
        <header><div><h3>文档目标 · Document targets</h3><p>一个项目目录可以管理多个独立入口。</p></div><button className="text-command" onClick={onOpenConfiguration} disabled={readOnly}><Settings2 size={14} />目标配置</button></header>
        <div className="overview-target-table" role="list">
          {manifest.targets.map((item) => (
            <button role="listitem" className={item.id === target.id ? "selected" : ""} key={item.id} onClick={() => onSelectTarget(item.id)}>
              <span className="target-file-icon"><FileCode2 size={17} /></span>
              <span className="target-name"><strong>{item.name}</strong><small>{item.entry}</small></span>
              <span><small>文档类</small><strong>{item.classConfig.name}</strong></span>
              <span><small>引擎</small><strong>{item.engine === "auto" ? "自动检测" : item.engine}</strong></span>
              <span><small>方案</small><strong>{item.profiles.length}</strong></span>
              <span className={projectPdf?.targetId === item.id ? "target-status status-success" : "target-status status-idle"}>{projectPdf?.targetId === item.id ? "PDF 可用" : item.id === target.id ? "当前目标" : "未选中"}</span>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      </section>

      <div className="overview-columns">
        <section className="overview-section profile-section">
          <header><div><h3>编译方案 · Build profile</h3><p>控制章节状态、编号和输出结构。</p></div><button className="text-command" onClick={onOpenStructure} disabled={readOnly}><ListTree size={14} />管理结构</button></header>
          <label className="overview-profile-select"><span>当前方案</span><select value={profile.id} onChange={(event) => onSelectProfile(event.target.value)}>{target.profiles.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <div className="chapter-state-bar" aria-label="章节状态分布">
            {chapterCounts.full > 0 && <span className="full" style={{ flex: chapterCounts.full }} />}
            {chapterCounts.titleOnly > 0 && <span className="title-only" style={{ flex: chapterCounts.titleOnly }} />}
            {chapterCounts.hidden > 0 && <span className="hidden" style={{ flex: chapterCounts.hidden }} />}
          </div>
          <div className="chapter-state-summary">
            <button onClick={onOpenStructure} disabled={readOnly}><Eye size={15} /><span><strong>{chapterCounts.full}</strong><small>编入正文</small></span></button>
            <button onClick={onOpenStructure} disabled={readOnly}><TextCursorInput size={15} /><span><strong>{chapterCounts.titleOnly}</strong><small>仅标题</small></span></button>
            <button onClick={onOpenStructure} disabled={readOnly}><EyeOff size={15} /><span><strong>{chapterCounts.hidden}</strong><small>排除</small></span></button>
          </div>
          <div className="profile-facts"><span>编号：{profile.numbering === "preserve" ? "保留原编号" : "连续重排"}</span><span>结构块：{target.structure.length}</span></div>
        </section>

        <section className="overview-section health-section">
          <header><div><h3>项目健康 · Health</h3><p>路径、工具链、编辑器与依赖状态。</p></div><button className="text-command" onClick={onOpenConfiguration} disabled={readOnly}><Settings2 size={14} />查看诊断</button></header>
          <div className="health-list">
            {healthItems.map((item) => (
              <div className={`health-row health-${item.state}`} key={item.id}>
                {item.state === "ok" ? <CheckCircle2 size={16} /> : item.state === "error" ? <AlertCircle size={16} /> : item.state === "warning" ? <AlertTriangle size={16} /> : <LoaderCircle size={16} className="spin" />}
                <span><strong>{item.title}</strong><small>{item.detail}</small></span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="overview-section recent-build-section">
        <header><div><h3>最近 PDF · Latest PDF</h3><p>{projectPdf ? pdfName : "尚未在项目中发现主 PDF"}</p></div><span className="management-only-note">由 VS Code / LaTeX Workshop 生成</span></header>
        <div className="recent-build-row">
          <span className={`recent-build-icon status-${pdfStatus}`}>{projectPdf ? <CheckCircle2 size={17} /> : <Clock3 size={17} />}</span>
          <span><strong>{projectPdf ? "可打开和导出" : "等待外部编译输出"}</strong><small>{pdfTime}</small></span>
          <span><small>入口</small><strong>{target.entry}</strong></span>
          <span><small>大小</small><strong>{pdfSize}</strong></span>
          <span><small>来源目标</small><strong>{projectPdf?.targetId ?? "自动识别"}</strong></span>
          <span className="build-output-path" title={projectPdf?.path}><small>文件</small><strong>{pdfName}</strong></span>
        </div>
      </section>
    </main>
  );
}

interface StructureTabProps {
  target: DocumentTarget;
  profile: BuildProfile;
  onProfileChange: (updater: (profile: BuildProfile) => BuildProfile) => void;
  onDuplicateProfile: () => void;
}

function StructureTab({ target, profile, onProfileChange, onDuplicateProfile }: StructureTabProps) {
  const ordered = [...target.structure].sort((a, b) => profile.order.indexOf(a.id) - profile.order.indexOf(b.id));
  const phases = (["frontmatter", "mainmatter", "appendix", "backmatter"] as StructureNode["phase"][]).map((phase) => ({ phase, nodes: ordered.filter((node) => node.phase === phase) })).filter((group) => group.nodes.length);

  function stateFor(node: StructureNode): ChapterState {
    if (["chapter", "input", "appendix", "part"].includes(node.kind)) return profile.chapterState[node.id] ?? "full";
    return profile.enabledBlocks[node.id] === false ? "hidden" : "full";
  }

  function setState(node: StructureNode, state: ChapterState) {
    onProfileChange((current) => {
      if (["chapter", "input", "appendix", "part"].includes(node.kind)) return { ...current, chapterState: { ...current.chapterState, [node.id]: state } };
      return { ...current, enabledBlocks: { ...current.enabledBlocks, [node.id]: state !== "hidden" } };
    });
  }

  function move(node: StructureNode, direction: -1 | 1) {
    const next = [...profile.order];
    const index = next.indexOf(node.id);
    const peerIds = ordered.filter((item) => item.phase === node.phase).map((item) => item.id);
    const peerIndex = peerIds.indexOf(node.id);
    const swapId = peerIds[peerIndex + direction];
    const swapIndex = next.indexOf(swapId);
    if (index < 0 || swapIndex < 0) return;
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
    onProfileChange((current) => ({ ...current, order: next }));
  }

  const included = ordered.filter((node) => stateFor(node) === "full").length;
  const titleOnly = ordered.filter((node) => stateFor(node) === "titleOnly").length;

  return (
    <div className="settings-layout structure-layout">
      <aside className="settings-sidebar">
        <p className="eyebrow">当前编译方案</p><h2>{profile.name}</h2>
        <div className="profile-summary"><div><strong>{included}</strong><span>编入正文</span></div><div><strong>{titleOnly}</strong><span>仅标题</span></div><div><strong>{ordered.length - included - titleOnly}</strong><span>排除</span></div></div>
        <div className="sidebar-section"><label>编号模式 · Numbering</label><div className="segmented vertical"><button className={profile.numbering === "preserve" ? "active" : ""} onClick={() => onProfileChange((current) => ({ ...current, numbering: "preserve" }))}><BookOpen size={16} /><span><strong>保留原编号</strong><small>章节号与完整书稿一致</small></span></button><button className={profile.numbering === "continuous" ? "active" : ""} onClick={() => onProfileChange((current) => ({ ...current, numbering: "continuous" }))}><ListTree size={16} /><span><strong>连续重排</strong><small>仅对当前输出重新编号</small></span></button></div></div>
        <button className="button secondary full" onClick={onDuplicateProfile}><Plus size={16} />复制为新方案</button>
      </aside>
      <main className="settings-content">
        <header className="section-heading"><div><p className="eyebrow">输出顺序与可见性</p><h2>文档结构 · Document structure</h2><p>“仅标题”保留章节标题、编号和目录项，但不读取正文。</p></div></header>
        <div className="structure-legend"><span><Eye size={14} />编入正文</span><span><TextCursorInput size={14} />仅标题</span><span><EyeOff size={14} />排除</span><i />使用箭头调整同一区域内的顺序</div>
        <div className="structure-groups">
          {phases.map(({ phase, nodes }) => (
            <section className="structure-group" key={phase}>
              <header><span>{phaseLabels[phase]}</span><small>{nodes.length} 项</small></header>
              {nodes.map((node, index) => {
                const value = stateFor(node);
                return (
                  <div className={`structure-row state-${value}`} key={node.id}>
                    <div className="structure-order"><IconButton label="上移" disabled={index === 0} onClick={() => move(node, -1)}><ArrowUp size={14} /></IconButton><IconButton label="下移" disabled={index === nodes.length - 1} onClick={() => move(node, 1)}><ArrowDown size={14} /></IconButton></div>
                    <div className="structure-icon">{node.kind === "chapter" || node.kind === "appendix" ? <BookOpen size={17} /> : node.kind === "bibliography" || node.kind === "index" ? <Braces size={17} /> : <FileCode2 size={17} />}</div>
                    <div className="structure-main"><strong>{node.originalNumber ? `${node.originalNumber}. ` : ""}{node.title}</strong><span>{node.path ?? node.kind}{node.managed ? " · 受管" : " · 原样保留"}</span></div>
                    <div className="state-control segmented">
                      {chapterStates.filter((item) => item.value !== "titleOnly" || ["chapter", "input", "appendix", "part"].includes(node.kind)).map((item) => { const Icon = item.icon; return <button key={item.value} title={item.label} aria-label={`${node.title}：${item.label}`} className={value === item.value ? "active" : ""} onClick={() => setState(node, item.value)}><Icon size={14} /><span>{item.shortLabel}</span></button>; })}
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}

interface ConfigurationTabProps {
  target: DocumentTarget;
  assets: AssetPin[];
  onTargetChange: (target: DocumentTarget) => void;
  onNotify: (message: string) => void;
}

function ConfigurationTab({ target, assets, onTargetChange, onNotify }: ConfigurationTabProps) {
  const [section, setSection] = useState<"class" | "packages" | "assets">("class");
  const [newPackage, setNewPackage] = useState("");
  const classPresentation = describeClass(target.classConfig);
  const notices = packageNotices(target.packages, target.classConfig.name);
  const targetAssets = collectTargetAssets(target, assets);
  const elegantOptionKeys = new Set(ELEGANTBOOK_OPTIONS.map((definition) => definition.key));
  const additionalOptions = Object.entries(target.classConfig.options).filter(([key]) => !classPresentation.isElegantBook || !elegantOptionKeys.has(key));

  function setOption(key: string, value: string | boolean) {
    onTargetChange({ ...target, classConfig: { ...target.classConfig, options: { ...target.classConfig.options, [key]: value } } });
  }

  function addPackage() {
    const name = newPackage.trim().replace(/^\\usepackage(?:\[[^\]]*\])?\{?|\}$/g, "");
    if (!name) return;
    const existing = target.packages.find((item) => item.name === name);
    if (existing) {
      onNotify(`${name} 已由${existing.source === "class" ? "文档类" : "前导区"}加载，请先处理重复或选项冲突。`);
      return;
    }
    const item: PackageSpec = { id: `pkg-${name}-${Date.now()}`, name, options: [], enabled: true, order: target.packages.length, source: "managed", diagnostic: "ok" };
    onTargetChange({ ...target, packages: [...target.packages, item] });
    setNewPackage("");
  }

  function patchPackage(id: string, patch: Partial<PackageSpec>) {
    onTargetChange({ ...target, packages: target.packages.map((item) => item.id === id ? { ...item, ...patch } : item) });
  }

  return (
    <div className="settings-layout configuration-layout">
      <aside className="settings-sidebar config-nav">
        <p className="eyebrow">目标配置</p><h2>{target.name}</h2><p>{target.entry}</p>
        <nav>
          <button className={section === "class" ? "active" : ""} onClick={() => setSection("class")}><BookOpen size={17} /><span>文档类</span><small>Document class</small></button>
          <button className={section === "packages" ? "active" : ""} onClick={() => setSection("packages")}><Package size={17} /><span>宏包</span><small>Packages</small></button>
          <button className={section === "assets" ? "active" : ""} onClick={() => setSection("assets")}><ShieldCheck size={17} /><span>固定资源</span><small>Assets</small></button>
        </nav>
        <div className="managed-info"><ShieldCheck size={17} /><div><strong>当前目标清单</strong><span>{target.structure.length} 个结构节点 · {target.packages.length} 个宏包</span></div></div>
      </aside>
      <main className="settings-content">
        {section === "class" && (
          <>
            <header className="section-heading"><div><p className="eyebrow">{classPresentation.eyebrow}</p><h2>{classPresentation.title}</h2><p>修改后写入当前目标配置；无法识别的原始选项保持不变。</p></div><span className="source-badge"><ShieldCheck size={14} />{classPresentation.badge}</span></header>
            <div className="class-source-row"><div><span>文档类 · documentclass</span><strong>{target.classConfig.name}.cls</strong></div><div><span>来源</span><strong>{classPresentation.source}</strong></div><div><span>内容哈希</span><code>{target.classConfig.sourceHash?.slice(0, 12) ?? "未固定"}</code></div></div>
            {classPresentation.isElegantBook && (
              <div className="option-grid">
                {ELEGANTBOOK_OPTIONS.map((definition) => {
                  const label = optionLabels[definition.key] ?? { label: definition.key, help: definition.key };
                  const value = target.classConfig.options[definition.key] ?? definition.defaultValue;
                  return (
                    <label className={`option-field ${definition.kind === "toggle" ? "toggle-option" : ""}`} key={definition.key}>
                      <span><strong>{label.label}</strong><small>{label.help}</small></span>
                      {definition.kind === "select" && <select value={String(value)} onChange={(event) => setOption(definition.key, event.target.value)}>{definition.values?.map((item) => <option key={item} value={item}>{item || "默认"}</option>)}</select>}
                      {definition.kind === "text" && <input value={String(value)} onChange={(event) => setOption(definition.key, event.target.value)} />}
                      {definition.kind === "toggle" && <input type="checkbox" checked={Boolean(value)} onChange={(event) => setOption(definition.key, event.target.checked)} />}
                      {definition.warning && <i title={definition.warning}><AlertTriangle size={14} /></i>}
                    </label>
                  );
                })}
              </div>
            )}
            {!classPresentation.isElegantBook && additionalOptions.length === 0 && <div className="empty-state compact"><Braces size={24} /><h3>没有已解析的键值选项</h3><p>该文档类没有专用表单，仍可管理下方保留的原始选项。</p></div>}
            {additionalOptions.length > 0 && (
              <div className="option-grid generic-option-grid">
                {additionalOptions.map(([key, value]) => (
                  <label className={`option-field ${typeof value === "boolean" ? "toggle-option" : ""}`} key={key}>
                    <span><strong>{key}</strong><small>documentclass option</small></span>
                    {typeof value === "boolean"
                      ? <input type="checkbox" checked={value} onChange={(event) => setOption(key, event.target.checked)} />
                      : <input value={value} onChange={(event) => setOption(key, event.target.value)} />}
                  </label>
                ))}
              </div>
            )}
            <div className="raw-options"><label><span><strong>保留的原始选项 · Raw options</strong><small>客户端不了解的选项不会被删除</small></span><input value={target.classConfig.rawOptions.join(", ")} onChange={(event) => onTargetChange({ ...target, classConfig: { ...target.classConfig, rawOptions: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) } })} /></label></div>
          </>
        )}
        {section === "packages" && (
          <>
            <header className="section-heading"><div><p className="eyebrow">加载来源与诊断</p><h2>宏包 · Packages</h2><p>文档类内置宏包只读显示；受管宏包可排序、配置和停用。</p></div><div className="add-package"><input value={newPackage} onChange={(event) => setNewPackage(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addPackage()} placeholder="输入宏包名，如 cleveref" aria-label="新宏包名称" /><button className="button primary" onClick={addPackage}><Plus size={16} />添加</button></div></header>
            <div className="diagnostic-summary"><span><CheckCircle2 size={16} />{target.packages.filter((item) => item.diagnostic === "ok").length} 正常</span><span className="warning"><AlertTriangle size={16} />{target.packages.filter((item) => item.diagnostic === "duplicate" || item.diagnostic === "conflict").length} 冲突</span><span className="error"><CircleSlash2 size={16} />{target.packages.filter((item) => item.diagnostic === "missing").length} 缺失</span><i />缺包只诊断，不会静默安装</div>
            <div className="package-table" role="table" aria-label="宏包列表">
              <div className="package-head" role="row"><span>启用</span><span>宏包</span><span>选项</span><span>来源</span><span>诊断</span><span /></div>
              {[...target.packages].sort((a, b) => a.order - b.order).map((item) => (
                <div className={`package-row diagnostic-${item.diagnostic ?? "ok"}`} role="row" key={item.id}>
                  <span><input type="checkbox" checked={item.enabled} disabled={item.source === "class"} onChange={(event) => patchPackage(item.id, { enabled: event.target.checked })} aria-label={`${item.enabled ? "停用" : "启用"} ${item.name}`} /></span>
                  <strong><Package size={15} />{item.name}</strong>
                  <input value={item.options.join(", ")} disabled={item.source === "class"} onChange={(event) => patchPackage(item.id, { options: event.target.value.split(",").map((option) => option.trim()).filter(Boolean) })} aria-label={`${item.name} 选项`} placeholder="无选项" />
                  <span className={`source source-${item.source}`}>{item.source === "class" ? "文档类内置" : item.source === "managed" ? "受管区块" : "手动代码"}</span>
                  <span className={`diagnostic ${item.diagnostic ?? "ok"}`}>{item.diagnostic === "missing" ? <><CircleSlash2 size={14} />本机缺失</> : item.diagnostic === "duplicate" ? <><AlertTriangle size={14} />重复加载</> : item.diagnostic === "conflict" ? <><AlertCircle size={14} />选项冲突</> : <><Check size={14} />正常</>}</span>
                  {item.source === "managed" ? <IconButton label={`删除 ${item.name}`} onClick={() => onTargetChange({ ...target, packages: target.packages.filter((entry) => entry.id !== item.id) })}><Trash2 size={15} /></IconButton> : <IconButton label={`${item.name} 由${item.source === "class" ? "文档类" : "手动代码"}加载`} disabled><ShieldCheck size={15} /></IconButton>}
                </div>
              ))}
            </div>
            {notices.map((notice) => <div className={`package-advice ${notice.severity}`} key={notice.id}>{notice.severity === "error" ? <CircleSlash2 size={17} /> : <AlertTriangle size={17} />}<div><strong>{notice.title}</strong><p>{notice.detail}</p></div></div>)}
          </>
        )}
        {section === "assets" && (
          <>
            <header className="section-heading"><div><p className="eyebrow">可复现资源</p><h2>固定资源 · Asset pins</h2><p>文档类、字体和模板按内容哈希识别，不按版本号自动覆盖。</p></div></header>
            {targetAssets.length > 0 ? targetAssets.map((asset) => (
              <div className="asset-row" key={asset.id}><ShieldCheck size={20} /><div><strong>{asset.path}</strong><span>{asset.kind === "class" ? "文档类" : asset.kind === "font" ? "字体" : asset.kind === "template" ? "模板" : "其他资源"}{asset.source ? ` · ${asset.source}` : ""}</span><code>{asset.hash}</code></div><span className="badge success">已固定</span></div>
            )) : <div className="empty-state compact"><CircleSlash2 size={24} /><h3>没有固定资源</h3><p>当前项目清单未记录文档类、字体或模板资源的内容哈希。</p></div>}
          </>
        )}
      </main>
    </div>
  );
}
