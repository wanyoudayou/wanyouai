import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const)
  for (const width of [1440, 1100, 390, 320]) {
    test(`${theme} workspace at ${width}px`, async ({ page }, info) => {
      const errors: string[] = [],
        fonts: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (/hydration|didn't match|does not match/i.test(message.text()))
          errors.push(message.text());
      });
      page.on("request", (request) => {
        if (/fonts\.googleapis|fonts\.gstatic/.test(request.url()))
          fonts.push(request.url());
      });
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: "让知识与服务，成为你的事业。" }),
      ).toBeVisible();
      await expect
        .poll(() => page.locator("html").getAttribute("class"))
        .toContain(theme);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`home-${theme}-${width}.png`),
        fullPage: true,
      });
      if (width < 768) {
        await expect(
          page.getByRole("navigation", { name: "移动主导航" }),
        ).toBeVisible();
        await page.getByRole("button", { name: "目录", exact: true }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "分身", exact: true }).click();
        await expect(page.getByRole("dialog")).toHaveCount(1);
        await page.keyboard.press("Escape");
      } else if (width < 1280)
        await expect(
          page.getByRole("navigation", { name: "快捷导航" }),
        ).toBeVisible();
      await page.goto("/collections/example");
      await expect(
        page.getByRole("heading", { name: "功能与使用方式", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`reading-${theme}-${width}.png`),
        fullPage: true,
      });
      await page.goto("/p/pricing");
      await expect(
        page.getByRole("heading", { name: "年度订阅" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "购买年度订阅" }),
      ).toBeDisabled();
      await page.screenshot({
        path: info.outputPath(`pricing-${theme}-${width}.png`),
        fullPage: true,
      });
      expect(errors).toEqual([]);
      expect(fonts).toEqual([]);
    });
  }

test("manual theme persists and admin pagination retains URL state", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/admin/articles");
  const appearance = page.getByRole("button", { name: /^外观：/ });
  await appearance.click();
  await appearance.click();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(
    page.getByRole("navigation", { name: "后台管理" }),
  ).toBeVisible();
  await expect(
    page.getByText("显示第 1–20 条，共 21 条", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "下一页", exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(
    page.getByText("显示第 21–21 条，共 21 条", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("显示第 21–21 条，共 21 条", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("admin-dark.png"),
    fullPage: true,
  });
});

test("workbench retains collection context and protects an unsaved draft", async ({
  page,
}) => {
  await page.goto("/admin/content");
  await expect(page.getByLabel("所属专辑")).toHaveValue("example");
  await page.getByLabel("标题", { exact: true }).fill("未保存的标题");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "文章", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/content$/);
  await expect(page.getByLabel("标题", { exact: true })).toHaveValue(
    "未保存的标题",
  );
});

test("system preference and manual choice work when browser storage is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem"])
      Object.defineProperty(Storage.prototype, method, {
        value() {
          throw new DOMException("blocked", "SecurityError");
        },
        configurable: true,
      });
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/admin/content");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByLabel("标题", { exact: true }).fill("切换主题仍保留的草稿");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveClass(/light/);
  const appearance = page.getByRole("button", { name: /^外观：/ });
  await appearance.click();
  await appearance.click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByLabel("标题", { exact: true })).toHaveValue(
    "切换主题仍保留的草稿",
  );
});

test("theme pill cycles the stored preference with keyboard and follows the system again", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/admin/content");
  const appearance = page.getByRole("button", { name: /^外观：/ });
  await expect(appearance).toHaveText("跟随系统");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("combobox", { name: "外观" })).toHaveCount(0);
  await page.getByLabel("标题", { exact: true }).fill("循环外观时保留草稿");
  await appearance.focus();
  await page.keyboard.press("Enter");
  await expect(appearance).toHaveText("浅色模式");
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.keyboard.press("Space");
  await expect(appearance).toHaveText("深色模式");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await appearance.click();
  await expect(appearance).toHaveText("跟随系统");
  await expect(appearance).toBeFocused();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveClass(/light/);
  await expect(page.getByLabel("标题", { exact: true })).toHaveValue("循环外观时保留草稿");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("wanyou-theme"))).toBe("system");
});

test("mobile directory uses the same pill and preserves the preference when reopened", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.getByRole("button", { name: "目录", exact: true }).click();
  const directory = page.getByRole("dialog");
  const appearance = directory.getByRole("button", { name: /^外观：/ });
  await expect(appearance).toHaveText("跟随系统");
  await appearance.click();
  await appearance.click();
  await expect(appearance).toHaveText("深色模式");
  await expect(directory).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "目录", exact: true }).click();
  await expect(directory.getByRole("button", { name: /^外观：/ })).toHaveText("深色模式");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("SSR colors follow a dark system before JavaScript runs", async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    colorScheme: "dark",
  });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(10, 15, 10)",
    );
  } finally {
    await context.close();
  }
});
