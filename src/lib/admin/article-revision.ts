import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createPublisherStore } from "@/lib/publishing/server";
import { publish } from "@/lib/publishing/pipeline";
import type { PublishInput, Frontmatter } from "@/lib/publishing/types";

export class ArticleRevisionError extends Error {}

/** Only called after owner verification. Snapshots and bodies stay on the server. */
export async function reviseArticle(id: string, expected: string, requestId: string, change: { price: number } | { version: number }) {
  const store = createPublisherStore();
  const replay = await store.replay(requestId);
  if (replay) { for (const path of replay.revalidated) store.revalidate(path); return replay; }
  const client = createSupabaseServiceClient();
  const { data: article, error } = await client.from("articles").select("id,slug,title,type,access,price,summary,cover_url,tags,published_at,series_id,status,updated_at").eq("id", id).single();
  if (error || !article || article.status === "archived" || article.status === "draft") throw new ArticleRevisionError("当前内容无法修改，请刷新后确认状态。");
  if (article.updated_at !== expected) throw new ArticleRevisionError("内容已更新，请刷新后重试。");
  let input: Omit<PublishInput, "client_request_id">;
  if ("version" in change) {
    const { data, error } = await client.from("article_versions").select("snapshot").eq("article_id", id).eq("version", change.version).single();
    if (error || !data?.snapshot) throw new ArticleRevisionError("历史版本不可用。");
    input = data.snapshot as typeof input;
    if (!input.frontmatter || typeof input.markdown !== "string" || !Array.isArray(input.media)) throw new ArticleRevisionError("此历史记录没有完整发布快照，无法恢复。请选择通过发布工作台生成的版本。");
    if (input.frontmatter?.slug !== article.slug) throw new ArticleRevisionError("历史版本与当前文章不匹配。");
  } else {
    if (article.type !== "blog" || article.access !== "paid") throw new ArticleRevisionError("仅单篇付费博客可在此改价。");
    const { data: latest, error: latestError } = await client.from("article_versions").select("snapshot").eq("article_id", id).order("version", { ascending: false }).limit(1).maybeSingle();
    if (latestError) throw new ArticleRevisionError("版本暂时不可用。");
    const snapshot = latest?.snapshot as typeof input | undefined;
    if (snapshot && snapshot.frontmatter?.slug === article.slug && snapshot.frontmatter.access === "paid" && snapshot.frontmatter.type === "blog") {
      input = { ...snapshot, frontmatter: { ...snapshot.frontmatter, price: change.price } };
      return publish({ ...input, client_request_id: requestId }, { ...store, commit: (requestId, payload) => store.commit(requestId, { ...payload, expected_updated_at: expected }) });
    }
    const { data: body, error } = await client.from("article_bodies").select("content").eq("article_id", id).single();
    if (error || !body) throw new ArticleRevisionError("正文暂时不可用。");
    const frontmatter: Frontmatter = { title: article.title, slug: article.slug, type: "blog", access: "paid", price: change.price, tags: article.tags };
    if (article.summary) frontmatter.summary = article.summary;
    if (article.cover_url) frontmatter.cover = article.cover_url;
    if (article.published_at) frontmatter.published_at = article.published_at;
    input = { frontmatter, markdown: body.content, media: [] };
  }
  return publish({ ...input, client_request_id: requestId }, { ...store, commit: (requestId, payload) => store.commit(requestId, { ...payload, expected_updated_at: expected }) });
}
