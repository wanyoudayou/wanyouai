"use server";
import { revalidatePath } from "next/cache";
import { getAdminIdentity } from "@/lib/admin/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validTurnstileKey } from "@/lib/turnstile-config";

export type SecurityFormState = { message: string; updated?: string };
export async function saveSecuritySettings(_state: SecurityFormState, form: FormData): Promise<SecurityFormState> {
  try {
    if (!(await getAdminIdentity()).owner) return { message: "需要站主身份" };
    const migrate = form.get("intent") === "migrate";
    const siteKey = (migrate ? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "" : String(form.get("site_key") ?? "")).trim();
    const secret = (migrate ? process.env.TURNSTILE_SECRET_KEY ?? "" : String(form.get("secret_key") ?? "")).trim();
    const enabled = migrate || form.get("enabled") === "on";
    const clear = !migrate && form.get("clear_secret") === "on";
    if ((siteKey && !validTurnstileKey(siteKey)) || (secret && !validTurnstileKey(secret)) || (migrate && (!siteKey || !secret))) {
      return { message: "请填写同一 Turnstile widget 的 Site Key 与 Secret Key。" };
    }
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("save_turnstile_settings", {
      p_expected: String(form.get("updated") ?? ""), p_enabled: enabled,
      p_site_key: siteKey, p_secret: secret, p_clear: clear,
    });
    if (error) {
      if (error.message.includes("SETTINGS_CONFLICT")) return { message: "未保存：配置已更新，请刷新后核对。" };
      if (error.message.includes("TURNSTILE_NEW_PAIR_REQUIRED")) return { message: "更换 Site Key 时，请同时填写对应的 Secret Key。" };
      if (error.message.includes("TURNSTILE_PAIR_REQUIRED")) return { message: "开启人机校验前须填写完整密钥对；删除密钥时请先关闭。" };
      return { message: "保存未完成，请刷新确认状态；输入内容已保留。" };
    }
    revalidatePath("/", "layout");
    return { message: "人机校验配置已保存，立即对新请求生效。", updated: data.updated_at };
  } catch { return { message: "保存结果暂时无法确认，请刷新核对后再操作。" }; }
}
