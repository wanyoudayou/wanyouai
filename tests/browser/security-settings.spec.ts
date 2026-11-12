import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) for (const width of [320, 1440]) {
  test(`security settings: ${theme} at ${width}px keeps input private and fits the viewport`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/admin/security");
    const secret = page.getByLabel("Secret Key", { exact: true });
    await expect(secret).toHaveAttribute("type", "password");
    await expect(secret).toHaveValue("");
    await secret.fill("synthetic-unsaved-private-key");
    await page.getByLabel("Site Key", { exact: true }).fill("replacement-site-key");
    await page.emulateMedia({ colorScheme: theme === "light" ? "dark" : "light" });
    await expect(secret).toHaveValue("synthetic-unsaved-private-key");
    await expect(page.getByLabel("Site Key", { exact: true })).toHaveValue("replacement-site-key");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("anonymous inquiry: widget token is sent once, failure keeps fields and requires a new challenge", async ({ page }) => {
  await page.route("https://challenges.cloudflare.com/**", route => route.fulfill({ contentType: "application/javascript", body: `window.turnstile={render(host,opts){const b=document.createElement('button');b.type='button';b.textContent='完成测试校验';b.onclick=()=>opts.callback('synthetic-token');host.appendChild(b);return 'synthetic-widget';},remove(){}};` }));
  const payloads: Record<string, unknown>[] = [];
  await page.route("**/api/services/inquire", async route => {
    payloads.push(route.request().postDataJSON());
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "测试拒绝，保留输入" }) });
  });
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.goto("/inquiry");
  await page.getByLabel(/需求描述/).fill("这是需要保留的合成服务询价需求文本。");
  await page.getByLabel(/联系邮箱/).fill("fixture@example.test");
  const submit = page.getByRole("button", { name: "提交询价", exact: true });
  await expect(submit).toBeDisabled();
  await page.getByRole("button", { name: "完成测试校验" }).click();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.locator('form [role="alert"]')).toContainText("保留输入");
  expect(payloads).toHaveLength(1);
  expect(payloads[0].turnstile_token).toBe("synthetic-token");
  await expect(page.getByLabel(/需求描述/)).toHaveValue("这是需要保留的合成服务询价需求文本。");
  await expect(submit).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
