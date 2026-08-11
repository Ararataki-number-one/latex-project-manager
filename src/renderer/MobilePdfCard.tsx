import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, FileText, LoaderCircle, RefreshCw, Smartphone } from "lucide-react";

import type { WorkbenchApi } from "@/shared/ipc";
import type { MobilePdfCandidate, MobileProjectIndex, ProjectManifest, ProjectSummary } from "@/shared/types";

interface MobilePdfCardProps {
  api: WorkbenchApi;
  project: ProjectSummary;
  manifest: ProjectManifest;
  isDemo: boolean;
  onNotify: (message: string) => void;
}

interface TargetDraft {
  pdfPath: string;
  profileId: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function MobilePdfCard({ api, project, manifest, isDemo, onNotify }: MobilePdfCardProps) {
  const [index, setIndex] = useState<MobileProjectIndex | null>(null);
  const [candidates, setCandidates] = useState<MobilePdfCandidate[]>([]);
  const [drafts, setDrafts] = useState<Record<string, TargetDraft>>({});
  const [defaultTargetId, setDefaultTargetId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const configuredTargets = useMemo(
    () => manifest.targets.filter((target) => Boolean(drafts[target.id]?.pdfPath)),
    [drafts, manifest.targets]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextIndex, nextCandidates] = await Promise.all([
        api.mobileIndex.read(project.id),
        api.mobileIndex.candidates(project.id)
      ]);
      const nextDrafts: Record<string, TargetDraft> = {};
      for (const target of manifest.targets) {
        const saved = nextIndex?.outputs.find((output) => output.targetId === target.id);
        const suggestions = nextCandidates.filter((candidate) => candidate.suggestedTargetIds.includes(target.id));
        const suggested = suggestions.length === 1 ? suggestions[0].relativePath : "";
        nextDrafts[target.id] = {
          pdfPath: saved?.pdfPath ?? suggested,
          profileId: saved?.profileId ?? target.profiles[0]?.id ?? ""
        };
      }
      setIndex(nextIndex);
      setCandidates(nextCandidates);
      setDrafts(nextDrafts);
      const savedDefault = nextIndex?.outputs.find((output) => output.id === nextIndex.defaultOutputId)?.targetId;
      setDefaultTargetId(savedDefault ?? manifest.targets.find((target) => nextDrafts[target.id]?.pdfPath)?.id ?? "");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法读取移动端主 PDF 设置");
    } finally {
      setLoading(false);
    }
  }, [api, manifest.targets, onNotify, project.id]);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    const outputs = manifest.targets.flatMap((target) => {
      const draft = drafts[target.id];
      if (!draft?.pdfPath) return [];
      return [{
        id: `mobile-${target.id}`,
        name: target.name,
        targetId: target.id,
        entry: target.entry,
        profileId: draft.profileId || undefined,
        pdfPath: draft.pdfPath
      }];
    });
    if (!outputs.length || !defaultTargetId) {
      onNotify("请至少为一个文档目标选择主 PDF，并设置项目默认成品");
      return;
    }
    const defaultOutput = outputs.find((output) => output.targetId === defaultTargetId);
    if (!defaultOutput) {
      onNotify("项目默认成品必须来自已配置的文档目标");
      return;
    }
    setSaving(true);
    try {
      const written = await api.mobileIndex.write(project.id, {
        schemaVersion: 1,
        projectId: manifest.projectId,
        name: project.name,
        updatedAt: new Date().toISOString(),
        defaultOutputId: defaultOutput.id,
        outputs
      });
      setIndex(written);
      onNotify(isDemo ? "演示模式：已模拟保存移动端主 PDF" : "移动端主 PDF 已保存，并已加入 GitHub 同步队列");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法保存移动端主 PDF");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="intro-card mobile-pdf-card">
      <header className="mobile-pdf-heading">
        <div><span className="intro-card-icon"><Smartphone size={19} /></span><div><h3>移动端主 PDF</h3><p>Android 首页会直接显示项目默认成品，并在打开前检查 GitHub 最新版本。</p></div></div>
        <button className="button ghost" onClick={() => void load()} disabled={loading || saving}><RefreshCw size={15} className={loading ? "spin" : ""} />重新扫描</button>
      </header>
      {loading ? <div className="resource-loading"><LoaderCircle size={18} className="spin" />正在扫描项目 PDF…</div> : candidates.length === 0 ? (
        <div className="mobile-pdf-empty"><FileText size={22} /><div><strong>项目中尚未找到可同步的 PDF</strong><p>请先在 VS Code 中生成 PDF；references 和临时构建目录不会被当作主成品。</p></div></div>
      ) : (
        <>
          <div className="mobile-output-list">
            {manifest.targets.map((target) => {
              const draft = drafts[target.id] ?? { pdfPath: "", profileId: target.profiles[0]?.id ?? "" };
              return <div className="mobile-output-row" key={target.id}>
                <div><strong>{target.name}</strong><code>{target.entry}</code></div>
                <label><span>成品 PDF</span><select value={draft.pdfPath} onChange={(event) => setDrafts((current) => ({ ...current, [target.id]: { ...draft, pdfPath: event.target.value } }))}><option value="">不发布到手机</option>{candidates.map((candidate) => <option key={candidate.relativePath} value={candidate.relativePath}>{candidate.relativePath} · {formatBytes(candidate.size)}</option>)}</select></label>
                <label><span>对应方案</span><select value={draft.profileId} disabled={!draft.pdfPath} onChange={(event) => setDrafts((current) => ({ ...current, [target.id]: { ...draft, profileId: event.target.value } }))}>{target.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
              </div>;
            })}
          </div>
          <div className="mobile-pdf-footer">
            <label><span>项目默认成品</span><select value={defaultTargetId} onChange={(event) => setDefaultTargetId(event.target.value)}><option value="">请选择</option>{configuredTargets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label>
            <div className="mobile-index-state">{index ? <><Check size={15} />已发布移动索引 · {new Date(index.updatedAt).toLocaleString("zh-CN")}</> : <>首次保存后会创建 .latex-project.json</>}</div>
            <button className="button primary" onClick={() => void save()} disabled={saving || !configuredTargets.length}>{saving ? <LoaderCircle size={16} className="spin" /> : <Smartphone size={16} />}保存移动端设置</button>
          </div>
        </>
      )}
    </section>
  );
}

