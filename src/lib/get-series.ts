import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ARTICLE_METADATA, getArticleReading } from "@/lib/get-article";
import { getReader } from "@/lib/reading/viewer";
import { hasEntitlement, visible } from "@/lib/reading/access";
import type { SeriesType, EventDetailsRow } from "@/types/database";
import type {
  ReadingArticle,
  ReadingSeries,
  SeriesReading,
} from "@/types/reading";

import { SERIES_BASE } from "@/lib/content-kinds";
export { SERIES_BASE, SERIES_LABEL } from "@/lib/content-kinds";

export const getSeriesMetadata = cache(
  async (kind: SeriesType, slug: string): Promise<ReadingSeries | null> => {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("series")
      .select(
        "id, slug, type, title, readme_article_id, price, status, tags, task, audiences, featured, created_at, updated_at",
      )
      .in("type", kind === "handbook" ? ["handbook", "collection"] : [kind])
      .eq("slug", slug)
      .in("status", ["published", "paused"])
      .maybeSingle();
    if (error) throw new Error("内容暂时无法加载");
    return data as ReadingSeries | null;
  },
);

export async function getSeries(
  kind: SeriesType,
  slug: string,
  selected?: string,
): Promise<SeriesReading | null> {
  const series = await getSeriesMetadata(kind, slug);
  if (!series) return null;
  const supabase = await createSupabaseServerClient();
  const [chapters, reader, eventResult] = await Promise.all([
    supabase
      .from("articles")
      .select(ARTICLE_METADATA)
      .eq("series_id", series.id)
      .eq("type", "chapter")
      .in("status", ["published", "paused"])
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
    getReader(),
    kind === "event"
      ? supabase
          .from("event_details")
          .select(
            "series_id, starts_at, location_text, registration, capacity, kind, ticket_price, state",
          )
          .eq("series_id", series.id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (chapters.error || eventResult.error)
    throw new Error("内容详情暂时无法加载");
  const articles = (chapters.data ?? []) as ReadingArticle[];
  const current =
    selected === undefined
      ? articles.find((a) => a.id === series.readme_article_id)
      : articles.find((a) => a.slug === selected);
  if (selected !== undefined && !current) return null;
  const pathname = `${SERIES_BASE[kind]}/${encodeURIComponent(slug)}`;
  const ordered = [...articles].sort(
    (a, b) =>
      Number(b.id === series.readme_article_id) -
      Number(a.id === series.readme_article_id),
  );
  return {
    series,
    reading: current ? await getArticleReading(current, series, reader) : null,
    isReadme: !current || current.id === series.readme_article_id,
    navigation: {
      pathname,
      title: series.title,
      backHref: SERIES_BASE[kind],
      currentSlug: current?.slug ?? null,
      chapters: ordered.map((article) => ({
        href:
          article.id === series.readme_article_id
            ? pathname
            : `${pathname}?article=${encodeURIComponent(article.slug)}`,
        title: article.title,
        slug: article.slug,
        locked: visible(reader, article, series) !== "full",
        readme: article.id === series.readme_article_id,
        status: article.status,
      })),
    },
    event: eventResult.data as EventDetailsRow | null,
    canDownload:
      !!reader.userId &&
      (reader.owner ||
        hasEntitlement(reader, "subscription", null) ||
        hasEntitlement(reader, "series", series.id)),
  };
}

export async function getSeriesSeo(
  kind: SeriesType,
  slug: string,
  selected?: string | string[],
) {
  const { publicMetadata } = await import("@/lib/seo/server");
  const series = await getSeriesMetadata(kind, slug);
  if (!series || Array.isArray(selected))
    return { title: "内容不存在", robots: { index: false, follow: false } };
  let title = series.title,
    description = series.task,
    path = `${SERIES_BASE[kind]}/${encodeURIComponent(series.slug)}`;
  if (selected) {
    const { data, error } = await (await createSupabaseServerClient())
      .from("articles")
      .select("id,title,summary,slug")
      .eq("series_id", series.id)
      .eq("type", "chapter")
      .eq("slug", selected)
      .in("status", ["published", "paused"])
      .maybeSingle();
    if (error) throw new Error("内容信息暂时不可用");
    if (!data)
      return { title: "内容不存在", robots: { index: false, follow: false } };
    if (data.id !== series.readme_article_id) {
      title = data.title;
      description = data.summary;
      path += `?article=${encodeURIComponent(data.slug)}`;
    }
  }
  return publicMetadata(title, path, description);
}
