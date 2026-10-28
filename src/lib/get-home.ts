import { createSupabaseServerClient } from "@/lib/supabase/server";
import { skillShowcase } from "@/lib/skills/repository";
import { unmappedLegacySkills } from "@/lib/skills/legacy";
import { formatPrice } from "@/lib/format";
import type {
  ArticleCardRow,
  EventSeriesRow,
  SeriesRow,
  ServiceCardRow,
} from "@/types/database";
import type {
  CommerceConfig,
  ConstraintsConfig,
  FactBadgeConfig,
  FactBadgeType,
  HomeBlockConfig,
  HomeConfig,
} from "@/types/site";
import type {
  AlbumCardData,
  ArticleCardData,
  EventCardData,
  ServiceCardData,
} from "@/types/content";

export interface ResolvedFactBadge {
  type: FactBadgeType;
  text: string;
}

export interface HomeData {
  counts: { series: number; articles: number };
  /** 手册 / 技能区块（featured 置顶优先，其余按更新时间）；封面取 README cover_url */
  albums: Record<"handbook" | "skill", AlbumCardData[]>;
  albumCounts: Record<"handbook" | "skill", number>;
  latestBlog: ArticleCardData[];
  upcomingEvents: EventCardData[];
  services: ServiceCardData[];
  facts: ResolvedFactBadge[];
}

import { SERIES_BASE as SERIES_TYPE_HREFS } from "@/lib/content-kinds";

function toAlbumCard(
  row: SeriesRow,
  currency: string,
  coverUrl: string | null,
): AlbumCardData {
  return {
    href: `${SERIES_TYPE_HREFS[row.type]}/${row.slug}`,
    kind: row.type,
    title: row.title,
    summary: row.task ?? null,
    coverUrl,
    tags: row.tags ?? [],
    audiences: row.audiences ?? [],
    price: Number(row.price),
    currency,
    featured: row.featured === true,
    updatedAt: row.updated_at,
  };
}

function toArticleCard(row: ArticleCardRow): ArticleCardData {
  return {
    href: `/blog/${row.slug}`,
    title: row.title,
    summary: row.summary,
    coverUrl: row.cover_url,
    tags: row.tags ?? [],
    access: row.access,
    price: row.price === null ? null : Number(row.price),
    publishedAt: row.published_at,
  };
}

function toEventCard(row: EventSeriesRow): EventCardData | null {
  const detail = Array.isArray(row.event_details)
    ? row.event_details[0]
    : row.event_details;
  if (!detail) return null;
  return {
    href: `/events/${row.slug}`,
    title: row.title,
    summary: row.task ?? null,
    coverUrl: null,
    tags: row.tags ?? [],
    state: detail.state,
    startsAt: detail.starts_at,
    locationText: detail.location_text,
    ticketPrice:
      detail.ticket_price === null ? null : Number(detail.ticket_price),
    memberOnly: detail.kind === "member",
  };
}

function blockLimit(
  blocks: HomeBlockConfig[],
  type: HomeBlockConfig["type"],
): number {
  return blocks.find((b) => b.type === type)?.limit ?? 6;
}

function resolveFacts(
  badges: FactBadgeConfig[],
  sources: {
    seriesCount: number;
    articleCount: number;
    subscriptionPriceText: string | null;
    currentLoad: string;
  },
): ResolvedFactBadge[] {
  return badges.flatMap((badge) => {
    let value: string | null = null;
    switch (badge.type) {
      case "series_count":
        value = `专辑 ${sources.seriesCount}`;
        break;
      case "article_count":
        value = `文章 ${sources.articleCount}`;
        break;
      case "subscription_price":
        value = sources.subscriptionPriceText;
        break;
      case "service_capacity":
        value = sources.currentLoad || null;
        break;
    }
    if (!value) return [];
    return [
      {
        type: badge.type,
        text: badge.label ? `${badge.label} ${value}` : value,
      },
    ];
  });
}

/**
 * Homepage dynamic data (页面契约 3.1 取数边界).
 * Lists never touch article_bodies — card surfaces are metadata-only.
 * Empty blocks are filtered by the page; no personalization, no algorithm.
 */
export async function getHomeData(
  home: HomeConfig,
  site: {
    commerce: CommerceConfig;
    constraints: ConstraintsConfig;
    contact: { email: string | null; bookingUrl: string | null };
  },
): Promise<HomeData> {
  const empty: HomeData = {
    counts: { series: 0, articles: 0 },
    albums: { handbook: [], skill: [] },
    albumCounts: { handbook: 0, skill: 0 },
    latestBlog: [],
    upcomingEvents: [],
    services: [],
    facts: resolveFacts(home.factBadges, {
      seriesCount: 0,
      articleCount: 0,
      subscriptionPriceText: site.commerce.subscriptionPrice
        ? `${formatPrice(site.commerce.subscriptionPrice.amount, site.commerce.subscriptionPrice.currency)} / 年`
        : null,
      currentLoad: site.constraints.currentLoad,
    }),
  };

  const supabase = await createSupabaseServerClient();
  try {
    const blogLimit = blockLimit(home.blocks, "blog");
    const eventsLimit = blockLimit(home.blocks, "event");
    const servicesLimit = blockLimit(home.blocks, "service");

    const [
      seriesResult,
      countsResult,
      blogResult,
      eventsResult,
      servicesResult,
      skillResult,
      legacySkills,
    ] = await Promise.all([
      supabase
        .from("series")
        .select(
          "id, slug, type, title, task, price, tags, audiences, featured, status, updated_at, readme_article_id",
        )
        .eq("status", "published")
        .order("featured", { ascending: false })
        .order("updated_at", { ascending: false }),
      Promise.all([
        supabase
          .from("series")
          .select("id", { count: "exact", head: true })
          .eq("status", "published"),
        supabase
          .from("articles")
          .select("id", { count: "exact", head: true })
          .eq("status", "published"),
      ]),
      supabase
        .from("articles")
        .select(
          "slug, title, summary, cover_url, tags, access, price, published_at",
        )
        .eq("type", "blog")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(blogLimit),
      supabase
        .from("series")
        .select("id, slug, title, task, tags")
        .eq("type", "event")
        .eq("status", "published")
        .limit(50),
      supabase
        .from("services")
        .select(
          "slug, title, summary, deliverables, duration, price, capacity_per_month",
        )
        .eq("status", "published")
        .not("price", "is", null)
        .order("sort", { ascending: true })
        .limit(servicesLimit),
      skillShowcase(blockLimit(home.blocks, "skill"), site.commerce.subscriptionPrice?.currency ?? "CNY"),
      unmappedLegacySkills(),
    ]);

    if (seriesResult.error)
      console.error("[getHomeData:series]", seriesResult.error.message);

    const publishedSeries = (seriesResult.data ?? []) as SeriesRow[];
    // 封面与手册/技能栏目同源：取 README 文章的 cover_url（否则首页橱窗恒为占位图）
    const showcaseIds = publishedSeries.map((row) => row.id);
    const coverByArticleId = new Map<number, string | null>();
    if (showcaseIds.length > 0) {
      const { data: coverRows, error: coverError } = await supabase
        .from("articles")
        .select("id, cover_url")
        .in("series_id", showcaseIds)
        .eq("type", "chapter")
        .eq("status", "published");
      if (coverError) console.error("[getHomeData:covers]", coverError.message);
      for (const row of (coverRows ?? []) as {
        id: number;
        cover_url: string | null;
      }[]) {
        coverByArticleId.set(row.id, row.cover_url);
      }
    }
    // 手册 / 技能区块：featured 置顶优先、其余按更新（seriesResult 已按此排序）；封面取 README
    const albums = { handbook: [], skill: [] } as Record<
      "handbook" | "skill",
      AlbumCardData[]
    >;
    for (const type of ["handbook", "skill"] as const) {
      albums[type] = publishedSeries
        .filter((row) => type === "handbook" ? ["handbook", "collection"].includes(row.type) : row.type === "skill" && legacySkills.some(s => s.slug === row.slug))
        .slice(0, blockLimit(home.blocks, type))
        .map((row) =>
          toAlbumCard(
            row,
            site.commerce.subscriptionPrice?.currency ?? "CNY",
            row.readme_article_id === null
              ? null
              : (coverByArticleId.get(row.readme_article_id) ?? null),
          ),
        );
    }

    albums.skill = [...skillResult.items, ...albums.skill].slice(0, blockLimit(home.blocks, "skill"));

    const [seriesCountResult, articleCountResult] = countsResult;
    const seriesCount = seriesCountResult.count ?? 0;
    const articleCount = articleCountResult.count ?? 0;

    const latestBlog = ((blogResult.data ?? []) as ArticleCardRow[]).map(
      toArticleCard,
    );

    // 活动详情平铺查询后合并（不依赖 PostgREST 嵌入 join）
    const eventRows = (eventsResult.data ?? []) as Pick<
      SeriesRow,
      "id" | "slug" | "title" | "task" | "tags"
    >[];
    const { data: eventDetails } = eventRows.length
      ? await supabase
          .from("event_details")
          .select(
            "series_id, state, starts_at, location_text, kind, ticket_price",
          )
          .in("state", ["upcoming", "registering"])
          .limit(50)
          .order("starts_at", { ascending: true })
      : { data: [] as Record<string, never>[] };
    const detailBySeriesId = new Map(
      (
        (eventDetails ?? []) as {
          series_id: number;
          state: string;
          starts_at: string;
          location_text: string | null;
          kind: string;
          ticket_price: number | null;
        }[]
      ).map((d) => [d.series_id, d]),
    );
    const upcomingEvents = eventRows
      .map((row) => {
        const detail = detailBySeriesId.get(row.id);
        if (!detail) return null;
        return toEventCard({ ...row, event_details: detail } as EventSeriesRow);
      })
      .filter((card): card is EventCardData => card !== null)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .slice(0, eventsLimit);

    const services = ((servicesResult.data ?? []) as ServiceCardRow[]).map(
      (row) => ({
        slug: row.slug,
        title: row.title,
        summary: row.summary,
        deliverables: row.deliverables ?? [],
        duration: row.duration,
        price: row.price === null ? null : Number(row.price),
        capacityPerMonth: row.capacity_per_month,
      }),
    );

    const facts = resolveFacts(home.factBadges, {
      seriesCount,
      articleCount,
      subscriptionPriceText: site.commerce.subscriptionPrice
        ? `${formatPrice(site.commerce.subscriptionPrice.amount, site.commerce.subscriptionPrice.currency)} / 年`
        : null,
      currentLoad: site.constraints.currentLoad,
    });

    return {
      counts: { series: seriesCount, articles: articleCount },
      albums,
      albumCounts: {
        handbook: publishedSeries.filter((row) => ["handbook", "collection"].includes(row.type))
          .length,
        skill: skillResult.total + legacySkills.length,
      },
      latestBlog,
      upcomingEvents,
      services,
      facts,
    };
  } catch (error) {
    console.error("[getHomeData]", error);
    return empty;
  }
}
