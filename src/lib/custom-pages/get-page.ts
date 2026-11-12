import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sanitizeCustomHtml } from "@/lib/custom-pages/sanitize";
import { seriesPath } from "@/lib/content-kinds";

export interface CustomPageRow {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  html: string;
  status: string;
  nav_label: string | null;
  nav_order: number;
  placement: "nav" | "footer" | "none";
  updated_at: string;
}

/** 自定义页读取：RLS 只放行 published；草稿/归档对前台即 404。 */
export async function getCustomPage(
  slug: string,
): Promise<CustomPageRow | null> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("custom_pages")
    .select(
      "id, slug, title, description, html, status, nav_label, nav_order, placement, updated_at",
    )
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw new Error("页面暂时不可用");
  if (!data) return null;
  // 读取时净化：保存管线已净化，这里是防御纵深——保证 RSC 载荷与渲染都不携带未净化 HTML
  return {
    ...(data as CustomPageRow),
    html: sanitizeCustomHtml((data as CustomPageRow).html),
  };
}

/** 指定发布位置的已发布自定义页（nav=左栏 / footer=页脚；按 nav_order 排）。 */
async function getPlacedPages(
  placement: "nav" | "footer",
): Promise<{ href: string; label: string; order: number }[]> {
  const client = await createSupabaseServerClient();
  const items: { href: string; label: string; order: number }[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client
      .from("custom_pages")
      .select("slug, title, nav_label, nav_order")
      .eq("status", "published")
      .eq("placement", placement)
      .order("nav_order", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + 499);
    if (error) {
      console.error("[getPlacedPages]", error.message);
      throw new Error("导航暂时不可用");
    }
    items.push(
      ...(data ?? []).map((row) => ({
        href: `/p/${row.slug}`,
        label: (row.nav_label as string | null) || (row.title as string),
        order: Number(row.nav_order),
      })),
    );
    if ((data?.length ?? 0) < 500) break;
  }
  return items;
}

/** 左栏导航里的自定义页。 */
export async function getNavPages() {
  const pages = await getPlacedPages("nav");
  const client = await createSupabaseServerClient();
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client
      .from("series")
      .select("id,slug,type,title,nav_label,nav_order")
      .eq("nav_enabled", true)
      .in("status", ["published", "paused"])
      .order("nav_order")
      .order("id")
      .range(offset, offset + 499);
    if (error) throw new Error("专辑导航暂时不可用");
    pages.push(
      ...(data ?? []).map((row) => ({
        href: seriesPath(row),
        label: row.nav_label || row.title,
        order: Number(row.nav_order),
      })),
    );
    if ((data?.length ?? 0) < 500) break;
  }
  return pages.sort(
    (a, b) => a.order - b.order || a.href.localeCompare(b.href),
  );
}

/** 页脚链接区里的自定义页。 */
export function getFooterPages() {
  return getPlacedPages("footer");
}
