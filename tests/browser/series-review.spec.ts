import { expect, test } from "@playwright/test";
const rows = [
  {
    id: 1,
    version: 1,
    path: "README.md",
    slug: "manual-readme",
    title: "手册介绍",
    access: "public",
  },
  {
    id: 2,
    version: 2,
    path: "第一章.md",
    slug: "manual-one",
    title: "第一章",
    access: "paid",
  },
];
test("whole-series review freezes scope, highlights errors and resolves an unknown request without a second publication", async ({
  page,
}) => {
  let sent = 0;
  let frozen: string | undefined;
  let published = false;
  await page.route("**/api/admin/files", async (route) => {
    const body = route.request().postDataJSON();
    if (body.op === "batchList")
      return route.fulfill({
        json: { total: published ? 0 : 2, items: published ? [] : rows },
      });
    if (body.op === "inventory")
      return route.fulfill({ json: { files: [], assets: [] } });
    if (body.op === "batchPublish") {
      sent++;
      frozen = body.input.request;
      expect(body.input.ids).toEqual([1, 2]);
      expect(body.input.activate).toBe(true);
      expect(body.input.readme).toBe("manual-readme");
      if (sent === 1)
        return route.fulfill({
          json: {
            ok: false,
            message: "本批没有发布任何章节。",
            problems: [{ id: 2, message: "图片需要补插" }],
          },
        });
      published = true;
      return route.abort();
    }
    if (body.op === "batchStatus") {
      expect(body.request).toBe(frozen);
      return route.fulfill({
        json: {
          ok: true,
          message: "已确认发布 2 篇文稿。",
          results: [],
          activated: true,
        },
      });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/admin/series-review");
  const section = page.getByRole("region", { name: "全辑审核与发布" });
  await expect(section.getByText("共 2 篇待发布 · 已选 2 篇")).toBeVisible();
  await section.getByLabel("发布成功后同时上架专辑").check();
  const confirm = section.getByRole("checkbox", { name: /我已核对/ });
  const publish = section.getByRole("button", { name: "发布 2 篇并上架专辑" });
  await expect(publish).toBeDisabled();
  await confirm.check();
  await publish.click();
  await expect(section.getByText("图片需要补插")).toBeVisible();
  await expect(confirm).not.toBeChecked();
  await confirm.check();
  await publish.click();
  await expect(
    section.getByRole("button", { name: "查询本次发布结果" }),
  ).toBeVisible();
  await expect(section.getByLabel("选择 第一章")).toBeDisabled();
  await section.getByRole("button", { name: "查询本次发布结果" }).click();
  await expect(section.getByText("没有待发布更新")).toBeVisible();
  expect(sent).toBe(2);
});
for (const theme of ["light", "dark"] as const)
  for (const width of [1440, 390, 320])
    test(`series review ${theme} ${width}: readable controls and no page overflow`, async ({
      page,
    }, info) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width, height: 950 });
      await page.route("**/api/admin/files", (route) =>
        route.fulfill({
          json:
            route.request().postDataJSON().op === "batchList"
              ? { total: 2, items: rows }
              : { files: [], assets: [] },
        }),
      );
      await page.goto("/admin/series-review");
      await expect(page.getByText("手册介绍", { exact: true })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expect(page.getByText("导入位置", { exact: true })).toHaveCount(0);
      await page.screenshot({
        path: info.outputPath(`series-${theme}-${width}.png`),
        fullPage: true,
      });
    });

test("unsaved album settings block publication until settings are saved", async ({
  page,
}) => {
  await page.route("**/api/admin/files", (route) =>
    route.fulfill({
      json:
        route.request().postDataJSON().op === "batchList"
          ? { total: 2, items: rows }
          : { files: [], assets: [] },
    }),
  );
  await page.goto("/admin/series-review");
  await page
    .getByRole("region", { name: "专辑设置", exact: true })
    .getByLabel("标题", { exact: true })
    .fill("修改后的手册");
  const section = page.getByRole("region", { name: "全辑审核与发布" });
  await expect(
    section.getByRole("checkbox", { name: /我已核对/ }),
  ).toBeDisabled();
  await expect(
    section.getByText("请先保存上方专辑设置，再确认发布。"),
  ).toBeVisible();
});
