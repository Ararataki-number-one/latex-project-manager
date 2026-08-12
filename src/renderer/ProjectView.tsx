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
  BackupSnapshot,
  DocumentTarget,
  ProjectBackupSettings,
  ProjectManifest,
  ProjectPdfInfo,
  ProjectSummary,
  ToolchainInfo
} from "@/shared/types";
import { getVsCodeApi, type VsCodeStatusView } from "./vscode-bridge";
import { GitHubSyncTab, ReferencesTab } from "./ProjectResources";
import { MobilePdfCard } from "./MobilePdfCard";
import { ProjectFiles } from "./ProjectFiles";

type ProjectTab = "overview" | "files" | "references" | "github";

interface ProjectViewProps {
  api: WorkbenchApi;
  project: ProjectSummary;
  isDemo: boolean;
  initialTab?: ProjectTab;
  onBack: () => void;
  onNotify: (message: string) => void;
  onProjectChange?: (project: ProjectSummary) => void;
}

function IconButton({ label, children, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>;
}

export function ProjectView({ api, project, isDemo, initialTab = "overview", onBack, onNotify, onProjectChange }: ProjectViewProps) {
  const [manifest, setManifest] = useState<ProjectManifest | null>(null);
  const [activeTab, setActiveTab] = useState<ProjectTab>(initialTab);
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
      onNotify(vsCodeStatus?.diagnostics?.[0] ?? "未检测到 VS Code 或 VSCodium；安装后请重启客户端");
      return;
    }
    try {
      await vscode.openProject(project.rootPath);
      onNotify(isDemo ? "演示模式：已模拟打开 VS Code 项目" : vsCodeStatus?.latexWorkshop.state === "notFound"
        ? "已在 VS Code 中打开项目；未检测到 LaTeX Workshop，编译功能可能不可用"
        : "已在 VS Code 中打开项目");
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

  const tabs: Array<{ id: ProjectTab; label: string; icon: typeof Code2 }> = migrationOnly
    ? [
        { id: "overview", label: "项目介绍", icon: BookOpen },
        { id: "files", label: "文件", icon: FolderOpen },
        { id: "references", label: "研究资料", icon: Files },
        { id: "github", label: "同步", icon: GitFork }
      ]
    : [
        { id: "overview", label: "项目介绍", icon: BookOpen },
        { id: "files", label: "文件", icon: FolderOpen },
        { id: "references", label: "研究资料", icon: Files },
        { id: "github", label: "同步", icon: GitFork }
      ];

  return (
    <section className="project-page">
      <header className="project-header">
        <IconButton label="返回项目库" className="back-button" onClick={onBack}><ArrowLeft size={19} /></IconButton>
        <div className="project-identity">
          <span className="project-avatar" aria-hidden="true"><FolderKanban size={21} /></span>
          <div className="project-heading"><h1>{project.name}</h1><p className="project-root" title={project.rootPath}>{project.rootPath}</p><div className="project-heading-meta"><span>{manifest.targets.length} 个文档入口</span><span>{target.classConfig.name}</span><span>{target.engine === "auto" ? "自动检测引擎" : target.engine}</span></div></div>
        </div>
        <div className="project-header-actions">
          <button className="button primary" onClick={() => void openProjectFolder()} disabled={!project.pathAvailable}><FolderOpen size={16} />打开文件夹</button>
          <button className="button secondary" onClick={() => void openProjectInVsCode()}><Code2 size={16} />在 VS Code 中打开</button>
        </div>
      </header>

      <nav className="project-tabs" aria-label="项目页面" role="tablist">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return <button role="tab" aria-label={tab.id === "references" ? "原始文稿 · 研究资料" : tab.label} aria-selected={activeTab === tab.id} className={activeTab === tab.id ? "active" : ""} key={tab.id} onClick={() => setActiveTab(tab.id)}><Icon size={17} /><span>{tab.label}</span></button>;
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
          onSelectProfile={setProfileId}
          onOpenEntry={() => void openFileInVsCode(target.entry)}
          onNotify={onNotify}
          onProjectChange={onProjectChange}
        />
      )}
      {activeTab === "files" && <ProjectFiles api={api} project={project} isDemo={isDemo} onNotify={onNotify} />}
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
  onSelectProfile: (id: string) => void;
  onOpenEntry: () => void;
  onNotify: (message: string) => void;
  onProjectChange?: (project: ProjectSummary) => void;
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
  onSelectProfile,
  onOpenEntry,
  onNotify,
  onProjectChange
}: ProjectIntroductionTabProps) {
  const [descriptionDraft, setDescriptionDraft] = useState(project.description ?? "");
  const [savingDescription, setSavingDescription] = useState(false);
  const editorLabel = vsCodeStatus?.editor === "codium" ? "VSCodium" : "VS Code";
  const pdfName = projectPdf?.path.split(/[\\/]/).at(-1) ?? "尚未发现 PDF";
  const pdfDetail = projectPdf
    ? `${(projectPdf.size / 1024 / 1024).toFixed(1)} MB · ${new Date(projectPdf.modifiedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`
    : "等待 VS Code / LaTeX Workshop 生成";
  const workshop = vsCodeStatus?.latexWorkshop.state === "installed"
    ? `已安装${vsCodeStatus.latexWorkshop.version ? ` · ${vsCodeStatus.latexWorkshop.version}` : ""}`
    : "未检测到";

  async function saveDescription() {
    setSavingDescription(true);
    try {
      const updated = await api.library.update(project.id, { description: descriptionDraft.trim() });
      onProjectChange?.(updated);
      onNotify("项目说明已保存到本机项目库，不会写入 LaTeX 文件。");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法保存项目说明");
    } finally {
      setSavingDescription(false);
    }
  }

  return (
    <main className="overview-page introduction-page">
      <header className="introduction-context-card">
        <div className="introduction-context-copy"><span className="overview-heading-icon" aria-hidden="true"><BookOpen size={21} /></span><div><h2>项目介绍</h2><p>管理文档入口、主 PDF 和移动端成品。</p></div></div>
        <div className="introduction-context-controls">
          <label><span>当前文档入口</span><select value={target.id} onChange={(event) => onSelectTarget(event.target.value)}>{manifest.targets.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.entry}</option>)}</select></label>
          <label><span>当前方案</span><select value={profile.id} onChange={(event) => onSelectProfile(event.target.value)}>{target.profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <button className="button secondary" onClick={onOpenEntry} disabled={vsCodeStatus?.available === false}><ExternalLink size={16} />打开入口文件</button>
        </div>
      </header>

      <section className="overview-section project-description-card">
        <header><div><h3>项目说明</h3><p>只保存在本机项目库，适合记录研究主题、当前进度和下一步。</p></div><button className="button secondary" disabled={savingDescription || descriptionDraft.trim() === (project.description ?? "").trim()} onClick={() => void saveDescription()}>{savingDescription ? "正在保存…" : "保存说明"}</button></header>
        <textarea value={descriptionDraft} onChange={(event) => setDescriptionDraft(event.target.value)} rows={3} maxLength={1200} placeholder="例如：基于原始英文文稿整理图论笔记；下一步补充第 6 章例题。" aria-label="项目说明" />
      </section>

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
            <div><span>{editorLabel}</span><strong>{vsCodeStatus?.available ? "已就绪" : "未检测到"}</strong>{vsCodeStatus?.executablePath && <small title={vsCodeStatus.executablePath}>{vsCodeStatus.executablePath}</small>}</div>
            <div><span>LaTeX Workshop</span><strong>{workshop}</strong></div>
            <div className="introduction-pdf"><span>最近 PDF</span><strong>{pdfName}</strong><small>{pdfDetail}</small></div>
          </div>
        </section>
      </div>
      <MobilePdfCard api={api} project={project} manifest={manifest} isDemo={isDemo} onNotify={onNotify} />
      <ProjectBackupCard api={api} project={project} onNotify={onNotify} onProjectChange={onProjectChange} />
    </main>
  );
}

function ProjectBackupCard({
  api,
  project,
  onNotify,
  onProjectChange
}: {
  api: WorkbenchApi;
  project: ProjectSummary;
  onNotify: (message: string) => void;
  onProjectChange?: (project: ProjectSummary) => void;
}) {
  const [snapshots, setSnapshots] = useState<BackupSnapshot[]>([]);
  const [settings, setSettings] = useState<ProjectBackupSettings | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAllSnapshots, setShowAllSnapshots] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.projectBackups.list(project.id), api.projectBackups.settings(project.id)])
      .then(([nextSnapshots, nextSettings]) => {
        if (!cancelled) { setSnapshots(nextSnapshots); setSettings(nextSettings); }
      })
      .catch((error: unknown) => !cancelled && onNotify(error instanceof Error ? error.message : "无法读取项目快照"));
    return () => { cancelled = true; };
  }, [api, onNotify, project.id]);

  async function createSnapshot() {
    setBusy("create");
    try {
      const preview = await api.projectBackups.preview(project.id);
      const snapshot = await api.projectBackups.create(project.id);
      setSnapshots((current) => [snapshot, ...current.filter((item) => item.id !== snapshot.id)]);
      onProjectChange?.({ ...project, protectionState: project.protectionState === "github" || project.protectionState === "both" ? "both" : "localBackup" });
      onNotify(`项目快照已创建并校验：${preview.fileCount} 个文件，${(preview.totalBytes / 1024 / 1024).toFixed(1)} MB`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法创建项目快照");
    } finally {
      setBusy(null);
    }
  }

  async function saveSettings(next: Pick<ProjectBackupSettings, "frequency" | "retainCount">) {
    setBusy("settings");
    try {
      setSettings(await api.projectBackups.setSettings(project.id, next));
      onNotify(next.frequency === "off" ? "已关闭定期项目快照" : `已开启${next.frequency === "daily" ? "每日" : "每周"}项目快照`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法保存备份设置");
    } finally {
      setBusy(null);
    }
  }

  async function verify(snapshot: BackupSnapshot) {
    setBusy(snapshot.id);
    try {
      const result = await api.projectBackups.verify(project.id, snapshot.id);
      if (!result.valid) throw new Error(result.errors.join("；") || "快照校验失败");
      setSnapshots((current) => current.map((item) => item.id === snapshot.id
        ? { ...item, verified: true, verifiedAt: new Date().toISOString() }
        : item));
      onNotify(`快照校验通过：${result.checkedFiles} 个文件完整`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "快照校验失败");
    } finally {
      setBusy(null);
    }
  }

  async function restore(snapshot: BackupSnapshot) {
    setBusy(snapshot.id);
    try {
      const result = await api.projectBackups.restore(project.id, snapshot.id);
      if (result) onNotify(
        `已恢复到新目录：${result.destinationPath}${result.restoredLocalAttachments ? `（含 ${result.restoredLocalAttachments} 份仅本机资料）` : ""}`
      );
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法恢复项目快照");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="overview-section project-backup-card">
      <header>
        <div><h3>项目保护</h3><p>快照保留源码和仅本机资料；排除 Git、构建缓存与撤销目录。恢复始终写入新目录。</p></div>
        <button className="button primary" disabled={busy !== null} onClick={() => void createSnapshot()}><Files size={16} />{busy === "create" ? "正在校验…" : "立即创建快照"}</button>
      </header>
      <div className="backup-settings-row">
        <label><span>定期快照</span><select value={settings?.frequency ?? "off"} disabled={!settings || busy !== null} onChange={(event) => void saveSettings({ frequency: event.target.value as ProjectBackupSettings["frequency"], retainCount: settings?.retainCount ?? 7 })}><option value="off">关闭</option><option value="daily">每日</option><option value="weekly">每周</option></select></label>
        <label><span>保留份数</span><select value={settings?.retainCount ?? 7} disabled={!settings || busy !== null} onChange={(event) => void saveSettings({ frequency: settings?.frequency ?? "off", retainCount: Number(event.target.value) })}>{[3, 5, 7, 14, 30].map((value) => <option key={value} value={value}>{value} 份</option>)}</select></label>
        <span className={`protection-state protection-${project.protectionState ?? "unprotected"}`}>{project.protectionState === "both" ? "GitHub + 本地快照" : project.protectionState === "github" ? "已连接 GitHub" : project.protectionState === "localBackup" ? "已有本地快照" : "尚未建立保护"}</span>
      </div>
      {snapshots.length > 0 ? <>
        <div className="backup-snapshot-list">{(showAllSnapshots ? snapshots : snapshots.slice(0, 5)).map((snapshot) => <article key={snapshot.id}><div><strong>{new Date(snapshot.createdAt).toLocaleString("zh-CN")}</strong><small>{snapshot.fileCount} 个文件 · {(snapshot.size / 1024 / 1024).toFixed(1)} MB · {snapshot.kind === "scheduled" ? "定期" : "手动"}</small></div><span title={snapshot.verifiedAt ? `最近校验：${new Date(snapshot.verifiedAt).toLocaleString("zh-CN")}` : undefined}>{snapshot.verified ? "已校验" : "待复核"}</span><button className="button secondary" disabled={busy !== null} onClick={() => void verify(snapshot)}>校验</button><button className="button secondary" disabled={busy !== null} onClick={() => void restore(snapshot)}>恢复副本</button></article>)}</div>
        {snapshots.length > 5 ? <button className="button tertiary backup-show-all" onClick={() => setShowAllSnapshots((value) => !value)}>{showAllSnapshots ? "收起快照" : `查看全部 ${snapshots.length} 份快照`}</button> : null}
      </> : <p className="backup-empty">还没有项目快照。GitHub 同步与本地快照用途不同，建议至少启用一种保护方式。</p>}
    </section>
  );
}
