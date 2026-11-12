import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";
import { getSiteUrl } from "@/lib/site-url";
import { seriesPath } from "@/lib/content-kinds";
import { supabaseRequestOptions } from "@/lib/supabase/request-options";
export const dynamic = "force-dynamic";
type Row = {
  id: number;
  slug: string;
  status: string;
  updated_at: string;
  type?: string;
  series_id?: number | null;
  readme_article_id?: number | null;
};
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = getSiteUrl(),
    endpoint = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!origin || !endpoint || !key) throw new Error("公开目录配置不可用");
  const signal = AbortSignal.timeout(10000);
  const client = createClient(endpoint, key, {
    ...supabaseRequestOptions({ signal, timeoutMs: 6000 }),
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  async function read(
    table: "series" | "articles" | "services" | "custom_pages",
    select: string,
  ) {
    const rows: Row[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client
        .from(table)
        .select(select)
        .in(
          "status",
          table === "custom_pages" ? ["published"] : ["published", "paused"],
        )
        .order("id")
        .range(offset, offset + 499);
      if (error) throw new Error("公开目录暂时不可用");
      rows.push(...(data as unknown as Row[]));
      if (data.length < 500) return rows;
    }
  }
  const [series, articles, services, pages] = await Promise.all([
    read("series", "id,slug,type,status,readme_article_id,updated_at"),
    read("articles", "id,slug,type,series_id,status,updated_at"),
    read("services", "id,slug,status,updated_at"),
    read("custom_pages", "id,slug,status,updated_at"),
  ]);
  const parents = new Map(series.map((row) => [row.id, row]));
  const result: MetadataRoute.Sitemap = [
    "/",
    "/blog",
    "/collections",
    "/handbooks",
    "/skills",
    "/events",
    "/services",
    "/card",
  ].map((path) => ({ url: new URL(path, origin).toString() }));
  const add = (path: string, row: Row) =>
    result.push({
      url: new URL(path, origin).toString(),
      ...(Number.isFinite(Date.parse(row.updated_at))
        ? { lastModified: row.updated_at }
        : {}),
    });
  for (const row of series)
    add(seriesPath({ type: row.type!, slug: row.slug }), row);
  for (const row of articles) {
    if (row.type === "skill" && row.series_id === null) add(`/skills/${encodeURIComponent(row.slug)}`, row);
    if (row.type === "blog" && row.series_id === null)
      add(`/blog/${encodeURIComponent(row.slug)}`, row);
    const parent = row.series_id ? parents.get(row.series_id) : null;
    if (row.type === "chapter" && parent && parent.readme_article_id !== row.id)
      add(
        `${seriesPath({ type: parent.type!, slug: parent.slug })}?article=${encodeURIComponent(row.slug)}`,
        row,
      );
  }
  for (const row of services)
    add(`/services/${encodeURIComponent(row.slug)}`, row);
  for (const row of pages) add(`/p/${encodeURIComponent(row.slug)}`, row);
  return result;
}
