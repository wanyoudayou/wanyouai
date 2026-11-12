import { seriesPath } from "@/lib/content-kinds";
// 同 mailer.ts：本文件被 tsx 单测直接导入，故不 import "server-only"；服务端约束由调用方保证。
import { visible } from "@/lib/reading/access";
import type { Reader, ReadingArticle, ReadingSeries } from "@/types/reading";

/**
 * 分身检索与注入分级（产品契约 §4.6 红线）：
 * 检索全域（service_role 绕过 RLS）；命中后由代码验权——catalog/readme/preview 是公开样品直接注入，
 * body 仅当 visible()===full 注入原文片段，否则替换为节选占位（标题 + 访问级别 + 预览链接，不含价格）。
 */

export type ChunkHit = {
  chunk_id: number;
  article_id: number;
  series_id: number | null;
  access: string;
  chunk_type: string;
  chunk_no: number;
  content: string;
};

export type GatedHit = {
  articleId: number;
  title: string;
  access: string;
  chunkType: string;
  /** 注入上下文的内容：授权=原文片段；未授权=占位文本。 */
  content: string;
  gated: boolean;
  url: string;
};

const ACCESS_LABEL: Record<string, string> = {
  public: "公开",
  registered: "注册可读",
  subscriber: "订阅可读",
  paid: "付费可读",
};

export function articleUrl(
  article: { slug: string; type: string },
  series: { slug: string; type: string } | null,
): string {
  if (article.type === "skill") return `/skills/${article.slug}`;
  if (article.type === "blog") return `/blog/${article.slug}`;
  if (series) {
    return `${seriesPath(series)}?article=${encodeURIComponent(article.slug)}`;
  }
  return `/blog/${article.slug}`;
}

/**
 * 注入分级裁决（纯函数，红线测试直接断言）：
 * - 所有 chunk 先检查文章及父专辑的生命周期；
 * - catalog / readme / preview 样品 chunk：可见内容的公开面；
 * - body chunk：visible()==='full' 注入原文，否则注入占位（标题 + 访问级别 + 链接，绝不含正文与价格）。
 */
export function gateHits(
  hits: ChunkHit[],
  reader: Reader,
  articlesById: Map<number, ReadingArticle>,
  seriesById: Map<number, ReadingSeries>,
): GatedHit[] {
  const out: GatedHit[] = [];
  for (const hit of hits) {
    const article = articlesById.get(hit.article_id);
    if (!article) continue;
    const series =
      article.series_id !== null
        ? (seriesById.get(article.series_id) ?? null)
        : null;
    const level = visible(reader, article, series);
    if (level === "hidden") continue;
    const url = articleUrl(article, series);
    if (["catalog", "readme", "preview"].includes(hit.chunk_type)) {
      out.push({
        articleId: article.id,
        title: article.title,
        access: hit.access,
        chunkType: hit.chunk_type,
        content: hit.content,
        gated: false,
        url,
      });
      continue;
    }
    if (hit.chunk_type !== "body") continue;
    if (level === "full") {
      out.push({
        articleId: article.id,
        title: article.title,
        access: hit.access,
        chunkType: "body",
        content: hit.content,
        gated: false,
        url,
      });
    } else if (level === "preview") {
      out.push({
        articleId: article.id,
        title: article.title,
        access: hit.access,
        chunkType: "body",
        content: `《${article.title}》（${ACCESS_LABEL[hit.access] ?? hit.access}）——该内容未解锁，仅提供试读：${url}`,
        gated: true,
        url,
      });
    }
    // hidden（草稿/归档/孤儿章节）：不进入结果
  }
  return out;
}
