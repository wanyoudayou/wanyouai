"use server";
import { getAdminIdentity } from "@/lib/admin/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseService } from "@/lib/admin/service-input";
import { revalidatePath } from "next/cache";
export async function saveService(
  _previous: { message: string },
  form: FormData,
) {
  try {
    if (!(await getAdminIdentity()).owner) return { message: "需要站主身份" };
    const client = await createSupabaseServerClient();
    const id = String(form.get("id") ?? "");
    let current = "draft";
    let originalSlug: string | null = null;
    if (id) {
      if (!/^\d+$/.test(id)) return { message: "无效服务编号。" };
      const { data, error } = await client
        .from("services")
        .select("status,slug")
        .eq("id", id)
        .single();
      if (error || !data) return { message: "服务不存在。" };
      current = data.status;
      originalSlug = data.slug;
    }
    let input;
    try {
      input = parseService(form, current);
    } catch (error) {
      return { message: (error as Error).message };
    }
    if (originalSlug && originalSlug !== input.slug)
      return { message: "已有服务的网址标识不可更改。" };
    const result = id
      ? await client
          .from("services")
          .update(input)
          .eq("id", id)
          .eq("updated_at", String(form.get("updated") ?? ""))
          .select("id")
      : await client.from("services").insert(input).select("id");
    if (result.error?.code === "23505")
      return { message: "网址标识已存在，请查看已有服务。" };
    if (result.error || !result.data?.length)
      return { message: "保存失败或服务已更新，请刷新后重试。" };
    revalidatePath("/", "layout");
    return { message: "服务已保存。", id: Number(result.data[0].id) };
  } catch {
    return { message: "保存中断，请刷新确认状态后重试。" };
  }
}
