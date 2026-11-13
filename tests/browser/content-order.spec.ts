import { expect, test } from "@playwright/test";

test("chapter order moves locally, can be discarded, and delete asks for confirmation", async ({ page }) => {
  await page.goto("/admin/content-order");
  const order = page.getByRole("region", { name: "章节顺序" });
  const titles = order.locator("li span.truncate");
  await expect(titles).toHaveText(["功能与使用方式", "名片、导航与收费方案", "Skill 发布与在线运行"]);
  const save = order.getByRole("button", { name: "保存顺序" });
  await expect(save).toBeDisabled();
  await expect(order.getByRole("button", { name: "上移「功能与使用方式」" })).toBeDisabled();
  await order.getByRole("button", { name: "上移「Skill 发布与在线运行」" }).click();
  await expect(titles).toHaveText(["功能与使用方式", "Skill 发布与在线运行", "名片、导航与收费方案"]);
  await expect(save).toBeEnabled();
  await order.getByRole("button", { name: "放弃调整" }).click();
  await expect(titles).toHaveText(["功能与使用方式", "名片、导航与收费方案", "Skill 发布与在线运行"]);
  await expect(save).toBeDisabled();

  const remove = page.getByRole("region", { name: "删除内容" }).first();
  await remove.getByRole("button", { name: "删除这篇内容" }).click();
  await expect(remove.getByRole("button", { name: "确认删除" })).toBeVisible();
  await expect(remove.getByRole("checkbox")).not.toBeChecked();
  await remove.getByRole("button", { name: "取消" }).click();
  await expect(remove.getByRole("button", { name: "删除这篇内容" })).toBeVisible();
  const paid = page.getByTestId("paid");
  await expect(paid.getByText("付费或订阅内容不能删除")).toBeVisible();
  await expect(paid.getByRole("button")).toHaveCount(0);
});
