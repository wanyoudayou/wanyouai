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
import { ChapterOrder } from "@/components/admin/chapter-order";
import { AdminResourcePage } from "@/components/admin/admin-resource-page";
import type { RawListQuery } from "@/lib/admin/list-query";
import { readRelatedPages } from "@/lib/admin/related-pages";
import { seriesScope } from "@/lib/admin/series-scopes";
import { SERIES_LABEL, isSeriesType } from "@/lib/content-kinds";
import { ADMIN_LABELS } from "@/lib/admin/list-labels";
import { StatusBadge, type StatusBadgeTone } from "@/components/shared/status-badge";
import { Callout } from "@/components/shared/callout";
import { Button } from "@/components/ui/button";
import { TriangleAlertIcon } from "lucide-react";

const STATUS_TONE: Record<string, StatusBadgeTone> = {
  draft: "neutral",
  published: "success",
  paused: "paused",
  archived: "neutral",
};

function nextStep(status: string, hasReadme: boolean, event: boolean) {
  if (status === "draft")
    return hasReadme
      ? "公开介绍已发布，确认内容后可在下方「上架与生命周期」上架。"
      : event
        ? "下一步：保存活动时间与票价，再在「待发布更新」发布公开介绍。"
        : "下一步：在「待发布更新」发布公开介绍和章节，然后上架。";
  if (status === "published")
    return "读者可见。新编辑的章节会进入「待发布更新」，确认后才替换线上内容。";
  if (status === "paused") return "已停售，已有权益继续可读；暂停满三个月后可归档。";
  return "已归档，读者不可见，且不能恢复。";
}
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
  const ordered = await readRelatedPages((from, to) => client.from("articles").select("id,title,status").eq("series_id", id).order("sort_order").order("id").range(from, to));
  if (ordered.error) throw new Error("章节暂时不可用");
  const event =
    s.type === "event"
      ? await client
          .from("event_details")
          .select("*")
          .eq("series_id", id)
          .maybeSingle()
      : { data: null, error: null };
  if (event.error) throw new Error("专辑详情暂时不可用");
  const scope = seriesScope(s.type);
  const seriesType = String(s.type);
  const kindLabel = isSeriesType(seriesType) ? SERIES_LABEL[seriesType] : "专辑";
  const publicChapters = (chapters.data ?? []).filter(
    (chapter) => chapter.id !== s.readme_article_id,
  ).length;
  const priced = s.type !== "event" && Number(s.price) > 0;
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-3">
        <AdminReturnLink fallback={scope.path}>返回{scope.title}</AdminReturnLink>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">{kindLabel}</span>
              <StatusBadge tone={STATUS_TONE[s.status] ?? "neutral"}>
                {ADMIN_LABELS[s.status] ?? s.status}
              </StatusBadge>
            </div>
            <h1 className="text-2xl font-semibold break-words">{s.title}</h1>
            <p className="text-sm text-muted-foreground">
              {nextStep(s.status, !!s.readme_article_id, s.type === "event")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={`/admin/import?series=${s.slug}`}>批量导入文件</Link>
            </Button>
            {s.type === "event" && (
              <Button asChild variant="outline">
                <Link href={`/admin/events/${id}`}>报名与核销</Link>
              </Button>
            )}
          </div>
        </div>
        {priced && publicChapters > 0 && (
          <Callout Icon={TriangleAlertIcon} title={`整本收费，其中 ${publicChapters} 章任何人可读`}>
            <p>
              整本价格不会改变章节的阅读权限。如果它们不是有意开放的试读章节，请在章节编辑页把阅读权限改为“单篇购买”或“订阅专享”。
            </p>
          </Callout>
        )}
      </header>
      <div className="space-y-5">
        <SeriesWorkflow key={s.updated_at} series={s as SeriesSettings & { slug: string }} chapters={chapters.data} />
        {s.type === "event" && (
          <>
            <EventDetailsForm
              id={id}
              updated={s.updated_at}
              details={event.data ?? undefined}
            />
          </>
        )}
      </div>
      {s.status !== "archived" && (
        <ChapterOrder
          key={(ordered.data ?? []).map((chapter) => chapter.id).join(",")}
          seriesId={id}
          chapters={(ordered.data ?? []).map((chapter) => ({ id: Number(chapter.id), title: String(chapter.title), status: String(chapter.status) }))}
        />
      )}
      <AdminResourcePage
        resource="articles"
        params={{ ...(await searchParams), series: s.slug }}
        embedded
        scope={{
          types: ["chapter"],
          title: "章节",
          description: "这里的章节与公开介绍按阅读顺序排列；新编辑的内容需在上方「待发布更新」确认后才上线。",
          path: `/admin/collections/${id}`,
          create: {
            label: "新建章节",
            href: `/admin/content?type=chapter&series=${encodeURIComponent(s.slug)}&returnTo=${encodeURIComponent(`/admin/collections/${id}`)}`,
          },
        }}
      />
    </div>
  );
}
