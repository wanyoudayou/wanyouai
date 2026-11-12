import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
/** Legacy series compatibility stays here; package delivery never reads skill_details. */
export async function legacySkillChapters(seriesId: number) {
  const db = await createSupabaseServerClient();
  const parent = await db.from("series").select("id,slug,readme_article_id").eq("id", seriesId).eq("type", "skill").in("status", ["published", "paused"]).maybeSingle();
  if (parent.error) throw new Error("原有章节暂时不可用。");
  if (!parent.data) return [];
  const slug = parent.data.slug;
  const items: { title: string; href: string }[] = [];
  for (let offset = 0; ; offset += 100) {
    const result = await db.from("articles").select("id,slug,title").eq("series_id", seriesId).in("status", ["published", "paused"]).order("sort_order").order("id").range(offset, offset + 99);
    if (result.error) throw new Error("原有章节暂时不可用。");
    items.push(...result.data.map(a => ({ title: a.title, href: `/skills/${slug}?article=${encodeURIComponent(a.slug)}` })));
    if (result.data.length < 100) return items;
  }
}
export async function unmappedLegacySkills() {
  const db = await createSupabaseServerClient();
  const items: { title: string; slug: string }[] = [];
  for (let offset = 0; ; offset += 100) {
    const result = await db.from("series").select("id,title,slug").eq("type", "skill").in("status", ["published", "paused"]).order("id").range(offset, offset + 99);
    if (result.error) throw new Error("原有技能暂时不可用。");
    if (result.data.length) {
      const mapped = await db.from("skills").select("legacy_series_id").in("legacy_series_id", result.data.map(s => s.id));
      if (mapped.error) throw new Error("技能目录暂时不可用。");
      items.push(...result.data.filter(s => !mapped.data.some(m => m.legacy_series_id === s.id)));
    }
    if (result.data.length < 100) return items;
  }
}
