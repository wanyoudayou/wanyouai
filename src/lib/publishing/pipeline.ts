import { inspectMarkdown } from "./markdown";
import { resolveMedia, type MediaStore } from "./media";
import { blocked, diagnostic, type PublishInput, type PublishResponse } from "./types";
import { contentHash, validEnvelope, validateFrontmatter } from "./validate";

export type PublisherStore = {
  replay(id: string): Promise<PublishResponse | null>;
  commit(id: string, payload: object): Promise<PublishResponse>;
  media: MediaStore;
  revalidate(path: string): void;
  /** 发布后置钩子（仅新发布、非重放）：用于切片 embedding。实现方必须自吞异常。 */
  onPublished?(slug: string): Promise<void>;
};

/** Shared validation for individual and atomic batch publication. No database writes. */
export async function preparePublication(value: PublishInput, mediaStore: MediaStore) {
  const diagnostics = validateFrontmatter(value.frontmatter);
  if (!diagnostics.length) diagnostics.push(...inspectMarkdown(value.markdown, value.frontmatter.access).diagnostics);
  if (diagnostics.some(entry => entry.severity === "error")) return blocked(diagnostics);
  const media = await resolveMedia(value, mediaStore);
  diagnostics.push(...media.diagnostics);
  if (diagnostics.some(entry => entry.severity === "error")) return blocked(diagnostics);
  return {
    frontmatter: value.frontmatter, markdown: media.markdown,
    preview: inspectMarkdown(media.markdown, value.frontmatter.access).preview,
    cover: media.cover, content_hash: contentHash(value),
    snapshot: { frontmatter: value.frontmatter, markdown: value.markdown, media: value.media }, diagnostics,
  };
}

/** Caller must authenticate before invoking this server-side pipeline. */
export async function publish(value: unknown, store: PublisherStore): Promise<PublishResponse> {
  if (!validEnvelope(value)) return blocked([diagnostic("SCHEMA_INVALID", "请求结构不符合发布契约。")]);
  let result = await store.replay(value.client_request_id);
  const replayed = result !== null;
  if (!result) {
    result = await store.commit(value.client_request_id, await preparePublication(value, store.media));
  }
  // Persist first, invalidate second. A failed/aborted response retries invalidation
  // from the durable first response without touching content or version history.
  for (const path of result.revalidated) store.revalidate(path);
  if (!replayed && result.status === "pass" && result.article && store.onPublished) await store.onPublished(result.article.slug);
  return result;
}
