import { requireOwner } from "@/lib/admin/detail";
import { SeriesCreateForm } from "@/components/admin/series-create-form";
export default async function Page() {
  await requireOwner();
  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">创建专辑</h1>
      <SeriesCreateForm />
    </section>
  );
}
