import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`pricing preserves its hierarchy and purchase boundary in ${theme}`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/p/pricing");
    const plans = page.locator(".pricing-plan");
    await expect(plans).toHaveCount(3);
    const publicPlan = page.getByRole("region", {
      name: "公开阅读",
      exact: true,
    });
    const subscription = page.getByRole("region", {
      name: "年度订阅",
      exact: true,
    });
    const individual = page.getByRole("region", {
      name: "按篇／专辑购买",
      exact: true,
    });
    const publicBox = await publicPlan.boundingBox();
    const annualBox = await subscription.boundingBox();
    const individualBox = await individual.boundingBox();
    expect(publicBox && annualBox && individualBox).toBeTruthy();
    expect(publicBox!.x).toBeLessThan(annualBox!.x);
    expect(annualBox!.x).toBeLessThan(individualBox!.x);
    await expect(
      subscription.locator(".pricing-plan__price strong"),
    ).toHaveText("¥99");
    await expect(
      subscription.locator(".pricing-plan__price > span"),
    ).toHaveText("/ 年");
    await expect(subscription.locator(".pricing-plan__price strong")).toHaveCSS(
      "font-size",
      "30px",
    );
    await expect(
      subscription.getByRole("button", { name: "购买年度订阅" }),
    ).toBeDisabled();
    await expect(subscription.getByText("暂未开通在线收款。")).toBeVisible();
    await expect(
      subscription.getByText("到期自主续购，不自动扣款"),
    ).toBeVisible();
    await expect(subscription.locator(".pricing-plan__badge")).toHaveText(
      "年度方案",
    );
    const service = page.getByRole("region", { name: "服务合作", exact: true });
    const serviceBox = await service.boundingBox();
    expect(serviceBox!.y).toBeGreaterThan(annualBox!.y + annualBox!.height);
    await expect(
      service.getByRole("link", { name: "查看服务与合作方式" }),
    ).toHaveAttribute("href", "/services");
    await page.screenshot({
      path: info.outputPath(`pricing-${theme}-desktop.png`),
      fullPage: true,
    });

    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto("/p/pricing");
    await expect
      .poll(async () => {
        const [one, two] = await Promise.all([
          publicPlan.boundingBox(),
          subscription.boundingBox(),
        ]);
        return !!one && !!two && two.y >= one.y + one.height;
      })
      .toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const mobileNavigation = page.getByRole("navigation", {
      name: "移动主导航",
    });
    await expect(mobileNavigation).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();
    await page.screenshot({
      path: info.outputPath(`pricing-${theme}-mobile-top.png`),
    });

    const finalFaq = page.getByRole("heading", {
      name: "在哪里查看已购权益？",
      exact: true,
    });
    const finalSection = page.locator(".cp-section").filter({
      has: page.getByRole("heading", {
        name: "还不确定从哪里开始？",
        exact: true,
      }),
    });
    const finalEntry = finalSection.getByRole("link", {
      name: "查看内容专辑",
      exact: true,
    });
    await finalFaq.scrollIntoViewIfNeeded();
    await finalEntry.scrollIntoViewIfNeeded();
    await expect(finalFaq).toBeInViewport();
    await expect(finalEntry).toBeInViewport({ ratio: 1 });
    await expect(finalEntry).toHaveAttribute("href", "/handbooks");
    const entryBox = await finalEntry.boundingBox();
    const navigationBox = await mobileNavigation.boundingBox();
    expect(entryBox && navigationBox).toBeTruthy();
    expect(entryBox!.y).toBeGreaterThanOrEqual(0);
    expect(entryBox!.y + entryBox!.height).toBeLessThanOrEqual(
      navigationBox!.y,
    );
    expect(
      await finalEntry.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        return !!hit && element.contains(hit);
      }),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`pricing-${theme}-mobile-final-faq-cta.png`),
    });
  });
}

test("pricing never offers an unconfigured subscription and sends only its SKU when ready", async ({
  page,
}) => {
  await page.goto("/p/pricing-config");
  const subscription = page.getByRole("region", {
    name: "年度订阅",
    exact: true,
  });
  await expect(subscription.locator(".pricing-plan__price strong")).toHaveText(
    "未配置",
  );
  await expect(subscription.locator(".pricing-plan__badge")).toHaveCount(0);
  await expect(
    subscription.getByRole("button", { name: "购买年度订阅" }),
  ).toBeDisabled();
  await expect(subscription.getByText("站主尚未设置订阅方案。")).toBeVisible();

  await page.goto("/p/pricing-config?configured=yes");
  await expect(subscription.locator(".pricing-plan__price strong")).toHaveText(
    "¥299.50",
  );
  const purchase = subscription.getByRole("button", { name: "购买年度订阅" });
  await expect(purchase).toBeEnabled();
  const submitted = new Promise<unknown>((resolve) => {
    void page.route("**/api/orders", async (route) => {
      resolve(route.request().postDataJSON());
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "隔离测试：未发起真实订单" }),
      });
    });
  });
  await purchase.click();
  expect(await submitted).toEqual({ sku_type: "subscription" });
  await expect(subscription.getByRole("alert")).toHaveText(
    "隔离测试：未发起真实订单",
  );
});
