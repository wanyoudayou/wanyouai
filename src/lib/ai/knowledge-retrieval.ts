import type { createSupabaseServiceClient } from "../supabase/service";
import type { Reader, ReadingArticle, ReadingSeries } from "@/types/reading";
import { visible } from "@/lib/reading/access";
import { gateHits, articleUrl, type GatedHit } from "@/lib/avatar/retrieve";
import { AIError } from "./connections";
import { knowledgeRPC } from "./knowledge";

type Service = ReturnType<typeof createSupabaseServiceClient>;
type Hit = { item_id: string; article_id: number | null; source_key: string; target: string; chunk_type: string; access: string; content: string; score: number };
export async function retrieveKnowledge(service: Service, reader: Reader, indexId: string, vector: number[], threshold: number, pins: string[] = []): Promise<GatedHit[]> {
  const hits = await knowledgeRPC(service, "match_knowledge", { p_generation: indexId, p_embedding: JSON.stringify(vector), p_threshold: threshold, p_limit: 24, p_pins: pins.slice(0, 3).map(slug => `article:${slug}`) }) as Hit[];
  if (!Array.isArray(hits)) throw new AIError("KNOWLEDGE_SEARCH_UNAVAILABLE");
  const ids = [...new Set(hits.map(hit => hit.article_id).filter((id): id is number => id !== null))];
  const articles = ids.length ? await service.from("articles").select("id,slug,series_id,type,title,summary,cover_url,tags,access,price,status,published_at,preview_md").in("id", ids) : { data: [], error: null };
  if (articles.error || !articles.data) throw new AIError("KNOWLEDGE_PERMISSION_UNAVAILABLE");
  const articleMap = new Map<number, ReadingArticle>(articles.data.map(article => [article.id, article as ReadingArticle]));
  const parentIds = [...new Set(articles.data.map(article => article.series_id).filter((id): id is number => id !== null))];
  const parents = parentIds.length ? await service.from("series").select("id,slug,type,title,readme_article_id,price,status,tags,task,audiences,featured,created_at,updated_at").in("id", parentIds) : { data: [], error: null };
  if (parents.error || !parents.data) throw new AIError("KNOWLEDGE_PERMISSION_UNAVAILABLE");
  const parentMap = new Map<number, ReadingSeries>(parents.data.map(series => [series.id, series as ReadingSeries]));
  const result: GatedHit[] = [];
  for (const hit of hits) {
    const article = hit.article_id === null ? null : articleMap.get(hit.article_id);
    const parent = article?.series_id == null ? null : parentMap.get(article.series_id) ?? null;
    if (hit.chunk_type === "qa") {
      // Only the explicit editorial publication, never a private conversation.
      if (hit.article_id !== null && (!article || visible(reader, article, parent) === "hidden")) continue;
      result.push({ articleId: hit.article_id ?? 0, title: article ? `公开问答 · ${article.title}` : "站内公开问答", access: "public", chunkType: "qa", gated: false, content: hit.content, url: article ? articleUrl(article, parent) : "/card" });
    } else if (article) result.push(...gateHits([{ chunk_id: 0, article_id: article.id, series_id: article.series_id, access: article.access, chunk_type: hit.chunk_type, chunk_no: 0, content: hit.content }], reader, articleMap, parentMap));
    if (result.length >= 10) break;
  }
  return result;
}
