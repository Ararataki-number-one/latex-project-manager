import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CloudOff,
  FileDown,
  FolderInput,
  FolderKanban,
  LoaderCircle,
  ShieldCheck
} from "lucide-react";

import type { WorkbenchApi } from "@/shared/ipc";
import type { CatalogStatus, OperationSnapshot, ProjectStatusRecord, ProjectSummary, VsCodeStatus } from "@/shared/types";

type ProjectDestination = "overview" | "github";
type AttentionIssue = {
  id: string;
  project: ProjectSummary;
  kind: "path" | "sync" | "pdf" | "protection";
  title: string;
  detail: string;
  action: string;
  destination?: ProjectDestination;
};

export function NeedsAttentionView({
  api,
  projects,
  onOpenProject,
  onProjectsChange,
  onNotify,
  onOpenSettings,
  onOpenActivity
}: {
  api: WorkbenchApi;
  projects: ProjectSummary[];
  onOpenProject: (project: ProjectSummary, tab: ProjectDestination) => void;
  onProjectsChange: React.Dispatch<React.SetStateAction<ProjectSummary[]>>;
  onNotify: (message: string) => void;
  onOpenSettings: () => void;
  onOpenActivity: () => void;
}) {
  const activeProjects = useMemo(() => projects.filter((project) => !project.archived && !project.trashed), [projects]);
  const [statuses, setStatuses] = useState<Record<string, ProjectStatusRecord>>({});
  const [loadingStatuses, setLoadingStatuses] = useState(true);
  const [relinkingId, setRelinkingId] = useState<string | null>(null);
  const [editorStatus, setEditorStatus] = useState<VsCodeStatus | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus | null>(null);
  const [operations, setOperations] = useState<OperationSnapshot[]>([]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.projectStatus.list(), api.editor.status(), api.library.catalogStatus(), api.operations.list(undefined, 200)])
      .then(([items, editor, catalog, activity]) => {
        if (cancelled) return;
        setStatuses(Object.fromEntries(items.map((item) => [item.snapshot.projectId, item])));
        setEditorStatus(editor);
        setCatalogStatus(catalog);
        setOperations(activity);
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoadingStatuses(false); });
    const unsubscribe = api.projectStatus.onEvent((event) => {
      if (!cancelled) setStatuses((current) => ({ ...current, [event.projectId]: event.record }));
    });
    const unsubscribeOperations = api.operations.onEvent((snapshot) => {
      if (!cancelled) setOperations((current) => [snapshot, ...current.filter((item) => item.id !== snapshot.id)].slice(0, 200));
    });
    return () => { cancelled = true; unsubscribe(); unsubscribeOperations(); };
  }, [api]);

  const failedBackups = useMemo(() => operations.filter((item) => item.kind === "backup" && ["failed", "blocked"].includes(item.state)), [operations]);
  const globalIssueCount = (editorStatus && !editorStatus.available ? 1 : 0) + (catalogStatus?.writable === false ? 1 : 0) + failedBackups.length;

  const issues = useMemo(() => {
    const output: AttentionIssue[] = [];
    for (const project of activeProjects) {
      if (!project.pathAvailable) {
        output.push({ id: `${project.id}:path`, project, kind: "path", title: "项目路径失效", detail: "原文件夹已移动、重命名或当前不可访问。", action: "重新定位" });
        continue;
      }
      const status = statuses[project.id]?.snapshot;
      if (status?.syncState && ["blocked", "error", "needsPull", "unavailable"].includes(status.syncState)) {
        output.push({ id: `${project.id}:sync`, project, kind: "sync", title: status.syncState === "blocked" ? "同步被安全检查阻止" : "GitHub 同步需要处理", detail: status.syncMessage || "打开保护页查看具体原因。", action: "查看保护", destination: "github" });
      }
      if (status && !status.mainPdfPath) {
        output.push({ id: `${project.id}:pdf`, project, kind: "pdf", title: "尚未设置主 PDF", detail: "移动端和项目检查器无法快速定位最终成品。", action: "设置主 PDF", destination: "overview" });
      }
      if (!project.protectionState || project.protectionState === "unprotected") {
        output.push({ id: `${project.id}:protection`, project, kind: "protection", title: "项目尚未建立保护", detail: "既没有本地快照，也没有连接 GitHub。", action: "建立保护", destination: "github" });
      }
    }
    const order = { path: 0, sync: 1, protection: 2, pdf: 3 } as const;
    return output.sort((left, right) => order[left.kind] - order[right.kind] || left.project.name.localeCompare(right.project.name, "zh-CN"));
  }, [activeProjects, statuses]);

  async function relink(project: ProjectSummary) {
    const rootPath = await api.dialogs.openDirectory();
    if (!rootPath) return;
    setRelinkingId(project.id);
    try {
      const updated = await api.library.relink(project.id, rootPath);
      onProjectsChange((current) => current.map((item) => item.id === project.id ? updated : item));
      onNotify(`已将“${project.name}”重新定位到 ${rootPath}`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "项目路径重新定位失败");
    } finally {
      setRelinkingId(null);
    }
  }

  const grouped = [
    { kind: "path" as const, title: "路径", icon: FolderInput },
    { kind: "sync" as const, title: "同步", icon: CloudOff },
    { kind: "protection" as const, title: "保护", icon: ShieldCheck },
    { kind: "pdf" as const, title: "成品 PDF", icon: FileDown }
  ].map((group) => ({ ...group, items: issues.filter((issue) => issue.kind === group.kind) })).filter((group) => group.items.length);

  return <section className="desktop-v1-attention-page" aria-label="需要处理">
    <header className="page-heading desktop-v1-attention-heading">
      <div><span className="page-heading-icon"><AlertTriangle size={22} /></span><div><h1>需要处理</h1><p>只显示会阻碍继续工作或降低项目安全性的事项。</p></div></div>
      <span className={`desktop-v1-attention-count ${issues.length + globalIssueCount ? "has-issues" : "clear"}`}>{loadingStatuses ? <LoaderCircle size={15} className="spin" /> : issues.length + globalIssueCount ? issues.length + globalIssueCount : <CheckCircle2 size={16} />}{loadingStatuses ? "正在读取缓存" : issues.length + globalIssueCount ? `${issues.length + globalIssueCount} 项` : "全部正常"}</span>
    </header>
    {globalIssueCount > 0 && <section className="desktop-v1-attention-group desktop-v1-global-attention">
      <header><AlertTriangle size={18} /><strong>客户端</strong><span>{globalIssueCount}</span></header>
      <div>
        {editorStatus && !editorStatus.available && <article className="desktop-v1-attention-row issue-editor"><span className="desktop-v1-attention-project"><FolderInput size={17} /></span><div><strong>VS Code 尚未配置</strong><p>外部编辑器联动不可用</p><small>{editorStatus.diagnostics?.join("；") || "请自动检测或手动选择 Code.exe。"}</small></div><button className="button secondary" onClick={onOpenSettings}>配置编辑器<ChevronRight size={15} /></button></article>}
        {catalogStatus?.writable === false && <article className="desktop-v1-attention-row issue-catalog"><span className="desktop-v1-attention-project"><AlertTriangle size={17} /></span><div><strong>项目库数据库不可写</strong><p>所有持久写入已安全阻止</p><small>{catalogStatus.readOnlyReason ?? catalogStatus.warnings.join("；")}</small></div><button className="button secondary" onClick={() => void navigator.clipboard.writeText(catalogStatus.readOnlyReason ?? catalogStatus.warnings.join("；")).then(() => onNotify("已复制数据库诊断信息"))}>复制诊断</button></article>}
        {failedBackups.map((operation) => <article key={operation.id} className="desktop-v1-attention-row issue-backup"><span className="desktop-v1-attention-project"><ShieldCheck size={17} /></span><div><strong>本地备份失败</strong><p>{projects.find((item) => item.id === operation.projectId)?.name ?? operation.title}</p><small>{operation.message ?? "请在活动中心查看详细信息"}</small></div><button className="button secondary" onClick={onOpenActivity}>查看活动<ChevronRight size={15} /></button></article>)}
      </div>
    </section>}
    {issues.length ? <div className="desktop-v1-attention-groups">
      {grouped.map((group) => { const Icon = group.icon; return <section key={group.kind} className="desktop-v1-attention-group">
        <header><Icon size={18} /><strong>{group.title}</strong><span>{group.items.length}</span></header>
        <div>{group.items.map((issue) => <article key={issue.id} className={`desktop-v1-attention-row issue-${issue.kind}`}>
          <span className="desktop-v1-attention-project"><FolderKanban size={17} /></span>
          <div><strong>{issue.title}</strong><p>{issue.project.name}</p><small>{issue.detail}</small></div>
          <button className="button secondary" disabled={relinkingId === issue.project.id} onClick={() => issue.kind === "path" ? void relink(issue.project) : issue.destination && onOpenProject(issue.project, issue.destination)}>{relinkingId === issue.project.id ? <LoaderCircle size={15} className="spin" /> : null}{issue.action}<ChevronRight size={15} /></button>
        </article>)}</div>
      </section>; })}
    </div> : !loadingStatuses && globalIssueCount === 0 ? <div className="desktop-v1-attention-empty"><span><CheckCircle2 size={30} /></span><h2>项目库状态良好</h2><p>没有路径失效、同步阻止、保护缺失、备份失败或主 PDF 问题。</p></div> : loadingStatuses ? <div className="desktop-v1-attention-empty"><LoaderCircle size={26} className="spin" /><h2>正在读取项目状态</h2><p>这里只读取本机缓存，不会扫描全部项目目录。</p></div> : null}
  </section>;
}
