import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPublicCatalog } from "@/lib/public-catalog";
import { buildMachineCard, validProtocol } from "@/lib/machine-output";
import { type SiteContext } from "@/lib/get-site-config";
import { getSiteUrl } from "@/lib/site-url";
import { formatPrice } from "@/lib/format";
import type { CardPanelData } from "@/types/panel";

/**
 * /card 与 /card.json 的唯一数据函数（card-mapping 契约）；
 * 首页右栏名片占位复用同一 buildCardPanelData 纯函数组装。
 */

export async function getCardCounts(): Promise<{ series: number; articles: number }> {
  const supabase = await createSupabaseServerClient();
  try {
    const [series, articles] = await Promise.all([
      supabase.from("series").select("id", { count: "exact", head: true }).eq("status", "published"),
      supabase.from("articles").select("id", { count: "exact", head: true }).eq("status", "published"),
    ]);
    return { series: series.count ?? 0, articles: articles.count ?? 0 };
  } catch (error) {
    console.error("[getCardCounts]", error);
    return { series: 0, articles: 0 };
  }
}

export async function getCardServices(): Promise<CardPanelData["services"]> {
  const supabase = await createSupabaseServerClient();
  try {
    const { data, error } = await supabase
      .from("services")
      .select("slug, title, price")
      .eq("status", "published")
      .not("price", "is", null)
      .order("sort", { ascending: true });
    if (error) {
      console.error("[getCardServices]", error.message);
      return [];
    }
    return ((data ?? []) as { slug: string; title: string; price: number | null }[]).map((row) => ({
      slug: row.slug,
      title: row.title,
      price: row.price === null ? null : Number(row.price),
    }));
  } catch (error) {
    console.error("[getCardServices]", error);
    return [];
  }
}

export function buildCardPanelData(
  site: SiteContext,
  sources: { services: CardPanelData["services"]; series: number; articles: number; evaluations?: CardPanelData["evaluations"] },
  currencyFallback = "CNY",
): CardPanelData {
  const currency = site.commerce.subscriptionPrice?.currency ?? currencyFallback;
  const siteUrl = getSiteUrl();
  return {
    siteName: site.siteName,
    ownerName: site.ownerName,
    avatarUrl: site.identity.avatarUrl,
    oneLiner: site.identity.oneLiner,
    languages: site.identity.languages,
    timezone: site.identity.timezone,
    focusAreas: site.identity.focusAreas,
    workingHours: site.constraints.workingHours,
    responseTime: site.constraints.responseTime,
    currentLoad: site.constraints.currentLoad,
    exclusions: site.constraints.exclusions,
    email: site.contact.email,
    bookingUrl: site.contact.bookingUrl,
    socialLinks: site.identity.socialLinks,
    subscriptionPriceText: site.commerce.subscriptionPrice
      ? `${formatPrice(site.commerce.subscriptionPrice.amount, currency)} / 年`
      : null,
    services: sources.services,
    evaluations: sources.evaluations ?? [],
    seriesCount: sources.series,
    articleCount: sources.articles,
    cardJsonUrl: siteUrl ? `${siteUrl}/card.json` : "/card.json",
  };
}

/** /card 页面与后续 /card.json 共用的入口。 */
export async function getCardData({ includeEvaluations = true }: { includeEvaluations?: boolean } = {}) {
  const catalog = await getPublicCatalog();
  const origin = getSiteUrl(); if (!origin) throw new Error("站点地址未配置");
  const services = catalog.services.filter((service) => service.price !== null && validProtocol(service.protocol_snapshot)).map((service) => ({ slug: service.slug, title: service.title, price: service.price, protocol: service.protocol_snapshot as Record<string, string> }));
  // 交易锚定评价（公开读、不含个人信息；实证区展示最新 3 条）
  const { data: evaluationRows } = includeEvaluations ? await createSupabaseServerClient().then((client) => client
    .from("evaluations")
    .select("id,rating,content,created_at")
    .order("created_at", { ascending: false })
    .limit(3)) : { data: [] };
  return { ...buildCardPanelData(catalog.site, { services, series: catalog.series.length, articles: catalog.articles.filter((article) => article.status === "published").length, evaluations: evaluationRows ?? [] }), machine: buildMachineCard(catalog, origin) };
}
