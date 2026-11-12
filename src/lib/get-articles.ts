import "server-only";

import { getListOwnership } from "@/lib/get-list-ownership";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ArticleCardRow } from "@/types/database";
import type { ArticleCardData } from "@/types/content";

/** /blog 列表：全部 published 博客（仅元数据，永不触碰正文）。 */
export async function getBlogArticles(): Promise<ArticleCardData[]> {
  const supabase = await createSupabaseServerClient();
  const [{ data, error }, isOwned] = await Promise.all([supabase
      .from("articles")
      .select("id, slug, title, summary, cover_url, tags, access, price, published_at")
      .eq("type", "blog")
      .eq("status", "published")
      .order("published_at", { ascending: false }), getListOwnership(supabase)]);
  if (error) throw new Error("无法加载博客列表");
  return ((data ?? []) as ArticleCardRow[]).map((row) => ({
      href: `/blog/${row.slug}`,
      title: row.title,
      summary: row.summary,
      coverUrl: row.cover_url,
      tags: row.tags ?? [],
      access: row.access,
      price: row.price === null ? null : Number(row.price),
      publishedAt: row.published_at,
      owned: row.access === "paid" && isOwned("single", row.id),
    }));
}
