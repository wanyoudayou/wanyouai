import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner, numericId } from "@/lib/admin/detail";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminResourcePage } from "@/components/admin/admin-resource-page";
import type { RawListQuery } from "@/lib/admin/list-query";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawListQuery>;
}) {
  await requireOwner();
  const id = numericId((await params).id);
  const { data, error } = await (await createSupabaseServerClient())
    .from("series")
    .select("id,slug,title,type")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("活动暂时不可用");
  if (!data || data.type !== "event") notFound();
  return (
    <div>
      <header className="space-y-3 px-6 pt-8">
        <Link href={`/admin/collections/${id}`} className="text-primary">
          返回活动专辑
        </Link>
        <h1 className="text-2xl font-semibold">{data.title}</h1>
        <a
          href={`/admin/events/${id}/roster.csv`}
          download
          className="text-primary underline"
        >
          导出完整报名名单 CSV
        </a>
      </header>
      <AdminResourcePage
        resource="registrations"
        params={{ ...(await searchParams), series: data.slug }}
      />
    </div>
  );
}
