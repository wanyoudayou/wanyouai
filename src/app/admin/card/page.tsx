import { generationReady } from "@/lib/ai/settings";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAdminIdentity } from "@/lib/admin/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSiteConfig } from "@/lib/get-site-config";
import { listCustomPages } from "@/lib/admin/pages";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { CardSettingsForm } from "@/components/admin/card-settings-form";

export const metadata: Metadata = {
  title: "名片配置",
  robots: { index: false, follow: false },
};

/** 名片配置（/admin/card）：名片基础、联系与约束、自媒体平台露出、名片自定义区。 */
export default async function CardSettingsPage() {
  if (!(await getAdminIdentity()).owner) redirect("/admin");
  const client = await createSupabaseServerClient();
  const [{ data, error }, site, pages, aiReady] = await Promise.all([
    client.from("site_config").select("updated_at").eq("id", 1).maybeSingle(),
    getSiteConfig(true),
    listCustomPages(),
    generationReady(createSupabaseServiceClient()),
  ]);
  if (error || !data?.updated_at) throw new Error("名片配置版本暂时不可用");
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <h1 className="text-2xl font-medium">名片配置</h1>
      <AdminTabs active="card" />
      <CardSettingsForm
        site={site}
        updated={data.updated_at}
        customPages={pages.map((p) => ({ slug: p.slug, title: p.title }))}
        avatarKeySet={aiReady}
      />
    </div>
  );
}
