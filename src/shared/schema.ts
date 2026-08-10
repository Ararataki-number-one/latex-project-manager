import { z } from "zod";

import type { ProjectManifest } from "./types";

const relativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.includes("\0"), "路径不能包含 NUL 字符")
  .refine((value) => !/^(?:[a-zA-Z]:[\\/]|[\\/]{1,2})/.test(value), "路径必须相对于项目根目录")
  .refine(
    (value) => !value.split(/[\\/]+/).some((segment) => segment === ".."),
    "路径不能离开项目根目录"
  );

const idSchema = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);

export const engineSchema = z.enum(["auto", "xelatex", "lualatex", "pdflatex"]);
export const chapterStateSchema = z.enum(["full", "titleOnly", "hidden"]);
export const numberingModeSchema = z.enum(["preserve", "continuous"]);

export const classConfigSchema = z
  .object({
    name: z.string().min(1),
    options: z.record(z.string(), z.union([z.string(), z.boolean()])),
    rawOptions: z.array(z.string()),
    source: z.enum(["project", "texlive", "unknown"]).optional(),
    sourcePath: z.string().min(1).optional(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/i).optional()
  })
  .strict();

export const packageSpecSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    options: z.array(z.string()),
    enabled: z.boolean(),
    order: z.number().int().nonnegative(),
    source: z.enum(["managed", "manual", "class"]),
    condition: z.string().min(1).optional(),
    diagnostic: z.enum(["ok", "missing", "duplicate", "conflict"]).optional()
  })
  .strict();

export const structureKindSchema = z.enum([
  "cover",
  "title",
  "frontmatter",
  "toc",
  "localToc",
  "listOfFigures",
  "listOfTables",
  "listOfChanges",
  "mainmatter",
  "part",
  "chapter",
  "input",
  "appendix",
  "bibliography",
  "index",
  "backmatter",
  "raw"
]);

export const structureNodeSchema = z
  .object({
    id: idSchema,
    kind: structureKindSchema,
    title: z.string(),
    path: relativePathSchema.optional(),
    phase: z.enum(["frontmatter", "mainmatter", "appendix", "backmatter"]),
    order: z.number().int().nonnegative(),
    originalNumber: z.number().int().positive().optional(),
    titleSource: z.enum(["main", "file", "manual", "dynamic"]).optional(),
    headingSource: z.string().optional(),
    contentSource: z.string().optional(),
    managed: z.boolean()
  })
  .strict();

export const buildProfileSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    chapterState: z.record(z.string(), chapterStateSchema),
    numbering: numberingModeSchema,
    enabledBlocks: z.record(z.string(), z.boolean()),
    order: z.array(idSchema),
    focusNodes: z.array(idSchema).optional(),
    autoCompile: z.boolean().optional()
  })
  .strict();

export const documentTargetSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    entry: relativePathSchema,
    engine: engineSchema,
    texDistribution: z.string().min(1).optional(),
    classConfig: classConfigSchema,
    packages: z.array(packageSpecSchema),
    structure: z.array(structureNodeSchema),
    profiles: z.array(buildProfileSchema).min(1)
  })
  .strict();

export const assetPinSchema = z
  .object({
    id: idSchema,
    kind: z.enum(["class", "font", "template", "other"]),
    path: relativePathSchema,
    hash: z.string().regex(/^[a-f0-9]{64}$/i),
    source: z.string().optional()
  })
  .strict();

export const projectManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: idSchema,
    name: z.string().min(1),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    targets: z.array(documentTargetSchema).min(1),
    assets: z.array(assetPinSchema)
  })
  .strict()
  .superRefine((manifest, context) => {
    const targetIds = new Set<string>();
    for (const [targetIndex, target] of manifest.targets.entries()) {
      if (targetIds.has(target.id)) {
        context.addIssue({
          code: "custom",
          message: `文档目标 ID 重复: ${target.id}`,
          path: ["targets", targetIndex, "id"]
        });
      }
      targetIds.add(target.id);

      const nodeIds = new Set(target.structure.map((node) => node.id));
      for (const [profileIndex, profile] of target.profiles.entries()) {
        for (const nodeId of [...Object.keys(profile.chapterState), ...profile.order, ...(profile.focusNodes ?? [])]) {
          if (!nodeIds.has(nodeId)) {
            context.addIssue({
              code: "custom",
              message: `编译方案引用了不存在的结构节点: ${nodeId}`,
              path: ["targets", targetIndex, "profiles", profileIndex]
            });
          }
        }
      }
    }

    const assetIds = new Set<string>();
    for (const [assetIndex, asset] of manifest.assets.entries()) {
      if (assetIds.has(asset.id)) {
        context.addIssue({
          code: "custom",
          message: `资源 ID 重复: ${asset.id}`,
          path: ["assets", assetIndex, "id"]
        });
      }
      assetIds.add(asset.id);
    }
  });

export const ProjectManifestSchema = projectManifestSchema;

export function parseProjectManifest(value: unknown): ProjectManifest {
  return projectManifestSchema.parse(value) as ProjectManifest;
}

export function safeParseProjectManifest(value: unknown) {
  return projectManifestSchema.safeParse(value);
}

export { relativePathSchema };
