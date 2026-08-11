# LaTeX 项目查看器（Android）

一个只读的 GitHub LaTeX 项目浏览器。界面采用中性、留白充足的简约风格，跟随系统浅色/深色主题。

## 能做什么

- 多个 GitHub 仓库会持久保存在手机项目库中，可以添加、切换或移除本机入口。
- 使用只读 GitHub fine-grained personal access token 访问私有仓库；公开仓库不需要令牌。
- 不登录时可以直接输入 `owner/repository` 或完整 GitHub 地址添加公开仓库。
- 浏览仓库目录和默认分支。
- 使用内置代码查看器阅读 `.tex`、`.bib`、`.cls`、`.sty`、Markdown、纯文本和常见源码文件。
- 使用 Android 原生 PDF 渲染器在应用内分页阅读 PDF；打开前先检查 GitHub 上的最新 SHA，文件未变化时秒开本地缓存，变化时才重新下载。
- 每个普通文件都能单独下载，每个仓库都能整体下载为 ZIP。
- 普通下载默认保存到 `内部存储/Download/LaTeX项目`；下载完成后显示文件位置，并提供“现在打开”。
- 自动检查公开 GitHub Release；可选择自动下载 APK，大小与 SHA-256 校验通过后再交给 Android 安装器。
- 搜索仓库和当前文件夹。
- 自动跟随 Android 系统浅色/深色主题。

应用没有编辑、提交、上传和删除入口。令牌用 Android Keystore 的 AES-GCM 密钥加密后保存在应用私有数据中，退出时可以一键移除。

## 下载与更新

- 文件列表右侧的下载按钮只下载该文件；PDF 也可以直接点击后在内置查看器中阅读。
- 项目卡片和项目文件页中的“下载整个 LaTeX 项目”会下载默认分支 ZIP。
- 文件与 ZIP 默认进入 `内部存储/Download/LaTeX项目`；Android 8/9 使用应用专属下载目录作为兼容回退。
- 下载完成弹窗会显示实际保存路径，可以选择“现在打开”或“稍后”。
- “设置与更新”中可以分别开启自动检查和自动下载。
- Android 不允许普通应用静默安装 APK；首次更新时需要允许“安装未知应用”，每次安装仍由系统界面确认。
- 正式 Release 使用固定签名密钥。只有签名一致、版本号更高的 APK 才能覆盖安装旧版本。

## 推荐令牌权限

使用 GitHub fine-grained personal access token，并只选择需要查看的仓库：

- Repository permissions → Metadata: Read-only
- Repository permissions → Contents: Read-only

不要把令牌写进源码、截图、问题报告或 Git 提交。

## 在 Android Studio 中运行

要求：

- JDK 17
- Android SDK 36
- Android Studio 支持 Android Gradle Plugin 9.1.1

用 Android Studio 打开本目录，等待 Gradle 同步后运行 `app`。命令行也可以使用：

```powershell
.\gradlew.bat assembleDebug
```

调试 APK 会生成到：

```text
app\build\outputs\apk\debug\app-debug.apk
```

首次构建会从官方 Gradle、Google Maven 和 Maven Central 下载构建依赖。

## 当前边界

- GitHub Contents API 单个目录最多返回 1000 项；超大目录应改用 Git Trees API。
- 应用内文本预览上限为 1.5 MB；更大的文件在 GitHub 页面查看。
- GitHub Contents API 不支持直接返回超过 100 MB 的文件内容。
- 本版不提供代码语义高亮、编辑或 Git 提交；PDF 预览缓存按 GitHub 文件版本保存，并自动清理较旧缓存。
