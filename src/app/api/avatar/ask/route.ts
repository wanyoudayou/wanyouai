import { NextResponse } from "next/server";
import { getReader } from "@/lib/reading/viewer";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { answerAvatarQuestion } from "@/lib/avatar/answer";
import { providerJSON } from "@/lib/ai/transport";
import { object } from "@/lib/ai/connections";
import { loadAvatarRuntime } from "@/lib/ai/avatar-runtime";
import { sameSiteOrigin } from "@/lib/publishing/auth";
import { turnstileFromConfig, turnstileHostname } from "@/lib/turnstile";
import { loadTurnstileRuntime } from "@/lib/turnstile-config";

/**
 * 分身问答入口。检索全域走 service_role（注入分级在 answer 层按读者身份裁决）。
 * 匿名：需站点开启匿名入口 + 配置 Turnstile 且校验通过（未配置则匿名一律拒绝，如实提示登录）。
 */
export async function POST(request: Request) {
  try { return await answerRequest(request); }
  catch { return NextResponse.json({ message: "分身暂时不可用，请稍后重试。" }, { status: 503, headers: { "cache-control": "no-store" } }); }
}

async function answerRequest(request: Request) {
  if (!sameSiteOrigin(request.headers.get("origin"), process.env.SITE_URL)) return NextResponse.json({ message: "请求来源无效。" }, { status: 403 });
  const cancelled = new AbortController();
  const signal = AbortSignal.any([request.signal, cancelled.signal, AbortSignal.timeout(45_000)]);
  let body: { question?: unknown; pins?: unknown; turnstileToken?: unknown };
  try { body = object(await providerJSON(new Response(request.body), signal, 8192)); } catch { return NextResponse.json({ message: "请求格式无效或过大" }, { status: 400 }); }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question || Buffer.byteLength(question) > 1024) return NextResponse.json({ message: "问题为空或过长（最多 1024 UTF-8 字节）" }, { status: 400 });
  const pins = Array.isArray(body.pins) ? body.pins.filter((p): p is string => typeof p === "string" && /^[a-z0-9-]{1,120}$/.test(p)).slice(0, 3) : [];

  const reader = await getReader();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip");
  const service = createSupabaseServiceClient({ timeoutMs: 6_000, signal });
  const runtime = await loadAvatarRuntime(service);
  if (!runtime) return NextResponse.json({ message: "站主分身暂未就绪，请先浏览本站内容。" }, { status: 503, headers: { "cache-control": "no-store" } });

  if (!reader.userId && !reader.owner) {
    // 匿名：双条件（开关 + 人机校验），缺一不可
    const anonymousEntry = runtime.settings.anonymous_entry;
    const config = await loadTurnstileRuntime(service);
    const turnstile = turnstileFromConfig(config, turnstileHostname(), "avatar", (input, init) => fetch(input, {
      ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
    }));
    if (!anonymousEntry || !turnstile) {
      return NextResponse.json({ message: "分身对话需登录后使用。[免费注册 / 登录](/login)", status: "login_required" }, { status: 401 });
    }
    const token = typeof body.turnstileToken === "string" ? body.turnstileToken : "";
    if (!token || !(await turnstile.verify(token, ip))) {
      return NextResponse.json({ message: "人机校验未通过，请刷新后重试。", status: "turnstile_failed" }, { status: 403 });
    }
  }

  // 流式输出：text/plain 逐段吐出（生成层 SSE 实时转发；缓存/检索等非生成路径一次性吐出）。
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let streamed = false;
        const answer = await answerAvatarQuestion({
          service, reader, question, pins, signal,
          ip: ip ?? null,
          onToken: (delta) => {
            streamed = true;
            signal.throwIfAborted();
            controller.enqueue(encoder.encode(delta));
          },
        });
        // 非生成路径（缓存/检索直答/熔断降级/LLM 失败降级）不经 onToken：补发完整文本，避免空气泡。
        if (!signal.aborted && !streamed && answer.text) controller.enqueue(encoder.encode(answer.text));
        else if (!signal.aborted && streamed && answer.status === "degraded") controller.enqueue(encoder.encode(`\n\n${answer.text}`));

        // 会话落库（pending 待审核；失败只记日志不影响应答）；公开稿由站主另行编辑。
        // 匿名用户无 auth.users 行，会话不落库。
        if (reader.userId && !signal.aborted) {
          try {
            let articleId: number | null = null;
            if (pins.length === 1) {
              const { data: pin } = await service.from("articles").select("id").eq("slug", pins[0]).maybeSingle();
              articleId = pin?.id ?? null;
            }
            const { data: conversation } = await service
              .from("conversations")
              .insert({ article_id: articleId, user_id: reader.userId })
              .select("id")
              .single();
            if (conversation) {
              await service.from("conversation_messages").insert([
                { conversation_id: conversation.id, role: "user", content: question },
                { conversation_id: conversation.id, role: "avatar", content: answer.text },
              ]);
            }
          } catch {
            console.error("[avatar] 会话落库失败");
          }
        }
      } catch {
        console.error("[avatar] 流式应答中断");
        if (!signal.aborted) controller.enqueue(encoder.encode("分身暂时不可用，请稍后再试。"));
      } finally {
        if (!cancelled.signal.aborted) controller.close();
      }
    },
    cancel() { cancelled.abort(); },
  });
  return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

export const maxDuration = 60;
