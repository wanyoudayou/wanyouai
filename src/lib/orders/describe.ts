import "server-only";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSeriesType, seriesPath } from "@/lib/content-kinds";

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type OrderTarget = { sku_type: string; target_id: number | null };

export interface OrderContent {
  name: string;
  href: string | null;
  actionLabel: string;
}

/** Only metadata is read; a destination link never grants access to its body. */
export async function getOrderContents(
  supabase: ServerClient,
  orders: OrderTarget[],
): Promise<OrderContent[]> {
  const articleIds = [...new Set(orders
    .filter(o => ["single", "skill"].includes(o.sku_type) && o.target_id !== null)
    .map(o => o.target_id!))];
  const seriesIds = [...new Set(orders
    .filter(o => ["series", "event"].includes(o.sku_type) && o.target_id !== null)
    .map(o => o.target_id!))];
  const [articles, series] = await Promise.all([
    articleIds.length ? supabase.from("articles").select("id,title,slug,type,status").in("id", articleIds) : Promise.resolve({ data: [] }),
    seriesIds.length ? supabase.from("series").select("id,title,slug,type,status").in("id", seriesIds) : Promise.resolve({ data: [] }),
  ]);
  const articlesById = new Map((articles.data ?? []).map(row => [row.id, row]));
  const seriesById = new Map((series.data ?? []).map(row => [row.id, row]));
  return orders.map(order => {
    if (order.sku_type === "skill") {
      const article = order.target_id === null ? null : articlesById.get(order.target_id);
      return { name: article?.title ? `Skill · ${article.title}` : "Skill", href: article?.type === "skill" && ["published", "paused"].includes(article.status) ? `/skills/${encodeURIComponent(article.slug)}` : null, actionLabel: "使用 Skill" };
    }
    if (order.sku_type === "subscription") return { name: "全站订阅（1 年）", href: "/me", actionLabel: "查看订阅权益" };
    if (order.sku_type === "single") {
      const article = order.target_id === null ? null : articlesById.get(order.target_id);
      return {
        name: article?.title ? `单篇 · ${article.title}` : "单篇内容",
        href: article?.slug && article.type === "blog" && ["published", "paused"].includes(article.status) ? `/blog/${encodeURIComponent(article.slug)}` : null,
        actionLabel: "阅读文章",
      };
    }
    if (order.sku_type === "series" || order.sku_type === "event") {
      const item = order.target_id === null ? null : seriesById.get(order.target_id);
      const event = order.sku_type === "event";
      const matches = item && isSeriesType(item.type) && (event ? item.type === "event" : item.type !== "event");
      return {
        name: item?.title ? `${event ? "活动资格" : "专辑"} · ${item.title}` : event ? "活动资格" : "专辑内容",
        href: matches && item.slug && ["published", "paused"].includes(item.status) ? seriesPath(item) : null,
        actionLabel: event ? "查看活动" : "查看专辑",
      };
    }
    return { name: "内容权益", href: null, actionLabel: "查看内容" };
  });
}

export async function getOrderContent(
  supabase: ServerClient,
  order: OrderTarget,
): Promise<OrderContent> {
  return (await getOrderContents(supabase, [order]))[0];
}

/** 商品描述（支付 API 契约 §5 商品名 = 站名 + 商品描述）；checkout 与收银台共用。 */
export async function describeOrder(
  supabase: ServerClient,
  order: OrderTarget,
): Promise<string> {
  return (await getOrderContent(supabase, order)).name;
}
