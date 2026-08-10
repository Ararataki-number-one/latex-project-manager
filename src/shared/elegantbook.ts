export interface ElegantOptionDefinition {
  key: string;
  label: string;
  kind: "select" | "toggle" | "text";
  defaultValue: string | boolean;
  values?: string[];
  warning?: string;
}

export const ELEGANTBOOK_OPTIONS: ElegantOptionDefinition[] = [
  { key: "color", label: "主题色", kind: "select", defaultValue: "blue", values: ["blue", "green", "cyan", "gray", "black"] },
  { key: "lang", label: "语言", kind: "select", defaultValue: "en", values: ["cn", "en", "it", "fr", "nl", "hu", "de", "es", "mn", "pt", "jp"] },
  { key: "result", label: "答案与证明", kind: "select", defaultValue: "answer", values: ["answer", "noanswer"], warning: "noanswer 同时隐藏 solution、proof 和 inline。" },
  { key: "mode", label: "定理样式", kind: "select", defaultValue: "fancy", values: ["fancy", "simple"], warning: "两种模式的定理参数语法不同，切换前应回归编译。" },
  { key: "device", label: "页面设备", kind: "select", defaultValue: "normal", values: ["normal", "pad"] },
  { key: "math", label: "数学字体", kind: "select", defaultValue: "cm", values: ["cm", "newtx", "mtpro2"], warning: "mtpro2 通常需要单独安装。" },
  { key: "marginpar", label: "边注", kind: "toggle", defaultValue: false },
  { key: "toc", label: "目录栏数", kind: "select", defaultValue: "onecol", values: ["onecol", "twocol"] },
  { key: "scheme", label: "中文章号", kind: "select", defaultValue: "", values: ["", "chinese"] },
  { key: "chinesefont", label: "中文字体方案", kind: "select", defaultValue: "ctexfont", values: ["ctexfont", "founder", "nofont"] },
  { key: "usesamecnt", label: "共用定理计数器", kind: "toggle", defaultValue: false },
  { key: "citestyle", label: "引用样式", kind: "text", defaultValue: "numeric-comp" },
  { key: "bibstyle", label: "文献样式", kind: "text", defaultValue: "numeric" },
  { key: "thmcnt", label: "定理计数层级", kind: "select", defaultValue: "chapter", values: ["chapter", "section"] },
  { key: "bibend", label: "文献后端", kind: "select", defaultValue: "biber", values: ["biber", "bibtex"] },
  { key: "titlestyle", label: "章标题样式", kind: "select", defaultValue: "hang", values: ["hang", "display"] }
];

export const ELEGANTBOOK_CLASS_PACKAGES = [
  "hyperref",
  "geometry",
  "fontspec",
  "ctex",
  "xcolor",
  "amsmath",
  "amsfonts",
  "amssymb",
  "graphicx",
  "booktabs",
  "tcolorbox",
  "titlesec",
  "tocloft",
  "biblatex",
  "bm",
  "enumitem",
  "fancyhdr"
];
