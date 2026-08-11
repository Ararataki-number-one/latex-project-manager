import type { WorkbenchApi } from "@/shared/ipc";
import type {
  AppUpdateStatus,
  GitHubSyncStatus,
  MigrationPreview,
  ProjectManifest,
  ProjectSummary,
  ReferenceDocumentInfo,
  ScanCandidate,
  TemplateInfo
} from "@/shared/types";

export const DEMO_ROOT = "D:\\LaTeX资料库\\概率方法笔记";

export const demoProjects: ProjectSummary[] = [
  {
    id: "probability-method",
    name: "概率方法笔记",
    rootPath: DEMO_ROOT,
    targetCount: 2,
    classNames: ["elegantbook"],
    lastOpenedAt: "2026-07-22T09:36:00.000Z",
    lastBuildAt: "2026-07-22T09:42:00.000Z",
    lastBuildStatus: "success",
    favorite: true,
    archived: false,
    trashed: false,
    tags: ["组合数学", "讲义"],
    pathAvailable: true
  },
  {
    id: "ramsey",
    name: "Ramsey 数笔记",
    rootPath: "D:\\LaTeX资料库\\Ramsey数笔记",
    targetCount: 3,
    classNames: ["elegantbook", "article"],
    lastOpenedAt: "2026-07-21T14:20:00.000Z",
    lastBuildAt: "2026-07-21T14:28:00.000Z",
    lastBuildStatus: "warning",
    favorite: true,
    archived: false,
    trashed: false,
    tags: ["Ramsey", "研究"],
    pathAvailable: true
  },
  {
    id: "graph-theory",
    name: "Graph Theory 组合笔记",
    rootPath: "D:\\LaTeX资料库\\Graph Theory",
    targetCount: 1,
    classNames: ["elegantbook"],
    lastOpenedAt: "2026-07-19T11:04:00.000Z",
    lastBuildAt: "2026-07-19T11:10:00.000Z",
    lastBuildStatus: "success",
    favorite: false,
    archived: false,
    trashed: false,
    tags: ["图论", "讲义"],
    pathAvailable: true
  },
  {
    id: "analysis",
    name: "数学分析强化讲义",
    rootPath: "E:\\数学考研\\数学分析强化讲义",
    targetCount: 1,
    classNames: ["ctexbook"],
    lastOpenedAt: "2026-07-16T08:12:00.000Z",
    lastBuildStatus: "failed",
    favorite: false,
    archived: false,
    trashed: false,
    tags: ["数学分析", "考研"],
    pathAvailable: false
  },
  {
    id: "gaussian",
    name: "GAUSSIAN 论文",
    rootPath: "D:\\论文\\GAUSSIAN",
    targetCount: 2,
    classNames: ["amsart"],
    lastOpenedAt: "2026-07-11T16:45:00.000Z",
    lastBuildAt: "2026-07-11T16:51:00.000Z",
    lastBuildStatus: "success",
    favorite: false,
    archived: true,
    trashed: false,
    tags: ["论文"],
    pathAvailable: true
  }
];

const structure = [
  { id: "cover", kind: "cover" as const, title: "封面", phase: "frontmatter" as const, order: 0, managed: true },
  { id: "title", kind: "title" as const, title: "标题页 · \\maketitle", phase: "frontmatter" as const, order: 1, managed: true },
  { id: "toc", kind: "toc" as const, title: "总目录 · \\tableofcontents", phase: "frontmatter" as const, order: 2, managed: true },
  { id: "ch-probability", kind: "chapter" as const, title: "概率方法基础", path: "chapters/01-probability.tex", phase: "mainmatter" as const, order: 3, originalNumber: 1, titleSource: "file" as const, managed: true },
  { id: "ch-linearity", kind: "chapter" as const, title: "期望的线性性质", path: "chapters/02-linearity.tex", phase: "mainmatter" as const, order: 4, originalNumber: 2, titleSource: "file" as const, managed: true },
  { id: "ch-alteration", kind: "chapter" as const, title: "删改法", path: "chapters/03-alteration.tex", phase: "mainmatter" as const, order: 5, originalNumber: 3, titleSource: "file" as const, managed: true },
  { id: "ch-second-moment", kind: "chapter" as const, title: "二阶矩方法", path: "chapters/04-second-moment.tex", phase: "mainmatter" as const, order: 6, originalNumber: 4, titleSource: "file" as const, managed: true },
  { id: "ch-lll", kind: "chapter" as const, title: "Lovász 局部引理", path: "chapters/05-local-lemma.tex", phase: "mainmatter" as const, order: 7, originalNumber: 5, titleSource: "file" as const, managed: true },
  { id: "app-notation", kind: "appendix" as const, title: "符号约定", path: "appendices/notation.tex", phase: "appendix" as const, order: 8, titleSource: "file" as const, managed: true },
  { id: "bibliography", kind: "bibliography" as const, title: "参考文献 · bibliography", phase: "backmatter" as const, order: 9, managed: true },
  { id: "index", kind: "index" as const, title: "索引 · index", phase: "backmatter" as const, order: 10, managed: true }
];

export const demoManifest: ProjectManifest = {
  schemaVersion: 1,
  projectId: "probability-method",
  name: "概率方法笔记",
  createdAt: "2026-05-18T10:00:00.000Z",
  updatedAt: "2026-07-22T09:35:00.000Z",
  assets: [
    {
      id: "elegantbook-fork",
      kind: "class",
      path: "elegantbook.cls",
      hash: "01c64c1e479d8a21e8cf5b7b6cf907449caa5b5c8a6f8241c1812a77ab3a4b7f",
      source: "用户本地 fork · v4.6"
    }
  ],
  targets: [
    {
      id: "book-main",
      name: "讲义正文",
      entry: "main.tex",
      engine: "xelatex",
      texDistribution: "C:\\texlive\\2026\\bin\\windows",
      classConfig: {
        name: "elegantbook",
        source: "project",
        sourcePath: "elegantbook.cls",
        sourceHash: "01c64c1e479d8a21e8cf5b7b6cf907449caa5b5c8a6f8241c1812a77ab3a4b7f",
        options: {
          color: "blue",
          lang: "cn",
          result: "answer",
          mode: "fancy",
          device: "normal",
          math: "cm",
          marginpar: false,
          toc: "onecol",
          scheme: "chinese",
          chinesefont: "ctexfont",
          usesamecnt: false,
          citestyle: "numeric-comp",
          bibstyle: "numeric",
          thmcnt: "chapter",
          bibend: "biber",
          titlestyle: "hang"
        },
        rawOptions: ["openany"]
      },
      packages: [
        { id: "pkg-hyperref", name: "hyperref", options: [], enabled: true, order: 0, source: "class", diagnostic: "ok" },
        { id: "pkg-fontspec", name: "fontspec", options: [], enabled: true, order: 1, source: "class", diagnostic: "ok" },
        { id: "pkg-tcolorbox", name: "tcolorbox", options: [], enabled: true, order: 2, source: "class", diagnostic: "ok" },
        { id: "pkg-bm", name: "bm", options: [], enabled: true, order: 3, source: "class", diagnostic: "duplicate" },
        { id: "pkg-microtype", name: "microtype", options: ["protrusion=true"], enabled: true, order: 4, source: "managed", diagnostic: "ok" },
        { id: "pkg-cleveref", name: "cleveref", options: ["nameinlink"], enabled: true, order: 5, source: "managed", diagnostic: "ok" },
        { id: "pkg-mtpro2", name: "mtpro2", options: [], enabled: false, order: 6, source: "manual", diagnostic: "missing" }
      ],
      structure,
      profiles: [
        {
          id: "full-book",
          name: "完整讲义",
          numbering: "preserve",
          chapterState: Object.fromEntries(structure.map((node) => [node.id, "full"])),
          enabledBlocks: { cover: true, title: true, toc: true, bibliography: true, index: true },
          order: structure.map((node) => node.id),
          autoCompile: false
        },
        {
          id: "current-study",
          name: "当前学习",
          numbering: "preserve",
          chapterState: {
            "ch-probability": "full",
            "ch-linearity": "full",
            "ch-alteration": "titleOnly",
            "ch-second-moment": "hidden",
            "ch-lll": "hidden",
            "app-notation": "hidden"
          },
          enabledBlocks: { cover: false, title: true, toc: true, bibliography: false, index: false },
          order: structure.map((node) => node.id),
          autoCompile: true
        },
        {
          id: "print-handout",
          name: "课堂打印",
          numbering: "continuous",
          chapterState: {
            "ch-probability": "full",
            "ch-linearity": "titleOnly",
            "ch-alteration": "full",
            "ch-second-moment": "hidden",
            "ch-lll": "hidden",
            "app-notation": "full"
          },
          enabledBlocks: { cover: false, title: false, toc: true, bibliography: true, index: false },
          order: structure.map((node) => node.id),
          autoCompile: false
        }
      ]
    },
    {
      id: "exercise-sheet",
      name: "习题单",
      entry: "exercises.tex",
      engine: "xelatex",
      classConfig: { name: "article", source: "texlive", options: { a4paper: true }, rawOptions: ["11pt"] },
      packages: [
        { id: "pkg-amsmath", name: "amsmath", options: [], enabled: true, order: 0, source: "managed", diagnostic: "ok" },
        { id: "pkg-enumitem", name: "enumitem", options: [], enabled: true, order: 1, source: "managed", diagnostic: "ok" }
      ],
      structure: structure.slice(3, 7),
      profiles: [
        {
          id: "student",
          name: "学生版",
          numbering: "continuous",
          chapterState: Object.fromEntries(structure.slice(3, 7).map((node) => [node.id, "full"])),
          enabledBlocks: {},
          order: structure.slice(3, 7).map((node) => node.id)
        }
      ]
    }
  ]
};

export const demoMigration: MigrationPreview = {
  projectRoot: DEMO_ROOT,
  entryPath: "main.tex",
  sourceHash: "a8bb10ab28e5b792",
  manifest: demoManifest,
  warnings: [
    "检测到条件前导区 \\ifdraft，已保持原样，不纳入受管区块。",
    "elegantbook.cls 是项目内 fork，将按内容哈希固定，不会被 TeX Live 版本覆盖。"
  ],
  changes: [
    {
      id: "migration-class",
      section: "class",
      label: "接管文档类与选项",
      before: "\\documentclass[cn,blue,openany]{elegantbook}",
      after: "%% <latex-workbench:begin id=\"class\" version=\"1\">\n\\documentclass[cn,blue,openany]{elegantbook}\n%% <latex-workbench:end id=\"class\">",
      selected: true,
      confidence: "high"
    },
    {
      id: "migration-packages",
      section: "packages",
      label: "接管 2 个普通宏包",
      before: "\\usepackage[protrusion=true]{microtype}\n\\usepackage[nameinlink]{cleveref}",
      after: "%% <latex-workbench:begin id=\"packages\" version=\"1\">\n\\usepackage[protrusion=true]{microtype}\n\\usepackage[nameinlink]{cleveref}\n%% <latex-workbench:end id=\"packages\">",
      selected: true,
      confidence: "high"
    },
    {
      id: "migration-structure",
      section: "structure",
      label: "识别 6 个章节与 3 个后置块",
      before: "\\input{chapters/01-probability}\n% \\input{chapters/02-linearity}\n\\printbibliography",
        after: "%% 结构由 LaTeX 项目管理器 runtime 按方案生成\n\\input{.latex-workbench/runtime/book-main/full-book.tex}",
      selected: true,
      confidence: "medium"
    }
  ]
};

export const demoFiles: Record<string, string> = {
  "main.tex": `\\documentclass[cn,blue,openany]{elegantbook}
\\title{概率方法笔记}
\\author{ZQY}
\\usepackage[protrusion=true]{microtype}
\\usepackage[nameinlink]{cleveref}

\\begin{document}
\\maketitle
\\tableofcontents

\\input{chapters/01-probability}
\\input{chapters/02-linearity}
\\input{chapters/03-alteration}
\\input{chapters/04-second-moment}
\\input{chapters/05-local-lemma}

\\appendix
\\input{appendices/notation}
\\printbibliography
\\printindex
\\end{document}
`,
  "chapters/01-probability.tex": `\\chapter{概率方法基础}
\\label{chap:probability}

概率方法的基本思想是：在一个适当的概率空间中，证明某类对象以正概率存在。

\\begin{theorem}[第一矩方法]
若非负随机变量 $X$ 满足 $\\mathbb E X < 1$，则 $\\Pr(X=0)>0$。
\\end{theorem}

\\begin{proof}
由 Markov 不等式，$\\Pr(X\\ge 1)\\le \\mathbb E X<1$。
\\end{proof}
`,
  "chapters/02-linearity.tex": `\\chapter{期望的线性性质}
\\label{chap:linearity}

即使随机变量并不独立，期望仍然满足线性性质。
`,
  "chapters/03-alteration.tex": `\\chapter{删改法}
先随机选取一个结构，再删除造成冲突的局部对象。
`,
  "chapters/04-second-moment.tex": "\\chapter{二阶矩方法}\n本章讨论方差与集中性。\n",
  "chapters/05-local-lemma.tex": "\\chapter{Lovász 局部引理}\n本章讨论局部依赖事件。\n",
  "appendices/notation.tex": "\\chapter{符号约定}\n记 $[n]=\\{1,2,\\dots,n\\}$。\n"
};

const candidates: ScanCandidate[] = [
  {
    rootPath: "D:\\LaTeX资料库\\概率方法笔记",
    name: "概率方法笔记",
    entries: [
      { path: `${DEMO_ROOT}\\main.tex`, relativePath: "main.tex", engine: "xelatex", className: "elegantbook", classOptions: ["cn", "blue", "openany"] },
      { path: `${DEMO_ROOT}\\exercises.tex`, relativePath: "exercises.tex", engine: "xelatex", className: "article", classOptions: ["a4paper", "11pt"] }
    ]
  },
  {
    rootPath: "D:\\LaTeX资料库\\Ramsey数笔记",
    name: "Ramsey 数笔记",
    entries: [
      { path: "D:\\LaTeX资料库\\Ramsey数笔记\\book.tex", relativePath: "book.tex", engine: "xelatex", className: "elegantbook", classOptions: ["cn"] },
      { path: "D:\\LaTeX资料库\\Ramsey数笔记\\notes.tex", relativePath: "notes.tex", engine: "pdflatex", className: "article", classOptions: [] }
    ]
  }
];

const templates: TemplateInfo[] = [
  { id: "elegant-book", name: "ElegantBook 讲义", description: "含章节目录、参考文献与索引的中文书稿", rootPath: "templates/elegant-book", className: "elegantbook", assetPins: demoManifest.assets },
  { id: "article", name: "简洁论文", description: "适合单文件或小型多文件论文", rootPath: "templates/article", className: "article", assetPins: [] }
];

export interface DemoWorkbench {
  api: WorkbenchApi;
  isDemo: boolean;
}

function joinDemoPath(root: string, path: string) {
  if (/^[A-Za-z]:[\\/]/.test(path)) return path;
  return `${root.replace(/[\\/]$/, "")}\\${path.replaceAll("/", "\\")}`;
}

export function createWorkbench(): DemoWorkbench {
  if (window.workbench) return { api: window.workbench, isDemo: false };

  let projects = structuredClone(demoProjects);
  const readonlyError = () => Promise.reject(new Error("浏览器演示模式不会写入本地文件"));
  let githubStatus: GitHubSyncStatus = {
    available: true,
    gitVersion: "2.51.0.windows.1",
    configured: true,
    repository: true,
    lfsAvailable: true,
    remoteUrl: "https://github.com/zqy/probability-notes.git",
    autoSync: true,
    useLfsForDocuments: true,
    branch: "main",
    state: "changes",
    changedFiles: [
      { path: "chapters/03-alteration.tex", status: " M" },
      { path: "references/Alon-Spencer-The-Probabilistic-Method.pdf", status: "??" }
    ],
    largeFiles: [],
    ahead: 0,
    behind: 0,
    lastSyncAt: "2026-08-03T12:36:00.000Z",
    identity: { name: "Ararataki-number-one", email: "Ararataki-number-one@users.noreply.github.com", configured: true, source: "local" },
    lastCommit: { hash: "4ec2f9a", message: "自动同步：2026/8/3 20:36:00", committedAt: "2026-08-03T12:36:00.000Z" },
    message: "2 个文件等待自动同步。"
  };
  let referenceDocuments: ReferenceDocumentInfo[] = [
    { name: "Alon-Spencer-The-Probabilistic-Method.pdf", relativePath: "references/Alon-Spencer-The-Probabilistic-Method.pdf", size: 18_724_811, modifiedAt: "2026-08-02T08:20:00.000Z", kind: "pdf", lfsRecommended: false },
    { name: "随机图中文讲义.pdf", relativePath: "references/随机图中文讲义.pdf", size: 62_104_322, modifiedAt: "2026-07-28T13:15:00.000Z", kind: "pdf", lfsRecommended: true }
  ];
  let updateStatus: AppUpdateStatus = {
    currentVersion: "0.3.5",
    latestVersion: "0.3.5",
    autoCheck: true,
    autoDownload: true,
    state: "upToDate",
    githubCliAvailable: true,
    releaseUrl: "https://github.com/Ararataki-number-one/latex-project-manager/releases",
    checkedAt: new Date().toISOString(),
    message: "当前已是最新版本 0.3.5。"
  };

  const api: WorkbenchApi = {
    library: {
      list: async () => structuredClone(projects),
      scan: async () => structuredClone(candidates),
      import: async (candidate) => {
        const imported: ProjectSummary = {
          ...structuredClone(demoProjects[0]),
          id: `demo-import-${Date.now()}`,
          name: candidate.name,
          rootPath: candidate.rootPath,
          targetCount: candidate.entries.length,
          classNames: Array.from(new Set(candidate.entries.map((entry) => entry.className))),
          favorite: false,
          archived: false,
          trashed: false,
          tags: []
        };
        projects = [...projects, imported];
        return structuredClone(imported);
      },
      relink: async (projectId, rootPath) => {
        const current = projects.find((item) => item.id === projectId);
        if (!current) throw new Error("演示项目不存在");
        const relinked = { ...current, rootPath, pathAvailable: true };
        projects = projects.map((item) => item.id === projectId ? relinked : item);
        return structuredClone(relinked);
      },
      update: async (projectId, patch) => {
        const current = projects.find((item) => item.id === projectId);
        if (!current) throw new Error("演示项目不存在");
        const updated: ProjectSummary = {
          ...current,
          ...patch,
          ...(patch.trashed === true ? { trashedAt: new Date().toISOString() } : {}),
          ...(patch.trashed === false ? { trashedAt: undefined } : {})
        };
        projects = projects.map((item) => item.id === projectId ? updated : item);
        return structuredClone(updated);
      },
      openFolder: async (projectId) => {
        if (!projects.some((item) => item.id === projectId)) throw new Error("演示项目不存在");
      },
      openInVsCode: async (projectId) => {
        if (!projects.some((item) => item.id === projectId)) throw new Error("演示项目不存在");
      },
      copy: async (projectId, destinationParent, name) => {
        const source = projects.find((item) => item.id === projectId);
        if (!source) throw new Error("演示项目不存在");
        const normalizedName = name.trim();
        if (!normalizedName) throw new Error("请输入副本名称");
        const rootPath = joinDemoPath(destinationParent, normalizedName);
        if (projects.some((item) => item.rootPath.toLocaleLowerCase() === rootPath.toLocaleLowerCase())) {
          throw new Error("目标位置已存在同名项目");
        }
        const copy: ProjectSummary = {
          ...structuredClone(source),
          id: `demo-copy-${Date.now()}`,
          name: normalizedName,
          rootPath,
          lastOpenedAt: undefined,
          favorite: false,
          archived: false,
          trashed: false,
          trashedAt: undefined,
          pathAvailable: true
        };
        projects = [...projects, copy];
        return structuredClone(copy);
      },
      exportZip: async (projectId) => {
        const project = projects.find((item) => item.id === projectId);
        if (!project) throw new Error("演示项目不存在");
        return { canceled: false, path: `D:\\LaTeX导出\\${project.name}.zip` };
      },
      lastSuccessfulPdf: async (projectId) => {
        const project = projects.find((item) => item.id === projectId);
        if (!project) throw new Error("演示项目不存在");
        if (!project.lastBuildAt || !["success", "warning"].includes(project.lastBuildStatus ?? "")) return null;
        return {
          path: joinDemoPath(project.rootPath, `${project.name}.pdf`),
          size: 2_487_296,
          modifiedAt: project.lastBuildAt,
          targetId: "book-main",
          profileId: "full-book"
        };
      },
      openLastSuccessfulPdf: async (projectId) => {
        const project = projects.find((item) => item.id === projectId);
        if (!project?.lastBuildAt || !["success", "warning"].includes(project.lastBuildStatus ?? "")) {
          throw new Error("没有可用的成功 PDF");
        }
      },
      exportLastSuccessfulPdf: async (projectId) => {
        const project = projects.find((item) => item.id === projectId);
        if (!project?.lastBuildAt || !["success", "warning"].includes(project.lastBuildStatus ?? "")) {
          throw new Error("没有可用的成功 PDF");
        }
        return { canceled: false, path: `D:\\LaTeX导出\\${project.name}.pdf` };
      },
      previewTemporaryCleanup: async () => ({
        planId: "demo-cleanup-plan",
        fileCount: 18,
        directoryCount: 3,
        totalBytes: 3_482_624,
        samplePaths: ["main.aux", "main.log", "main.synctex.gz", ".latex-workbench/build/book/full/main.fls"],
        categories: [
          { name: "LaTeX 辅助文件", count: 14 },
          { name: "工作台构建缓存", count: 4 }
        ],
        expiresAt: new Date(Date.now() + 300_000).toISOString()
      }),
      applyTemporaryCleanup: async (_projectId, planId) => {
        if (planId !== "demo-cleanup-plan") throw new Error("清理预览已过期");
        return { fileCount: 18, directoryCount: 3, freedBytes: 3_482_624 };
      },
      storageInfo: async (projectId) => {
        const project = projects.find((item) => item.id === projectId);
        if (!project) throw new Error("演示项目不存在");
        const index = Math.max(0, projects.findIndex((item) => item.id === projectId));
        return { totalBytes: (index + 1) * 18_742_930, fileCount: 42 + index * 17, measuredAt: new Date().toISOString() };
      }
    },
    github: {
      status: async () => structuredClone(githubStatus),
      configure: async (_projectId, settings) => {
        githubStatus = { ...githubStatus, ...settings, configured: true, repository: true, state: "ready", message: "演示模式：已模拟连接 GitHub 仓库。" };
        return structuredClone(githubStatus);
      },
      syncNow: async () => {
        githubStatus = { ...githubStatus, state: "synced", changedFiles: [], ahead: 0, behind: 0, lastSyncAt: new Date().toISOString(), message: "演示模式：已模拟同步。" };
        return structuredClone(githubStatus);
      },
      setAutoSync: async (_projectId, enabled) => {
        githubStatus = { ...githubStatus, autoSync: enabled, state: "ready", message: enabled ? "演示模式：已开启自动同步。" : "演示模式：已暂停自动同步。" };
        return structuredClone(githubStatus);
      },
      setIdentity: async (_projectId, identity) => {
        githubStatus = { ...githubStatus, identity: { ...identity, configured: true, source: "local" }, state: "changes", message: "演示模式：已保存提交身份。" };
        return structuredClone(githubStatus);
      }
    },
    updates: {
      status: async () => structuredClone(updateStatus),
      setSettings: async (settings) => {
        updateStatus = { ...updateStatus, ...settings };
        return structuredClone(updateStatus);
      },
      check: async () => {
        updateStatus = { ...updateStatus, state: "upToDate", checkedAt: new Date().toISOString(), message: `当前已是最新版本 ${updateStatus.currentVersion}。` };
        return structuredClone(updateStatus);
      },
      download: async () => {
        updateStatus = { ...updateStatus, state: "downloaded", downloadedPath: "D:\\Downloads\\LaTeX-Project-Manager-Setup.exe", message: "演示模式：更新已下载。" };
        return structuredClone(updateStatus);
      },
      install: async () => undefined,
      openRelease: async () => undefined
    },
    references: {
      list: async () => structuredClone(referenceDocuments),
      import: async () => {
        if (!referenceDocuments.some((item) => item.name === "新增英文文稿.pdf")) {
          referenceDocuments = [...referenceDocuments, { name: "新增英文文稿.pdf", relativePath: "references/新增英文文稿.pdf", size: 4_102_144, modifiedAt: new Date().toISOString(), kind: "pdf", lfsRecommended: false }];
        }
        return structuredClone(referenceDocuments);
      },
      open: async () => undefined,
      openFolder: async () => undefined,
      remove: async (_projectId, relativePath) => {
        referenceDocuments = referenceDocuments.filter((item) => item.relativePath !== relativePath);
        return structuredClone(referenceDocuments);
      }
    },
    manifest: {
      read: async () => structuredClone(demoManifest),
      write: async () => readonlyError()
    },
    migration: {
      preview: async () => structuredClone(demoMigration)
    },
    files: {
      rename: async () => readonlyError(),
      move: async () => readonlyError(),
      trash: async () => readonlyError(),
      delete: async () => readonlyError()
    },
    templates: {
      list: async () => structuredClone(templates),
      create: async () => readonlyError(),
      instantiate: async () => readonlyError()
    },
    toolchains: {
      list: async () => [{ name: "texlive", version: "2026", binPath: "C:\\texlive\\2026\\bin\\windows", latexmk: "latexmk.exe", xelatex: "xelatex.exe", lualatex: "lualatex.exe", pdflatex: "pdflatex.exe", biber: "biber.exe", bibtex: "bibtex.exe", synctex: "synctex.exe", kpsewhich: "kpsewhich.exe" }]
    },
    vscode: {
      status: async () => ({
        available: true,
        editor: "code",
        executablePath: "C:\\Program Files\\Microsoft VS Code\\Code.exe",
        source: "common",
        latexWorkshop: { state: "installed", version: "10.10.0" }
      }),
      openProject: async () => undefined,
      openFile: async () => undefined,
      openProfile: async (_projectRoot, targetId, profileId) => `.latex-workbench/build/${targetId}/${profileId}/latex-workbench-wrapper.tex`
    },
    dialogs: {
      openDirectory: async () => "D:\\LaTeX资料库",
      openFile: async () => null
    },
    editor: {
      openExternal: async () => undefined
    }
  };

  return { api, isDemo: true };
}
