import { requireOwner } from "@/lib/admin/detail";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveTurnstilePublic, validTurnstileKey } from "@/lib/turnstile-config";
import { SecuritySettingsForm } from "@/components/admin/security-settings-form";

export const metadata = { title: "安全与人机校验", robots: { index: false, follow: false } };
export default async function SecurityPage() {
  await requireOwner();
  const client = await createSupabaseServerClient();
  const [{ data: site, error }, { data: key, error: keyError }] = await Promise.all([
    client.from("site_config").select("updated_at,turnstile_config").eq("id", 1).single(),
    client.from("site_secrets").select("key").eq("key", "turnstile_secret_key").maybeSingle(),
  ]);
  if (error || keyError || !site) throw new Error("人机校验配置暂时不可用");
  const config = resolveTurnstilePublic(site.turnstile_config);
  const canMigrate = config.source === "environment" && validTurnstileKey(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "") && validTurnstileKey(process.env.TURNSTILE_SECRET_KEY ?? "");
  return <section className="mx-auto max-w-3xl space-y-6 p-6">
    <h1 className="text-2xl font-semibold">安全与人机校验</h1>
    <p className="text-sm text-muted-foreground">在 Cloudflare → Turnstile 创建 Managed widget，添加本站域名，再填写下方密钥对。Site Key 允许公开；Secret Key 仅用于服务端校验。</p>
    <SecuritySettingsForm config={config} updated={site.updated_at} keySet={!!key} canMigrate={canMigrate} />
  </section>;
}
