import { authenticateHandbookPublisher } from "@/lib/handbooks/credentials";
import { handbookRead, handbookWrite } from "@/lib/handbooks/api";
import { readBoundedBody } from "@/lib/publishing/request-body";
import { ImportError } from "@/lib/importing/server";
import { MediaLibraryError } from "@/lib/media/types";
export const runtime = "nodejs";
export const maxDuration = 60;
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
type Context = { params: Promise<{ action: string }> };
async function handle(request: Request, context: Context, write: boolean) {
  try {
    const identity = await authenticateHandbookPublisher(request);
    if (!identity) return reply({ message: "手册发布凭据无效或已撤销。" }, 401);
    const { action } = await context.params;
    if (!write) return reply(await handbookRead(action, new URL(request.url).searchParams, identity));
    let body: Record<string, unknown>;
    try { body = JSON.parse((await readBoundedBody(request, 2 * 1024 * 1024)).toString("utf8")); if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(); }
    catch { return reply({ message: "请求无效或超过 2 MiB。" }, 422); }
    return reply(await handbookWrite(action, body, identity));
  } catch (error) {
    return reply({ code: error instanceof MediaLibraryError || error instanceof ImportError ? error.code : undefined, message: error instanceof ImportError || error instanceof MediaLibraryError ? error.message : "服务暂时不可用，请查询操作状态后再试。" }, error instanceof ImportError || error instanceof MediaLibraryError ? 409 : 503);
  }
}
export const GET = (request: Request, context: Context) => handle(request, context, false);
export const POST = (request: Request, context: Context) => handle(request, context, true);
