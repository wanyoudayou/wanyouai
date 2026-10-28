import "server-only";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createPublisherStore } from "@/lib/publishing/server";
import { preparePublication } from "@/lib/publishing/pipeline";
import { ImportError, reviewRevision } from "./server";
import type { PublishResponse } from "@/lib/publishing/types";

export type BatchInput = {
  series: number;
  expected: string;
  request: string;
  ids: number[];
  activate: boolean;
  readme: string | null;
};
export type PendingRevision = {
  id: number;
  version: number;
  path: string;
  slug: string;
  title: string;
  access: string;
};
export type BatchResult = {
  ok: boolean;
  message: string;
  problems?: { id: number; message: string }[];
  results?: PublishResponse[];
  activated?: boolean;
};
export async function pendingRevisions(
  series: number,
): Promise<{ total: number; items: PendingRevision[] }> {
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("series_pending_revisions", {
    p_id: series,
  });
  if (error || !data)
    throw new ImportError("待发布更新暂时无法读取，请确认数据库升级已完成。");
  return data;
}
function validate(input: BatchInput) {
  if (
    !input ||
    typeof input !== "object" ||
    !Number.isSafeInteger(input.series) ||
    input.series < 1 ||
    !Number.isFinite(Date.parse(input.expected)) ||
    !/^[a-f0-9-]{36}$/.test(input.request) ||
    typeof input.activate !== "boolean" ||
    !Array.isArray(input.ids) ||
    !input.ids.length ||
    input.ids.length > 500 ||
    new Set(input.ids).size !== input.ids.length ||
    input.ids.some((id) => !Number.isSafeInteger(id) || id < 1) ||
    !(
      input.readme === null ||
      (typeof input.readme === "string" &&
        /^[a-z0-9-]{2,120}$/.test(input.readme))
    )
  )
    throw new ImportError("发布范围无效，请重新读取待发布更新。");
}
export async function publishBatch(input: BatchInput): Promise<BatchResult> {
  try {
    validate(input);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
  const startedAt = Date.now();
  const db = createSupabaseServiceClient({ timeoutMs: 30000 });
  const args = {
    p_series: input.series,
    p_expected: input.expected,
    p_request: input.request,
    p_activate: input.activate,
    p_readme: input.readme,
  };
  const old = await db
    .from("publish_requests")
    .select("id")
    .eq("client_request_id", `series-batch:${input.request}`)
    .maybeSingle();
  if (old.error) throw new ImportError("发布结果无法确认，请稍后查询原任务。");
  const items: { id: number; payload?: object }[] = [];
  if (old.data) items.push(...input.ids.map((id) => ({ id })));
  else {
    const owner = await createSupabaseServerClient();
    const album = await owner
      .from("series")
      .select("slug,updated_at,status")
      .eq("id", input.series)
      .single();
    if (
      album.error ||
      !album.data ||
      album.data.updated_at !== input.expected ||
      album.data.status === "archived"
    )
      return {
        ok: false,
        message: "专辑设置已变化，请刷新清单并重新核对发布范围。",
      };
    const store = createPublisherStore();
    const problems: NonNullable<BatchResult["problems"]> = [];
    let payloadBytes = 2;
    // Bounded parallel validation, with no content publication until every selected item passes.
    for (let offset = 0; offset < input.ids.length; offset += 4) {
      const group = await Promise.all(
        input.ids.slice(offset, offset + 4).map(async (id) => {
          try {
            const revision = await reviewRevision(id);
            if (revision.scope !== `series:${album.data.slug}`)
              throw new ImportError("文稿不属于当前专辑。");
            const payload = await preparePublication(
              { ...revision.snapshot, client_request_id: revision.request_id },
              store.media,
            );
            if ("status" in payload)
              return {
                id,
                problem: payload.diagnostics.map((d) => d.message).join("；"),
              };
            return { id, payload };
          } catch (error) {
            return {
              id,
              problem:
                error instanceof ImportError
                  ? error.message
                  : "校验暂时失败，请重新检查此文稿。",
            };
          }
        }),
      );
      for (const entry of group) {
        if (entry.problem)
          problems.push({ id: entry.id, message: entry.problem });
        else if (entry.payload) {
          const prepared = { id: entry.id, payload: entry.payload };
          payloadBytes += Buffer.byteLength(JSON.stringify(prepared)) + 1;
          if (payloadBytes > 8 * 1024 * 1024)
            return { ok: false, message: "本批正文超过 8 MiB，尚未发布。请减少选中文稿后分批发布。" };
          items.push(prepared);
        }
      }
      // Leave time for the atomic database commit and its result to reach the client.
      if (Date.now() - startedAt > 20000)
        return { ok: false, message: "本批校验耗时较长，尚未发布。请减少选中文稿后分批发布。" };
    }
    if (problems.length)
      return {
        ok: false,
        message:
          "本批没有发布任何章节。请修正下列问题，或明确取消选择这些文稿。",
        problems,
      };
  }
  const { data, error } = await db.rpc("commit_series_publication", {
    ...args,
    p_items: items,
  });
  if (error || !data) {
    if (error?.message?.startsWith("BATCH_"))
      return {
        ok: false,
        message:
          "本批未发布：文稿、专辑或 README 已变化，或尚未配置活动详情。请刷新清单，重新核对后发布。",
      };
    throw new ImportError(
      "发布结果尚未确认。请先点击“查询本次发布结果”，不要新建重复任务。",
    );
  }
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `已发布 ${data.results.length} 篇文稿${data.activated ? "并上架专辑" : ""}。`,
    results: data.results,
    activated: data.activated,
  };
}
export async function batchStatus(request: string): Promise<BatchResult> {
  if (!/^[a-f0-9-]{36}$/.test(request)) throw new ImportError("任务标识无效。");
  const db = await createSupabaseServerClient();
  const { data, error } = await db
    .from("publish_requests")
    .select("response")
    .eq("client_request_id", `series-batch:${request}`)
    .maybeSingle();
  if (error)
    throw new ImportError("查询暂时不可用，请保留此页面，稍后重试查询。");
  if (!data)
    return {
      ok: false,
      message:
        "尚未查到完成记录。可以重试同一任务；系统会核对原任务，不会重复创建版本。",
    };
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `已确认发布 ${data.response.results.length} 篇文稿。`,
    results: data.response.results,
    activated: data.response.activated,
  };
}
