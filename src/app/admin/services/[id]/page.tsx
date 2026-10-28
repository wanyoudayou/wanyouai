import { AdminReturnLink } from "@/components/admin/return-link";
import { notFound } from "next/navigation";
import { requireOwner, numericId } from "@/lib/admin/detail";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  ServiceForm,
  type ManagedService,
} from "@/components/admin/service-form";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOwner();
  const id = numericId((await params).id);
  const { data, error } = await (await createSupabaseServerClient())
    .from("services")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("服务暂时不可用");
  if (!data) notFound();
  return (
    <section className="mx-auto max-w-4xl space-y-6 p-6">
      <AdminReturnLink fallback="/admin/services">返回服务项目</AdminReturnLink>
      <h1 className="text-2xl font-semibold">编辑服务</h1>
      <ServiceForm service={data as ManagedService} />
    </section>
  );
}
