import { requireOwner } from "@/lib/admin/detail";
import { AdminReturnLink } from "@/components/admin/return-link";
import { SeriesCreateForm } from "@/components/admin/series-create-form";
import { seriesScope } from "@/lib/admin/series-scopes";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ type?: string | string[] }>;
}) {
  await requireOwner();
  const type = (await searchParams).type === "event" ? "event" : "handbook";
  const scope = seriesScope(type);
  return (
    <section className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <AdminReturnLink fallback={scope.path}>返回{scope.title}</AdminReturnLink>
        <h1 className="text-2xl font-semibold">新建内容</h1>
      </header>
      <SeriesCreateForm initialType={type} />
    </section>
  );
}
