import { useMemo, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  FolderInput,
  FolderKanban,
  LoaderCircle,
  ShieldCheck,
  X
} from "lucide-react";

import type { WorkbenchApi } from "@/shared/ipc";
import type { ProjectSummary, ScanCandidate } from "@/shared/types";

export interface OnboardingResult {
  imported: ProjectSummary[];
  dismissed?: boolean;
}

interface OnboardingWizardProps {
  api: WorkbenchApi;
  projects: ProjectSummary[];
  onComplete: (result: OnboardingResult) => void;
  onNotify: (message: string) => void;
}

export function OnboardingWizard({ api, projects, onComplete, onNotify }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [candidates, setCandidates] = useState<ScanCandidate[]>([]);
  const [selectedRoots, setSelectedRoots] = useState<string[]>([]);
  const [imported, setImported] = useState<ProjectSummary[]>([]);
  const [busy, setBusy] = useState<"scan" | "import" | null>(null);

  const existingRoots = useMemo(
    () => new Set(projects.map((project) => project.rootPath.toLocaleLowerCase())),
    [projects]
  );
  const importable = useMemo(
    () => candidates.filter((candidate) => !existingRoots.has(candidate.rootPath.toLocaleLowerCase())),
    [candidates, existingRoots]
  );

  function dismiss() {
    if (busy) return;
    onComplete({ imported, dismissed: true });
  }

  async function chooseDirectory() {
    const root = await api.dialogs.openDirectory();
    if (!root) return;
    setBusy("scan");
    try {
      const next = await api.library.scan(root, { maxDepth: 3 });
      setCandidates(next);
      const known = new Set(projects.map((project) => project.rootPath.toLocaleLowerCase()));
      setSelectedRoots(next.filter((candidate) => !known.has(candidate.rootPath.toLocaleLowerCase())).map((candidate) => candidate.rootPath));
      setStep(1);
      if (!next.length) onNotify("所选目录中没有识别到包含 LaTeX 主文件的项目");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法扫描所选目录");
    } finally {
      setBusy(null);
    }
  }

  function toggleCandidate(rootPath: string, checked: boolean) {
    setSelectedRoots((current) => checked
      ? [...current.filter((item) => item !== rootPath), rootPath]
      : current.filter((item) => item !== rootPath));
  }

  async function importSelected() {
    const selected = importable.filter((candidate) => selectedRoots.includes(candidate.rootPath));
    if (!selected.length) return;
    setBusy("import");
    try {
      const next = await api.library.importMany(selected);
      setImported(next);
      setStep(2);
      onNotify(`已将 ${next.length} 个项目加入本机项目库`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "项目导入失败");
    } finally {
      setBusy(null);
    }
  }

  const stepLabels = ["了解本地管理", "选择项目", "开始使用"];

  return (
    <div className="modal-backdrop onboarding-backdrop desktop-v1-onboarding-backdrop" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") dismiss(); }}>
      <section className="modal onboarding-modal desktop-v1-onboarding" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <header className="onboarding-header">
          <div><p>欢迎使用</p><h2 id="onboarding-title">把 LaTeX 项目集中到一处</h2></div>
          <button className="icon-button" aria-label="暂时关闭新手引导" disabled={busy !== null} onClick={dismiss}><X size={18} /></button>
        </header>
        <ol className="onboarding-progress" aria-label={`新手引导第 ${step + 1} 步，共 3 步`}>
          {stepLabels.map((label, index) => <li key={label} className={index < step ? "completed" : index === step ? "current" : "pending"} aria-current={index === step ? "step" : undefined}><span>{index < step ? <CheckCircle2 size={14} /> : index + 1}</span><strong>{label}</strong></li>)}
        </ol>

        {step === 0 && <div className="onboarding-content desktop-v1-onboarding-intro">
          <span className="onboarding-hero-icon"><FolderKanban size={31} /></span>
          <div className="onboarding-copy"><h3>先整理项目，再决定是否同步</h3><p>项目管理器只登记原文件夹的位置，不复制、不接管，也不会改写你的 LaTeX 源文件。写作仍在 VS Code 或你熟悉的工具中完成。</p></div>
          <div className="desktop-v1-onboarding-promises">
            <div><CheckCircle2 size={18} /><span><strong>立即获得项目库</strong><small>搜索、收藏、整理并快速打开文件夹</small></span></div>
            <div><CheckCircle2 size={18} /><span><strong>安全管理文件和资料</strong><small>危险操作先预览，原始文稿与项目建立关系</small></span></div>
            <div><ShieldCheck size={18} /><span><strong>保护设置完全可选</strong><small>GitHub 与本地快照可在导入后再配置</small></span></div>
          </div>
          <p className="desktop-v1-onboarding-note">不需要账号、Git 或 TeX 工具链也可以先完成导入。</p>
        </div>}

        {step === 1 && <div className="onboarding-content desktop-v1-onboarding-projects">
          <div className="onboarding-copy"><h3>选择要加入项目库的项目</h3><p>扫描过程只读。一个目录里有多个项目时可以一次导入。</p></div>
          <div className="desktop-v1-scan-summary">
            <span><strong>{candidates.length}</strong> 个已识别</span>
            <span><strong>{selectedRoots.length}</strong> 个已选择</span>
            <button className="button secondary" disabled={busy !== null} onClick={() => void chooseDirectory()}><FolderInput size={16} />重新选择目录</button>
          </div>
          <div className="desktop-v1-onboarding-candidates" role="list" aria-label="扫描到的 LaTeX 项目">
            {!candidates.length && <div className="desktop-v1-onboarding-empty"><FolderKanban size={24} /><strong>没有识别到项目</strong><span>请选择包含 `\\documentclass` 主文件的目录，或返回后从项目库导入。</span></div>}
            {candidates.map((candidate) => {
              const duplicate = existingRoots.has(candidate.rootPath.toLocaleLowerCase());
              const selected = selectedRoots.includes(candidate.rootPath);
              return <label key={candidate.rootPath} className={`desktop-v1-onboarding-candidate ${selected ? "selected" : ""} ${duplicate ? "duplicate" : ""}`}>
                <input type="checkbox" checked={selected} disabled={duplicate || busy !== null} onChange={(event) => toggleCandidate(candidate.rootPath, event.target.checked)} aria-label={`选择项目 ${candidate.name}`} />
                <span className="desktop-v1-candidate-check" aria-hidden="true">{selected ? <Check size={14} /> : null}</span>
                <FolderKanban size={19} />
                <span><strong>{candidate.name}</strong><small title={candidate.rootPath}>{candidate.rootPath}</small><em>{candidate.entries.length} 个主文件{duplicate ? " · 已在项目库" : ""}</em></span>
              </label>;
            })}
          </div>
        </div>}

        {step === 2 && <div className="onboarding-content onboarding-finish-step desktop-v1-onboarding-finish">
          <span className="onboarding-hero-icon success"><CheckCircle2 size={31} /></span>
          <div className="onboarding-copy"><h3>项目库已经准备好</h3><p>{imported.length ? `已加入 ${imported.length} 个项目。` : "可以稍后从项目库导入项目。"}接下来可以直接打开文件夹或 VS Code；需要备份时，再进入项目的“保护”页面。</p></div>
          <div className="onboarding-summary"><div><CheckCircle2 size={17} /><span><strong>源文件保持原位</strong><small>管理器只保存本机索引</small></span></div><div><CheckCircle2 size={17} /><span><strong>外部编辑优先</strong><small>双击项目打开文件夹，或使用 VS Code 按钮</small></span></div><div><ShieldCheck size={17} /><span><strong>保护状态清晰可见</strong><small>GitHub 与本地快照稍后按项目开启</small></span></div></div>
        </div>}

        <footer className="onboarding-actions">
          {step === 1 ? <button className="button ghost" disabled={busy !== null} onClick={() => setStep(0)}>上一步</button> : <span />}
          {step === 0 && <button className="button primary" disabled={busy !== null} onClick={() => void chooseDirectory()}>{busy === "scan" ? <LoaderCircle size={16} className="spin" /> : <FolderInput size={16} />}选择项目目录<ChevronRight size={16} /></button>}
          {step === 1 && <button className="button primary" disabled={!selectedRoots.length || busy !== null} onClick={() => void importSelected()}>{busy === "import" ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}导入 {selectedRoots.length} 个项目<ChevronRight size={16} /></button>}
          {step === 2 && <button className="button primary" onClick={() => onComplete({ imported })}>进入项目库<ChevronRight size={16} /></button>}
        </footer>
      </section>
    </div>
  );
}
