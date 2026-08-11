import { useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Code2,
  ExternalLink,
  FileCode2,
  Files,
  FolderKanban,
  FolderOpen,
  GitFork,
  LoaderCircle,
} from "lucide-react";
import type { WorkbenchApi } from "@/shared/ipc";
import type {
  BuildProfile,
  DocumentTarget,
  ProjectManifest,
  ProjectPdfInfo,
  ProjectSummary,
  ToolchainInfo
} from "@/shared/types";
import { getVsCodeApi, type VsCodeStatusView } from "./vscode-bridge";
import { GitHubSyncTab, ReferencesTab } from "./ProjectResources";
import { MobilePdfCard } from "./MobilePdfCard";

type ProjectTab = "overview" | "references" | "github";

interface ProjectViewProps {
  api: WorkbenchApi;
  project: ProjectSummary;
  isDemo: boolean;
  onBack: () => void;
  onNotify: (message: string) => void;
}

function IconButton({ label, children, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>;
}

export function ProjectView({ api, project, isDemo, onBack, onNotify }: ProjectViewProps) {
  const [manifest, setManifest] = useState<ProjectManifest | null>(null);
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
  }, [api, project.rootPath, onNotify]);

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

  function selectTarget(nextId: string) {
    const next = manifest?.targets.find((item) => item.id === nextId);
    if (!next) return;
    setTargetId(nextId);
    setProfileId(next.profiles[0]?.id ?? "");
  }

  async function initializeManagementManifest() {
    if (!manifest || !migrationOnly || initializingManifest) return;
    setInitializingManifest(true);
    try {
      const written = await api.manifest.write(project.rootPath, manifest);
      setManifest(written);
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
          api={api}
          manifest={manifest}
          project={project}
          isDemo={isDemo}
          target={target}
          profile={profile}
          projectPdf={projectPdf}
          toolchain={toolchain}
          vsCodeStatus={vsCodeStatus}
          onSelectTarget={selectTarget}
          onOpenFolder={() => void openProjectFolder()}
          onOpenProject={() => void openProjectInVsCode()}
          onOpenEntry={() => void openFileInVsCode(target.entry)}
          onNotify={onNotify}
        />
      )}
      {activeTab === "references" && <ReferencesTab api={api} project={project} isDemo={isDemo} onNotify={onNotify} />}
      {activeTab === "github" && <GitHubSyncTab api={api} project={project} isDemo={isDemo} onNotify={onNotify} />}
    </section>
  );
}

interface ProjectIntroductionTabProps {
  api: WorkbenchApi;
  manifest: ProjectManifest;
  project: ProjectSummary;
  isDemo: boolean;
  target: DocumentTarget;
  profile: BuildProfile;
  projectPdf: ProjectPdfInfo | null;
  toolchain: ToolchainInfo | null;
  vsCodeStatus: VsCodeStatusView | null;
  onSelectTarget: (id: string) => void;
  onOpenFolder: () => void;
  onOpenProject: () => void;
  onOpenEntry: () => void;
  onNotify: (message: string) => void;
}

function ProjectIntroductionTab({
  api,
  manifest,
  project,
  isDemo,
  target,
  profile,
  projectPdf,
  toolchain,
  vsCodeStatus,
  onSelectTarget,
  onOpenFolder,
  onOpenProject,
  onOpenEntry,
  onNotify
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
      <MobilePdfCard api={api} project={project} manifest={manifest} isDemo={isDemo} onNotify={onNotify} />
    </main>
  );
}
