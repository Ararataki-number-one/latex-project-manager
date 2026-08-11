import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronRight, Code2, GitFork, HardDrive, LoaderCircle, LogIn, ShieldCheck, X } from "lucide-react";

import type { WorkbenchApi } from "@/shared/ipc";
import type { DesktopEnvironmentStatus, GitHubAccountStatus, ToolchainInfo, VsCodeStatus } from "@/shared/types";

interface OnboardingWizardProps {
  api: WorkbenchApi;
  onComplete: (openImport: boolean) => void;
  onNotify: (message: string) => void;
}

export function OnboardingWizard({ api, onComplete, onNotify }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [environment, setEnvironment] = useState<DesktopEnvironmentStatus | null>(null);
  const [account, setAccount] = useState<GitHubAccountStatus | null>(null);
  const [editor, setEditor] = useState<VsCodeStatus | null>(null);
  const [toolchains, setToolchains] = useState<ToolchainInfo[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [nextEnvironment, nextAccount, nextEditor, nextToolchains] = await Promise.all([
        api.runtime.environmentStatus(),
        api.github.authStatus(),
        api.vscode.status(),
        api.toolchains.list()
      ]);
      setEnvironment(nextEnvironment);
      setAccount(nextAccount);
      setEditor(nextEditor);
      setToolchains(nextToolchains);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法检查本机工具");
    } finally {
      setBusy(false);
    }
  }, [api, onNotify]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function login() {
    setBusy(true);
    try {
      if (account?.cliAvailable === false) {
        await api.github.openCliDownload();
        onNotify("已打开 GitHub CLI 下载页；安装后返回并刷新检查");
      } else {
        const next = await api.github.beginLogin();
        setAccount(next);
        onNotify(next.message);
      }
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "无法启动 GitHub 登录");
    } finally {
      setBusy(false);
    }
  }

  const checks = [
    { name: "Git", detail: environment?.gitAvailable ? environment.gitVersion ?? "已安装" : "未检测到", ready: Boolean(environment?.gitAvailable), icon: GitFork },
    { name: "Git LFS", detail: environment?.gitLfsAvailable ? "已安装" : "大型 PDF 同步需要安装", ready: Boolean(environment?.gitLfsAvailable), icon: HardDrive },
    { name: "GitHub CLI", detail: environment?.githubCliAvailable ? environment.githubCliVersion ?? "已安装" : "未检测到", ready: Boolean(environment?.githubCliAvailable), icon: GitFork },
    { name: "VS Code", detail: editor?.available ? editor.executablePath ?? "已就绪" : "未检测到", ready: Boolean(editor?.available), icon: Code2 },
    { name: "LaTeX Workshop", detail: editor?.latexWorkshop.state === "installed" ? editor.latexWorkshop.version ?? "已安装" : "未检测到", ready: editor?.latexWorkshop.state === "installed", icon: Code2 },
    { name: "TeX 工具链", detail: toolchains[0] ? `${toolchains[0].name} ${toolchains[0].version ?? ""}` : "未检测到；管理功能仍可使用", ready: toolchains.length > 0, icon: HardDrive }
  ];
  const stepLabels = ["检查环境", "连接 GitHub", "导入项目"];

  return (
    <div className="modal-backdrop onboarding-backdrop" role="presentation" onKeyDown={(event) => { if (event.key === "Escape") onComplete(false); }}>
      <section className="modal onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <header className="onboarding-header">
          <div><p>欢迎使用</p><h2 id="onboarding-title">配置 LaTeX 项目管理器</h2></div>
          <button className="icon-button" aria-label="暂时关闭新手引导" onClick={() => onComplete(false)}><X size={18} /></button>
        </header>
        <ol className="onboarding-progress" aria-label={`新手引导第 ${step + 1} 步，共 3 步`}>
          {stepLabels.map((label, index) => <li key={label} className={index < step ? "completed" : index === step ? "current" : "pending"} aria-current={index === step ? "step" : undefined}><span>{index < step ? <CheckCircle2 size={14} /> : index + 1}</span><strong>{label}</strong></li>)}
        </ol>

        {step === 0 && <div className="onboarding-content">
          <div className="onboarding-copy"><h3>先检查本机工具</h3><p>管理器不会替代 VS Code；缺少 TeX 工具链也不影响项目整理和 GitHub 备份。</p></div>
          <div className="environment-grid">{checks.map((check) => { const Icon = check.icon; return <div key={check.name} className={check.ready ? "ready" : "missing"}><span><Icon size={18} /></span><div><strong>{check.name}</strong><small>{check.detail}</small></div>{check.ready ? <CheckCircle2 size={17} /> : <em>可稍后安装</em>}</div>; })}</div>
          <button className="button secondary" onClick={() => void refresh()} disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : null}重新检查</button>
        </div>}

        {step === 1 && <div className="onboarding-content onboarding-github-step">
          <span className="onboarding-hero-icon"><GitFork size={30} /></span>
          <div className="onboarding-copy"><h3>连接 GitHub</h3><p>登录后可在导入时自动创建私有或公开仓库。本软件不保存密码或访问令牌。</p></div>
          <div className={`onboarding-account ${account?.authenticated ? "ready" : "required"}`}><span>{account?.authenticated ? <CheckCircle2 size={22} /> : <LogIn size={22} />}</span><div><strong>{account?.authenticated ? `已登录 ${account.login}` : account?.message ?? "正在检查…"}</strong><small>{account?.authenticated ? "可以自动创建和同步仓库" : "也可以跳过，稍后在设置中登录"}</small></div>{!account?.authenticated && <button className="button primary" onClick={() => void login()} disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <LogIn size={16} />}{account?.cliAvailable === false ? "安装 GitHub CLI" : "登录"}</button>}</div>
          <div className="onboarding-security"><ShieldCheck size={18} /><div><strong>登录是可选的</strong><p>新仓库默认私有；高风险密钥会被安全扫描阻止上传。你也可以只管理本地项目。</p></div></div>
        </div>}

        {step === 2 && <div className="onboarding-content onboarding-finish-step">
          <span className="onboarding-hero-icon"><HardDrive size={30} /></span>
          <div className="onboarding-copy"><h3>导入第一个项目</h3><p>选择资料库目录后，客户端只登记项目路径，不复制或改写 LaTeX 源文件。导入窗口会询问是否同步；进入项目介绍后可指定 Android 首页显示的主 PDF。</p></div>
          <div className="onboarding-summary"><div><CheckCircle2 size={17} /><span><strong>本地项目统一索引</strong><small>打开项目时直接进入原文件夹</small></span></div><div><CheckCircle2 size={17} /><span><strong>GitHub 安全自动同步</strong><small>可选开启，冲突时不会强推</small></span></div><div><CheckCircle2 size={17} /><span><strong>Android 直达最新主 PDF</strong><small>在项目介绍中指定默认成品</small></span></div></div>
        </div>}

        <footer className="onboarding-actions">
          {step > 0 ? <button className="button ghost" onClick={() => setStep((value) => value - 1)}>上一步</button> : <span />}
          {step === 0 && <button className="button primary" onClick={() => setStep(1)}>继续连接 GitHub<ChevronRight size={16} /></button>}
          {step === 1 && <button className="button primary" onClick={() => setStep(2)}>{account?.authenticated ? "继续导入项目" : "暂不登录，继续"}<ChevronRight size={16} /></button>}
          {step === 2 && <button className="button primary" onClick={() => onComplete(true)}>完成并导入项目<ChevronRight size={16} /></button>}
        </footer>
      </section>
    </div>
  );
}
