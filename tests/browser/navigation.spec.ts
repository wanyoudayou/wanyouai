import { expect, test } from "@playwright/test";

test("custom sections activate on nested routes; external links open separately; phones see a desktop hint", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/lab/fixture-lab/step/2");
  await expect(page.getByRole("heading", { name: "实验栏目内容" })).toBeVisible();
  const map = page.getByRole("navigation", { name: "内容地图" });
  await expect(map.getByRole("link", { name: "实验栏目" })).toHaveAttribute("aria-current", "page");
  await expect(map.locator('[aria-current="page"]')).toHaveCount(1);
  const external = map.getByRole("link", { name: /外部工具/ });
  await expect(external).toHaveAttribute("target", "_blank");
  await expect(external).toHaveAttribute("rel", "noopener noreferrer");
  await expect(external).not.toHaveAttribute("aria-current", "page");

  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(page.getByRole("navigation", { name: "快捷导航" }).getByRole("link", { name: "实验栏目" })).toHaveAttribute("aria-current", "page");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("navigation", { name: "移动主导航" }).getByRole("button", { name: "目录" }).click();
  const drawer = page.getByRole("dialog").getByRole("navigation", { name: "内容地图" });
  await expect(drawer.getByRole("link", { name: "收费方案" })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "实验栏目" })).toBeHidden();
  await expect(drawer.getByText("更多栏目请在电脑上访问。")).toBeVisible();
});

test("navigation manager adds, reorders and flags entries before one save", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin/navigation-fixture");
  const list = page.getByRole("region", { name: "自定义导航" });
  await expect(list.getByText("本次部署中不存在，前台已隐藏")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存导航" })).toBeDisabled();

  const add = page.getByRole("region", { name: "添加导航" });
  await add.getByLabel("导航类型").selectOption("section");
  await add.getByLabel("导航目标").selectOption("git-lab");
  await add.getByRole("button", { name: "加入列表" }).click();
  await expect(list.getByLabel("第 3 项名称")).toHaveValue("Git 实验室");
  await expect(list.getByLabel("第 3 项访问级别")).toHaveValue("public");

  await add.getByLabel("导航类型").selectOption("external");
  await add.getByLabel("链接地址").fill("http://insecure.example");
  await add.getByLabel("名称").fill("外链");
  await add.getByRole("button", { name: "加入列表" }).click();
  await expect(add.getByText("请填写完整的 https 地址。")).toBeVisible();

  await add.getByLabel("导航类型").selectOption("page");
  await expect(add.getByLabel("导航目标").locator("option", { hasText: "收费方案" })).toHaveCount(0);

  await list.getByRole("button", { name: "上移 Git 实验室" }).click();
  await expect(list.getByLabel("第 2 项名称")).toHaveValue("Git 实验室");
  await expect(page.getByText("有未保存的修改。")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存导航" })).toBeEnabled();
  await page.getByRole("button", { name: "放弃修改" }).click();
  await expect(list.getByLabel("第 2 项名称")).toHaveValue("旧栏目");
  await expect(page.getByText("当前部署：abc1234", { exact: false })).toBeVisible();
});

test("parent directories collapse behind a down arrow and expand to internal and external children", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const map = page.getByRole("navigation", { name: "内容地图" });
  const toggle = map.getByRole("button", { name: "学习资源" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle.locator("svg").last()).not.toHaveClass(/rotate-180/);
  const children = map.getByRole("group", { name: "学习资源" });
  await expect(children).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle.locator("svg").last()).toHaveClass(/rotate-180/);
  await expect(children.getByRole("link", { name: "设计预览" })).toBeVisible();
  const docs = children.getByRole("link", { name: /开发文档/ });
  await expect(docs).toHaveAttribute("target", "_blank");
  await expect(docs).toHaveAttribute("rel", "noopener noreferrer");
  await toggle.click();
  await expect(children).toBeHidden();

  // A child page opens its directory and is the only active entry.
  await page.goto("/p/design-preview");
  await expect(map.getByRole("button", { name: "学习资源" })).toHaveAttribute("aria-expanded", "true");
  await expect(map.getByRole("group", { name: "学习资源" }).getByRole("link", { name: "设计预览" })).toHaveAttribute("aria-current", "page");
  await expect(map.locator('[aria-current="page"]')).toHaveCount(1);

  // The icon rail keeps the directory as one icon that opens the full map.
  await page.setViewportSize({ width: 1024, height: 800 });
  const rail = page.getByRole("navigation", { name: "快捷导航" });
  await expect(rail.getByRole("button", { name: "学习资源（在目录中展开）" })).toHaveClass(/bg-accent/);
  await rail.getByRole("button", { name: "学习资源（在目录中展开）" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "学习资源" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Phones show directories whose children work on mobile.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("navigation", { name: "移动主导航" }).getByRole("button", { name: "目录" }).click();
  const drawer = page.getByRole("dialog").getByRole("navigation", { name: "内容地图" });
  await drawer.getByRole("button", { name: "学习资源" }).click();
  await expect(drawer.getByRole("link", { name: "设计预览" })).toBeVisible();
});

test("navigation manager builds a parent directory with children and keeps one level", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin/navigation-fixture");
  const list = page.getByRole("region", { name: "自定义导航" });
  const add = page.getByRole("region", { name: "添加导航" });
  const payload = async () =>
    JSON.parse(await page.locator('input[name="items"]').inputValue()) as { kind: string; label: string; child: boolean }[];

  await add.getByLabel("导航类型").selectOption("group");
  await add.getByLabel("目录名称").fill("工具箱");
  await add.getByRole("button", { name: "加入列表" }).click();
  await expect(list.getByText("没有子项，前台不显示")).toBeVisible();

  await add.getByLabel("导航类型").selectOption("external");
  await add.getByLabel("导航名称").fill("开发文档");
  await add.getByLabel("链接地址").fill("https://example.com/docs");
  await add.getByLabel("放入目录").selectOption({ label: "工具箱" });
  await add.getByRole("button", { name: "加入列表" }).click();
  await add.getByLabel("导航类型").selectOption("section");
  await add.getByLabel("导航目标").selectOption("git-lab");
  await add.getByLabel("放入目录").selectOption({ label: "工具箱" });
  await add.getByRole("button", { name: "加入列表" }).click();
  await expect(list.getByText("2 个子项")).toBeVisible();
  expect((await payload()).map((item) => [item.label, item.child])).toEqual([
    ["收费方案", false], ["旧栏目", false], ["工具箱", false], ["开发文档", true], ["Git 实验室", true],
  ]);

  // Children move within their directory; the directory moves with its children.
  await list.getByRole("button", { name: "上移 Git 实验室" }).click();
  await expect(list.getByRole("button", { name: "上移 Git 实验室" })).toBeDisabled();
  await list.getByRole("button", { name: "上移 工具箱" }).click();
  expect((await payload()).map((item) => item.label)).toEqual(["收费方案", "工具箱", "Git 实验室", "开发文档", "旧栏目"]);

  // Moving out places the link after the directory; it can move back in.
  await list.getByRole("button", { name: "将 Git 实验室 移出目录" }).click();
  expect((await payload()).map((item) => [item.label, item.child])).toEqual([
    ["收费方案", false], ["工具箱", false], ["开发文档", true], ["Git 实验室", false], ["旧栏目", false],
  ]);
  await list.getByRole("button", { name: "将 Git 实验室 移入上方目录" }).click();
  expect((await payload())[3]).toMatchObject({ label: "Git 实验室", child: true });
  await expect(list.getByRole("button", { name: "将 旧栏目 移入上方目录" })).toBeVisible();
  await expect(list.getByRole("button", { name: "将 工具箱 移入上方目录" })).toHaveCount(0);

  // Removing the directory keeps its children as top-level links.
  await list.getByRole("button", { name: "移除 工具箱" }).click();
  expect((await payload()).map((item) => [item.label, item.child])).toEqual([
    ["收费方案", false], ["开发文档", false], ["Git 实验室", false], ["旧栏目", false],
  ]);
});
