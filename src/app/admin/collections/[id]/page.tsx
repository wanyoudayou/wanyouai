import { AdminReturnLink } from "@/components/admin/return-link";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner, numericId } from "@/lib/admin/detail";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  SeriesWorkflow,
  type SeriesSettings,
} from "@/components/admin/series-settings-form";
import { EventDetailsForm } from "@/components/admin/event-details-form";
import { AdminResourcePage } from "@/components/admin/admin-resource-page";
import type { RawListQuery } from "@/lib/admin/list-query";
import { readRelatedPages } from "@/lib/admin/related-pages";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawListQuery>;
}) {
  await requireOwner();
  const id = numericId((await params).id);
  const client = await createSupabaseServerClient();
  const { data: s, error } = await client
    .from("series")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("专辑暂时不可用");
  if (!s) notFound();
  const chapters = await readRelatedPages((from, to) => client.from("articles").select("id,slug,title").eq("series_id", id).eq("access", "public").in("status", ["published", "paused"]).order("sort_order").order("id").range(from, to));
  const event =
    s.type === "event"
      ? await client
          .from("event_details")
          .select("*")
          .eq("series_id", id)
          .maybeSingle()
      : { data: null, error: null };
  if (event.error) throw new Error("专辑详情暂时不可用");
  return (
    <div className="space-y-6">
      <header className="space-y-3 px-6 pt-8">
        <AdminReturnLink fallback="/admin/collections">
          返回专辑
        </AdminReturnLink>
        <h1 className="text-2xl font-semibold">{s.title}</h1>
        <Link
          href={`/admin/import?series=${s.slug}`}
          className="text-primary underline"
        >
          文件导入与修订
        </Link>
      </header>
      <div className="mx-6 space-y-5">
        <SeriesWorkflow key={s.updated_at} series={s as SeriesSettings & { slug: string }} chapters={chapters.data} />
        {s.type === "event" && (
          <>
            <EventDetailsForm
              id={id}
              updated={s.updated_at}
              details={event.data ?? undefined}
            />
            <Link
              href={`/admin/events/${id}`}
              className="inline-block text-primary underline"
            >
              活动报名与核销
            </Link>
          </>
        )}
      </div>
      <AdminResourcePage
        resource="articles"
        params={{ ...(await searchParams), series: s.slug }}
      />
    </div>
  );
}
