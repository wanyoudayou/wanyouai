import { generationReady } from "@/lib/ai/settings";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requireOwner } from "@/lib/admin/detail";
import { PageEditorRoute } from "@/components/admin/page-editor-route";
import type { CustomPageRow } from "@/lib/admin/pages";
/** 新建独立页面：编辑器以空页面打开，保存后进入编辑路由。 */
export default async function Page() {
  await requireOwner();
  const page: CustomPageRow | null = null;
  const aiReady = await generationReady(createSupabaseServiceClient());
  return (
    <section className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">新建独立页面</h1>
      <PageEditorRoute
        page={page}
        avatarReady={aiReady}
      />
    </section>
  );
}
