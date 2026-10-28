import { expect, test } from "@playwright/test";

test("homepage has no technical card controls; public card copying reports actual success", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => { (window as unknown as { copiedCard: string }).copiedCard = text; } } }));
  await page.goto("/");
  await expect(page.getByText(/机器可读|youai\.card/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /复制.*链接/ })).toHaveCount(0);
  await page.goto("/card");
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByLabel("公开名片地址")).not.toBeVisible();
  await page.getByText("供 AI 读取", { exact: true }).click();
  await page.getByRole("button", { name: "复制名片链接", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("名片链接已复制。");
  expect(await page.evaluate(() => (window as unknown as { copiedCard: string }).copiedCard)).toBe("https://example.test/card.json");
  await expect(page.getByText(/youai\.card/)).toHaveCount(0);
});

test("clipboard denial offers a selectable address and never reports copied", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("denied"); } } }));
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/card");
  await page.getByText("供 AI 读取", { exact: true }).click();
  await page.getByRole("button", { name: "复制名片链接", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("无法自动复制，请选中名片地址后手动复制。");
  await expect(page.getByLabel("公开名片地址")).toHaveValue("https://example.test/card.json");
  await expect(page.getByLabel("公开名片地址")).toBeFocused();
  await expect(page.getByRole("button", { name: "已复制", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
