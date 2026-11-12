import { generationReady } from "@/lib/ai/settings";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { redirect } from "next/navigation";
import { getAdminIdentity } from "@/lib/admin/session";
import { getSiteConfig } from "@/lib/get-site-config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SettingsForm } from "@/components/admin/settings-form";
import { listCustomPages } from "@/lib/admin/pages";
import { zpayConfigFromEnv } from "@/lib/payments/zpay";
export const metadata = {
  title: "站点配置",
  robots: { index: false, follow: false },
};
export default async function SettingsPage() {
  if (!(await getAdminIdentity()).owner) redirect("/admin");
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("site_config")
    .select("updated_at")
    .eq("id", 1)
    .single();
  if (error || !data) throw new Error("站点配置暂时不可用");
  const aiReady = await generationReady(createSupabaseServiceClient());
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <h1 className="text-2xl font-medium">站点配置</h1>
      <AdminTabs active="settings" />
      <SettingsForm
        site={await getSiteConfig(true)}
        updated={data.updated_at}
        zpayReady={zpayConfigFromEnv(process.env) !== null}
        avatarKeySet={aiReady}
        customPages={(await listCustomPages()).map((p) => ({
          slug: p.slug,
          title: p.title,
        }))}
      />
    </div>
  );
}
