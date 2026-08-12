import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ChevronRight, Copy, ExternalLink, File, FilePlus2, Folder, FolderOpen,
  FolderPlus, Import, List, Pencil, RotateCcw, Search, Trash2, X
} from "lucide-react";
import type { WorkbenchApi } from "@/shared/ipc";
import type { ProjectFileEntry, ProjectFileOperationKind, ProjectFileOperationPlan, ProjectSummary } from "@/shared/types";

interface ProjectFilesProps {
  api: WorkbenchApi;
  project: ProjectSummary;
  isDemo: boolean;
  onNotify: (message: string) => void;
}

function parentOf(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function joinPath(parent: string, name: string): string { return [parent, name].filter(Boolean).join("/"); }

function formatSize(size: number, directory: boolean): string {
  if (directory) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function FileGlyph({ entry }: { entry: ProjectFileEntry }) {
  return entry.isDirectory ? <Folder size={19} /> : <File size={19} />;
}

export function ProjectFiles({ api, project, isDemo, onNotify }: ProjectFilesProps) {
  const [directory, setDirectory] = useState("");
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<ProjectFileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"name" | "modified" | "size" | "type">("name");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [compact, setCompact] = useState(false);
  const [newItem, setNewItem] = useState<"file" | "directory" | null>(null);
  const [newName, setNewName] = useState("");
  const [operation, setOperation] = useState<ProjectFileOperationKind | null>(null);
  const [destination, setDestination] = useState("");
  const [plan, setPlan] = useState<ProjectFileOperationPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [undoId, setUndoId] = useState<string | null>(null);

  const selected = entries.find((entry) => entry.relativePath === selectedPath) ?? null;
  const breadcrumbs = useMemo(() => directory.split("/").filter(Boolean), [directory]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.files.list(project.id, {
        directory: query.trim() ? undefined : directory,
        query: query.trim() || undefined,
        recursive: Boolean(query.trim()), sort, direction
      });
      setEntries(result);
      setSelectedPath((current) => result.some((entry) => entry.relativePath === current) ? current : null);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法读取项目文件");
    } finally { setLoading(false); }
  }, [api, project.id, directory, query, sort, direction, onNotify]);

  useEffect(() => { void reload(); }, [reload]);

  async function openEntry(entry: ProjectFileEntry) {
    if (entry.isDirectory) { setDirectory(entry.relativePath); setQuery(""); return; }
    try { await api.files.open(project.id, entry.relativePath); }
    catch (error) { onNotify(error instanceof Error ? error.message : "无法打开文件"); }
  }

  async function createItem() {
    if (!newItem || !newName.trim()) return;
    if (isDemo) { onNotify("演示模式不会创建文件"); return; }
    setBusy(true);
    try {
      if (newItem === "directory") await api.files.createDirectory(project.id, directory, newName);
      else await api.files.create(project.id, directory, newName);
      onNotify(newItem === "directory" ? "文件夹已创建" : "空文件已创建");
      setNewItem(null); setNewName(""); await reload();
    } catch (error) { onNotify(error instanceof Error ? error.message : "创建失败"); }
    finally { setBusy(false); }
  }

  async function importFiles() {
    if (isDemo) { onNotify("演示模式不会导入文件"); return; }
    try {
      const imported = await api.files.import(project.id, directory);
      if (imported.length) { onNotify(`已导入 ${imported.length} 个文件`); await reload(); }
    } catch (error) { onNotify(error instanceof Error ? error.message : "导入失败"); }
  }

  function beginOperation(kind: ProjectFileOperationKind) {
    if (!selected) return;
    setOperation(kind); setPlan(null);
    setDestination(kind === "rename" ? joinPath(parentOf(selected.relativePath), selected.name) : directory);
  }

  async function previewOperation() {
    if (!selected || !operation) return;
    setBusy(true);
    try {
      const nextPlan = await api.files.plan(project.id, {
        kind: operation, sourcePath: selected.relativePath,
        destinationPath: operation === "trash" ? undefined : destination,
        expectedHash: selected.hash, rewriteLatexReferences: true
      });
      setPlan(nextPlan);
    } catch (error) { onNotify(error instanceof Error ? error.message : "无法生成操作预览"); }
    finally { setBusy(false); }
  }

  async function applyOperation() {
    if (!plan) return;
    if (isDemo) { onNotify("演示模式不会修改文件"); return; }
    setBusy(true);
    try {
      const result = await api.files.apply(project.id, plan.id);
      setUndoId(result.undoId); setOperation(null); setPlan(null); setSelectedPath(null);
      onNotify(`操作已完成${result.rewrittenFiles.length ? `，并更新 ${result.rewrittenFiles.length} 个 LaTeX 引用文件` : ""}`);
      await reload();
    } catch (error) { onNotify(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  }

  async function undo() {
    if (!undoId) return;
    setBusy(true);
    try { await api.files.undo(project.id, undoId); setUndoId(null); onNotify("上一次文件操作已撤销"); await reload(); }
    catch (error) { onNotify(error instanceof Error ? error.message : "撤销失败"); }
    finally { setBusy(false); }
  }

  return (
    <main className="project-files-page">
      <section className="files-commandbar" aria-label="文件管理工具">
        <div className="files-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目中的文件" aria-label="搜索项目文件" />{query && <button onClick={() => setQuery("")} aria-label="清除搜索"><X size={15} /></button>}</div>
        <div className="files-command-actions">
          <button className="button secondary" onClick={() => { setNewItem("directory"); setNewName(""); }}><FolderPlus size={16} />新建文件夹</button>
          <button className="button secondary" onClick={() => { setNewItem("file"); setNewName(""); }}><FilePlus2 size={16} />新建文件</button>
          <button className="button primary" onClick={() => void importFiles()}><Import size={16} />导入文件</button>
        </div>
      </section>

      <section className="files-browser-shell">
        <div className="files-pathbar">
          <button disabled={!directory} onClick={() => { setDirectory(parentOf(directory)); setQuery(""); }} aria-label="返回上级"><ArrowLeft size={17} /></button>
          <nav aria-label="当前位置"><button onClick={() => { setDirectory(""); setQuery(""); }}>{project.name}</button>{breadcrumbs.map((part, index) => <span key={`${part}-${index}`}><ChevronRight size={14} /><button onClick={() => setDirectory(breadcrumbs.slice(0, index + 1).join("/"))}>{part}</button></span>)}</nav>
          <div className="files-view-controls"><select value={`${sort}-${direction}`} onChange={(event) => { const [nextSort, nextDirection] = event.target.value.split("-") as [typeof sort, typeof direction]; setSort(nextSort); setDirection(nextDirection); }} aria-label="文件排序"><option value="name-asc">名称 A–Z</option><option value="modified-desc">最近修改</option><option value="size-desc">大小</option><option value="type-asc">类型</option></select><button className={compact ? "active" : ""} onClick={() => setCompact((value) => !value)} aria-label="切换紧凑密度"><List size={17} /></button></div>
        </div>

        {selected && <div className="file-selection-actions" aria-label="所选文件操作"><strong title={selected.relativePath}>{selected.name}</strong><button onClick={() => beginOperation("rename")}><Pencil size={15} />重命名</button><button onClick={() => beginOperation("move")}><FolderOpen size={15} />移动</button><button onClick={() => beginOperation("copy")}><Copy size={15} />复制</button><button onClick={() => void api.files.reveal(project.id, selected.relativePath)}><ExternalLink size={15} />在文件夹中显示</button><button className="danger" onClick={() => beginOperation("trash")}><Trash2 size={15} />回收站</button></div>}

        <div className={`project-file-list ${compact ? "compact" : ""}`} role="grid" aria-busy={loading}>
          <div className="project-file-list-head" role="row"><span>名称</span><span>类型</span><span>大小</span><span>修改时间</span></div>
          {loading ? <div className="files-empty">正在读取文件…</div> : entries.length === 0 ? <div className="files-empty">{query ? "没有匹配的文件" : "此文件夹为空"}</div> : entries.map((entry) => (
            <button type="button" role="row" key={entry.relativePath} className={`project-file-row ${selectedPath === entry.relativePath ? "selected" : ""}`} onClick={() => setSelectedPath(entry.relativePath)} onDoubleClick={() => void openEntry(entry)}>
              <span className={`file-name-cell kind-${entry.kind}`}><FileGlyph entry={entry} /><span><strong>{entry.name}</strong>{query && <small>{parentOf(entry.relativePath) || "项目根目录"}</small>}</span></span>
              <span>{entry.isDirectory ? "文件夹" : (entry.extension?.toUpperCase() ?? "文件")}</span><span>{formatSize(entry.size, entry.isDirectory)}</span><span>{new Date(entry.modifiedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
            </button>
          ))}
        </div>
        <footer className="files-statusbar"><span>{entries.length} 个项目{query ? "（全项目搜索）" : ""}</span><span>单击选中，双击打开</span>{undoId && <button disabled={busy} onClick={() => void undo()}><RotateCcw size={14} />撤销上一次操作</button>}</footer>
      </section>

      {newItem && <div className="modal-backdrop"><form className="dialog-card file-dialog" onSubmit={(event) => { event.preventDefault(); void createItem(); }}><header><div><h2>{newItem === "directory" ? "新建文件夹" : "新建空文件"}</h2><p>将在“{directory || "项目根目录"}”中创建。</p></div><button type="button" onClick={() => setNewItem(null)} aria-label="关闭"><X size={18} /></button></header><label>名称<input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={newItem === "directory" ? "例如 chapters" : "例如 notes.tex"} /></label><footer><button type="button" className="button secondary" onClick={() => setNewItem(null)}>取消</button><button className="button primary" disabled={!newName.trim() || busy}>创建</button></footer></form></div>}

      {operation && selected && <div className="modal-backdrop"><section className="dialog-card file-dialog operation-preview"><header><div><h2>{operation === "trash" ? "移入回收站" : operation === "rename" ? "重命名" : operation === "move" ? "移动" : "复制"}</h2><p>{selected.relativePath}</p></div><button onClick={() => { setOperation(null); setPlan(null); }} aria-label="关闭"><X size={18} /></button></header>{operation !== "trash" && <label>目标相对路径<input value={destination} onChange={(event) => { setDestination(event.target.value.replace(/\\/g, "/")); setPlan(null); }} /></label>}{!plan ? <div className="operation-preview-placeholder"><p>下一步只生成预览，不会立即修改文件。</p><button className="button primary" disabled={busy || (operation !== "trash" && !destination.trim())} onClick={() => void previewOperation()}>查看影响</button></div> : <><div className="operation-plan-summary"><strong>即将执行</strong><span>{plan.sourcePath}{plan.destinationPath ? ` → ${plan.destinationPath}` : " → 系统回收站"}</span><span>{plan.isDirectory ? "文件夹" : formatSize(plan.sourceSize, false)}</span></div>{plan.referenceChanges.length > 0 && <div className="reference-diff"><strong>同步更新 LaTeX 字面量引用（{plan.referenceChanges.length} 个文件）</strong>{plan.referenceChanges.map((change) => <div key={change.filePath}><span>{change.filePath}</span><code>- {change.oldReference}</code><code>+ {change.newReference}</code></div>)}</div>}{plan.warnings.map((warning) => <p className="operation-warning" key={warning}>{warning}</p>)}<footer><button className="button secondary" onClick={() => setPlan(null)}>返回修改</button><button className={`button ${operation === "trash" ? "danger-button" : "primary"}`} disabled={busy} onClick={() => void applyOperation()}>确认执行</button></footer></>}</section></div>}
    </main>
  );
}
