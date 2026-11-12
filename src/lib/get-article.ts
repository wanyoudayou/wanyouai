import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getReader } from "@/lib/reading/viewer";
import { readVisibleArticle } from "@/lib/reading/access";
import type { Reader, ReadingArticle, ReadingSeries } from "@/types/reading";

export const ARTICLE_METADATA = "id, slug, series_id, type, title, summary, cover_url, tags, access, price, status, published_at, preview_md";

export const getBlogMetadata = cache(async (slug: string): Promise<ReadingArticle | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("articles").select(ARTICLE_METADATA)
    .eq("slug", slug).eq("type", "blog").in("status", ["published", "paused"]).maybeSingle();
  if (error) throw new Error("文章暂时无法加载");
  return data as ReadingArticle | null;
});

export async function getArticleReading(article: ReadingArticle, series: ReadingSeries | null, reader: Reader) {
  return readVisibleArticle(reader, article, series, async () => {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("article_bodies").select("content").eq("article_id", article.id).maybeSingle();
    if (error) throw new Error("正文暂时无法加载");
    return data?.content ?? null;
  });
}

export async function getBlogArticle(slug: string) {
  const article = await getBlogMetadata(slug);
  if (!article) return null;
  return getArticleReading(article, null, await getReader());
}
