import { NextResponse } from "next/server";
import { getAdminIdentity } from "@/lib/admin/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { sameSiteOrigin } from "@/lib/publishing/auth";
import { AIError, object } from "@/lib/ai/connections";
import { loadAISettings, loadAIConnection, aiSettingsView } from "@/lib/ai/settings";
import { probeConnection } from "@/lib/ai/probe";
import { withAICall } from "@/lib/ai/call-control";
import { providerJSON } from "@/lib/ai/transport";

export const runtime = "nodejs";
export const maxDuration = 60;
const reply = (message: string, status: number) => NextResponse.json({ message }, { status, headers: { "cache-control": "no-store" } });
export async function POST(request: Request) {
  if (!sameSiteOrigin(request.headers.get("origin"), process.env.SITE_URL)) return reply("请求来源无效。", 403);
  const identity = await getAdminIdentity();
  if (!identity.owner || !identity.user) return reply("需要站主身份。", 401);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(40000)]);
  try {
    const input = object(await providerJSON(new Response(request.body), signal, 4096));
    if (input.consent !== true || !["generation", "embedding"].includes(String(input.purpose)) || typeof input.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) return reply("请确认检查范围后操作。", 400);
    const service = createSupabaseServiceClient({ signal, timeoutMs: 6000 });
    const settings = await loadAISettings(service);
    const id = input.purpose === "generation" ? settings.generation_connection : settings.embedding_connection;
    if (!id) return reply("请先保存对应连接。", 409);
    const connection = await loadAIConnection(service, id);
    await withAICall(service, { id: input.requestId, task: input.purpose === "generation" ? "generation_probe" : "embedding_probe", connectionId: id, userId: identity.user.id }, async () => {
      const result = await probeConnection(connection, signal);
      const { error } = await service.from("ai_connections").update({ verified_at: new Date().toISOString(), probe_summary: result.summary }).eq("id", id);
      if (error) throw new AIError("PROBE_RESULT_NOT_SAVED");
      return { value: true, usage: result.usage };
    });
    const refreshed = await service.rpc("refresh_ai_public_state");
    if (refreshed.error) throw new AIError("AI_PUBLIC_STATE_UNCONFIRMED");
    return NextResponse.json({ message: input.purpose === "embedding" ? "向量连接检查通过：1024 维、批量响应及语义检查正常。下一步：建立知识库索引。" : "生成连接检查通过：普通响应与流式响应正常。分身还需已启用的知识库。", view: await aiSettingsView(service) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const code = error instanceof AIError ? error.code : "PROBE_INTERRUPTED";
    const limits: Record<string, string> = {
      AI_CALL_RATE_LIMIT: "检查过于频繁，请稍后手动重试。", AI_CALL_DAILY_LIMIT: "今日连接检查次数已达上限。",
      AI_CALL_DUPLICATE: "这次检查已处理，请刷新查看结果，不重复发送。",
    };
    const http: Record<number, string> = {
      401: "供应商拒绝了 API Key，请核对该供应商的 Key 后重新保存。",
      403: "供应商拒绝访问，请核对账户和模型使用权限。",
      404: "供应商未找到目标模型或接口，请核对模型标识。",
      429: "供应商调用频率或配额已达限制，请在控制台核对后稍后手动检查。",
      503: "供应商暂时不可用，请稍后手动检查。",
      504: "供应商响应超时，结果未确认，请先查看已保存的检查状态。",
    };
    return reply(limits[code] ?? (error instanceof AIError && error.httpStatus ? http[error.httpStatus] : undefined) ?? `连接检查未完成（${code}）；未自动重试，请核对配置。`, 502);
  }
}
