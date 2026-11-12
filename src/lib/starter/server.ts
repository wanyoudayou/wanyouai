import "server-only";
import template from "@/generated/starter-content.json";
import { getAdminIdentity } from "@/lib/admin/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createPublisherStore } from "@/lib/publishing/server";
import { publish } from "@/lib/publishing/pipeline";
import { contentHash } from "@/lib/publishing/validate";
import { sanitizeCustomHtml } from "@/lib/custom-pages/sanitize";
import type { PublishInput, PublishResponse } from "@/lib/publishing/types";

export type StarterStatus = {
  available: boolean;
  completed: boolean;
  started: boolean;
  empty: boolean;
  count: number;
};
export async function getStarterStatus(): Promise<StarterStatus> {
  if (!(await getAdminIdentity()).owner) throw new Error("需要站主身份");
  try {
    const client = await createSupabaseServerClient();
    const [job, articles, pages, series] = await Promise.all([
      client
        .from("starter_imports")
        .select("completed,published_count")
        .eq("id", template.id)
        .maybeSingle(),
      client.from("articles").select("id", { head: true, count: "exact" }),
      client.from("custom_pages").select("id", { head: true, count: "exact" }),
      client.from("series").select("id", { head: true, count: "exact" }),
    ]);
    if (
      [job, articles, pages, series].some((result) => result.error) ||
      [articles, pages, series].some((result) => result.count === null)
    )
      throw new Error();
    return {
      available: true,
      completed: job.data?.completed === true,
      started: !!job.data,
      empty: !articles.count && !pages.count && !series.count,
      count: Number(job.data?.published_count ?? 0),
    };
  } catch {
    return {
      available: false,
      completed: false,
      started: false,
      empty: false,
      count: 0,
    };
  }
}

/** One checkpoint per request; replay and the cursor advance share a DB transaction. */
export async function publishNextStarterChapter() {
  if (!(await getAdminIdentity()).owner) throw new Error("OWNER_REQUIRED");
  const client = createSupabaseServiceClient({ timeoutMs: 8000 });
  const articles = template.articles as PublishInput[];
  const descriptors = articles.map((input) => ({
    slug: input.frontmatter.slug,
    title: input.frontmatter.title,
    content_hash: contentHash(input),
  }));
  const prepared = await client.rpc("prepare_starter_content", {
    p_hash: template.hash,
    p_html: sanitizeCustomHtml(template.pricing),
    p_articles: descriptors,
  });
  if (prepared.error) {
    if (prepared.error.message.includes("STARTER_SLUG_CONFLICT"))
      throw new Error("STARTER_SLUG_CONFLICT");
    if (prepared.error.message.includes("STARTER_TEMPLATE_CHANGED"))
      throw new Error("STARTER_TEMPLATE_CHANGED");
    throw new Error("STARTER_UNAVAILABLE");
  }
  const job = await client
    .from("starter_imports")
    .select("published_count,completed")
    .eq("id", template.id)
    .single();
  if (job.error || !job.data) throw new Error("STARTER_UNAVAILABLE");
  if (job.data.completed) return { count: 8, completed: true };
  const input = articles[Number(job.data.published_count)];
  if (!input) throw new Error("STARTER_CONTENT_CHANGED");
  const store = createPublisherStore();
  const response = await publish(input, {
    ...store,
    // The parent/page stay draft until completion. Invalidate once after activation.
    revalidate() {},
    onPublished: undefined,
    async replay(id) {
      const { data, error } = await client
        .from("publish_requests")
        .select("response")
        .eq("client_request_id", id)
        .maybeSingle();
      if (error) throw new Error("STARTER_UNAVAILABLE");
      return (data?.response ?? null) as PublishResponse | null;
    },
    async commit(id, payload) {
      const { data, error } = await client.rpc("commit_starter_publication", {
        p_request_id: id,
        p_payload: payload,
      });
      if (error || !data)
        throw new Error(
          error?.message.includes("STARTER_CONTENT_CHANGED")
            ? "STARTER_CONTENT_CHANGED"
            : "STARTER_UNAVAILABLE",
        );
      return data as PublishResponse;
    },
  });
  if (response.status === "blocked") throw new Error("STARTER_CONTENT_CHANGED");
  const after = await client
    .from("starter_imports")
    .select("published_count,completed")
    .eq("id", template.id)
    .single();
  if (after.error || !after.data) throw new Error("STARTER_UNAVAILABLE");
  return {
    count: Number(after.data.published_count),
    completed: after.data.completed === true,
  };
}
