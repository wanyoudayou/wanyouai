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
      theme === "light" ? "rgb(45, 42, 69)" : "rgb(217, 242, 224)",
    );
    await expect(page.locator(".opc-hero__input")).toHaveCSS(
      "color",
      theme === "light" ? "rgb(45, 42, 69)" : "rgb(217, 242, 224)",
    );
    await page.getByLabel("向站主的分身提问").fill("切换横幅时保留的问题");
    const opposite = theme === "light" ? "dark" : "light";
    const appearance = page.getByRole("button", { name: /^外观：/ });
    await appearance.click();
    if (opposite === "dark") await appearance.click();
    await expect(page.locator(`.opc-hero__image--${opposite}`)).toBeVisible();
    await expect(page.getByLabel("向站主的分身提问")).toHaveValue("切换横幅时保留的问题");
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
