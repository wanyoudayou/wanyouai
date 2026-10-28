import { requireOwner } from "@/lib/admin/detail";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { aiSettingsView } from "@/lib/ai/settings";
import { AISettingsForm } from "@/components/admin/ai-settings-form";

export const metadata = { title: "AI 设置", robots: { index: false, follow: false } };
export default async function AISettingsPage() {
  await requireOwner();
  const view = await aiSettingsView(createSupabaseServiceClient());
  return <div className="mx-auto max-w-4xl space-y-6 p-6 lg:p-8">
    <header><h1 className="text-2xl font-semibold">AI 设置</h1><p className="mt-2 text-sm text-muted-foreground">统一管理生成连接、站内知识库与分身。接口与凭据在本站后台保存，无需新增 Vercel 变量。</p></header>
    <AISettingsForm initial={view} />
  </div>;
}
