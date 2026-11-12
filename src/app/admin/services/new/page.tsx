import { requireOwner } from "@/lib/admin/detail";
import { ServiceForm } from "@/components/admin/service-form";
export default async function Page() {
  await requireOwner();
  return (
    <section className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">新建服务</h1>
      <ServiceForm />
    </section>
  );
}
