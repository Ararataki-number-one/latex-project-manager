import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Cloud,
  CloudOff,
  ExternalLink,
  FileArchive,
  FileText,
  FolderOpen,
  GitBranch,
  GitFork,
  HardDrive,
  LoaderCircle,
  LogIn,
  Mail,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  X
} from "lucide-react";

import type { WorkbenchApi } from "@/shared/ipc";
import type {
  CatalogProjectResearchItem,
  GitHubAccountStatus,
  GitHubRepositoryVisibility,
  GitHubSyncEvent,
  GitHubSyncState,
  GitHubSyncStatus,
  LegacyResearchCandidate,
  ProjectManifest,
  ProjectResearchItem,
  ProjectSummary,
  ReferenceDocumentInfo,
  ResearchAttachment,
  ResearchRole,
  ResearchTargetLink,
  SyncSecurityFinding
} from "@/shared/types";

interface SharedProps {
  api: WorkbenchApi;
  project: ProjectSummary;
  isDemo: boolean;
  onNotify: (message: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTime(value?: string): string {
  if (!value) return "尚未同步";
  return new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function suggestedRepositoryName(project: ProjectSummary): string {
  const normalized = project.name
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 80);
  return normalized || `latex-project-${project.id.slice(0, 8).toLocaleLowerCase("en-US")}`;
}

const syncStateLabel: Record<GitHubSyncState, string> = {
  unavailable: "Git 不可用",
  notConfigured: "尚未连接",
  ready: "等待首次同步",
  changes: "有待同步变更",
  queued: "排队中",
  syncing: "正在同步",
  retrying: "等待重试",
  synced: "已同步",
  needsPull: "需要处理远端更新",
  blocked: "安全阻止",
  error: "同步异常"
};

function SyncStateIcon({ state }: { state: GitHubSyncState }) {
  if (state === "syncing" || state === "retrying" || state === "queued") return <LoaderCircle size={19} className={state === "syncing" ? "spin" : ""} />;
  if (state === "synced") return <CheckCircle2 size={19} />;
  if (state === "unavailable" || state === "error") return <CloudOff size={19} />;
  if (state === "needsPull" || state === "blocked") return <AlertCircle size={19} />;
  return <Cloud size={19} />;
}

export function GitHubSyncTab({ api, project, isDemo, onNotify }: SharedProps) {
  const [status, setStatus] = useState<GitHubSyncStatus | null>(null);
  const [account, setAccount] = useState<GitHubAccountStatus | null>(null);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [autoSync, setAutoSync] = useState(true);
  const [useLfs, setUseLfs] = useState(true);
  const [identityName, setIdentityName] = useState("");
  const [identityEmail, setIdentityEmail] = useState("");
  const [repositoryName, setRepositoryName] = useState(() => suggestedRepositoryName(project));
  const [visibility, setVisibility] = useState<GitHubRepositoryVisibility>("private");
  const [history, setHistory] = useState<GitHubSyncEvent[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState<"configure" | "create" | "sync" | "toggle" | "identity" | "login" | "visibility" | null>(null);

  const refresh = useCallback(async (initializeDraft = false) => {
    try {
      const [next, events] = await Promise.all([
        api.github.status(project.id),
        api.github.history(project.id, 20)
      ]);
      setStatus(next);
      setHistory(events);
      if (initializeDraft || !initialized) {
        setRemoteUrl(next.remoteUrl);
        setAutoSync(next.configured ? next.autoSync : true);
        setUseLfs(next.configured ? next.useLfsForDocuments : next.lfsAvailable);
        setVisibility(next.visibility ?? "private");
        setIdentityName(next.identity.name);
        setIdentityEmail(next.identity.email);
        setInitialized(true);
      }
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法读取 GitHub 同步状态");
    }
  }, [api, initialized, onNotify, project.id]);

  const refreshAccount = useCallback(async () => {
    try {
      setAccount(await api.github.authStatus());
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法读取 GitHub 登录状态");
    }
  }, [api, onNotify]);

  useEffect(() => {
    void refresh(true);
    const timer = setInterval(() => { void refresh(false); }, 6_000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => { void refreshAccount(); }, [refreshAccount]);

  useEffect(() => api.github.onEvent((event) => {
    if (event.projectId === project.id) void refresh(false);
  }), [api, project.id, refresh]);

  useEffect(() => {
    if (!account?.cliAvailable || account.authenticated) return;
    const timer = setInterval(() => { void refreshAccount(); }, 5_000);
    return () => clearInterval(timer);
  }, [account?.authenticated, account?.cliAvailable, refreshAccount]);

  async function beginGitHubLogin() {
    setBusy("login");
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

  async function createAndSync() {
    if (!account?.authenticated) {
      onNotify("请先登录 GitHub，再自动创建仓库");
      return;
    }
    if (!repositoryName.trim()) {
      onNotify("请输入仓库名称");
      return;
    }
    setBusy("create");
    try {
      if (!await confirmSecurityPreflight(true)) return;
      const next = await api.github.createRepository(project.id, {
        repositoryName: repositoryName.trim(),
        visibility,
        autoSync,
        useLfsForDocuments: useLfs
      });
      setStatus(next);
      setRemoteUrl(next.remoteUrl);
      setIdentityName(next.identity.name);
      setIdentityEmail(next.identity.email);
      onNotify(next.state === "synced" ? "GitHub 仓库已创建，项目已完成首次同步" : (next.message ?? "GitHub 仓库已创建"));
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法创建 GitHub 仓库");
      await refresh(false);
    } finally {
      setBusy(null);
    }
  }

  async function changeVisibility(nextVisibility: GitHubRepositoryVisibility) {
    if (nextVisibility === status?.visibility) return;
    if (nextVisibility === "public" && !window.confirm("设为公开后，任何人都能看到并下载仓库中的 LaTeX 源码和原始文稿。确定继续吗？")) return;
    setBusy("visibility");
    try {
      if (nextVisibility === "public" && !await confirmSecurityPreflight(true)) return;
      const next = await api.github.setVisibility(project.id, nextVisibility);
      setStatus(next);
      setVisibility(nextVisibility);
      onNotify(`仓库已切换为${nextVisibility === "public" ? "公开" : "私有"}`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法修改仓库可见性");
    } finally {
      setBusy(null);
    }
  }

  async function confirmSecurityPreflight(includeTracked: boolean): Promise<boolean> {
    const findings = await api.github.securityPreflight(project.id, includeTracked);
    const blocked = findings.filter((finding) => finding.severity === "block");
    if (blocked.length) {
      onNotify(`安全检查已阻止上传：${blocked[0].path} · ${blocked[0].message}`);
      return false;
    }
    const warnings = findings.filter((finding) => finding.severity === "warning");
    if (!warnings.length) return true;
    return window.confirm(`发现 ${warnings.length} 项需要注意的文件：\n\n${warnings.slice(0, 8).map((finding) => `• ${finding.path}：${finding.message}`).join("\n")}\n\n确认这些文件可以同步吗？`);
  }

  async function approveWarnings(findings: SyncSecurityFinding[]) {
    const warnings = findings.filter((finding) => finding.severity === "warning");
    if (!warnings.length || !window.confirm(`确认允许同步以下 ${warnings.length} 个普通风险文件吗？高风险密钥仍然不能放行。`)) return;
    setBusy("sync");
    try {
      const next = await api.github.acknowledgeWarnings(project.id, warnings.map((finding) => finding.path));
      setStatus(next);
      onNotify(next.message ?? "已确认同步警告");
      await refresh(false);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法确认同步警告");
    } finally {
      setBusy(null);
    }
  }

  async function openRemote() {
    try {
      await api.github.openRemote(project.id);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法打开 GitHub 仓库");
    }
  }

  async function configureAndSync() {
    if (!remoteUrl.trim()) {
      onNotify("请粘贴 GitHub 仓库地址");
      return;
    }
    if (!status?.identity.configured && (!identityName.trim() || !identityEmail.trim())) {
      onNotify("请先填写下方的 Git 提交姓名和邮箱");
      return;
    }
    setBusy("configure");
    try {
      if (!status?.identity.configured) {
        await api.github.setIdentity(project.id, { name: identityName.trim(), email: identityEmail.trim() });
      }
      const configured = await api.github.configure(project.id, {
        remoteUrl: remoteUrl.trim(),
        autoSync,
        useLfsForDocuments: useLfs
      });
      setStatus(configured);
      setBusy("sync");
      const synced = await api.github.syncNow(project.id);
      setStatus(synced);
      onNotify(synced.state === "synced" ? "项目已同步到 GitHub" : (synced.message ?? "GitHub 同步已完成"));
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法连接 GitHub 仓库");
      await refresh(false);
    } finally {
      setBusy(null);
    }
  }

  async function saveIdentityAndContinue() {
    if (!identityName.trim() || !identityEmail.trim()) {
      onNotify("请填写 Git 提交姓名和邮箱");
      return;
    }
    setBusy("identity");
    try {
      const next = await api.github.setIdentity(project.id, { name: identityName.trim(), email: identityEmail.trim() });
      setStatus(next);
      if (next.configured) {
        setBusy("sync");
        const synced = await api.github.syncNow(project.id);
        setStatus(synced);
        onNotify(synced.state === "synced" ? "提交身份已保存，项目已同步" : (synced.message ?? "提交身份已保存"));
      } else {
        onNotify("已为当前项目保存 Git 提交身份");
      }
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法保存 Git 提交身份");
    } finally {
      setBusy(null);
    }
  }

  async function syncNow() {
    setBusy("sync");
    try {
      const next = await api.github.syncNow(project.id);
      setStatus(next);
      onNotify(next.state === "synced" ? "项目已同步到 GitHub" : (next.message ?? "同步已结束"));
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "GitHub 同步失败");
    } finally {
      setBusy(null);
    }
  }

  async function toggleAutoSync(enabled: boolean) {
    setAutoSync(enabled);
    if (!status?.configured) return;
    setBusy("toggle");
    try {
      const next = await api.github.setAutoSync(project.id, enabled);
      setStatus(next);
      onNotify(enabled ? "已开启 GitHub 自动同步" : "已暂停 GitHub 自动同步");
    } catch (error) {
      setAutoSync(!enabled);
      onNotify(error instanceof Error ? error.message : "无法更新自动同步设置");
    } finally {
      setBusy(null);
    }
  }

  if (!status) return <div className="resource-loading"><LoaderCircle size={20} className="spin" />正在检查 Git 与仓库状态…</div>;

  const stateClass = status.state === "synced" ? "success" : status.state === "error" || status.state === "unavailable" || status.state === "blocked" ? "error" : status.state === "needsPull" || status.state === "retrying" ? "warning" : "neutral";
  const hasDraftChanges = status.configured && (remoteUrl.trim() !== status.remoteUrl || useLfs !== status.useLfsForDocuments);

  return (
    <section className="resource-page github-sync-page">
      <header className="resource-heading">
        <div className="resource-heading-copy"><span className="resource-heading-icon"><GitFork size={22} /></span><div><h2>GitHub 同步</h2><p>自动备份项目中的新增、修改和删除；遇到分叉或风险文件时会安全停止。</p></div></div>
        {status.configured && <button className="button primary" onClick={() => void syncNow()} disabled={busy !== null || status.state === "unavailable" || !status.identity.configured}>{busy === "sync" ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}立即同步</button>}
      </header>

      <div className={`sync-status-card state-${stateClass}`}>
        <span className="sync-status-icon"><SyncStateIcon state={status.state} /></span>
        <div><strong>{syncStateLabel[status.state]}</strong><p>{status.message}</p></div>
        <span className="sync-status-time">上次成功：{formatTime(status.lastSyncAt)}</span>
        {status.configured && <button className="button ghost sync-advanced-toggle" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((value) => !value)}>{advancedOpen ? "收起设置" : "同步设置"}</button>}
      </div>

      {status.securityFindings && status.securityFindings.length > 0 && (
        <section className="resource-card sync-security-findings">
          <header><div><h3>同步安全检查</h3><p>高风险内容不会上传；普通风险内容需要你确认一次。</p></div><ShieldCheck size={19} /></header>
          <div className="security-finding-list">
            {status.securityFindings.map((finding) => <div key={`${finding.kind}-${finding.path}`} className={finding.severity}><strong>{finding.severity === "block" ? "已阻止" : "需确认"}</strong><code>{finding.path}</code><span>{finding.message}</span></div>)}
          </div>
          {status.securityFindings.some((finding) => finding.severity === "warning") && !status.securityFindings.some((finding) => finding.severity === "block") && <button className="button secondary" onClick={() => void approveWarnings(status.securityFindings ?? [])} disabled={busy !== null}>确认普通警告并重试</button>}
        </section>
      )}

      {!status.configured && <section className={`resource-card github-account-card ${account?.authenticated ? "account-ready" : "account-required"}`}>
        <header>
          <div><h3>GitHub 账号</h3><p>通过官方浏览器登录；密码和令牌不会保存到本软件。</p></div>
          {account?.authenticated ? <CheckCircle2 size={19} /> : <LogIn size={19} />}
        </header>
        <div className="github-account-row">
          <div className="github-account-copy">
            <strong>{account?.authenticated ? account.login : account?.message ?? "正在检查登录状态…"}</strong>
            <span>{account?.authenticated ? `${account.name ?? account.login} · ${account.email ?? "GitHub noreply 邮箱"}` : account?.cliAvailable ? "点击登录后会打开 GitHub 官方网页" : "需要先安装 GitHub CLI"}</span>
          </div>
          <button className="button secondary" onClick={() => void refreshAccount()} disabled={busy !== null}><RefreshCw size={16} />刷新状态</button>
          {!account?.authenticated && <button className="button primary" onClick={() => void beginGitHubLogin()} disabled={busy !== null}>{busy === "login" ? <LoaderCircle size={16} className="spin" /> : <LogIn size={16} />}{account?.cliAvailable === false ? "安装 GitHub CLI" : "登录 GitHub"}</button>}
        </div>
      </section>}

      {!status.configured && (
        <section className="resource-card github-create-card">
          <header><div><h3>一键创建同步仓库</h3><p>无需先去 GitHub 建仓库；客户端会创建、连接并完成首次同步。</p></div><Cloud size={19} /></header>
          <div className="github-create-fields">
            <label className="resource-field"><span>仓库名称</span><input value={repositoryName} onChange={(event) => setRepositoryName(event.target.value)} placeholder="latex-notes" maxLength={100} spellCheck={false} /></label>
            <label className="resource-field"><span>仓库可见性</span><select value={visibility} onChange={(event) => setVisibility(event.target.value as GitHubRepositoryVisibility)}><option value="private">私有 · 仅你和受邀成员可见</option><option value="public">公开 · 任何人都能查看和下载</option></select></label>
          </div>
          <div className="sync-toggle-list compact-sync-toggles">
            <label className="sync-toggle"><span><strong>创建后自动同步</strong><small>新增、删除和内容修改停止约 10 秒后自动上传</small></span><input type="checkbox" checked={autoSync} disabled={busy !== null} onChange={(event) => setAutoSync(event.target.checked)} /></label>
            <label className="sync-toggle"><span><strong>PDF 等大文稿使用 Git LFS</strong><small>适合项目中的原始英文文稿和中文 PDF</small></span><input type="checkbox" checked={useLfs} disabled={!status.lfsAvailable || busy !== null} onChange={(event) => setUseLfs(event.target.checked)} /></label>
          </div>
          <button className="button primary full" onClick={() => void createAndSync()} disabled={busy !== null || !account?.authenticated || !repositoryName.trim()}>{busy === "create" ? <LoaderCircle size={16} className="spin" /> : <Cloud size={16} />}创建{visibility === "public" ? "公开" : "私有"}仓库并首次同步</button>
        </section>
      )}

      {(!status.configured || !status.identity.configured) && <section className={`resource-card git-identity-card ${status.identity.configured ? "identity-ready" : "identity-required"}`}>
        <header><div><h3>提交身份</h3><p>只保存到当前项目，用来标记 GitHub 上的提交作者。</p></div><UserRound size={18} /></header>
        <div className="git-identity-fields">
          <label className="resource-field"><span>提交姓名</span><div className="input-with-icon"><UserRound size={16} /><input value={identityName} onChange={(event) => setIdentityName(event.target.value)} placeholder="例如：Ararataki-number-one" maxLength={100} /></div></label>
          <label className="resource-field"><span>提交邮箱</span><div className="input-with-icon"><Mail size={16} /><input type="email" value={identityEmail} onChange={(event) => setIdentityEmail(event.target.value)} placeholder="你的 GitHub 邮箱或 noreply 邮箱" maxLength={254} /></div></label>
          <button className="button secondary identity-save-button" onClick={() => void saveIdentityAndContinue()} disabled={busy !== null || !identityName.trim() || !identityEmail.trim()}>{busy === "identity" ? <LoaderCircle size={16} className="spin" /> : <CheckCircle2 size={16} />}{status.configured ? "保存并继续同步" : "保存到当前项目"}</button>
        </div>
        <p className={`identity-status ${status.identity.configured ? "ready" : "required"}`}>{status.identity.configured ? `已配置（${status.identity.source === "local" ? "当前项目" : "全局 Git 设置"}）` : "尚未配置；完成此项后即可提交并同步。"}</p>
      </section>}

      {(!status.configured || advancedOpen) && <div className="resource-columns sync-advanced-panel">
        <section className="resource-card github-connect-card">
          <header><div><h3>{status.configured ? "仓库连接" : "连接已有仓库"}</h3><p>{status.configured ? "这里显示当前项目的 GitHub 地址。" : "高级方式：连接你已经在 GitHub 创建的仓库。"}</p></div><GitFork size={18} /></header>
          <label className="resource-field"><span>GitHub 仓库地址</span><input value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://github.com/用户名/仓库名.git" spellCheck={false} /></label>
          <div className="sync-toggle-list">
            <label className="sync-toggle"><span><strong>自动同步</strong><small>文件停止变化约 10 秒后，自动提交并推送</small></span><input type="checkbox" checked={autoSync} disabled={busy !== null} onChange={(event) => void toggleAutoSync(event.target.checked)} /></label>
            <label className="sync-toggle"><span><strong>大型文稿使用 Git LFS</strong><small>跟踪 PDF、EPUB 与 DjVu，适合原始文稿</small></span><input type="checkbox" checked={useLfs} disabled={!status.lfsAvailable || busy !== null} onChange={(event) => setUseLfs(event.target.checked)} /></label>
          </div>
          {!status.lfsAvailable && <p className="inline-warning"><AlertCircle size={14} />未检测到 Git LFS；超过 100 MiB 的文件无法上传到普通 Git 仓库。</p>}
          <button className="button primary full" onClick={() => void configureAndSync()} disabled={busy !== null || !status.available || !remoteUrl.trim()}>{busy === "configure" ? <LoaderCircle size={16} className="spin" /> : <Cloud size={16} />}{status.configured ? (hasDraftChanges ? "保存设置并同步" : "重新连接并同步") : "连接并首次同步"}</button>
          {status.configured && <button className="button secondary full" onClick={() => void openRemote()}><ExternalLink size={16} />在 GitHub 中打开仓库</button>}
          {isDemo && <p className="demo-note compact-note">演示模式只展示同步流程，不会访问真实 GitHub 仓库。</p>}
        </section>

        <section className="resource-card sync-details-card">
          <header><div><h3>仓库状态</h3><p>只展示本机 Git 已知的信息。</p></div><GitBranch size={18} /></header>
          <div className="sync-facts">
            <div><span>Git</span><strong>{status.available ? status.gitVersion ?? "已安装" : "未安装"}</strong></div>
            <div><span>当前分支</span><strong>{status.branch ?? "—"}</strong></div>
            <div><span>待推送提交</span><strong>{status.ahead}</strong></div>
            <div><span>远端领先提交</span><strong>{status.behind}</strong></div>
            <div><span>仓库</span><strong>{status.repositoryFullName ?? "—"}</strong></div>
            <div><span>可见性</span><strong>{status.visibility === "public" ? "公开" : status.visibility === "private" ? "私有" : "未读取"}</strong></div>
          </div>
          {status.configured && <label className="resource-field visibility-field"><span>更改仓库可见性</span><select value={status.visibility ?? ""} disabled={busy !== null || !account?.authenticated} onChange={(event) => void changeVisibility(event.target.value as GitHubRepositoryVisibility)}><option value="" disabled>请选择当前可见性</option><option value="private">私有仓库</option><option value="public">公开仓库</option></select></label>}
          {status.lastCommit && <div className="last-commit"><span>最近提交</span><strong><code>{status.lastCommit.hash}</code>{status.lastCommit.message}</strong><small>{formatTime(status.lastCommit.committedAt)}</small></div>}
          <div className="sync-safety-note"><ShieldCheck size={17} /><div><strong>安全同步策略</strong><p>删除操作会正常进入 Git 历史；远端领先或分叉时停止推送，由你在 VS Code 或 GitHub Desktop 中处理。</p></div></div>
        </section>
      </div>}

      {(status.changedFiles.length > 0 || status.largeFiles.length > 0) && (
        <section className="resource-card pending-files-card">
          <header><div><h3>待同步文件</h3><p>{status.changedFiles.length} 个变更，包括新增、修改与删除。</p></div><HardDrive size={18} /></header>
          <div className="pending-file-list">
            {status.changedFiles.slice(0, 12).map((file) => <div key={`${file.status}-${file.path}`}><code>{file.status.trim() || "M"}</code><span title={file.path}>{file.path}</span>{status.largeFiles.some((large) => large.path === file.path) && <small>大型文件</small>}</div>)}
            {status.changedFiles.length > 12 && <p>另有 {status.changedFiles.length - 12} 个文件将在同一次同步中处理。</p>}
          </div>
        </section>
      )}

      <details className="resource-card resource-disclosure sync-history-card">
        <summary><span><strong>同步时间线</strong><small>最近的排队、重试和安全阻止记录</small></span><GitBranch size={18} /></summary>
        {history.length ? <div className="sync-history-list">{history.map((event) => <div key={event.id} className={`level-${event.level}`}><span className="history-dot" /><div><strong>{syncStateLabel[event.state]}</strong><p>{event.message}</p></div><time>{formatTime(event.occurredAt)}</time></div>)}</div> : <p className="resource-empty-copy">尚无同步记录。</p>}
      </details>
    </section>
  );
}

function DocumentIcon({ item }: { item: ReferenceDocumentInfo }) {
  if (item.kind === "archive") return <FileArchive size={19} />;
  if (item.kind === "pdf" || item.kind === "ebook") return <BookOpen size={19} />;
  return <FileText size={19} />;
}

export function LegacyReferencesTab({ api, project, isDemo, onNotify }: SharedProps) {
  const [items, setItems] = useState<ReferenceDocumentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pdf" | "reading" | "large">("all");
  const [query, setQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (filter === "pdf" && item.kind !== "pdf") return false;
      if (filter === "reading" && !new Set(["pdf", "ebook", "document"]).has(item.kind)) return false;
      if (filter === "large" && !item.lfsRecommended) return false;
      return !normalized || `${item.name} ${item.relativePath}`.toLocaleLowerCase().includes(normalized);
    });
  }, [filter, items, query]);

  const selectedItem = visibleItems.find((item) => item.relativePath === selectedPath)
    ?? visibleItems[0]
    ?? null;

  const refresh = useCallback(async () => {
    try {
      setItems(await api.references.list(project.id));
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法读取原始文稿");
    } finally {
      setLoading(false);
    }
  }, [api, onNotify, project.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function importDocuments() {
    setBusy(true);
    try {
      const next = await api.references.import(project.id);
      setItems(next);
      if (!isDemo) onNotify("原始文稿已复制到项目的 references 文件夹");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "添加原始文稿失败");
    } finally {
      setBusy(false);
    }
  }

  async function openDocument(item: ReferenceDocumentInfo) {
    try {
      await api.references.open(project.id, item.relativePath);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法打开原始文稿");
    }
  }

  async function openFolder() {
    try {
      await api.references.openFolder(project.id);
      if (isDemo) onNotify("演示模式：已模拟打开 references 文件夹");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法打开 references 文件夹");
    }
  }

  async function removeDocument(item: ReferenceDocumentInfo) {
    setBusy(true);
    try {
      setItems(await api.references.remove(project.id, item.relativePath));
      setConfirmRemove(null);
      onNotify(isDemo ? "演示模式：已模拟移除文稿" : "文稿已移入系统回收站；GitHub 将记录这次删除");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "移除原始文稿失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="resource-page references-page">
      <header className="resource-heading">
        <div className="resource-heading-copy"><span className="resource-heading-icon"><BookOpen size={22} /></span><div><p className="eyebrow">随项目保存的阅读材料</p><h2 aria-label="原始文稿">研究资料</h2><p>把论文、中文 PDF 与电子书和项目放在一起；资料只管理，不在这里编辑。</p></div></div>
        <div className="resource-heading-actions"><button className="button secondary" onClick={() => void openFolder()}><FolderOpen size={16} />打开资料文件夹</button><button className="button primary" onClick={() => void importDocuments()} disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}添加资料</button></div>
      </header>

      <div className="reference-location"><FolderOpen size={18} /><div><strong>研究资料文件夹</strong><code title={`${project.rootPath}\\references`}>{project.rootPath}\references</code></div><span>复制项目、导出 ZIP 与 GitHub 同步都会包含这里的文件</span></div>

      {loading ? (
        <div className="resource-loading"><LoaderCircle size={20} className="spin" />正在读取研究资料…</div>
      ) : items.length === 0 ? (
        <div className="reference-empty"><span><BookOpen size={28} /></span><h3>还没有研究资料</h3><p>添加你正在阅读的论文或 PDF。客户端会复制文件，不会移动或修改原文件。</p><button className="button primary" onClick={() => void importDocuments()} disabled={busy}><Plus size={16} />选择资料</button></div>
      ) : (
        <div className="reference-browser">
          <aside className="reference-filters" aria-label="研究资料分类">
            <strong>资料库</strong>
            {([
              ["all", "全部资料", items.length],
              ["pdf", "PDF", items.filter((item) => item.kind === "pdf").length],
              ["reading", "可阅读文稿", items.filter((item) => new Set(["pdf", "ebook", "document"]).has(item.kind)).length],
              ["large", "大型文件", items.filter((item) => item.lfsRecommended).length]
            ] as const).map(([id, label, count]) => <button key={id} className={filter === id ? "active" : ""} aria-pressed={filter === id} onClick={() => setFilter(id)}><span>{label}</span><small>{count}</small></button>)}
            <div className="reference-filter-note"><ShieldCheck size={15} /><span>公开同步前，请检查版权与隐私。</span></div>
          </aside>
          <section className="reference-collection">
            <label className="reference-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索研究资料" placeholder="搜索名称或路径" />{query && <button aria-label="清除资料搜索" onClick={() => setQuery("")}><X size={14} /></button>}</label>
            <div className="reference-list" role="list" aria-label="原始文稿列表">
              {visibleItems.map((item) => (
                <article className={`reference-row ${selectedItem?.relativePath === item.relativePath ? "selected" : ""}`} role="listitem" key={item.relativePath}>
                  <span className="reference-icon"><DocumentIcon item={item} /></span>
                  <button className="reference-main" aria-pressed={selectedItem?.relativePath === item.relativePath} onClick={() => setSelectedPath(item.relativePath)} onDoubleClick={() => void openDocument(item)}><strong>{item.name}</strong><span>{item.relativePath}</span></button>
                  <div className="reference-meta"><strong>{formatBytes(item.size)}</strong><span>{formatTime(item.modifiedAt)}</span></div>
                  {item.lfsRecommended ? <span className="reference-lfs-badge" title="GitHub 对大文件有限制，建议使用 Git LFS">建议 Git LFS</span> : <span />}
                </article>
              ))}
              {!visibleItems.length && <div className="reference-filter-empty">没有符合当前分类或搜索条件的资料。</div>}
            </div>
          </section>
          <aside className="reference-inspector" aria-label={selectedItem ? `资料详情 ${selectedItem.name}` : "资料详情"}>
            {selectedItem ? <>
              <span className="reference-preview-icon"><DocumentIcon item={selectedItem} /></span>
              <h3>{selectedItem.name}</h3>
              <p title={selectedItem.relativePath}>{selectedItem.relativePath}</p>
              <dl><div><dt>类型</dt><dd>{selectedItem.kind.toLocaleUpperCase()}</dd></div><div><dt>大小</dt><dd>{formatBytes(selectedItem.size)}</dd></div><div><dt>最近修改</dt><dd>{formatTime(selectedItem.modifiedAt)}</dd></div><div><dt>Git LFS</dt><dd>{selectedItem.lfsRecommended ? "建议使用" : "无需"}</dd></div></dl>
              <div className="reference-inspector-actions"><button className="button primary" aria-label={`打开原始文稿 ${selectedItem.name}`} onClick={() => void openDocument(selectedItem)}><ExternalLink size={16} />打开资料</button>{confirmRemove === selectedItem.relativePath ? <><button className="button danger" onClick={() => void removeDocument(selectedItem)} disabled={busy}><Trash2 size={14} />确认移除</button><button className="button secondary" onClick={() => setConfirmRemove(null)}>取消</button></> : <button className="button secondary danger-text" aria-label={`移除原始文稿 ${selectedItem.name}`} onClick={() => setConfirmRemove(selectedItem.relativePath)}><Trash2 size={15} />移入回收站</button>}</div>
            </> : <div className="reference-inspector-empty"><BookOpen size={24} /><span>选择资料查看详情</span></div>}
          </aside>
        </div>
      )}
    </section>
  );
}

const researchRoleLabels: Record<ResearchRole, string> = {
  primarySource: "主要原稿",
  reference: "普通参考",
  translationSource: "翻译原稿",
  data: "数据",
  supplement: "补充材料"
};

export const PROJECT_RESEARCH_SCOPE = "__project__";

export interface ResearchLinkDraftEntry {
  targetKey: string;
  enabled: boolean;
  role: ResearchRole;
  preferredAttachmentId?: string;
}

/** Build one editable row per target while retaining links to removed targets. */
export function createResearchLinkDraft(
  links: ResearchTargetLink[],
  targetIds: string[]
): ResearchLinkDraftEntry[] {
  const keys = [
    PROJECT_RESEARCH_SCOPE,
    ...targetIds,
    ...links.map((link) => link.targetId === null ? PROJECT_RESEARCH_SCOPE : link.targetId)
  ].filter((key, index, all) => all.indexOf(key) === index);
  return keys.map((targetKey) => {
    const link = links.find((candidate) => (candidate.targetId === null ? PROJECT_RESEARCH_SCOPE : candidate.targetId) === targetKey);
    return {
      targetKey,
      enabled: Boolean(link),
      role: link?.role ?? "reference",
      preferredAttachmentId: link?.preferredAttachmentId
    };
  });
}

/**
 * Metadata-only saves return the original links byte-for-byte in meaning and
 * order. Once link controls are touched, each enabled row keeps its own role
 * and preferred attachment instead of inheriting a global role.
 */
export function materializeResearchLinks(
  entries: ResearchLinkDraftEntry[],
  originalLinks: ResearchTargetLink[],
  linksTouched: boolean
): ResearchTargetLink[] {
  if (!linksTouched) return originalLinks.map((link) => ({ ...link }));
  return entries.filter((entry) => entry.enabled).map((entry) => ({
    targetId: entry.targetKey === PROJECT_RESEARCH_SCOPE ? null : entry.targetKey,
    role: entry.role,
    ...(entry.preferredAttachmentId ? { preferredAttachmentId: entry.preferredAttachmentId } : {})
  }));
}

interface ResearchMetadataDraft {
  title: string;
  authors: string;
  year: string;
  doi: string;
  arxivId: string;
  isbn: string;
  linkEntries: ResearchLinkDraftEntry[];
  linksTouched: boolean;
}

type ProjectResearchFilter = "all" | "pending" | "localOnly" | ResearchRole;

interface ProjectResearchRow {
  key: string;
  record?: CatalogProjectResearchItem;
  attachment?: ResearchAttachment;
  legacy?: LegacyResearchCandidate;
  file?: ReferenceDocumentInfo;
  title: string;
  subtitle: string;
  size: number;
  pending: boolean;
  localOnly: boolean;
}

function titleFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || name;
}

function attachmentKind(attachment?: ResearchAttachment, file?: ReferenceDocumentInfo): string {
  if (file) return file.kind.toLocaleUpperCase();
  if (!attachment) return "FILE";
  if (attachment.mediaType === "application/pdf") return "PDF";
  if (attachment.mediaType.includes("epub")) return "EPUB";
  if (attachment.mediaType.includes("bibtex")) return "BIB";
  return attachment.name.split(".").pop()?.toLocaleUpperCase() || "FILE";
}

function ResearchRowIcon({ row }: { row: ProjectResearchRow }) {
  if (row.file) return <DocumentIcon item={row.file} />;
  if (row.attachment?.mediaType === "application/pdf") return <FileText size={19} />;
  return <BookOpen size={19} />;
}

function ResearchLinksEditor({
  entries,
  targetNames,
  attachments,
  onToggle,
  onRoleChange,
  onPreferredAttachmentChange
}: {
  entries: ResearchLinkDraftEntry[];
  targetNames: Map<string, string>;
  attachments: ResearchAttachment[];
  onToggle: (targetKey: string, enabled: boolean) => void;
  onRoleChange: (targetKey: string, role: ResearchRole) => void;
  onPreferredAttachmentChange: (targetKey: string, attachmentId?: string) => void;
}) {
  return <fieldset className="research-link-editor">
    <legend>关联文档目标</legend>
    <p className="research-link-help">每个目标可单独设置资料角色与首选附件；不勾选任何目标时保留在“待关联”。</p>
    <div className="research-link-list">
      {entries.map((entry) => {
        const targetName = entry.targetKey === PROJECT_RESEARCH_SCOPE
          ? "整个项目"
          : targetNames.get(entry.targetKey) ?? `已移除的目标 · ${entry.targetKey}`;
        const preferredExists = !entry.preferredAttachmentId || attachments.some((attachment) => attachment.id === entry.preferredAttachmentId);
        return <div className={`research-link-row ${entry.enabled ? "active" : ""}`} key={entry.targetKey}>
          <label className="research-target-check">
            <input
              type="checkbox"
              aria-label={`关联到${targetName}`}
              checked={entry.enabled}
              onChange={(event) => onToggle(entry.targetKey, event.target.checked)}
            />
            <span><strong>{targetName}</strong><small>{entry.enabled ? `已关联 · ${researchRoleLabels[entry.role]}` : "未关联"}</small></span>
          </label>
          <div className="research-link-controls">
            <label><span>角色</span><select
              aria-label={`${targetName}的资料角色`}
              value={entry.role}
              disabled={!entry.enabled}
              onChange={(event) => onRoleChange(entry.targetKey, event.target.value as ResearchRole)}
            >{Object.entries(researchRoleLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            <label><span>首选附件</span><select
              aria-label={`${targetName}的首选附件`}
              value={entry.preferredAttachmentId ?? ""}
              disabled={!entry.enabled || attachments.length === 0}
              onChange={(event) => onPreferredAttachmentChange(entry.targetKey, event.target.value || undefined)}
            >
              <option value="">自动选择</option>
              {!preferredExists && <option value={entry.preferredAttachmentId}>已缺失 · {entry.preferredAttachmentId}</option>}
              {attachments.map((attachment) => <option key={attachment.id} value={attachment.id}>{attachment.name}</option>)}
            </select></label>
          </div>
        </div>;
      })}
    </div>
  </fieldset>;
}

export function ReferencesTab({ api, project, isDemo, onNotify }: SharedProps) {
  const [files, setFiles] = useState<ReferenceDocumentInfo[]>([]);
  const [records, setRecords] = useState<CatalogProjectResearchItem[]>([]);
  const [legacy, setLegacy] = useState<LegacyResearchCandidate[]>([]);
  const [manifest, setManifest] = useState<ProjectManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<ProjectResearchFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [confirmBatch, setConfirmBatch] = useState(false);
  const [confirmRemoveRecord, setConfirmRemoveRecord] = useState(false);
  const [draft, setDraft] = useState<ResearchMetadataDraft>({
    title: "", authors: "", year: "", doi: "", arxivId: "", isbn: "", linkEntries: [], linksTouched: false
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextFiles, nextRecords, nextLegacy, nextManifest] = await Promise.all([
        api.references.list(project.id),
        api.research.list(project.id),
        api.research.discoverLegacy(project.id),
        api.manifest.read(project.rootPath)
      ]);
      setFiles(nextFiles);
      setRecords(nextRecords);
      setLegacy(nextLegacy);
      setManifest(nextManifest);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法读取研究资料");
    } finally {
      setLoading(false);
    }
  }, [api, onNotify, project.id, project.rootPath]);

  useEffect(() => { void refresh(); }, [refresh]);

  const rows = useMemo<ProjectResearchRow[]>(() => {
    const filesByPath = new Map(files.map((file) => [file.relativePath.replaceAll("\\", "/"), file]));
    const knownHashes = new Set(records.flatMap((record) => record.item.attachments.map((attachment) => attachment.sha256?.toLocaleLowerCase()).filter(Boolean)));
    const output: ProjectResearchRow[] = [];
    const usedPaths = new Set<string>();
    for (const record of records) {
      for (const attachment of record.item.attachments) {
        const relativePath = attachment.relativePath?.replaceAll("\\", "/");
        const file = relativePath ? filesByPath.get(relativePath) : undefined;
        if (relativePath) usedPaths.add(relativePath);
        output.push({
          key: `${record.item.id}:${attachment.id}`,
          record,
          attachment,
          file,
          title: record.item.title || attachment.name,
          subtitle: [attachment.name, record.item.authors.join("、"), record.item.year].filter(Boolean).join(" · "),
          size: attachment.size ?? file?.size ?? 0,
          pending: record.item.links.length === 0,
          localOnly: attachment.availability === "localOnly"
        });
      }
    }
    for (const candidate of legacy) {
      if (knownHashes.has(candidate.sha256.toLocaleLowerCase())) continue;
      const relativePath = candidate.relativePath.replaceAll("\\", "/");
      if (usedPaths.has(relativePath)) continue;
      usedPaths.add(relativePath);
      output.push({
        key: `legacy:${candidate.sha256}`,
        legacy: candidate,
        file: filesByPath.get(relativePath),
        title: titleFromFileName(candidate.name),
        subtitle: `${candidate.name} · 待整理`,
        size: candidate.size,
        pending: true,
        localOnly: false
      });
    }
    for (const file of files) {
      const relativePath = file.relativePath.replaceAll("\\", "/");
      if (usedPaths.has(relativePath)) continue;
      output.push({ key: `file:${relativePath}`, file, title: titleFromFileName(file.name), subtitle: `${file.name} · 尚未建立资料索引`, size: file.size, pending: true, localOnly: false });
    }
    return output.sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));
  }, [files, legacy, records]);

  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      if (filter === "pending" && !row.pending) return false;
      if (filter === "localOnly" && !row.localOnly) return false;
      if (filter !== "all" && filter !== "pending" && filter !== "localOnly" && !row.record?.item.links.some((link) => link.role === filter)) return false;
      return !normalized || `${row.title} ${row.subtitle} ${row.record?.item.doi ?? ""} ${row.record?.item.arxivId ?? ""}`.toLocaleLowerCase().includes(normalized);
    });
  }, [filter, query, rows]);
  const selected = visibleRows.find((row) => row.key === selectedKey) ?? visibleRows[0] ?? null;
  const targetIds = manifest?.targets.map((target) => target.id) ?? [];
  const targetIdentity = targetIds.join("\0");
  const targetNames = useMemo(
    () => new Map(manifest?.targets.map((target) => [target.id, target.name]) ?? []),
    [manifest]
  );

  useEffect(() => {
    if (!selected) return;
    const item = selected.record?.item;
    setDraft({
      title: item?.title ?? selected.title,
      authors: item?.authors.join("、") ?? "",
      year: item?.year ? String(item.year) : "",
      doi: item?.doi ?? "",
      arxivId: item?.arxivId ?? "",
      isbn: item?.isbn ?? "",
      linkEntries: createResearchLinkDraft(item?.links ?? [], targetIds),
      linksTouched: false
    });
    setConfirmRemoveRecord(false);
  }, [selected?.key, selected?.record?.updatedAt, targetIdentity]);

  function localAttachmentPaths(current = records): Record<string, string> {
    return Object.assign({}, ...current.map((entry) => entry.localAttachmentPaths));
  }

  function toggleDraftTarget(targetKey: string, enabled: boolean) {
    setDraft((current) => ({
      ...current,
      linksTouched: true,
      linkEntries: current.linkEntries.map((entry) => {
        if (entry.targetKey === targetKey) return { ...entry, enabled };
        if (!enabled) return entry;
        if (targetKey === PROJECT_RESEARCH_SCOPE || entry.targetKey === PROJECT_RESEARCH_SCOPE) return { ...entry, enabled: false };
        return entry;
      })
    }));
  }

  function updateDraftLink(targetKey: string, patch: Partial<Pick<ResearchLinkDraftEntry, "role" | "preferredAttachmentId">>) {
    setDraft((current) => ({
      ...current,
      linksTouched: true,
      linkEntries: current.linkEntries.map((entry) => entry.targetKey === targetKey ? { ...entry, ...patch } : entry)
    }));
  }

  function itemFromSelected(): ProjectResearchItem {
    const existing = selected?.record?.item;
    const candidate = selected?.legacy;
    const fallbackFile = selected?.file;
    const attachment = selected?.attachment ?? (candidate ? {
      id: crypto.randomUUID(), name: candidate.name, relativePath: candidate.relativePath,
      mediaType: candidate.mediaType, size: candidate.size, sha256: candidate.sha256, availability: "repository" as const
    } : fallbackFile ? {
      id: crypto.randomUUID(), name: fallbackFile.name, relativePath: fallbackFile.relativePath,
      mediaType: fallbackFile.kind === "pdf" ? "application/pdf" : "application/octet-stream", size: fallbackFile.size,
      availability: "repository" as const
    } : undefined);
    if (!attachment) throw new Error("所选资料没有可保存的附件");
    const year = draft.year.trim() ? Number(draft.year) : undefined;
    if (year !== undefined && (!Number.isInteger(year) || year < 1000 || year > 3000)) throw new Error("年份应为四位数字");
    return {
      ...(existing ?? { id: crypto.randomUUID(), attachments: [attachment], links: [] }),
      title: draft.title.trim() || undefined,
      authors: draft.authors.split(/[，,、;]/).map((value) => value.trim()).filter(Boolean),
      year,
      doi: draft.doi.trim() || undefined,
      arxivId: draft.arxivId.trim() || undefined,
      isbn: draft.isbn.trim() || undefined,
      links: materializeResearchLinks(draft.linkEntries, existing?.links ?? [], draft.linksTouched)
    };
  }

  async function saveSelected() {
    if (!selected) return;
    setBusy(true);
    try {
      const nextItem = itemFromSelected();
      const nextItems = selected.record
        ? records.map((entry) => entry.item.id === selected.record!.item.id ? nextItem : entry.item)
        : [...records.map((entry) => entry.item), nextItem];
      const next = await api.research.save(project.id, { items: nextItems, localAttachmentPaths: localAttachmentPaths() });
      setRecords(next);
      setLegacy(await api.research.discoverLegacy(project.id));
      setSelectedKey(`${nextItem.id}:${nextItem.attachments[0].id}`);
      onNotify(isDemo ? "演示模式：资料信息已更新" : "资料信息与目标关联已保存；移动索引将进入安全同步队列");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法保存资料信息");
    } finally {
      setBusy(false);
    }
  }

  async function organizePending() {
    const pending = legacy.filter((candidate) => !records.some((record) => record.item.attachments.some((attachment) => attachment.sha256 === candidate.sha256)));
    if (!pending.length) return;
    if (!confirmBatch) { setConfirmBatch(true); return; }
    setBusy(true);
    try {
      const uniqueTarget = manifest?.targets.length === 1 ? manifest.targets[0].id : null;
      const additions: ProjectResearchItem[] = pending.map((candidate) => ({
        id: crypto.randomUUID(),
        title: titleFromFileName(candidate.name),
        authors: [],
        attachments: [{ id: crypto.randomUUID(), name: candidate.name, relativePath: candidate.relativePath, mediaType: candidate.mediaType, size: candidate.size, sha256: candidate.sha256, availability: "repository" }],
        links: uniqueTarget ? [{ targetId: uniqueTarget, role: "reference" }] : []
      }));
      const next = await api.research.save(project.id, { items: [...records.map((entry) => entry.item), ...additions], localAttachmentPaths: localAttachmentPaths() });
      setRecords(next);
      setLegacy(await api.research.discoverLegacy(project.id));
      setConfirmBatch(false);
      onNotify(uniqueTarget ? `已整理 ${additions.length} 份资料，并关联到唯一文档目标` : `已整理 ${additions.length} 份资料；已放入待关联`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "批量整理失败");
    } finally {
      setBusy(false);
    }
  }

  async function importDocuments() {
    setBusy(true);
    try {
      await api.references.import(project.id);
      await refresh();
      if (!isDemo) onNotify("资料已加入待整理箱；公开仓库会默认仅保存在本机");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "添加研究资料失败");
    } finally {
      setBusy(false);
    }
  }

  async function openRow(row: ProjectResearchRow) {
    try {
      if (row.record && row.attachment) await api.research.openAttachment(project.id, row.record.item.id, row.attachment.id);
      else if (row.file) await api.references.open(project.id, row.file.relativePath);
      else throw new Error("这份资料当前无法在本机打开");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法打开研究资料");
    }
  }

  async function openSelected() {
    if (selected) await openRow(selected);
  }

  async function removeRecordKeepFile() {
    if (!selected?.record) return;
    if (!confirmRemoveRecord) { setConfirmRemoveRecord(true); return; }
    setBusy(true);
    try {
      const nextRecords = records.filter((entry) => entry.item.id !== selected.record!.item.id);
      const next = await api.research.save(project.id, { items: nextRecords.map((entry) => entry.item), localAttachmentPaths: localAttachmentPaths(nextRecords) });
      setRecords(next);
      setLegacy(await api.research.discoverLegacy(project.id));
      setSelectedKey(null);
      setConfirmRemoveRecord(false);
      onNotify("已从项目资料视图移除；物理文件仍保留在原位置");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法移除资料记录");
    } finally {
      setBusy(false);
    }
  }

  async function openFolder() {
    try {
      await api.references.openFolder(project.id);
      if (isDemo) onNotify("演示模式：已模拟打开 references 文件夹");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法打开 references 文件夹");
    }
  }

  const filterItems: Array<{ id: ProjectResearchFilter; label: string; count: number }> = [
    { id: "all", label: "全部资料", count: rows.length },
    { id: "pending", label: "待关联", count: rows.filter((row) => row.pending).length },
    { id: "localOnly", label: "仅本机", count: rows.filter((row) => row.localOnly).length },
    ...Object.entries(researchRoleLabels).map(([id, label]) => ({ id: id as ResearchRole, label, count: rows.filter((row) => row.record?.item.links.some((link) => link.role === id)).length }))
  ];
  const pendingCount = rows.filter((row) => row.pending && row.legacy).length;

  return (
    <section className="resource-page references-page research-workbench-page">
      <header className="resource-heading">
        <div className="resource-heading-copy"><span className="resource-heading-icon"><BookOpen size={22} /></span><div><p className="eyebrow">资料与文档目标的关系</p><h2 aria-label="原始文稿">研究资料</h2><p>管理书目信息、附件版本和目标关联；不会在这里编辑原文件。</p></div></div>
        <div className="resource-heading-actions"><button className="button secondary" onClick={() => void openFolder()}><FolderOpen size={16} />打开资料文件夹</button>{pendingCount > 0 && <button className={`button secondary ${confirmBatch ? "warning" : ""}`} onClick={() => void organizePending()} disabled={busy}><CheckCircle2 size={16} />{confirmBatch ? `确认整理 ${pendingCount} 项` : `整理 ${pendingCount} 项`}</button>}<button className="button primary" onClick={() => void importDocuments()} disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}添加资料</button></div>
      </header>
      <div className="reference-location"><FolderOpen size={18} /><div><strong>项目资料位置</strong><code title={`${project.rootPath}\\references`}>{project.rootPath}\references</code></div><span>仓库附件可同步；“仅本机”附件受安全规则保护，绝不进入 Git</span></div>

      {loading ? <div className="resource-loading"><LoaderCircle size={20} className="spin" />正在建立资料视图…</div> : rows.length === 0 ? <div className="reference-empty"><span><BookOpen size={28} /></span><h3>还没有研究资料</h3><p>添加论文、书籍或数据。文件会复制到项目目录，原文件保持不变。</p><button className="button primary" onClick={() => void importDocuments()} disabled={busy}><Plus size={16} />选择资料</button></div> : <div className="reference-browser research-browser">
        <aside className="reference-filters" aria-label="研究资料分类"><strong>资料视图</strong>{filterItems.map((item) => <button key={item.id} className={filter === item.id ? "active" : ""} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}><span>{item.label}</span><small>{item.count}</small></button>)}<div className="reference-filter-note"><ShieldCheck size={15} /><span>公开同步前会再次检查版权与隐私。</span></div></aside>
        <section className="reference-collection"><label className="reference-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索研究资料" placeholder="搜索标题、作者、DOI 或附件" />{query && <button aria-label="清除资料搜索" onClick={() => setQuery("")}><X size={14} /></button>}</label><div className="reference-list" role="list" aria-label="原始文稿列表">{visibleRows.map((row) => <article className={`reference-row ${selected?.key === row.key ? "selected" : ""}`} role="listitem" key={row.key}><span className="reference-icon"><ResearchRowIcon row={row} /></span><button className="reference-main" aria-pressed={selected?.key === row.key} onClick={() => setSelectedKey(row.key)} onDoubleClick={() => void openRow(row)}><strong>{row.title}</strong><span>{row.subtitle}</span></button><div className="reference-meta"><strong>{formatBytes(row.size)}</strong><span>{row.localOnly ? "仅本机" : row.pending ? "待整理" : "已关联"}</span></div><span className={`reference-lfs-badge ${row.pending ? "pending" : row.localOnly ? "local" : ""}`}>{row.pending ? "待关联" : row.localOnly ? "仅电脑可用" : row.record?.item.links.map((link) => researchRoleLabels[link.role]).filter((value, index, all) => all.indexOf(value) === index).join("、")}</span></article>)}{!visibleRows.length && <div className="reference-filter-empty">没有符合当前视图或搜索条件的资料。</div>}</div></section>
        <aside className="reference-inspector research-metadata-inspector" aria-label={selected ? `资料详情 ${selected.title}` : "资料详情"}>
          {selected ? <>
            <span className="reference-preview-icon"><ResearchRowIcon row={selected} /></span>
            <div className="research-inspector-title"><h3>{selected.title}</h3><p>{selected.attachment?.name ?? selected.legacy?.name ?? selected.file?.name}</p></div>
            <div className="research-metadata-form">
              <label><span>标题</span><input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label>
              <label><span>作者</span><input value={draft.authors} onChange={(event) => setDraft((current) => ({ ...current, authors: event.target.value }))} placeholder="用逗号分隔" /></label>
              <div className="research-metadata-pair">
                <label><span>年份</span><input inputMode="numeric" value={draft.year} onChange={(event) => setDraft((current) => ({ ...current, year: event.target.value }))} /></label>
                <label><span>DOI</span><input value={draft.doi} onChange={(event) => setDraft((current) => ({ ...current, doi: event.target.value }))} /></label>
              </div>
              <label><span>arXiv / ISBN</span><div className="research-metadata-pair"><input value={draft.arxivId} onChange={(event) => setDraft((current) => ({ ...current, arxivId: event.target.value }))} placeholder="arXiv ID" /><input value={draft.isbn} onChange={(event) => setDraft((current) => ({ ...current, isbn: event.target.value }))} placeholder="ISBN" /></div></label>
              <ResearchLinksEditor
                entries={draft.linkEntries}
                targetNames={targetNames}
                attachments={selected.record?.item.attachments ?? (selected.attachment ? [selected.attachment] : [])}
                onToggle={toggleDraftTarget}
                onRoleChange={(targetKey, role) => updateDraftLink(targetKey, { role })}
                onPreferredAttachmentChange={(targetKey, preferredAttachmentId) => updateDraftLink(targetKey, { preferredAttachmentId })}
              />
            </div>
            <div className="reference-inspector-actions">
              <button className="button primary" onClick={() => void saveSelected()} disabled={busy}><CheckCircle2 size={16} />{selected.record ? "保存资料信息" : "建立资料记录"}</button>
              <button className="button secondary" aria-label={`打开原始文稿 ${selected.attachment?.name ?? selected.file?.name ?? selected.title}`} onClick={() => void openSelected()}><ExternalLink size={16} />打开附件</button>
              {selected.record && <button className="button secondary danger-text" onClick={() => void removeRecordKeepFile()} disabled={busy}><Trash2 size={15} />{confirmRemoveRecord ? "确认移除记录（保留文件）" : "从资料视图移除"}</button>}
            </div>
          </> : <div className="reference-inspector-empty"><BookOpen size={24} /><span>选择资料查看详情</span></div>}
        </aside>
      </div>}
    </section>
  );
}
