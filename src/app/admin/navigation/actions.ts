"use server";
import { revalidatePath } from "next/cache";
import { getAdminIdentity } from "@/lib/admin/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validateNavItems } from "@/lib/navigation/validate";

export type NavigationSaveState = { ok: boolean; message: string; version?: string };

/** 整表保存：服务端校验 → 乐观版本比对与替换同一事务（save_nav_items）→ revalidate 外壳。 */
export async function saveNavigationAction(
  _previous: NavigationSaveState,
  form: FormData,
): Promise<NavigationSaveState> {
  if (!(await getAdminIdentity()).owner) return { ok: false, message: "需要站主身份" };
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("items") ?? ""));
  } catch {
    return { ok: false, message: "导航数据无效，请刷新后重试。" };
  }
  const checked = validateNavItems(raw);
  if (!checked.ok) return checked;
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("save_nav_items", {
    p_expected: String(form.get("version") ?? ""),
    p_items: checked.items,
  });
  if (error || !data || typeof data.ok !== "boolean")
    return { ok: false, message: "导航未保存：请确认数据库补丁已应用，刷新后重试。" };
  if (!data.ok) return { ok: false, message: String(data.message ?? "导航未保存，请刷新后重试。") };
  revalidatePath("/", "layout");
  return { ok: true, message: String(data.message), version: String(data.version) };
}
