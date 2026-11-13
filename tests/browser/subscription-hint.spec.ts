import { expect, test } from "@playwright/test";

test("subscription hint adds an icon and monthly line to every subscription button", async ({ page }) => {
  await page.goto("/p/subscription-hint");
  const lines = page.locator("[data-subscription-hint]");
  await expect(lines).toHaveCount(3);
  for (const line of await lines.all()) await expect(line).toHaveText("约 ¥8.25 / 月 · 约每月一杯美式");
  await expect(page.locator("[data-subscription-hint-icon=coffee]")).toHaveCount(3);
  // 图标是装饰：按钮的可访问名称仍只有文字。
  await expect(page.getByRole("button", { name: "订阅 ¥99 / 年", exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "购买年度订阅", exact: true })).toBeVisible();
  // 单买按钮不受影响。
  await expect(page.getByRole("button", { name: "购买本篇", exact: true }).locator("svg")).toHaveCount(0);

  await page.goto("/p/subscription-hint?hint=no");
  await expect(page.locator("[data-subscription-hint]")).toHaveCount(0);
  await expect(page.locator("[data-subscription-hint-icon]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "订阅 ¥99 / 年", exact: true })).toHaveCount(2);
});
