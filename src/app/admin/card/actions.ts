"use server";
import { getAdminIdentity } from "@/lib/admin/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mergeIdentity, parseCardSettings } from "@/lib/admin/settings-input";
import { revalidatePath } from "next/cache";

type CardSaveState = { message: string; updated: string };

export async function saveCardSettings(previous: CardSaveState, form: FormData): Promise<CardSaveState> {
  let owner: boolean;
  try { owner = (await getAdminIdentity()).owner; }
  catch { return { ...previous, message: "暂时无法验证登录或站主身份，请检查网络后重试；本次没有保存。" }; }
  if (!owner) return { ...previous, message: "需要站主身份" };
  let input;
  try { input = parseCardSettings(form); } catch (error) { return { ...previous, message: (error as Error).message }; }
  try {
    const client = await createSupabaseServerClient();
    const updated = String(form.get("updated") ?? "");
    // 站名、Logo 与一句话由站点配置页维护：按版本读出 identity 后只合并名片页的键。
    const current = await client.from("site_config").select("identity").eq("id", 1).eq("updated_at", updated).maybeSingle();
    if (current.error) return { ...previous, message: "保存结果暂时无法确认，请刷新页面核对当前内容后再操作。" };
    if (!current.data) return { ...previous, message: "页面持有的配置版本已失效。请刷新页面核对最新内容后再保存。" };
    const { data, error } = await client.from("site_config").update({ ...input, identity: mergeIdentity(current.data.identity, input.identity) }).eq("id", 1).eq("updated_at", updated).select("updated_at");
    if (error) return { ...previous, message: "保存结果暂时无法确认，请刷新页面核对当前内容后再操作。" };
    if (!data?.[0]?.updated_at) return { ...previous, message: "页面持有的配置版本已失效。请刷新页面核对最新内容后再保存。" };
    revalidatePath("/", "layout");
    return { message: "名片配置已保存。", updated: data[0].updated_at };
  } catch { return { ...previous, message: "保存结果暂时无法确认，请刷新页面核对当前内容后再操作。" }; }
}
