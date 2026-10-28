import { generationReady } from "@/lib/ai/settings";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { notFound } from "next/navigation";
import { requireOwner, numericId } from "@/lib/admin/detail";
import { PageEditorRoute } from "@/components/admin/page-editor-route";
import type { CustomPageRow } from "@/lib/admin/pages";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOwner();
  const page = null;
  void params;
  void numericId;
  void notFound;
  const aiReady = await generationReady(createSupabaseServiceClient());
  return (
    <section className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">编辑独立页面</h1>
      <PageEditorRoute
        page={page as CustomPageRow | null}
        avatarReady={aiReady}
      />
    </section>
  );
}
