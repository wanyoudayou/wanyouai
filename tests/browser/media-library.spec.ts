import { expect, test } from "@playwright/test";
const path = `/media/library/${"a".repeat(64)}.png`;
const asset = {
  id: "00000000-0000-4000-8000-000000000099",
  name: "示例图片.png",
  alt: "可读的图片说明",
  url: path,
  storage_path: path.slice(1),
  sha256: "a".repeat(64),
  mime_type: "image/png",
  byte_size: 100,
  width: 3,
  height: 2,
  archived: false,
  created_at: "2026-10-18T00:00:00Z",
};
test.beforeEach(async ({ page }) => {
  await page.route("**/media/library/*.png", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1kAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.route("**/api/admin/media**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET") {
      const pageNo = Number(url.searchParams.get("page") || 1);
      return route.fulfill({
        json: {
          items: [
            { ...asset, name: pageNo === 2 ? "第二页图片.png" : asset.name },
          ],
          total: 21,
          query: {
            q: url.searchParams.get("q") || "",
            status: "ready",
            type: "",
            sort: "newest",
            page: pageNo,
            pageSize: 20,
            series: "",
          },
        },
      });
    }
    return route.fulfill({ json: { asset } });
  });
});
for (const width of [320, 1440])
  test(`picker retains draft, returns focus and inserts canonical references at ${width}px`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: width === 320 ? "dark" : "light" });
    await page.goto("/admin/content");
    await page.getByLabel("标题", { exact: true }).fill("草稿不丢失");
    const cover = page.getByRole("button", {
      name: "从素材库选择",
      exact: true,
    });
    await cover.click();
    const dialog = page.getByRole("dialog", { name: "选择图片素材" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: /示例图片/ }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`picker-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(cover).toBeFocused();
    await cover.click();
    await dialog.getByRole("button", { name: /示例图片/ }).click();
    await expect(
      page.getByLabel("封面图片地址（可选）", { exact: true }),
    ).toHaveValue(path);
    await expect(page.getByLabel("标题", { exact: true })).toHaveValue(
      "草稿不丢失",
    );
    await page.getByRole("button", { name: "从素材库插入正文" }).click();
    await dialog.getByRole("button", { name: /示例图片/ }).click();
    await expect(page.locator(".cm-content")).toContainText(path);
    expect(errors).toEqual([]);
  });
test("catalog preserves pagination in URL and distinguishes read failure from an empty library", async ({
  page,
}) => {
  await page.goto("/admin/media");
  await expect(page.getByRole("button", { name: /示例图片/ })).toBeVisible();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole("button", { name: /第二页图片/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /第二页图片/ })).toBeVisible();
  await page.route("**/api/admin/media**", (route) =>
    route.fulfill({ status: 503, json: { message: "unavailable" } }),
  );
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByText("0 张图片", { exact: true })).toHaveCount(0);
});
test("an image above the Vercel request limit goes directly to private Storage and a lost finish response reuses its upload ID", async ({
  page,
}) => {
  let firstFinish = true,
    uploads = 0;
  const ids: string[] = [];
  await page.route("**/api/admin/media**", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          items: [],
          total: 0,
          query: {
            q: "",
            status: "ready",
            type: "",
            sort: "newest",
            page: 1,
            pageSize: 20,
            series: "",
          },
        },
      });
    const body = route.request().postDataJSON();
    expect(route.request().postDataBuffer()!.byteLength).toBeLessThan(2000);
    if (body.op === "prepare") {
      ids.push(body.id);
      if (ids.length > 1)
        return route.fulfill({ json: { asset, sourceHash: "a".repeat(64) } });
      return route.fulfill({
        json: {
          id: body.id,
          signedUrl: `http://127.0.0.1:1/storage/v1/object/upload/sign/media-uploads/owner/${body.id}?token=fixture`,
        },
      });
    }
    if (firstFinish) {
      firstFinish = false;
      return route.fulfill({
        status: 503,
        json: { message: "确认响应丢失，请重试" },
      });
    }
    return route.fulfill({ json: { asset, sourceHash: "a".repeat(64) } });
  });
  await page.route(
    "http://127.0.0.1:1/storage/v1/object/upload/sign/**",
    async (route) => {
      if (route.request().method() === "OPTIONS")
        return route.fulfill({
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "PUT",
            "access-control-allow-headers": "content-type,apikey",
          },
        });
      expect(route.request().method()).toBe("PUT");
      expect(route.request().postDataBuffer()!.byteLength).toBe(
        6 * 1024 * 1024,
      );
      uploads++;
      return route.fulfill({
        status: uploads === 1 ? 200 : 409,
        headers: { "access-control-allow-origin": "*" },
        json: {},
      });
    },
  );
  await page.goto("/admin/media");
  const file = {
    name: "large.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(6 * 1024 * 1024, 1),
  };
  await page.getByLabel("上传素材图片").setInputFiles(file);
  await expect(
    page.getByText("确认响应丢失，请重试", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("上传素材图片").setInputFiles(file);
  await expect(
    page.getByText("已上传并校验 1 张图片。", { exact: true }),
  ).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  expect(uploads).toBe(1);
});
