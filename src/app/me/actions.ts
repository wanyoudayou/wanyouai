"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getUserIdentity } from "@/lib/account/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signOutUser() {
  const client = await createSupabaseServerClient();
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) throw new Error("退出失败，请重试");
  revalidatePath("/", "layout");
  redirect("/login");
}

/** 更新个人昵称：空 = 清除（回落邮箱前缀）；RLS 行级 + 列级授权双闸。 */
export async function updateDisplayName(_previous: { ok: boolean; message: string }, form: FormData) {
  const { user } = await getUserIdentity();
  if (!user) return { ok: false, message: "请先登录" };
  const name = String(form.get("display_name") ?? "").trim();
  if (name.length > 40) return { ok: false, message: "昵称不超过 40 字" };
  const client = await createSupabaseServerClient();
  // 昵称更新统一走受限 RPC：函数内校验当事人、补齐缺失资料，避免列权限与 RLS 组合造成写入失败。
  const { data, error } = await client.rpc("set_display_name", { p_name: name || null });
  const result = data as { ok: boolean; message: string } | null;
  if (error || !result?.ok) {
    console.error("[me] 昵称保存失败：", error?.message ?? result?.message ?? "unknown");
    return { ok: false, message: result?.message && !error ? result.message : "保存失败，请稍后再试" };
  }
  revalidatePath("/me");
  return { ok: true, message: name ? `昵称已更新为「${name}」` : "已清除昵称，显示邮箱前缀" };
}
