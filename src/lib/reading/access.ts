import type { Reader, ReadingArticle, ReadingSeries, ArticleReading } from "@/types/reading";

export function hasEntitlement(reader: Reader, type: "subscription" | "series" | "single" | "event" | "skill", target: number | null, now = Date.now()): boolean {
  if (!reader.userId) return false;
  return reader.entitlements.some((entitlement) =>
    entitlement.user_id === reader.userId && entitlement.revoked_at === null &&
    (entitlement.ends_at === null || Date.parse(entitlement.ends_at) > now) &&
    entitlement.type === type && entitlement.target_id === target,
  );
}

/** 与 RLS 并行的服务端第二道防线；先检查对象归属与生命周期。 */
export function visible(reader: Reader, article: ReadingArticle, series: ReadingSeries | null = null, now = Date.now()): "hidden" | "preview" | "full" {
  if (!["published", "paused"].includes(article.status)) return "hidden";
  if (article.type === "chapter" && (!series || series.id !== article.series_id || !["published", "paused"].includes(series.status))) return "hidden";
  if (article.type === "blog" && article.series_id !== null) return "hidden";
  if (reader.userId && reader.owner) return "full";
  if (article.type === "chapter" && series?.readme_article_id === article.id) return "full";
  if (article.access === "public") return "full";
  if (!reader.userId) return "preview";
  if (article.access === "registered") return "full";
  const subscription = hasEntitlement(reader, "subscription", null, now);
  if (article.access === "subscriber") {
    return subscription || (series?.type === "event" && hasEntitlement(reader, "event", series.id, now)) ? "full" : "preview";
  }
  if (article.access === "paid") {
    return subscription ||
      (article.type === "chapter" && !!series && hasEntitlement(reader, "series", series.id, now)) ||
      (article.type === "blog" && hasEntitlement(reader, "single", article.id, now)) ? "full" : "preview";
  }
  return "preview";
}

/** 未授权时结构上不调用正文读取；RLS 再拒绝时仍只返回预览。 */
export async function readVisibleArticle(reader: Reader, article: ReadingArticle, series: ReadingSeries | null, readBody: () => Promise<string | null>): Promise<ArticleReading | null> {
  const decision = visible(reader, article, series);
  if (decision === "hidden") return null;
  if (decision === "preview") return { article, markdown: article.preview_md, full: false };
  const body = await readBody();
  if (body === null) {
    if (article.access === "public" || series?.readme_article_id === article.id) throw new Error("正文暂时不可用");
    return { article, markdown: article.preview_md, full: false };
  }
  return { article, markdown: body, full: true };
}
