import { expect, type Locator, type Page, test } from "@playwright/test";

const probability = "概率方法笔记";
const ramsey = "Ramsey 数笔记";

function projectRow(page: Page, name: string): Locator {
  return page.locator(".project-row").filter({ has: page.getByRole("button", { name, exact: true }) });
}

async function openProjectMenu(page: Page, name: string): Promise<Locator> {
  const row = projectRow(page, name);
  await row.getByRole("button", { name: `更多操作 ${name}` }).click();
  const menu = row.getByRole("dialog", { name: `项目操作 ${name}` });
  await expect(menu).toBeVisible();
  return menu;
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

async function openLibraryFilters(page: Page): Promise<Locator> {
  const popover = page.locator(".desktop-v1-library-filter-popover");
  if (!await popover.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "更多项目筛选" }).click();
  }
  await expect(popover).toBeVisible();
  return popover;
}

test("500 个项目使用窗口化列表并保留桌面键盘操作", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?projectCount=501");

  const table = page.getByRole("table", { name: "项目列表" });
  await expect(table).toHaveAttribute("data-virtualized", "true");
  await expect(table).toHaveAttribute("aria-rowcount", "501");
  const firstScreenReadyMs = await page.evaluate(() => performance.now());
  expect(firstScreenReadyMs).toBeLessThan(1_500);
  const initialRenderedRows = await table.locator(".project-row").count();
  expect(initialRenderedRows).toBeGreaterThan(0);
  expect(initialRenderedRows).toBeLessThanOrEqual(24);

  const viewport = table.locator(".project-table-body");
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect(table.locator('[role="row"][aria-rowindex="501"]')).toBeVisible();
  expect(await table.locator(".project-row").count()).toBeLessThanOrEqual(24);

  const search = page.getByRole("textbox", { name: "搜索项目" });
  await page.keyboard.press("Control+f");
  await expect(search).toBeFocused();
  await search.fill("性能项目 0499");
  await expect(projectRow(page, "性能项目 0499")).toBeVisible();

  await page.goto("/?projectCount=501");
  const row = projectRow(page, probability);
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".project-page")).toBeVisible();

  await page.goto("/?projectCount=501");
  await projectRow(page, probability).focus();
  await page.keyboard.press("Control+Enter");
  await expect(page.getByRole("status")).toContainText(/打开.*文件夹/);
});

test("现代项目库支持搜索、标签、复制、归档、移除和导出", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page).toHaveTitle(/LaTeX/);
  await expect(page.getByRole("table", { name: "项目列表" })).toBeVisible();
  await expect(page.locator(".project-table-head").getByRole("columnheader", { name: "标题" })).toBeVisible();
  await expect(page.locator(".project-table-head").getByRole("columnheader", { name: "同步" })).toBeVisible();
  await expect(page.locator(".project-table-head").getByRole("columnheader", { name: "最近使用" })).toBeVisible();
  await expect(page.locator(".project-table-head").getByRole("columnheader", { name: "操作" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "项目库视图" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const search = page.getByRole("textbox", { name: "搜索项目" });
  await search.fill("Ramsey");
  await expect(projectRow(page, ramsey)).toBeVisible();
  await expect(projectRow(page, probability)).toHaveCount(0);
  await page.getByRole("button", { name: "清除搜索" }).click();

  const tagNavigation = (await openLibraryFilters(page)).getByRole("navigation", { name: "标签筛选" });
  await tagNavigation.getByRole("button", { name: "筛选标签：讲义" }).click();
  await expect(projectRow(page, probability)).toBeVisible();
  await expect(projectRow(page, "Graph Theory 组合笔记")).toBeVisible();
  await expect(projectRow(page, ramsey)).toHaveCount(0);
  await (await openLibraryFilters(page)).getByRole("button", { name: "显示全部标签" }).click();

  const initialRow = projectRow(page, probability);
  await expect(initialRow).toBeVisible();
  await initialRow.getByRole("checkbox", { name: `选择项目 ${probability}` }).check();
  await expect(page.getByRole("toolbar", { name: "批量项目操作" })).toContainText("已选 1 项");
  await initialRow.getByRole("checkbox", { name: `选择项目 ${probability}` }).uncheck();

  await expect(initialRow.getByRole("button", { name: `管理项目 ${probability}` })).toBeVisible();
  await expect(initialRow.getByRole("button", { name: `更多操作 ${probability}` })).toBeVisible();
  await expect(initialRow.getByRole("button", { name: `复制项目 ${probability}` })).toHaveCount(0);
  await expect(initialRow).toContainText(/MB/);
  await expect(initialRow.getByLabel(/GitHub 状态：/)).toBeVisible();

  const menu = await openProjectMenu(page, probability);
  for (const action of ["复制项目", "导出 ZIP", "导出 PDF", "清理临时文件", "归档项目", "从项目库移除"]) {
    await expect(menu.getByRole("button", { name: `${action} ${probability}` })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(initialRow.getByRole("button", { name: `更多操作 ${probability}` })).toBeFocused();

  await initialRow.getByRole("button", { name: probability, exact: true }).click();
  await expect(page.getByRole("complementary", { name: `项目快速检查 ${probability}` })).toBeVisible();
  await initialRow.dblclick();
  await expect(page.getByRole("status")).toContainText(/打开.*文件夹/);

  await (await openProjectMenu(page, probability)).getByRole("button", { name: `导出 ZIP ${probability}` }).click();
  await expect(page.getByRole("status")).toContainText(/\.zip/);
  await (await openProjectMenu(page, probability)).getByRole("button", { name: `导出 PDF ${probability}` }).click();
  await expect(page.getByRole("status")).toContainText(/\.pdf/);

  await (await openProjectMenu(page, probability)).getByRole("button", { name: `清理临时文件 ${probability}` }).click();
  const cleanupDialog = page.getByRole("dialog", { name: "清理临时文件" });
  await expect(cleanupDialog).toBeVisible();
  await expect(cleanupDialog).toContainText("18");
  await cleanupDialog.getByRole("button", { name: "确认清理" }).click();
  await expect(cleanupDialog).toBeHidden();
  await expect(page.getByRole("status")).toContainText(/已清理 18 个临时文件/);

  const copyName = "概率方法笔记 - E2E 副本";
  await (await openProjectMenu(page, probability)).getByRole("button", { name: `复制项目 ${probability}` }).click();
  const copyDialog = page.getByRole("dialog", { name: "复制项目" });
  await expect(copyDialog).toBeVisible();
  await copyDialog.getByRole("textbox", { name: "副本名称" }).fill(copyName);
  await copyDialog.getByRole("button", { name: "选择位置并复制" }).click();
  await expect(copyDialog).toBeHidden();
  await expect(projectRow(page, copyName)).toBeVisible();

  await (await openProjectMenu(page, probability)).getByRole("button", { name: `归档项目 ${probability}` }).click();
  await expect(projectRow(page, probability)).toHaveCount(0);
  const libraryNavigation = page.getByRole("navigation", { name: "资料库导航" });
  await (await openLibraryFilters(page)).getByRole("button", { name: "已归档", exact: true }).click();
  await expect(projectRow(page, probability)).toBeVisible();
  await (await openProjectMenu(page, probability)).getByRole("button", { name: `取消归档 ${probability}` }).click();
  await expect(projectRow(page, probability)).toHaveCount(0);

  await libraryNavigation.getByRole("button", { name: /^项目库/ }).click();
  await (await openProjectMenu(page, copyName)).getByRole("button", { name: `从项目库移除 ${copyName}` }).click();
  await expect(projectRow(page, copyName)).toHaveCount(0);
  await (await openLibraryFilters(page)).getByRole("button", { name: "已移除", exact: true }).click();
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
  await expect(projectTabs.getByRole("tab")).toHaveCount(4);
  await expect(projectTabs.getByRole("tab", { name: /文档结构/ })).toHaveCount(0);
  await expect(projectTabs.getByRole("tab", { name: /配置/ })).toHaveCount(0);
  await expect(projectTabs.getByRole("tab", { name: "研究资料", exact: true })).toBeVisible();
  await expect(projectTabs.getByRole("tab", { name: "文件", exact: true })).toBeVisible();
  await expect(projectTabs.getByRole("tab", { name: "保护", exact: true })).toBeVisible();
  await projectTabs.getByRole("tab", { name: "文件", exact: true }).click();
  await expect(page.getByRole("grid")).toContainText("main.tex");
  await expect(page.getByRole("button", { name: /导入文件/ })).toBeVisible();
  await projectTabs.getByRole("tab", { name: "研究资料", exact: true }).click();
  await expect(page.getByRole("heading", { name: "原始文稿" })).toBeVisible();
  await expect(page.locator(".reference-main").filter({ hasText: "Alon-Spencer-The-Probabilistic-Method.pdf" })).toBeVisible();
  await expect(page.getByText(/\\references/).first()).toBeVisible();
  await projectTabs.getByRole("tab", { name: "保护", exact: true }).click();
  await expect(page.getByRole("heading", { name: "项目保护", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "GitHub 同步" })).toBeVisible();
  await page.getByRole("button", { name: "同步设置" }).click();
  await expect(page.getByRole("textbox", { name: "GitHub 仓库地址" })).toHaveValue("https://github.com/zqy/probability-notes.git");
  await expect(page.getByRole("checkbox", { name: /自动同步/ })).toBeChecked();
  await expect(page.getByRole("button", { name: "重新连接并同步" })).toBeVisible();
  await expect(page.getByText(/新增、修改和删除/).first()).toBeVisible();
  await expect(page.getByText("同步时间线", { exact: true })).toBeVisible();

  await page.getByRole("navigation", { name: "应用导航" }).getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /关闭窗口后留在托盘/ })).toBeChecked();
  await expect(page.getByRole("combobox", { name: "液态玻璃" })).toHaveValue("auto");
  await page.getByRole("tab", { name: "外部编辑器" }).click();
  await expect(page.getByRole("heading", { name: "VS Code 与 LaTeX Workshop" })).toBeVisible();
  await expect(page.getByRole("button", { name: "测试打开最近项目" })).toBeVisible();
  await page.getByRole("tab", { name: "账号与同步" }).click();
  await expect(page.getByRole("heading", { name: "GitHub 连接" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /暂停所有自动同步/ })).not.toBeChecked();
  await page.getByRole("tab", { name: "客户端更新" }).click();
  await expect(page.getByRole("checkbox", { name: /自动检查更新/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /发现新版本后自动下载/ })).toBeChecked();
  await expect(page.getByRole("button", { name: "立即检查" })).toBeVisible();
  await page.getByRole("tab", { name: "关于" }).click();
  await expect(page.getByText("github.com/Ararataki-number-one/latex-project-manager", { exact: true })).toBeVisible();
  await expect(page.getByText("1.0.0-rc.1", { exact: true }).first()).toBeVisible();
  await page.getByRole("tab", { name: "外观与常规" }).click();
  await page.getByRole("button", { name: "重新打开新手向导" }).click();
  const onboarding = page.getByRole("dialog", { name: "把 LaTeX 项目集中到一处" });
  await expect(onboarding).toBeVisible();
  await expect(onboarding.getByLabel("新手引导第 1 步，共 3 步")).toContainText("了解本地管理");
  await expect(onboarding.getByText("选择项目", { exact: true })).toBeVisible();
  await expect(onboarding.getByText("开始使用", { exact: true })).toBeVisible();
  await expect(onboarding.getByText(/不需要账号、Git 或 TeX 工具链/)).toBeVisible();
  await onboarding.getByRole("button", { name: "暂时关闭新手引导" }).click();
  await expectNoHorizontalOverflow(page);
});

test("导入项目会询问是否自动创建 GitHub 仓库", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "导入项目" }).click();
  const dialog = page.getByRole("dialog", { name: "导入 LaTeX 项目" });
  await expect(dialog.getByLabel("导入进度")).toContainText("选择目录");
  await dialog.getByRole("button", { name: "选择目录" }).click();
  await expect(dialog.locator(".candidate")).toHaveCount(3);
  await expect(dialog.getByRole("checkbox", { name: `选择导入项目 ${probability}` })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: "选择导入项目 随机图论文" }).check();
  await expect(dialog.getByRole("button", { name: /加入 1 项到本机项目库/ })).toBeEnabled();
  const sync = dialog.getByRole("checkbox", { name: /导入后启用 GitHub 自动同步/ });
  await expect(sync).not.toBeChecked();
  await sync.check();
  await expect(dialog.getByText("新仓库可见性", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("combobox")).toHaveValue("private");
  await expect(dialog.getByRole("button", { name: /导入 1 项并开启同步/ })).toBeEnabled();
});

test("同步中心汇总项目状态并直达项目同步页", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "应用导航" }).getByRole("button", { name: "活动" }).click();
  await expect(page.getByRole("heading", { name: "活动", exact: true })).toBeVisible();
  await expect(page.getByLabel("活动概况")).toBeVisible();
  await expect(page.getByLabel("活动概况")).toContainText("进行中");
  await expect(page.getByText(/失败和安全阻止会一直保留/)).toBeVisible();
  await expect(page.getByRole("button", { name: "暂停自动同步" })).toBeVisible();
  await expect(page.getByRole("button", { name: "同步全部" })).toBeVisible();

  const probabilitySync = page.locator(".sync-project-row").filter({ hasText: probability });
  await expect(probabilitySync).toBeVisible();
  await probabilitySync.getByRole("button", { name: "查看同步" }).click();
  await expect(page.getByRole("tab", { name: "保护", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "项目保护", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "GitHub 同步" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("批量归档会同时更新所有选中项目", async ({ page }) => {
  await page.goto("/");
  await projectRow(page, probability).getByRole("checkbox", { name: `选择项目 ${probability}` }).check();
  await projectRow(page, ramsey).getByRole("checkbox", { name: `选择项目 ${ramsey}` }).check();
  await page.getByRole("toolbar", { name: "批量项目操作" }).getByRole("button", { name: "归档" }).click();
  await expect(projectRow(page, probability)).toHaveCount(0);
  await expect(projectRow(page, ramsey)).toHaveCount(0);

  await (await openLibraryFilters(page)).getByRole("button", { name: "已归档", exact: true }).click();
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
    await page.getByRole("navigation", { name: "应用导航" }).getByRole("button", { name: "活动" }).click();
    await expect(page.locator(".app-shell")).toHaveClass(/nav-closed/);
    await expect(page.getByRole("heading", { name: "活动", exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.getByLabel("活动概况").locator(":scope > span")).toHaveCount(4);
    await page.getByRole("button", { name: "打开侧栏" }).click();
    await page.getByRole("navigation", { name: "资料库导航" }).getByRole("button", { name: /^项目库/ }).click();
    await expect(page.getByRole("table", { name: "项目列表" })).toBeVisible();
  }

  const menuTrigger = projectRow(page, probability).getByRole("button", { name: `更多操作 ${probability}` });
  await menuTrigger.click();
  const mobileMenu = page.getByRole("dialog", { name: `项目操作 ${probability}` });
  await expect(mobileMenu).toBeVisible();
  await expect(page.getByRole("button", { name: `关闭项目操作 ${probability}` }).first()).toBeVisible();
  const menuBox = await mobileMenu.boundingBox();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  await expect(mobileMenu).toBeHidden();
  await expect(menuTrigger).toBeFocused();

  await projectRow(page, probability).getByRole("button", { name: probability, exact: true }).click();
  await page.getByRole("complementary", { name: `项目快速检查 ${probability}` }).getByRole("button", { name: "项目详情" }).click();
  await expect(page.locator(".project-page")).toBeVisible();
  const folderButton = page.getByRole("button", { name: "打开文件夹", exact: true });
  const editorButton = page.getByRole("button", { name: "在 VS Code 中打开", exact: true });
  const [folderBox, editorBox, headerBox] = await Promise.all([
    folderButton.boundingBox(),
    editorButton.boundingBox(),
    page.locator(".project-header").boundingBox()
  ]);
  expect(folderBox).not.toBeNull();
  expect(editorBox).not.toBeNull();
  expect(headerBox).not.toBeNull();
  expect(Math.abs(folderBox!.y - editorBox!.y)).toBeLessThan(5);
  expect(headerBox!.height).toBeLessThan(150);
  await expect(page.locator(".overview-target-table > button").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole("tab", { name: "研究资料", exact: true }).click();
  await expect(page.getByRole("heading", { name: "原始文稿" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("390px 模板库先展示列表，详情可返回", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "打开侧栏" }).click();
  await page.getByRole("navigation", { name: "资料库导航" }).getByRole("button", { name: "模板库" }).click();

  const details = page.getByRole("complementary", { name: "模板详情" });
  await expect(page.getByRole("region", { name: "内置模板", exact: true })).toBeVisible();
  await expect(details).toBeHidden();
  await page.getByRole("option", { name: /简洁论文/ }).click();
  await expect(details).toBeVisible();
  await expect(details.getByRole("button", { name: "返回模板列表" })).toBeVisible();
  await details.getByRole("button", { name: "返回模板列表" }).click();
  await expect(details).toBeHidden();
  await expect(page.getByRole("region", { name: "内置模板", exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("跟随系统主题会响应系统深浅色变化", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme-preference", "system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("模板库区分内置与个人模板并支持搜索和安全确认", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "资料库导航" });
  await navigation.getByRole("button", { name: "模板库" }).click();

  await expect(page.getByTestId("template-library")).toBeVisible();
  await expect(page.getByRole("heading", { name: "模板库" })).toBeVisible();
  await expect(page.getByRole("region", { name: "内置模板", exact: true })).toContainText("分章书稿");
  await expect(page.getByRole("region", { name: "我的模板", exact: true })).toContainText("我的概率论笔记");

  const search = page.getByRole("textbox", { name: "搜索模板" });
  await search.fill("不存在的模板名称");
  await expect(page.getByText("没有符合条件的模板")).toBeVisible();
  await page.getByRole("button", { name: "清除模板搜索" }).click();

  await page.getByRole("option", { name: /简洁论文/ }).click();
  await expect(page.getByRole("complementary", { name: "模板详情" })).toContainText("article");
  await page.getByRole("button", { name: "使用此模板新建项目" }).click();
  const createDialog = page.getByRole("dialog", { name: "简洁论文" });
  await expect(createDialog).toBeVisible();
  await expect(createDialog.getByRole("textbox", { name: "新项目名称" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(createDialog).toBeHidden();

  await page.getByRole("option", { name: /我的概率论笔记/ }).click();
  const deleteButton = page.getByRole("button", { name: "删除个人模板" });
  await deleteButton.click();
  const deleteDialog = page.getByRole("alertdialog", { name: /删除“我的概率论笔记”/ });
  await expect(deleteDialog).toContainText("不会删除或修改创建它的原项目");
  await page.keyboard.press("Escape");
  await expect(deleteDialog).toBeHidden();
  await expect(deleteButton).toBeFocused();
  await expectNoHorizontalOverflow(page);
});

test("桌面 1.0 信息架构收敛一级入口并提供三栏资料浏览", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const libraryNavigation = page.getByRole("navigation", { name: "资料库导航" });
  await expect(libraryNavigation.getByRole("button", { name: /^项目库/ })).toBeVisible();
  await expect(libraryNavigation.getByRole("button", { name: "研究资料" })).toBeVisible();
  await expect(libraryNavigation.getByRole("button", { name: "模板库" })).toBeVisible();
  await expect(libraryNavigation.getByRole("button", { name: "需要处理" })).toBeVisible();
  await expect(libraryNavigation.getByRole("button")).toHaveCount(4);
  await expect(page.getByRole("navigation", { name: "应用导航" })).toContainText("活动");
  await expect(page.getByRole("navigation", { name: "应用导航" })).toContainText("设置");
  await expect(page.getByRole("navigation", { name: "项目库视图" })).toContainText("全部项目");
  const filters = await openLibraryFilters(page);
  await expect(filters.getByRole("button", { name: "已归档", exact: true })).toBeVisible();
  await expect(filters.getByRole("button", { name: "已移除", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "更多项目筛选" }).click();

  await libraryNavigation.getByRole("button", { name: "研究资料" }).click();
  await expect(page.getByRole("heading", { name: "研究资料", exact: true })).toBeVisible();
  await expect(page.getByLabel("研究资料列表").getByText("The Probabilistic Method", { exact: true })).toBeVisible();
  await page.getByLabel("研究资料列表").getByText("The Probabilistic Method", { exact: true }).click();
  await expect(page.getByLabel("资料检查器")).toContainText("2");
  await page.getByLabel("资料检查器").getByRole("button", { name: /概率方法笔记/ }).click();
  await expect(page.getByRole("tab", { name: /研究资料/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".reference-browser")).toBeVisible();
  await page.getByRole("list", { name: "原始文稿列表" }).getByRole("button", { name: /The Probabilistic Method/ }).click();
  const researchInspector = page.getByRole("complementary", { name: /资料详情/ });
  await expect(researchInspector).toBeVisible();
  await expect(page.getByLabel("研究资料分类")).toBeVisible();
  await expect(researchInspector.getByRole("checkbox", { name: "关联到整个项目" })).toBeChecked();
  await expect(researchInspector.getByRole("combobox", { name: "整个项目的资料角色" })).toHaveValue("primarySource");
  await expect(researchInspector.getByRole("combobox", { name: "整个项目的首选附件" })).toHaveValue("attachment-probabilistic-method");

  await researchInspector.getByRole("checkbox", { name: "关联到讲义正文" }).check();
  await researchInspector.getByRole("combobox", { name: "讲义正文的资料角色" }).selectOption("translationSource");
  await researchInspector.getByRole("combobox", { name: "讲义正文的首选附件" }).selectOption("attachment-probabilistic-method");
  await researchInspector.getByRole("checkbox", { name: "关联到习题单" }).check();
  await researchInspector.getByRole("combobox", { name: "习题单的资料角色" }).selectOption("supplement");
  await researchInspector.getByRole("combobox", { name: "习题单的首选附件" }).selectOption("attachment-probabilistic-method");
  await researchInspector.getByRole("button", { name: "保存资料信息" }).click();
  await expect(researchInspector.getByRole("combobox", { name: "讲义正文的资料角色" })).toHaveValue("translationSource");
  await expect(researchInspector.getByRole("combobox", { name: "讲义正文的首选附件" })).toHaveValue("attachment-probabilistic-method");
  await expect(researchInspector.getByRole("combobox", { name: "习题单的资料角色" })).toHaveValue("supplement");
  await expect(researchInspector.getByRole("combobox", { name: "习题单的首选附件" })).toHaveValue("attachment-probabilistic-method");
  await expectNoHorizontalOverflow(page);
});

test("Ctrl+K 全局搜索可定位项目、文件和研究资料", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "全局搜索" });
  await expect(dialog).toBeVisible();
  const search = dialog.getByRole("combobox", { name: "搜索项目、文件和研究资料" });
  await search.fill("Probabilistic Method");
  await expect(dialog.getByRole("option", { name: /The Probabilistic Method/ }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("1024×768 发布窗口保留项目库主操作且无横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");

  const search = page.getByRole("textbox", { name: "搜索项目" });
  const importProject = page.getByRole("button", { name: "导入项目" });
  await expect(search).toBeVisible();
  await expect(importProject).toBeVisible();
  await projectRow(page, probability).getByRole("button", { name: probability, exact: true }).click();

  const inspector = page.getByRole("complementary", { name: `项目快速检查 ${probability}` });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole("button", { name: "打开文件夹" })).toBeVisible();
  await expect(inspector.getByRole("button", { name: "VS Code" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("高对比度与减少动态模式下主操作可见可聚焦", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");

  await expect.poll(() => page.evaluate(() => ({
    forcedColors: matchMedia("(forced-colors: active)").matches,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches
  }))).toEqual({ forcedColors: true, reducedMotion: true });

  const search = page.getByRole("textbox", { name: "搜索项目" });
  await page.keyboard.press("Control+f");
  await expect(search).toBeFocused();
  await expect(page.getByRole("button", { name: "导入项目" })).toBeVisible();
  await expect(projectRow(page, probability)).toBeVisible();

  const accessibilityStyles = await page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>(".app-sidebar");
    const row = document.querySelector<HTMLElement>(".project-row");
    return {
      sidebarBackdrop: sidebar ? getComputedStyle(sidebar).backdropFilter : "missing",
      rowTransitionMs: row
        ? getComputedStyle(row).transitionDuration.split(",").map((value) => Number.parseFloat(value) * (value.includes("ms") ? 1 : 1_000))
        : [Number.POSITIVE_INFINITY]
    };
  });
  expect(accessibilityStyles.sidebarBackdrop).toBe("none");
  expect(Math.max(...accessibilityStyles.rowTransitionMs)).toBeLessThanOrEqual(1);
  await expectNoHorizontalOverflow(page);
});

for (const scale of [1.25, 1.5] as const) {
  test(`${Math.round(scale * 100)}% 布局缩放下项目库仍可操作`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.evaluate((zoom) => {
      document.documentElement.style.zoom = String(zoom);
    }, scale);

    const search = page.getByRole("textbox", { name: "搜索项目" });
    const importProject = page.getByRole("button", { name: "导入项目" });
    await expect(search).toBeVisible();
    await expect(importProject).toBeVisible();
    await page.keyboard.press("Control+f");
    await expect(search).toBeFocused();
    await expect(projectRow(page, probability)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}

test("200% 字体下主操作可见且页面无横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.addStyleTag({ content: ":root { font-size: 200% !important; }" });

  const search = page.getByRole("textbox", { name: "搜索项目" });
  const importProject = page.getByRole("button", { name: "导入项目" });
  await expect(search).toBeVisible();
  await expect(importProject).toBeVisible();
  await page.keyboard.press("Control+f");
  await expect(search).toBeFocused();
  await expect(projectRow(page, probability)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("项目行支持真实右键菜单与键盘焦点恢复", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");

  const row = projectRow(page, probability);
  await row.click({ button: "right", position: { x: 180, y: 28 } });
  await expect(row).toHaveAttribute("aria-selected", "true");

  const menu = row.getByRole("dialog", { name: `项目操作 ${probability}` });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: `在 VS Code 中打开 ${probability}` })).toBeVisible();
  await expect(menu.getByRole("button", { name: `关闭项目操作 ${probability}` })).toBeFocused();
  await expectNoHorizontalOverflow(page);

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(row.getByRole("button", { name: `更多操作 ${probability}` })).toBeFocused();
});
