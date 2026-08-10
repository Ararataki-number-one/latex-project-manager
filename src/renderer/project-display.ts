import type { AssetPin, ClassConfig, DocumentTarget, FileReadResult, PackageSpec } from "../shared/types";

export interface ClassPresentation {
  isElegantBook: boolean;
  eyebrow: string;
  title: string;
  source: string;
  badge: string;
}

export interface PackageNotice {
  id: string;
  severity: "warning" | "error";
  title: string;
  detail: string;
}

export function collectTargetSourcePaths(target: DocumentTarget): string[] {
  const paths = [target.entry, ...target.structure.flatMap((node) => node.path ? [node.path] : [])];
  const seen = new Set<string>();

  return paths.filter((path) => {
    const key = path.replaceAll("\\", "/").toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function formatFileEncoding(file: Pick<FileReadResult, "encoding"> | null): string {
  if (!file) return "编码未知";
  return file.encoding === "utf8-bom" ? "UTF-8 BOM" : "UTF-8";
}

export function formatLineEnding(file: Pick<FileReadResult, "lineEnding"> | null): string {
  if (!file) return "换行未知";
  return file.lineEnding === "crlf" ? "CRLF" : "LF";
}

export function collectTargetAssets(target: DocumentTarget, assets: AssetPin[]): AssetPin[] {
  const sourcePath = target.classConfig.sourcePath?.replaceAll("\\", "/").toLocaleLowerCase();
  const sourceHash = target.classConfig.sourceHash?.toLocaleLowerCase();

  return assets.filter((asset) => {
    if (asset.kind !== "class") return true;
    const assetPath = asset.path.replaceAll("\\", "/").toLocaleLowerCase();
    return Boolean((sourcePath && assetPath === sourcePath) || (sourceHash && asset.hash.toLocaleLowerCase() === sourceHash));
  });
}

export function describeClass(config: ClassConfig): ClassPresentation {
  const isElegantBook = config.name.toLocaleLowerCase() === "elegantbook";
  const source = config.sourcePath
    ?? (config.source === "project" ? "项目内文件" : config.source === "texlive" ? "TeX 发行版" : "来源未知");
  const badge = config.sourceHash
    ? `${config.source === "project" ? "项目内" : "内容"} · 哈希固定`
    : config.source === "texlive" ? "TeX 发行版提供" : "未固定内容哈希";

  return {
    isElegantBook,
    eyebrow: isElegantBook ? "文档类专用面板" : "通用文档类配置",
    title: isElegantBook ? "ElegantBook 配置" : `${config.name} 配置`,
    source,
    badge
  };
}

export function packageNotices(packages: PackageSpec[], className: string): PackageNotice[] {
  return packages.flatMap((item): PackageNotice[] => {
    if (item.diagnostic === "missing") {
      return [{
        id: item.id,
        severity: "error" as const,
        title: `${item.name} 在当前 TeX 发行版中缺失`,
        detail: "工作台只报告依赖状态，不会静默安装宏包。"
      }];
    }
    if (item.diagnostic === "conflict") {
      return [{
        id: item.id,
        severity: "warning" as const,
        title: `${item.name} 存在选项冲突`,
        detail: "请在迁移 diff 中核对加载位置与选项，条件代码会原样保留。"
      }];
    }
    if (item.diagnostic === "duplicate") {
      const owner = item.source === "class" ? `${className}.cls` : "文档前导区";
      return [{
        id: item.id,
        severity: "warning" as const,
        title: `${item.name} 被重复加载`,
        detail: `${owner} 已提供该宏包；请在迁移 diff 中核对重复声明。`
      }];
    }
    return [];
  });
}
