"use server";
import { revalidatePath } from "next/cache";
import { getAdminIdentity } from "@/lib/admin/session";
import { saveCustomPage, previewCustomHtml } from "@/lib/admin/pages";

/** 保存自定义页（新建/更新）。 */
export async function savePageAction(
  _previous: { message: string; ok: boolean },
  form: FormData,
) {
  if (!(await getAdminIdentity()).owner)
    return { ok: false, message: "需要站主身份" };
  const status = String(form.get("status") ?? "draft");
  const placement = String(form.get("placement") ?? "none");
  if (
    !["draft", "published", "archived"].includes(status) ||
    !["nav", "footer", "none"].includes(placement)
  )
    return { ok: false, message: "状态或发布位置无效。" };
  try {
    const saved = await saveCustomPage(
      {
        id: Number(form.get("id")) || undefined,
        slug: String(form.get("slug") ?? "").trim(),
        title: String(form.get("title") ?? ""),
        description: String(form.get("description") ?? "") || null,
        html: String(form.get("html") ?? ""),
        status: status as "draft" | "published" | "archived",
        nav_label: String(form.get("nav_label") ?? "") || null,
        nav_order: Number(form.get("nav_order")) || 0,
        placement: placement as "nav" | "footer" | "none",
      },
      String(form.get("updated_at") ?? "") || undefined,
    );
    revalidatePath("/", "layout");
    return { ok: true, message: "已保存。", id: saved.id };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

/** 编辑器预览：返回净化后的 HTML（与保存/前台渲染同一管线）。 */
export async function previewPageHtml(html: string) {
  if (!(await getAdminIdentity()).owner)
    return { ok: false as const, html: "" };
  return { ok: true as const, html: previewCustomHtml(html) };
}

export async function loadPageForCopy(slug: string) {
  if (
    !(await getAdminIdentity()).owner ||
    !/^[a-z0-9][a-z0-9-]{0,60}$/.test(slug)
  )
    return { ok: false, html: "" };
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const { data, error } = await (await createSupabaseServerClient())
    .from("custom_pages")
    .select("html")
    .eq("slug", slug)
    .maybeSingle();
  return error || !data
    ? { ok: false, html: "" }
    : { ok: true, html: previewCustomHtml(data.html) };
}
