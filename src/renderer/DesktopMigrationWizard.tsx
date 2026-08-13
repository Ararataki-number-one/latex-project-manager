import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, DatabaseBackup, LoaderCircle, X } from "lucide-react";

import type { DesktopMigrationConflictResolution, DesktopMigrationPreview } from "@/shared/types";

export function DesktopMigrationWizard({
  preview,
  onApply,
  onLater
}: {
  preview: DesktopMigrationPreview;
  onApply: (resolutions: Record<string, DesktopMigrationConflictResolution>) => Promise<void>;
  onLater: () => void;
}) {
  const initial = useMemo(() => Object.fromEntries(preview.conflicts.map((conflict) => [conflict.id, "keepTarget" as const])), [preview]);
  const [resolutions, setResolutions] = useState<Record<string, DesktopMigrationConflictResolution>>(initial);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const busyRef = useRef(busy);
  const onLaterRef = useRef(onLater);
  const imported = preview.projects.filter((item) => item.action === "import").length;
  const merged = preview.projects.filter((item) => item.action === "merge").length;

  async function apply() {
    setBusy(true);
    try { await onApply(resolutions); } finally { setBusy(false); }
  }

  busyRef.current = busy;
  onLaterRef.current = onLater;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex='-1'])") ?? [])];
    focusable()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        onLaterRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previous?.focus();
    };
  }, []);

  return <div className="modal-backdrop desktop-migration-backdrop" role="presentation">
    <section ref={dialogRef} className="modal desktop-migration-dialog" role="dialog" aria-modal="true" aria-labelledby="desktop-migration-title" aria-describedby="desktop-migration-description">
      <header className="modal-header">
        <div><p className="eyebrow">安全升级</p><h2 id="desktop-migration-title">发现旧版本项目库</h2></div>
        <button className="icon-button" aria-label="稍后迁移" disabled={busy} onClick={onLater}><X size={18} /></button>
      </header>
      <div className="desktop-migration-intro"><DatabaseBackup size={25} /><div><strong>先预览，再备份并合并</strong><p id="desktop-migration-description">不会删除 0.11.1 或 Beta 数据目录；正式项目文件也不会被移动。</p></div></div>
      <div className="desktop-migration-summary">
        <span><small>来源</small><strong>{preview.sources.length}</strong></span>
        <span><small>新增项目</small><strong>{imported}</strong></span>
        <span><small>自动合并</small><strong>{merged}</strong></span>
        <span className={preview.conflicts.length ? "attention" : ""}><small>需要选择</small><strong>{preview.conflicts.length}</strong></span>
      </div>
      <div className="desktop-migration-sources">
        {preview.sources.map((source) => <div key={source.databasePath}><CheckCircle2 size={16} /><span><strong>{source.label ?? source.kind}</strong><small>{source.databasePath} · schema v{source.schemaVersion}</small></span></div>)}
      </div>
      {preview.conflicts.length > 0 && <section className="desktop-migration-conflicts">
        <h3><AlertTriangle size={17} />需要你确认的冲突</h3>
        {preview.conflicts.map((conflict) => <article key={conflict.id}>
          <div><strong>{conflict.sourceProject.name}</strong><p>{conflict.kind === "sameRootDifferentProject" ? "同一个文件夹在两个项目库中使用了不同项目 ID。" : "同一个项目 ID 指向了不同文件夹。"}</p><small>{conflict.sourceProject.rootPath}</small></div>
          <label><span>保留方式</span><select value={resolutions[conflict.id]} onChange={(event) => setResolutions((current) => ({ ...current, [conflict.id]: event.target.value as DesktopMigrationConflictResolution }))}><option value="keepTarget">保留当前正式版记录</option><option value="useSource">使用旧版本记录并合并元数据</option></select></label>
        </article>)}
      </section>}
      {preview.warnings.length > 0 && <div className="desktop-migration-warnings">{preview.warnings.join("；")}</div>}
      <footer className="modal-actions"><button className="button ghost" disabled={busy} onClick={onLater}>稍后处理</button><button className="button primary" disabled={busy} onClick={() => void apply()}>{busy ? <LoaderCircle size={16} className="spin" /> : <DatabaseBackup size={16} />}备份并合并项目库</button></footer>
    </section>
  </div>;
}
