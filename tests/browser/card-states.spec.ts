import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`${theme} cards preserve geometry and expose all interaction layers`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.goto("/card-states");
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    const links = page.locator(".opc-content-link");
    await expect(links).toHaveCount(4);
    for (const kind of ["article", "collection", "service", "event"]) {
      const link = page.locator(`[data-card-kind="${kind}"]`);
      const surface = link.locator(".opc-content-card");
      const cover = surface.locator(".opc-content-card-cover");
      const original = await surface.boundingBox();
      const coverBox = await cover.boundingBox();
      expect(original).not.toBeNull();
      expect(coverBox).not.toBeNull();
      expect(coverBox!.width).toBeCloseTo(original!.width, 1);
      expect(coverBox!.x).toBeCloseTo(original!.x, 1);
      expect(coverBox!.y).toBeCloseTo(original!.y, 1);
      await expect(cover).toHaveCSS("height", "120px");
      await expect(surface).toHaveCSS("box-shadow", "none");
      await expect(surface.locator(".opc-content-card-title")).toHaveCSS(
        "font-size",
        "14px",
      );
      await expect(
        surface.locator(".opc-content-card-action > span"),
      ).toHaveCSS("opacity", "0");
      await link.screenshot({
        path: info.outputPath(`${kind}-${theme}-default.png`),
      });

      await link.hover();
      await expect(
        surface.locator(".opc-content-card-action > span"),
      ).toHaveCSS("opacity", "1");
      const hovered = await surface.evaluate((element) => ({
        stroke: getComputedStyle(element, "::before").backgroundImage,
        shadow: getComputedStyle(element).boxShadow,
        title: getComputedStyle(element.querySelector("h3")!).color,
        primary: getComputedStyle(element).getPropertyValue("--primary").trim(),
        border: getComputedStyle(element, "::before").paddingTop,
      }));
      expect(hovered.stroke).toContain("linear-gradient(40deg");
      expect(hovered.shadow).not.toBe("none");
      await link.screenshot({
        path: info.outputPath(`${kind}-${theme}-hover.png`),
      });
      expect(await surface.boundingBox()).toEqual(original);

      await page.mouse.down();
      await expect
        .poll(() =>
          surface.evaluate(
            (element) => getComputedStyle(element, "::before").paddingTop,
          ),
        )
        .toBe("2px");
      const pressed = await surface.evaluate((element) => ({
        border: getComputedStyle(element, "::before").paddingTop,
        shadow: getComputedStyle(element, "::after").boxShadow,
        background: getComputedStyle(element).backgroundColor,
        active: element.closest("a")!.matches(":active"),
        stroke: getComputedStyle(element).getPropertyValue("--opc-card-stroke"),
      }));
      expect(pressed).toMatchObject({
        border: "2px",
        active: true,
        stroke: "2px",
      });
      expect(pressed.shadow).toContain("inset");
      expect(pressed.background).toBe(
        theme === "light" ? "rgb(255, 255, 255)" : "rgb(13, 19, 13)",
      );
      expect(await surface.boundingBox()).toEqual(original);
      await link.screenshot({
        path: info.outputPath(`${kind}-${theme}-pressed.png`),
      });
      // Release outside the link so the test never navigates to a product flow.
      await page.mouse.move(1, 1);
      await page.mouse.up();

      await link.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(link).toBeFocused();
      await expect(link).toHaveCSS("outline-style", "solid");
      await expect(link).toHaveCSS("outline-width", "2px");
      await link.screenshot({
        path: info.outputPath(`${kind}-${theme}-focus.png`),
      });
      await link.blur();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

  test(`${theme} cards remain readable at 320px`, async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.goto("/card-states");
    await expect(page.locator(".opc-content-link")).toHaveCount(4);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`cards-${theme}-320.png`),
      fullPage: true,
    });
  });
}
