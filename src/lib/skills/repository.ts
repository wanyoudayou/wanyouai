import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { parseListQuery, escapeLike, lastPage, type RawListQuery } from "@/lib/admin/list-query";
import { SkillError, type SkillSettings } from "./types";

export const skillColumns = "id,price,online_enabled,usage_guide,current_release,revision,legacy_series_id";
/** Uses the reader session and article RLS. No package data in this projection. */
export async function getSkill(slug: string) {
  const db = await createSupabaseServerClient();
  const article = await db.from("articles").select("id,slug,title,summary,cover_url,status,published_at").eq("slug", slug).eq("type", "skill").in("status", ["published", "paused"]).maybeSingle();
  if (article.error) throw new SkillError("Skill 暂时无法加载。", 503);
  if (!article.data) return null;
  const [settings, body] = await Promise.all([
    db.from("skills").select(skillColumns).eq("id", article.data.id).single(),
    db.from("article_bodies").select("content").eq("article_id", article.data.id).maybeSingle(),
  ]);
  if (settings.error || body.error) throw new SkillError("Skill 暂时无法加载。", 503);
  return { article: article.data, settings: settings.data as SkillSettings, markdown: body.data?.content ?? "" };
}
export async function getAdminSkill(id: number) {
  const db = await createSupabaseServerClient();
  const [article, settings] = await Promise.all([
    db.from("articles").select("id,title,slug,status").eq("id", id).eq("type", "skill").maybeSingle(),
    db.from("skills").select(skillColumns).eq("id", id).maybeSingle(),
  ]);
  if (article.error || settings.error) throw new SkillError("Skill 暂时无法加载。", 503);
  return article.data && settings.data ? { article: article.data, settings: settings.data as SkillSettings } : null;
}
export async function listSkills(raw: RawListQuery, owner = false) {
  const query = parseListQuery(raw);
  const db = await createSupabaseServerClient();
  const filter = () => {
    let request = db.from("articles").select("id,slug,title,summary,status,updated_at", { count: "exact" }).eq("type", "skill");
    if (!owner) request = request.in("status", ["published", "paused"]);
    else if (["draft", "published", "paused", "archived"].includes(query.status)) request = request.eq("status", query.status);
    if (query.q) request = request.ilike("title", `%${escapeLike(query.q)}%`);
    return request.order(query.sort === "title" ? "title" : "updated_at", { ascending: query.sort !== "newest" }).order("id", { ascending: false });
  };
  let result = await filter().range((query.page - 1) * query.pageSize, query.page * query.pageSize - 1);
  if (result.error || result.count === null) throw new SkillError("Skill 列表暂时无法读取。", 503);
  const last = lastPage(result.count, query.pageSize);
  if (query.page > last) { query.page = last; result = await filter().range((last - 1) * query.pageSize, last * query.pageSize - 1); }
  if (result.error || result.count === null) throw new SkillError("Skill 列表暂时无法读取。", 503);
  return { items: result.data ?? [], total: result.count, query };
}
export async function saveSkillSettings(data: Record<string, unknown>, owner: string) {
  const result = await createSupabaseServiceClient().rpc("save_skill_settings", { p_id: data.id, p_owner: owner, p_revision: data.revision, p_price: data.price, p_release: data.current_release, p_online: data.online_enabled, p_guide: data.usage_guide });
  if (result.error) throw new SkillError(result.error.message.includes("CONFLICT") ? "配置已在其他页面更新，请刷新后核对；本页未覆盖线上配置。" : "配置未保存，请检查版本、价格和使用说明。", 409);
  return { revision: result.data as number };
}

/** Homepage cards only read public metadata, never release manifests or file bytes. */
export async function skillShowcase(limit: number, currency: string) {
  const db = await createSupabaseServerClient();
  const result = await db.from("articles").select("id,slug,title,summary,cover_url,tags,featured,updated_at", { count: "exact" })
    .eq("type", "skill").eq("status", "published").order("featured", { ascending: false }).order("updated_at", { ascending: false }).order("id").limit(limit);
  if (result.error || result.count === null) throw new SkillError("Skill 目录暂时不可用。", 503);
  const settings = result.data.length ? await db.from("skills").select("id,price,current_release").in("id", result.data.map(a => a.id)) : { data: [], error: null };
  if (settings.error) throw new SkillError("Skill 目录暂时不可用。", 503);
  return { total: result.count, items: result.data.map(a => {
    const item = settings.data!.find(s => s.id === a.id);
    return { href: `/skills/${a.slug}`, kind: "skill" as const, title: a.title, summary: a.summary, coverUrl: a.cover_url,
      tags: a.tags ?? [], audiences: [], price: item?.current_release ? Number(item.price) : null, currency, featured: a.featured, updatedAt: a.updated_at };
  }) };
}
