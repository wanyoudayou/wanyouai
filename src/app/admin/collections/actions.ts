"use server";
import { revalidatePath } from "next/cache";
import { getAdminIdentity } from "@/lib/admin/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export async function saveSeriesSettings(
  _state: { message: string },
  form: FormData,
) {
  try {
    if (!(await getAdminIdentity()).owner) return { message: "需要站主身份" };
    const title = String(form.get("title") ?? "").trim(),
      task = String(form.get("task") ?? "").trim(),
      navLabel = String(form.get("nav_label") ?? "").trim();
    const order = Number(form.get("nav_order"));
    const list = (name: string) => [
      ...new Set(
        String(form.get(name) ?? "")
          .split(/[,，]/)
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    ];
    const tags = list("tags"),
      audiences = list("audiences");
    if (
      !title ||
      title.length > 200 ||
      task.length > 300 ||
      navLabel.length > 80 ||
      !Number.isInteger(order) ||
      Math.abs(order) > 10000 ||
      [...tags, ...audiences].some((v) => v.length > 50) ||
      tags.length > 20 ||
      audiences.length > 20
    )
      return { message: "请检查标题、简介、标签和目录顺序。" };
    const client = await createSupabaseServerClient();
    const price = String(form.get("price") ?? "0");
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(price)) return { message: "价格需为 0–999999.99，最多两位小数。" };
    const { data, error } = await client.rpc("save_series_settings", {
      p_id: Number(form.get("id")), p_expected: String(form.get("updated")),
      p_values: { title, task, tags, audiences, nav_enabled: form.has("nav_enabled"),
        nav_label: navLabel, nav_order: order, featured: form.has("featured"), price,
        readme_article_id: form.get("readme_article_id") || null },
    });
    if (error || !data?.ok) return { message: data?.message ?? "未保存：请确认数据库补丁已应用，刷新后重试。" };
    revalidatePath("/", "layout");
    return { message: "专辑设置已保存；正文与上架状态未改变。" };
  } catch {
    return { message: "保存暂时不可用，请保留修改并重试。" };
  }
}
