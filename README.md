# LaTeX 项目管理器

一个 Windows 优先、完全在本机运行的 LaTeX 项目管理软件。它把分散在不同目录中的项目集中成类似 Overleaf“所有项目”的列表，但不接管源码编辑、PDF 阅读或正式编译。

桌面端用于整理项目；写作、编译和调试继续交给 VS Code、LaTeX Workshop 或其他外部工具。仓库同时包含一个只读的 Android 客户端，用于查看 GitHub 上的项目文件。

## 桌面端

### 项目库

- 点击项目名称直接打开 Windows 文件夹。
- 搜索、标签、收藏、最近使用、归档和项目库回收站。
- 从本机文件夹导入，或从模板创建项目。
- 复制完整项目、导出源码 ZIP、打开或导出最新 PDF。
- 显示每个项目的内容大小和文件数量。
- 显示 GitHub 状态：`已同步`、`同步中`、`未同步`、`同步失败`。
- 项目列表保持紧凑；次要操作收在更多菜单中。

项目库回收站只隐藏本机索引记录，不会删除磁盘上的整个项目目录。

### 项目管理页

管理页只保留三个标签：

1. **项目介绍**：主文件、文档目标、当前方案、最新 PDF 和打开文件夹/VS Code 的入口。
2. **原始文稿**：把英文论文、中文 PDF、电子书等复制到项目根目录下的 `references` 文件夹。
3. **GitHub**：连接远端仓库、查看同步状态并控制自动同步。

界面不提供源码编辑器、内嵌 PDF、文档结构改写或 LaTeX 配置面板。

### 清理临时文件

每个项目都有“清理临时文件”操作。清理分为两步：

1. 只读扫描并列出文件数、预计释放空间、类型和示例路径。
2. 用户再次确认后，仅删除预览中且没有发生变化的临时文件。

可清理内容包括 `.aux`、`.log`、`.toc`、`.synctex.gz` 等 LaTeX 辅助文件，以及项目管理器自己的 build/runtime 缓存。它明确保留：

- `.tex`、`.bib`、`.cls`、`.sty` 等源文件；
- 所有 PDF；
- `references` 原始文稿；
- `.git`、快照和项目库回收站；
- 扫描后新增或发生变化的文件。

临时文件清理属于永久删除，因此界面始终先展示预览，不会静默执行。

### GitHub 自动同步

- 每个项目单独连接远端仓库，自动同步默认开启。
- 项目停止变化约 10 秒后，将新增、修改和删除合并成一次提交并推送。
- 认证交给本机 Git Credential Manager、GitHub Desktop 或 SSH；客户端不保存 GitHub 密码和访问令牌。
- 若 Git 尚未配置作者信息，可直接在同步页填写“提交姓名/提交邮箱”；信息只写入当前项目的本地 Git 配置。
- 不会强制推送。远端领先、历史分叉、认证失败或网络失败时进入“同步失败”，等待用户处理。
- `references` 中的原始文稿也会同步；大文件请按需使用 Git LFS。

### 客户端自动更新

- “设置”页可以分别控制启动时自动检查、发现版本后自动下载。
- 源码仓库已经公开；更新检查读取公开的 GitHub Release，不会把访问令牌写入客户端。
- 安装包下载后校验 GitHub Release 提供的文件大小与 SHA-256，再由用户确认安装。
- Windows 安装版按当前用户安装，不要求管理员权限；这是推荐版本。
- 便携版继续提供，但 Electron 官方不支持便携版安全地自行覆盖，因此便携版只能打开已下载的安装包完成迁移。

## Android 只读客户端

源码位于 [`android-viewer`](android-viewer)。它使用 Jetpack Compose 构建，采用中性留白、圆角卡片和系统浅色/深色主题：

- 列出 GitHub 公开与私有仓库；
- 浏览目录与默认分支；
- 在手机中阅读 `.tex`、`.bib`、`.cls`、`.sty`、Markdown 和常见文本文件；
- 搜索仓库和当前目录；
- 每个文件都可以单独选择位置下载，PDF、图片等二进制文件无需先打开 GitHub 网页；
- 每个仓库可以整体下载为 ZIP；
- 自动检查 Android 新版本，也可以自动下载 APK，校验后由 Android 系统确认安装；
- 没有编辑、提交、上传或删除功能；
- GitHub 令牌由 Android Keystore 加密保存。

安卓构建和权限说明见 [`android-viewer/README.md`](android-viewer/README.md)。

## 本地数据与安全

- 导入项目只登记绝对路径，不复制、不接管也不改写 `.tex`。
- 标签、收藏、归档、最近使用和 GitHub 状态保存在本机 SQLite 索引中。
- 项目大小只统计实际内容，跳过 `.git` 与项目管理器自身的构建缓存。
- 文件夹、ZIP/PDF 保存位置通过 Electron 原生对话框选择。
- 所有外部程序都通过参数数组启动，不经过 shell 字符串拼接。
- 不创建或覆盖项目中的 `.vscode/settings.json`。
- 不提供账号、云端协作或遥测。

本机索引默认位于：

```text
%APPDATA%\latex-workbench\library.sqlite
```

## 开发与测试

桌面端需要 Node.js 24 与 pnpm 11：

```powershell
pnpm install
pnpm dev
```

质量检查和 Windows 安装版/便携版：

```powershell
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm package:portable
pnpm package:windows
```

Windows 安装版和便携版都包含 Electron 运行时，不捆绑 TeX Live，也不会把项目文件复制到应用目录。带 `Setup` 的文件是支持后续自动更新的推荐安装包。
