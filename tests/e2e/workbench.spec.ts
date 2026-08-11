import { expect, type Locator, type Page, test } from "@playwright/test";

const probability = "概率方法笔记";
const ramsey = "Ramsey 数笔记";

function projectRow(page: Page, name: string): Locator {
  return page.locator(".project-row").filter({ has: page.getByRole("button", { name, exact: true }) });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

test("Overleaf 风格项目库支持搜索、标签、复制、归档、回收站和导出", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page).toHaveTitle(/LaTeX/);
  await expect(page.getByRole("table", { name: "项目列表" })).toBeVisible();
  await expect(page.locator(".project-table-head").getByRole("columnheader", { name: "标题" })).toBeVisible();
  await expect(page.locator(".project-table-head").getByRole("columnheader", { name: "最近使用" })).toBeVisible();
  await expect(page.locator(".project-table-head").getByRole("columnheader", { name: "操作" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "标签筛选" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const search = page.getByRole("textbox", { name: "搜索项目" });
  await search.fill("Ramsey");
  await expect(projectRow(page, ramsey)).toBeVisible();
  await expect(projectRow(page, probability)).toHaveCount(0);
  await page.getByRole("button", { name: "清除搜索" }).click();

  const tagNavigation = page.getByRole("navigation", { name: "标签筛选" });
  await tagNavigation.getByRole("button", { name: "筛选标签：讲义" }).click();
  await expect(projectRow(page, probability)).toBeVisible();
  await expect(projectRow(page, "Graph Theory 组合笔记")).toBeVisible();
  await expect(projectRow(page, ramsey)).toHaveCount(0);
  await tagNavigation.getByRole("button", { name: "显示全部标签" }).click();

  const initialRow = projectRow(page, probability);
  await expect(initialRow).toBeVisible();
  await initialRow.getByRole("checkbox", { name: `选择项目 ${probability}` }).check();
  await expect(page.getByRole("toolbar", { name: "批量项目操作" })).toContainText("已选 1 项");
  await initialRow.getByRole("checkbox", { name: `选择项目 ${probability}` }).uncheck();

  for (const action of ["复制项目", "导出 ZIP", "导出 PDF", "清理临时文件", "归档项目", "移入回收站", "管理项目"]) {
    await expect(initialRow.getByRole("button", { name: `${action} ${probability}` })).toBeVisible();
  }
  await expect(initialRow).toContainText(/MB/);
  await expect(initialRow.getByLabel(/GitHub 状态：/)).toBeVisible();

  await initialRow.getByRole("button", { name: probability, exact: true }).click();
  await expect(page.getByRole("status")).toContainText(/打开.*文件夹/);

  await initialRow.getByRole("button", { name: `导出 ZIP ${probability}` }).click();
  await expect(page.getByRole("status")).toContainText(/\.zip/);
  await initialRow.getByRole("button", { name: `导出 PDF ${probability}` }).click();
  await expect(page.getByRole("status")).toContainText(/\.pdf/);

  await initialRow.getByRole("button", { name: `清理临时文件 ${probability}` }).click();
  const cleanupDialog = page.getByRole("dialog", { name: "清理临时文件" });
  await expect(cleanupDialog).toBeVisible();
  await expect(cleanupDialog).toContainText("18");
  await cleanupDialog.getByRole("button", { name: "确认清理" }).click();
  await expect(cleanupDialog).toBeHidden();
  await expect(page.getByRole("status")).toContainText(/已清理 18 个临时文件/);

  const copyName = "概率方法笔记 - E2E 副本";
  await initialRow.getByRole("button", { name: `复制项目 ${probability}` }).click();
  const copyDialog = page.getByRole("dialog", { name: "复制项目" });
  await expect(copyDialog).toBeVisible();
  await copyDialog.getByRole("textbox", { name: "副本名称" }).fill(copyName);
  await copyDialog.getByRole("button", { name: "选择位置并复制" }).click();
  await expect(copyDialog).toBeHidden();
  await expect(projectRow(page, copyName)).toBeVisible();

  await projectRow(page, probability).getByRole("button", { name: `归档项目 ${probability}` }).click();
  await expect(projectRow(page, probability)).toHaveCount(0);
  const libraryNavigation = page.getByRole("navigation", { name: "资料库导航" });
  await libraryNavigation.getByRole("button", { name: /^已归档/ }).click();
  await expect(projectRow(page, probability)).toBeVisible();
  await projectRow(page, probability).getByRole("button", { name: `取消归档 ${probability}` }).click();
  await expect(projectRow(page, probability)).toHaveCount(0);

  await libraryNavigation.getByRole("button", { name: /^项目库/ }).click();
  await projectRow(page, copyName).getByRole("button", { name: `移入回收站 ${copyName}` }).click();
  await expect(projectRow(page, copyName)).toHaveCount(0);
  await libraryNavigation.getByRole("button", { name: /^回收站/ }).click();
  await expect(projectRow(page, copyName)).toBeVisible();
  await projectRow(page, copyName).getByRole("button", { name: `恢复项目 ${copyName}` }).click();
  await expect(projectRow(page, copyName)).toHaveCount(0);
  await libraryNavigation.getByRole("button", { name: /^项目库/ }).click();
  await expect(projectRow(page, copyName)).toBeVisible();

  await projectRow(page, ramsey).getByRole("button", { name: `管理项目 ${ramsey}` }).click();
  await expect(page.locator(".project-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "项目介绍" })).toBeVisible();
  await expect(page.getByText("源码预览", { exact: true })).toHaveCount(0);
  await expect(page.locator(".pdf-preview")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /快捷编译/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "变更" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /编译.*Build/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "移动端主 PDF" })).toBeVisible();
  await expect(page.getByRole("button", { name: /保存移动端设置/ })).toBeVisible();

  const projectTabs = page.getByRole("tablist", { name: "项目页面" });
  await expect(projectTabs.getByRole("tab")).toHaveCount(3);
  await expect(projectTabs.getByRole("tab", { name: /文档结构/ })).toHaveCount(0);
  await expect(projectTabs.getByRole("tab", { name: /配置/ })).toHaveCount(0);
  await expect(projectTabs.getByRole("tab", { name: /原始文稿/ })).toBeVisible();
  await expect(projectTabs.getByRole("tab", { name: /GitHub 同步/ })).toBeVisible();
  await projectTabs.getByRole("tab", { name: /原始文稿/ }).click();
  await expect(page.getByRole("heading", { name: "原始文稿" })).toBeVisible();
  await expect(page.getByText("Alon-Spencer-The-Probabilistic-Method.pdf", { exact: true })).toBeVisible();
  await expect(page.getByText(/\\references/).first()).toBeVisible();
  await projectTabs.getByRole("tab", { name: /GitHub 同步/ }).click();
  await expect(page.getByRole("heading", { name: "GitHub 同步" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "GitHub 仓库地址" })).toHaveValue("https://github.com/zqy/probability-notes.git");
  await expect(page.getByRole("textbox", { name: "提交姓名" })).toHaveValue("Ararataki-number-one");
  await expect(page.getByRole("textbox", { name: "提交邮箱" })).toHaveValue("Ararataki-number-one@users.noreply.github.com");
  await expect(page.getByRole("button", { name: "保存并继续同步" })).toBeVisible();
  await expect(page.getByText(/新增、修改和删除/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "同步时间线" })).toBeVisible();

  await page.getByRole("navigation", { name: "应用导航" }).getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /自动检查更新/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /发现新版本后自动下载/ })).toBeChecked();
  await expect(page.getByRole("button", { name: "立即检查" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "GitHub 连接" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /关闭窗口后留在托盘/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /暂停所有自动同步/ })).not.toBeChecked();
  await expect(page.getByText("github.com/Ararataki-number-one/latex-project-manager", { exact: true })).toBeVisible();
  await expect(page.getByText("0.5.0", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "重新打开新手向导" }).click();
  const onboarding = page.getByRole("dialog", { name: "配置 LaTeX 项目管理器" });
  await expect(onboarding).toBeVisible();
  await expect(onboarding.getByText("Git LFS", { exact: true })).toBeVisible();
  await onboarding.getByRole("button", { name: "暂时关闭新手引导" }).click();
  await expectNoHorizontalOverflow(page);
});

test("导入项目会询问是否自动创建 GitHub 仓库", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "导入项目" }).click();
  const dialog = page.getByRole("dialog", { name: "导入 LaTeX 项目" });
  const sync = dialog.getByRole("checkbox", { name: /导入后启用 GitHub 自动同步/ });
  await expect(sync).not.toBeChecked();
  await sync.check();
  await expect(dialog.getByText("新仓库可见性", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("combobox")).toHaveValue("private");
});

test("批量归档会同时更新所有选中项目", async ({ page }) => {
  await page.goto("/");
  await projectRow(page, probability).getByRole("checkbox", { name: `选择项目 ${probability}` }).check();
  await projectRow(page, ramsey).getByRole("checkbox", { name: `选择项目 ${ramsey}` }).check();
  await page.getByRole("toolbar", { name: "批量项目操作" }).getByRole("button", { name: "归档" }).click();
  await expect(projectRow(page, probability)).toHaveCount(0);
  await expect(projectRow(page, ramsey)).toHaveCount(0);

  await page.getByRole("navigation", { name: "资料库导航" }).getByRole("button", { name: /^已归档/ }).click();
  await expect(projectRow(page, probability)).toBeVisible();
  await expect(projectRow(page, ramsey)).toBeVisible();
});

test("390px 下项目库和管理页都没有横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("table", { name: "项目列表" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const openSidebar = page.getByRole("button", { name: "打开侧栏" });
  if (await openSidebar.isVisible().catch(() => false)) {
    await openSidebar.click();
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "收起侧栏" }).click();
  }

  await projectRow(page, probability).getByRole("button", { name: `管理项目 ${probability}` }).click();
  await expect(page.locator(".project-page")).toBeVisible();
  await page.getByRole("tab", { name: /原始文稿/ }).click();
  await expect(page.getByRole("heading", { name: "原始文稿" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
