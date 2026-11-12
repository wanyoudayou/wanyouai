import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getAdminIdentity } from "@/lib/admin/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { sameSiteOrigin } from "@/lib/publishing/auth";
import { customPageMessages } from "@/lib/custom-pages/design-contract";
import { prepareGeneratedPageDraft } from "@/lib/custom-pages/generated-draft";
import { loadAIConnection, loadAISettings } from "@/lib/ai/settings";
import { AIError, object } from "@/lib/ai/connections";
import { providerJSON } from "@/lib/ai/transport";
import { generate } from "@/lib/ai/generation";
import { withAICall } from "@/lib/ai/call-control";
export const runtime = "nodejs";
export const maxDuration = 60;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

/** Shared generation connection, isolated fixed design prompt. Never saves or publishes. */
export async function POST(request: Request) {
  if (!sameSiteOrigin(request.headers.get("origin"), process.env.SITE_URL)) return reply({ message: "请求来源无效。" }, 403);
  const identity = await getAdminIdentity();
  if (!identity.owner || !identity.user) return reply({ message: "需要站主身份。" }, 401);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45000)]);
  try {
    const body = object(await providerJSON(new Response(request.body), signal, 10000));
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt || prompt.length > 2000) return reply({ message: "请填写不超过 2000 字的页面需求。" }, 400);
    const context = body.context === "card" ? "card" : body.context === "section" ? "section" : "page";
    const id = typeof body.requestId === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.requestId) ? body.requestId : randomUUID();
    const service = createSupabaseServiceClient({ signal, timeoutMs: 6000 });
    const settings = await loadAISettings(service);
    if (!settings.generation_connection) return reply({ message: "请先在 AI 设置中配置并检查共享生成连接。" }, 503);
    const connection = await loadAIConnection(service, settings.generation_connection);
    if (!connection.verifiedAt) return reply({ message: "共享生成连接尚未检查通过，请前往 AI 设置。" }, 503);
    const result = await withAICall(service, { id, task: "page", connectionId: connection.id, userId: identity.user.id }, async () => {
      const result = await generate(connection, customPageMessages(prompt, context), { signal, maxTokens: 4000 });
      return { value: result.content, usage: result.usage };
    });
    const draft = prepareGeneratedPageDraft(result, context);
    if (draft.issues.length) return reply({ message: `生成结果未通过结构检查：${draft.issues.slice(0, 2).join("")} 编辑内容已保留。` }, 502);
    return reply({ html: draft.html });
  } catch (error) {
    const code = error instanceof AIError ? error.code : "GENERATION_INTERRUPTED";
    const message = code === "AI_CALL_MONTHLY_LIMIT" ? "本站本月生成次数已达上限。" : code === "AI_CALL_DAILY_LIMIT" || code === "AI_CALL_RATE_LIMIT" ? "生成次数已达当前上限，请稍后手动操作。" : "未得到完整结果，编辑内容已保留；已停止，不自动重试。";
    return reply({ message }, 502);
  }
}
