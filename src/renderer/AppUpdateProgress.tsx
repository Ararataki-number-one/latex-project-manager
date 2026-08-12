import { CheckCircle2, Download, LoaderCircle, RotateCcw, X } from "lucide-react";

import type { AppUpdateStatus } from "@/shared/types";

function bytes(value = 0): string {
  if (value <= 0) return "0 MB";
  return `${(value / 1024 / 1024).toFixed(value >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

const phaseLabels: Record<NonNullable<AppUpdateStatus["phase"]>, string> = {
  idle: "等待下载",
  checkingRelease: "正在检查版本",
  verifyingManifest: "正在验证发布签名",
  preparingDownload: "正在连接下载服务器",
  downloading: "正在下载安装包",
  verifyingPackage: "正在校验安装包",
  ready: "安装包已就绪",
  cancelled: "下载已暂停",
  failed: "下载失败"
};

export function AppUpdateProgress({ status, busy, onCancel, onRetry }: {
  status: AppUpdateStatus;
  busy: boolean;
  onCancel: () => void;
  onRetry: () => void;
}) {
  if (!(status.state === "downloading" || status.state === "downloaded" || status.state === "cancelled"
    || (status.state === "error" && (status.totalBytes ?? 0) > 0))) return null;
  const progress = Math.max(0, Math.min(100, status.progressPercent ?? 0));
  const active = status.state === "downloading";
  return <section className={`update-progress-panel update-progress-${status.state}`} aria-label="更新下载进度" aria-live="polite">
    <div className="update-progress-heading">
      <span>{active ? <LoaderCircle size={18} className="spin" /> : status.state === "downloaded" ? <CheckCircle2 size={18} /> : <Download size={18} />}</span>
      <div><strong>{phaseLabels[status.phase ?? (active ? "downloading" : status.state === "downloaded" ? "ready" : "failed")]}</strong><small>{status.latestVersion ? `版本 ${status.latestVersion}` : "客户端更新"}</small></div>
      <b>{progress}%</b>
    </div>
    <div className="update-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div>
    <div className="update-progress-meta"><span>{bytes(status.downloadedBytes)} / {bytes(status.totalBytes)}</span><span>{status.phase === "verifyingPackage" ? "文件已下载，正在做最终安全校验" : "关闭此页面不会中断下载"}</span></div>
    {(status.canCancel || status.canRetry) && <div className="update-progress-actions">
      {status.canCancel && <button className="button secondary compact" disabled={busy} onClick={onCancel}><X size={15} />取消下载</button>}
      {status.canRetry && <button className="button secondary compact" disabled={busy} onClick={onRetry}><RotateCcw size={15} />继续或重试</button>}
    </div>}
  </section>;
}
