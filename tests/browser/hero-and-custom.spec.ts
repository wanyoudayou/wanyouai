import { test, expect } from "@playwright/test";
for (const theme of ["light", "dark"] as const) {
  test(`theme artwork and generated-page hierarchy in ${theme}`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.goto("/");
    const hero = page.getByRole("region", { name: "站点介绍" });
    await expect(hero).toHaveAttribute("data-tone", "theme");
    await expect(hero.locator(`.opc-hero__image--${theme}`)).toBeVisible();
    await expect(hero.locator(`.opc-hero__image--${theme} img`)).toHaveJSProperty("naturalWidth", 1600);
    await expect(hero.locator(".opc-hero__content")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(hero.locator(".opc-hero__content")).toHaveCSS(
      "border-radius",
      "0px",
    );
    await page.screenshot({ path: info.outputPath(`hero-${theme}.png`) });
    await page.goto("/hero-custom");
    await expect(page.locator(`.opc-hero__image--${theme} .opc-hero__image`)).toHaveAttribute(
      "src",
      `/assets/custom-banner.svg?theme=${theme}`,
    );
    await expect(page.locator(`.opc-hero__image--${theme} img`)).toHaveJSProperty("naturalWidth", 1600);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCSS(
      "color",
      theme === "light" ? "rgb(45, 42, 69)" : "rgb(230, 227, 245)",
    );
    const opposite = theme === "light" ? "dark" : "light";
    const appearance = page.getByRole("button", { name: /^外观：/ });
    await appearance.click();
    if (opposite === "dark") await appearance.click();
    await expect(page.locator(`.opc-hero__image--${opposite}`)).toBeVisible();
    if (opposite === "light") await appearance.click();
    await appearance.click();
    await page.goto("/hero-custom?dark=default");
    await expect(page.locator(`.opc-hero__image--${theme} .opc-hero__image`)).toHaveAttribute("src", theme === "light" ? "/assets/custom-banner.svg?theme=light" : "/assets/hero-terminal-wave.svg");
    await page.goto("/p/design-preview");
    await expect(page.locator(".cp-icon svg")).toHaveCount(3);
    await expect(page.locator(".cp-icon").first()).toHaveCSS("width", "38px");
    const action = page.getByRole("link", { name: "查看完整指南" });
    expect(await action.evaluate((el) => getComputedStyle(el).display)).toMatch(
      /^(inline-)?flex$/,
    );
    await expect(action).toHaveCSS("align-items", "center");
    await expect(action).toHaveCSS("min-height", "42px");
    await expect(action.locator("svg")).toHaveCSS("width", "16px");
    const ratio = await page
      .locator(".cp-inverse .cp-card .cp-muted")
      .evaluate((el) => {
        const rgba = (value: string) => {
          const v = value.match(/[\d.]+/g)!.map(Number);
          return [v[0], v[1], v[2], v[3] ?? 1];
        };
        const blend = (front: number[], back: number[]) =>
          front
            .slice(0, 3)
            .map((v, i) => v * front[3] + back[i] * (1 - front[3]));
        const background = (element: Element | null): number[] => {
          if (!element) return [255, 255, 255];
          const color = rgba(getComputedStyle(element).backgroundColor);
          return color[3] === 1
            ? color.slice(0, 3)
            : blend(color, background(element.parentElement));
        };
        const luminance = (rgb: number[]) =>
          rgb
            .map((v) => v / 255)
            .map((v) =>
              v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
            )
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        const back = background(el),
          front = blend(rgba(getComputedStyle(el).color), back),
          a = luminance(front),
          b = luminance(back);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({
      path: info.outputPath(`custom-page-${theme}.png`),
    });
  });
}

test("centred hero: subtitle, chat opens the collapsed panel and focuses the composer", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const hero = page.getByRole("region", { name: "站点介绍" });
  await expect(hero).toHaveAttribute("data-layout", "center");
  await expect(hero.locator(".opc-hero__subtitle")).toHaveText("把经验整理成手册、技能与服务，读者按需阅读与合作。");
  await expect(hero.locator(".opc-hero__text")).toHaveCSS("text-align", "center");
  await expect(hero.getByRole("textbox")).toHaveCount(0);
  // Payment is not enabled in this fixture, so only the chat button renders.
  await expect(hero.getByRole("link", { name: /订阅/ })).toHaveCount(0);
  const composer = page.getByRole("textbox", { name: "向站主的分身提问", exact: true });
  await expect(composer).toHaveCount(0);
  await expect(page.getByRole("button", { name: "展开对话区" })).toBeVisible();
  await hero.getByRole("button", { name: "和我聊聊" }).click();
  await expect(composer).toBeFocused();
  await page.getByRole("button", { name: "收起对话区" }).click();
  await expect(composer).toHaveCount(0);
});

for (const width of [1440, 1100, 390, 320]) {
  test(`left hero with side image at ${width}: actions, hint and parallax`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/hero-layout");
    const hero = page.getByRole("region", { name: "站点介绍" });
    await expect(hero).toHaveAttribute("data-layout", "left");
    await expect(hero.locator(".opc-hero__text")).toHaveCSS("text-align", "left");
    const subscribe = hero.getByRole("link", { name: "订阅 · ¥99 / 年" });
    await expect(subscribe).toHaveAttribute("href", "/p/pricing");
    await expect(subscribe.locator("svg")).toHaveCount(1);
    await expect(hero.getByRole("button", { name: "和我聊聊" })).toBeVisible();
    await expect(hero.getByText("约 ¥8.25 / 月 · 一杯美式的价格")).toBeVisible();
    const picture = hero.getByRole("img", { name: "站点工作台示意图" });
    if (width >= 1100) {
      await expect(picture).toBeVisible();
      const text = (await hero.locator(".opc-hero__text").boundingBox())!;
      const image = (await picture.boundingBox())!;
      expect(image.x).toBeGreaterThan(text.x + text.width - 1);
    } else await expect(picture).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`hero-left-${width}.png`) });
    if (width >= 1100) {
      await page.mouse.wheel(0, 300);
      await expect.poll(() => picture.evaluate((el) => getComputedStyle(el).scale)).not.toBe("1");
    }
  });
}

test("reduced motion keeps the side image still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/hero-layout");
  const picture = page.getByRole("img", { name: "站点工作台示意图" });
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.locator(".opc-hero").evaluate((el) => getComputedStyle(el).getPropertyValue("--opc-hero-p"))).not.toBe("0");
  expect(await picture.evaluate((el) => getComputedStyle(el).scale)).toBe("none");
});

test("without the banner image the hero keeps its content and a faint bottom rule", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/hero-layout");
  const hero = page.getByRole("region", { name: "站点介绍" });
  await expect(hero.locator(".opc-hero__art")).toHaveCount(1);
  await expect(hero).toHaveCSS("border-bottom-width", "0px");
  await page.goto("/hero-layout?banner=off");
  await expect(hero.locator(".opc-hero__art")).toHaveCount(0);
  await expect(hero.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(hero.getByRole("button", { name: "和我聊聊" })).toBeVisible();
  await expect(hero).toHaveCSS("border-bottom-width", "1px");
});
