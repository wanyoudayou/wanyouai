import { getAdminIdentity } from "@/lib/admin/session";
import { sameSiteOrigin } from "@/lib/publishing/auth";
import { readBoundedBody } from "@/lib/publishing/request-body";
import { pendingRevisions, publishBatch, batchStatus } from "@/lib/importing/batch";
import {
  ImportError,
  inventory,
  inspectCandidate,
  stageCandidate,
  reviewRevision,
  publishRevision,
  uploadAsset,
  linkLibraryAsset,
  orderFiles,
} from "@/lib/importing/server";
export const runtime = "nodejs";
export const maxDuration = 60;
const reply = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  try {
    if (
      !sameSiteOrigin(request.headers.get("origin"), process.env.SITE_URL) ||
      !(await getAdminIdentity()).owner
    )
      return reply({ message: "需要站主登录。" }, 401);
    if (
      request.headers.get("content-type")?.startsWith("multipart/form-data")
    ) {
      let form: FormData;
      try {
        const bytes = await readBoundedBody(request, 12 * 1024 * 1024);
        form = await new Request(request.url, {
          method: "POST",
          headers: request.headers,
          body: new Uint8Array(bytes),
        }).formData();
      } catch {
        return reply({ message: "附件请求无效或超过 12 MiB。" }, 422);
      }
      const file = form.get("file");
      if (!(file instanceof File) || file.size > 10 * 1024 * 1024)
        return reply({ message: "请选择 10 MiB 以内的图片。" }, 422);
      return reply(
        await uploadAsset(
          String(form.get("scope")),
          String(form.get("path")),
          file,
          form.get("expected") ? String(form.get("expected")) : null,
        ),
      );
    }
    let data;
    try {
      data = JSON.parse(
        (await readBoundedBody(request, 2 * 1024 * 1024)).toString("utf8"),
      );
    } catch {
      return reply({ message: "请求无效或超过 2 MiB。" }, 422);
    }
    if (data.op === "batchList" && Number.isSafeInteger(data.series) && data.series > 0)
      return reply(await pendingRevisions(data.series));
    if (data.op === "batchPublish") return reply(await publishBatch(data.input));
    if (data.op === "batchStatus" && typeof data.request === "string") return reply(await batchStatus(data.request));
    if (data.op === "inventory" && typeof data.scope === "string")
      return reply(await inventory(data.scope));
    if (
      data.op === "linkAsset" &&
      typeof data.scope === "string" &&
      typeof data.path === "string" &&
      typeof data.uploadId === "string" &&
      /^[a-f0-9-]{36}$/.test(data.uploadId) &&
      (data.expected === null || typeof data.expected === "string")
    )
      return reply(
        await linkLibraryAsset(
          data.scope,
          data.path,
          data.uploadId,
          data.expected,
        ),
      );
    if (data.op === "order" && typeof data.scope === "string")
      return reply(await orderFiles(data.scope, data.ids));
    if (data.op === "compare")
      return reply(await inspectCandidate(data.candidate));
    if (
      data.op === "stage" &&
      Number.isSafeInteger(data.expected) &&
      data.expected >= 0
    )
      return reply(await stageCandidate(data.candidate, data.expected));
    if (
      ["review", "publish"].includes(data.op) &&
      Number.isSafeInteger(data.id) &&
      data.id > 0
    )
      return reply(
        data.op === "review"
          ? await reviewRevision(data.id)
          : await publishRevision(data.id),
      );
    return reply({ message: "未知操作。" }, 422);
  } catch (error) {
    return reply(
      {
        message:
          error instanceof ImportError
            ? error.message
            : "服务暂时不可用，请保留文件后重试。",
      },
      error instanceof ImportError ? 422 : 500,
    );
  }
}
