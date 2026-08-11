import { useCallback, useEffect, useState } from "react";
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
  Mail,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
  X
} from "lucide-react";

import type { WorkbenchApi } from "@/shared/ipc";
import type { GitHubSyncState, GitHubSyncStatus, ProjectSummary, ReferenceDocumentInfo } from "@/shared/types";

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

const syncStateLabel: Record<GitHubSyncState, string> = {
  unavailable: "Git 不可用",
  notConfigured: "尚未连接",
  ready: "等待首次同步",
  changes: "有待同步变更",
  syncing: "正在同步",
  synced: "已同步",
  needsPull: "需要处理远端更新",
  error: "同步异常"
};

function SyncStateIcon({ state }: { state: GitHubSyncState }) {
  if (state === "syncing") return <LoaderCircle size={19} className="spin" />;
  if (state === "synced") return <CheckCircle2 size={19} />;
  if (state === "unavailable" || state === "error") return <CloudOff size={19} />;
  if (state === "needsPull") return <AlertCircle size={19} />;
  return <Cloud size={19} />;
}

export function GitHubSyncTab({ api, project, isDemo, onNotify }: SharedProps) {
  const [status, setStatus] = useState<GitHubSyncStatus | null>(null);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [autoSync, setAutoSync] = useState(true);
  const [useLfs, setUseLfs] = useState(true);
  const [identityName, setIdentityName] = useState("");
  const [identityEmail, setIdentityEmail] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [busy, setBusy] = useState<"configure" | "sync" | "toggle" | "identity" | null>(null);

  const refresh = useCallback(async (initializeDraft = false) => {
    try {
      const next = await api.github.status(project.id);
      setStatus(next);
      if (initializeDraft || !initialized) {
        setRemoteUrl(next.remoteUrl);
        setAutoSync(next.configured ? next.autoSync : true);
        setUseLfs(next.configured ? next.useLfsForDocuments : next.lfsAvailable);
        setIdentityName(next.identity.name);
        setIdentityEmail(next.identity.email);
        setInitialized(true);
      }
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法读取 GitHub 同步状态");
    }
  }, [api, initialized, onNotify, project.id]);

  useEffect(() => {
    void refresh(true);
    const timer = setInterval(() => { void refresh(false); }, 6_000);
    return () => clearInterval(timer);
  }, [refresh]);

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

  const stateClass = status.state === "synced" ? "success" : status.state === "error" || status.state === "unavailable" ? "error" : status.state === "needsPull" ? "warning" : "neutral";
  const hasDraftChanges = status.configured && (remoteUrl.trim() !== status.remoteUrl || useLfs !== status.useLfsForDocuments);

  return (
    <section className="resource-page github-sync-page">
      <header className="resource-heading">
        <div className="resource-heading-copy"><span className="resource-heading-icon"><GitFork size={22} /></span><div><p className="eyebrow">版本备份与多设备同步</p><h2>GitHub 同步</h2><p>项目中的新增、修改和删除会作为 Git 提交上传；不会执行强制推送。</p></div></div>
        {status.configured && <button className="button primary" onClick={() => void syncNow()} disabled={busy !== null || status.state === "unavailable" || !status.identity.configured}>{busy === "sync" ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}立即同步</button>}
      </header>

      <div className={`sync-status-card state-${stateClass}`}>
        <span className="sync-status-icon"><SyncStateIcon state={status.state} /></span>
        <div><strong>{syncStateLabel[status.state]}</strong><p>{status.message}</p></div>
        <span className="sync-status-time">上次成功：{formatTime(status.lastSyncAt)}</span>
      </div>

      <section className={`resource-card git-identity-card ${status.identity.configured ? "identity-ready" : "identity-required"}`}>
        <header><div><h3>提交身份</h3><p>只保存到当前项目，用来标记 GitHub 上的提交作者。</p></div><UserRound size={18} /></header>
        <div className="git-identity-fields">
          <label className="resource-field"><span>提交姓名</span><div className="input-with-icon"><UserRound size={16} /><input value={identityName} onChange={(event) => setIdentityName(event.target.value)} placeholder="例如：Ararataki-number-one" maxLength={100} /></div></label>
          <label className="resource-field"><span>提交邮箱</span><div className="input-with-icon"><Mail size={16} /><input type="email" value={identityEmail} onChange={(event) => setIdentityEmail(event.target.value)} placeholder="你的 GitHub 邮箱或 noreply 邮箱" maxLength={254} /></div></label>
          <button className="button secondary identity-save-button" onClick={() => void saveIdentityAndContinue()} disabled={busy !== null || !identityName.trim() || !identityEmail.trim()}>{busy === "identity" ? <LoaderCircle size={16} className="spin" /> : <CheckCircle2 size={16} />}{status.configured ? "保存并继续同步" : "保存到当前项目"}</button>
        </div>
        <p className={`identity-status ${status.identity.configured ? "ready" : "required"}`}>{status.identity.configured ? `已配置（${status.identity.source === "local" ? "当前项目" : "全局 Git 设置"}）` : "尚未配置；完成此项后即可提交并同步。"}</p>
      </section>

      <div className="resource-columns">
        <section className="resource-card github-connect-card">
          <header><div><h3>仓库连接</h3><p>使用 GitHub HTTPS 或 SSH 仓库地址。</p></div><GitFork size={18} /></header>
          <label className="resource-field"><span>GitHub 仓库地址</span><input value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://github.com/用户名/仓库名.git" spellCheck={false} /></label>
          <div className="sync-toggle-list">
            <label className="sync-toggle"><span><strong>自动同步</strong><small>文件停止变化约 10 秒后，自动提交并推送</small></span><input type="checkbox" checked={autoSync} disabled={busy !== null} onChange={(event) => void toggleAutoSync(event.target.checked)} /></label>
            <label className="sync-toggle"><span><strong>大型文稿使用 Git LFS</strong><small>跟踪 PDF、EPUB 与 DjVu，适合原始文稿</small></span><input type="checkbox" checked={useLfs} disabled={!status.lfsAvailable || busy !== null} onChange={(event) => setUseLfs(event.target.checked)} /></label>
          </div>
          {!status.lfsAvailable && <p className="inline-warning"><AlertCircle size={14} />未检测到 Git LFS；超过 100 MiB 的文件无法上传到普通 Git 仓库。</p>}
          <button className="button primary full" onClick={() => void configureAndSync()} disabled={busy !== null || !status.available || !remoteUrl.trim()}>{busy === "configure" ? <LoaderCircle size={16} className="spin" /> : <Cloud size={16} />}{status.configured ? (hasDraftChanges ? "保存设置并同步" : "重新连接并同步") : "连接并首次同步"}</button>
          {isDemo && <p className="demo-note compact-note">演示模式只展示同步流程，不会访问真实 GitHub 仓库。</p>}
        </section>

        <section className="resource-card sync-details-card">
          <header><div><h3>仓库状态</h3><p>只展示本机 Git 已知的信息。</p></div><GitBranch size={18} /></header>
          <div className="sync-facts">
            <div><span>Git</span><strong>{status.available ? status.gitVersion ?? "已安装" : "未安装"}</strong></div>
            <div><span>当前分支</span><strong>{status.branch ?? "—"}</strong></div>
            <div><span>待推送提交</span><strong>{status.ahead}</strong></div>
            <div><span>远端领先提交</span><strong>{status.behind}</strong></div>
          </div>
          {status.lastCommit && <div className="last-commit"><span>最近提交</span><strong><code>{status.lastCommit.hash}</code>{status.lastCommit.message}</strong><small>{formatTime(status.lastCommit.committedAt)}</small></div>}
          <div className="sync-safety-note"><ShieldCheck size={17} /><div><strong>安全同步策略</strong><p>删除操作会正常进入 Git 历史；远端领先或分叉时停止推送，由你在 VS Code 或 GitHub Desktop 中处理。</p></div></div>
        </section>
      </div>

      {(status.changedFiles.length > 0 || status.largeFiles.length > 0) && (
        <section className="resource-card pending-files-card">
          <header><div><h3>待同步文件</h3><p>{status.changedFiles.length} 个变更，包括新增、修改与删除。</p></div><HardDrive size={18} /></header>
          <div className="pending-file-list">
            {status.changedFiles.slice(0, 12).map((file) => <div key={`${file.status}-${file.path}`}><code>{file.status.trim() || "M"}</code><span title={file.path}>{file.path}</span>{status.largeFiles.some((large) => large.path === file.path) && <small>大型文件</small>}</div>)}
            {status.changedFiles.length > 12 && <p>另有 {status.changedFiles.length - 12} 个文件将在同一次同步中处理。</p>}
          </div>
        </section>
      )}
    </section>
  );
}

function DocumentIcon({ item }: { item: ReferenceDocumentInfo }) {
  if (item.kind === "archive") return <FileArchive size={19} />;
  if (item.kind === "pdf" || item.kind === "ebook") return <BookOpen size={19} />;
  return <FileText size={19} />;
}

export function ReferencesTab({ api, project, isDemo, onNotify }: SharedProps) {
  const [items, setItems] = useState<ReferenceDocumentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

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
        <div className="resource-heading-copy"><span className="resource-heading-icon"><BookOpen size={22} /></span><div><p className="eyebrow">随项目保存的阅读材料</p><h2>原始文稿</h2><p>英文论文、中文 PDF 和电子书会复制到项目根目录的 <code>references</code> 文件夹。</p></div></div>
        <div className="resource-heading-actions"><button className="button secondary" onClick={() => void openFolder()}><FolderOpen size={16} />打开 references 文件夹</button><button className="button primary" onClick={() => void importDocuments()} disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}添加文稿</button></div>
      </header>

      <div className="reference-location"><FolderOpen size={18} /><div><strong>文稿保存位置</strong><code title={`${project.rootPath}\\references`}>{project.rootPath}\references</code></div><span>复制项目、导出 ZIP 与 GitHub 同步都会包含这里的文件</span></div>

      {loading ? (
        <div className="resource-loading"><LoaderCircle size={20} className="spin" />正在读取原始文稿…</div>
      ) : items.length === 0 ? (
        <div className="reference-empty"><span><BookOpen size={28} /></span><h3>还没有原始文稿</h3><p>添加你正在阅读的论文或 PDF。客户端会复制文件，不会移动或修改原文件。</p><button className="button primary" onClick={() => void importDocuments()} disabled={busy}><Plus size={16} />选择文稿</button></div>
      ) : (
        <div className="reference-list" role="list" aria-label="原始文稿列表">
          {items.map((item) => (
            <article className="reference-row" role="listitem" key={item.relativePath}>
              <span className="reference-icon"><DocumentIcon item={item} /></span>
              <button className="reference-main" onClick={() => void openDocument(item)}><strong>{item.name}</strong><span>{item.relativePath}</span></button>
              <div className="reference-meta"><strong>{formatBytes(item.size)}</strong><span>{formatTime(item.modifiedAt)}</span></div>
              {item.lfsRecommended ? <span className="reference-lfs-badge" title="GitHub 对大文件有限制，建议使用 Git LFS">建议 Git LFS</span> : <span />}
              <div className="reference-actions">
                {confirmRemove === item.relativePath ? <><button className="button danger compact-button" onClick={() => void removeDocument(item)} disabled={busy}><Trash2 size={14} />确认移除</button><button className="icon-button" aria-label={`取消移除 ${item.name}`} onClick={() => setConfirmRemove(null)}><X size={16} /></button></> : <><button className="icon-button" aria-label={`打开原始文稿 ${item.name}`} onClick={() => void openDocument(item)}><ExternalLink size={17} /></button><button className="icon-button danger-hover" aria-label={`移除原始文稿 ${item.name}`} onClick={() => setConfirmRemove(item.relativePath)}><Trash2 size={17} /></button></>}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
