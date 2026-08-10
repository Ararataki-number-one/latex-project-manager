# 受管区块与编译方案

LaTeX 工作台只改写带有稳定标记的区域。标记外的自定义命令、条件逻辑、正文和注释保持原样。

```tex
%% <latex-workbench:begin id="class" version="1">
\documentclass[lang=cn,toc=onecol]{elegantbook}
%% <latex-workbench:end id="class">

%% <latex-workbench:begin id="packages" version="1">
\usepackage{etoc}
%% <latex-workbench:end id="packages">
```

结构区块位于 `document` 环境内，保留扫描时识别到的 `\input`、`\include` 或 `\subfile` 语义。迁移器无法确认正文边界时不会创建结构区块，而是把相关内容标记为手工管理。

每次编译会在隔离目录中生成：

- `runtime.tex`：当前方案的章节状态、编号策略和启用结构块。
- `workbench.tex`：设置 runtime 后载入原主文件的临时入口。
- `workbench.pdf`、辅助文件和 SyncTeX 数据。
- `last-success.pdf`：失败后仍可查看的最后成功版本。

章节状态语义：

- `full`：输出标题、局部结构与完整正文。
- `titleOnly`：输出章节标题和目录项，不载入正文，也不生成空局部目录。
- `hidden`：不输出该章节；节点仍保存在项目结构中。

`preserve` 会在输出章节前恢复其原始编号，允许空缺；`continuous` 按当前方案重新连续编号。无法静态取得标题的章节不能进入 `titleOnly`，需要先在属性面板指定手工标题。
