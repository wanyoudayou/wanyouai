import { readBoundedBody } from "@/lib/publishing/request-body";
import { authenticatePublisher, createPublisherStore } from "@/lib/publishing/server";
import { publish } from "@/lib/publishing/pipeline";
import { blocked, diagnostic, type PublishResponse } from "@/lib/publishing/types";

export const runtime = "nodejs";
function response(body: PublishResponse, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  try {
    if (!await authenticatePublisher(request)) return response(blocked([diagnostic("UNAUTHORIZED", "valid publisher identity required")]), 401);
    let input: unknown;
    try {
      if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new Error();
      input = JSON.parse((await readBoundedBody(request, 2 * 1024 * 1024)).toString("utf8"));
    } catch {
      return response(blocked([diagnostic("SCHEMA_INVALID", "需要有效 JSON 请求，大小不超过 2 MiB。")]), 422);
    }
    const result = await publish(input, createPublisherStore());
    return response(result, result.status === "blocked" ? 422 : 200);
  } catch {
    return response(blocked([diagnostic("UNEXPECTED_ERROR", "发布暂时不可用，请保留原请求 ID 重试。")]), 500);
  }
}
