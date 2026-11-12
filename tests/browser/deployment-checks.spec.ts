import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 1440])
    test(`deployment checks: keyboard acceptance at ${width}px in ${theme}`, async ({ page }, info) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (/hydration|didn't match|does not match/i.test(message.text())) errors.push(message.text());
      });
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.goto("/admin/setup");
      const mail = page.getByRole("region", { name: "邮件：登录与业务通知" });
      await expect(mail).toContainText("缺少：EMAIL_FROM");
      await expect(mail).toContainText("登录验证码由 Supabase SMTP");
      const base = page.getByRole("region", { name: "人工确认：基础站点验收" });
      const summary = base.locator("summary").first();
      await summary.focus();
      await page.keyboard.press("Enter");
      await expect(base.locator("details").first()).toHaveAttribute("open", "");
      await expect(base.getByText(/在无痕窗口打开首页/)).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(base.locator("details").first()).not.toHaveAttribute("open", "");
      const payment = page.getByRole("region", { name: "可选：支付收款" });
      await expect(payment.locator("details")).toHaveCount(0);
      await expect(payment).toContainText("未启用");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.content()).not.toContain("private-fixture-only");
      await page.screenshot({ path: info.outputPath(`setup-${theme}-${width}.png`), fullPage: true });
      expect(errors).toEqual([]);
    });
