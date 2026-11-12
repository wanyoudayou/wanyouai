"use server";
import { getAdminIdentity } from "@/lib/admin/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseSiteSettings } from "@/lib/admin/settings-input";
import { revalidatePath } from "next/cache";
export async function saveSettings(
  _previous: { message: string },
  form: FormData,
) {
  if (!(await getAdminIdentity()).owner) return { message: "需要站主身份" };
  let input;
  try {
    input = parseSiteSettings(form);
  } catch (error) {
    return { message: (error as Error).message };
  }
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .from("site_config")
      .update(input)
      .eq("id", 1)
      .eq("updated_at", String(form.get("updated") ?? ""))
      .select("id");
    if (error || !data?.length)
      return { message: "保存失败或配置已更新，请刷新确认后重试。" };
    revalidatePath("/", "layout");
    return { message: "站点配置已保存。" };
  } catch {
    return { message: "保存中断，请刷新确认状态后重试。" };
  }
}
