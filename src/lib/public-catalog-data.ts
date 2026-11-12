import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCommerceConfig, normalizeConstraintsConfig, normalizeContactConfig, normalizeHomeConfig, normalizeIdentityConfig, normalizeAvatarConfig } from "@/types/site";
import type { SiteContext } from "@/lib/get-site-config";
export type CatalogArticle = { id: number; slug: string; title: string; summary: string | null; type: string; series_id: number | null; access: string; price: number | null; status: string; preview_md: string; updated_at: string };
export type CatalogSeries = { id: number; slug: string; title: string; type: string; price: number; status: string; readme_article_id: number | null; task: string | null; updated_at: string };
export type CatalogService = { slug: string; title: string; price: number | null; deliverables: string[]; duration: string | null; capacity_per_month: number | null; protocol_snapshot: unknown; updated_at: string };
export type CatalogSkill = { id: number; price: number; current_release: string | null; legacy_series_id: number | null; updated_at: string };
export type PublicCatalog = { site: SiteContext; updated: string; articles: CatalogArticle[]; series: CatalogSeries[]; services: CatalogService[]; skills?: CatalogSkill[]; events: { series_id: number; ticket_price: number | null; state: string }[]; readmes: { article_id: number; content: string }[] };

/** Read public catalog rows through an anonymous client supplied by the server adapter. */
export async function readPublicCatalog(client: SupabaseClient): Promise<PublicCatalog> {
  async function allRows<T>(table: string, columns: string, statuses?: string[]): Promise<T[]> {
    const result: T[] = [];
    for (let offset = 0; ; offset += 500) {
      let query = client.from(table).select(columns).order(table === "event_details" ? "series_id" : "id").range(offset, offset + 499);
      if (statuses) query = query.in("status", statuses);
      const { data, error } = await query;
      if (error || !data) throw new Error("公开目录暂时不可用");
      result.push(...data as unknown as T[]);
      if (data.length < 500) return result;
    }
  }
  const [{ data: config, error }, articles, series, services, events, skills] = await Promise.all([
    client.from("site_config").select("site_name,tagline,owner_name,footer_credit,identity,constraints,contact,commerce,home_config,avatar_config,updated_at").eq("id", 1).single(),
    allRows<CatalogArticle>("articles", "id,slug,title,summary,type,series_id,access,price,status,preview_md,updated_at", ["published", "paused"]),
    allRows<CatalogSeries>("series", "id,slug,title,type,price,status,readme_article_id,task,updated_at", ["published"]),
    allRows<CatalogService>("services", "id,slug,title,price,deliverables,duration,capacity_per_month,protocol_snapshot,updated_at", ["published"]),
    allRows<PublicCatalog["events"][number]>("event_details", "series_id,ticket_price,state"),
    allRows<CatalogSkill>("skills", "id,price,current_release,legacy_series_id,updated_at"),
  ]);
  if (error || !config) throw new Error("公开站点配置不可用");
  const readmeIds = series.flatMap((album) => articles.some((article) => article.id === album.readme_article_id && article.series_id === album.id && article.access === "public") ? [album.readme_article_id!] : []);
  const readmes: PublicCatalog["readmes"] = [];
  for (let i = 0; i < readmeIds.length; i += 100) {
    const { data, error } = await client.from("article_bodies").select("article_id,content").in("article_id", readmeIds.slice(i, i + 100));
    if (error || !data) throw new Error("公开 README 暂时不可用");
    readmes.push(...data);
  }
  const site: SiteContext = { siteName: config.site_name, ownerName: config.owner_name, tagline: config.tagline, footerCredit: config.footer_credit, identity: normalizeIdentityConfig(config.identity), constraints: normalizeConstraintsConfig(config.constraints), contact: normalizeContactConfig(config.contact), commerce: normalizeCommerceConfig(config.commerce), home: normalizeHomeConfig(config.home_config), avatar: normalizeAvatarConfig(config.avatar_config) };
  const updated = [config.updated_at, ...skills.map(v => v.updated_at), ...articles.map((v) => v.updated_at), ...series.map((v) => v.updated_at), ...services.map((v) => v.updated_at)].sort().at(-1)!;
  return { site, updated, skills: skills.map(item => ({ ...item, price: Number(item.price) })), articles: articles.map((item) => ({ ...item, price: item.price === null ? null : Number(item.price) })), series: series.map((item) => ({ ...item, price: Number(item.price) })), services: services.map((item) => ({ ...item, price: item.price === null ? null : Number(item.price) })), events: events.map((item) => ({ ...item, ticket_price: item.ticket_price === null ? null : Number(item.ticket_price) })), readmes };
}
