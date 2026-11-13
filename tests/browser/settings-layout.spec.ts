import { expect, test } from "@playwright/test";

test("site settings group LOGO fields, stack one-liner over subtitle and align both banners", async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin/settings-fixture");
  const logo = page.getByRole("region", { name: "LOGO" });
  await expect(logo.getByLabel("站名（必填）")).toHaveValue("示例工作室");
  await expect(logo.getByLabel("LOGO 小标题")).toHaveValue("内容、服务与合作");
  await expect(logo.getByText("站点 Logo（留空使用站名首字）")).toBeVisible();
  const hero = page.getByRole("region", { name: "首页首屏" });
  const oneLiner = (await hero.getByLabel(/一句话介绍/).boundingBox())!;
  const subtitle = (await hero.getByLabel("副标题（可选）").boundingBox())!;
  expect(subtitle.y).toBeGreaterThan(oneLiner.y + oneLiner.height - 1);
  expect(Math.abs(subtitle.x - oneLiner.x)).toBeLessThan(1);
  const light = (await hero.getByText("首页横幅图 · 浅色模式").boundingBox())!;
  const dark = (await hero.getByText("首页横幅图 · 深色模式").boundingBox())!;
  expect(Math.abs(light.y - dark.y)).toBeLessThan(1);
  await expect(hero.getByRole("checkbox", { name: "显示首页横幅图" })).not.toBeChecked();
  await expect(hero.getByText("已关闭横幅图")).toBeVisible();
  await expect(page.getByRole("heading", { name: "首屏内容与按钮" })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("settings-layout.png"), fullPage: true });
});
