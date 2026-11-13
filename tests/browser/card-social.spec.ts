import { expect, test } from "@playwright/test";

test("card social links use the site's line icons and keep text labels", async ({ page }) => {
  await page.goto("/card-social");
  const platforms = ["x", "github", "xiaohongshu", "xiaoyuzhou", "wechat-official", "custom"];
  for (const platform of platforms) {
    const icon = page.locator(`[data-social-icon="${platform}"]`);
    await expect(icon).toHaveCount(1);
    await expect(icon).toHaveAttribute("aria-hidden", "true");
    await expect(icon.locator("svg.lucide")).toHaveCount(1);
  }
  // 图标是装饰：链接名称来自平台名、显示名与补充说明。
  await expect(page.getByRole("link", { name: /GitHub\s*example\s*开源项目/ })).toHaveAttribute("href", "https://github.com/example");
  await expect(page.getByRole("link", { name: /小红书\s*示例站主/ })).toBeVisible();
});
