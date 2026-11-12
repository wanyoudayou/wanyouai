import { NextResponse } from "next/server";
import { getReader } from "@/lib/reading/viewer";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { parseInquiryInput, InquiryError } from "@/lib/services/inquiry-input";
import { turnstileFromConfig, turnstileHostname } from "@/lib/turnstile";
import { loadTurnstileRuntime } from "@/lib/turnstile-config";
import { mailerFromEnv, renderMailHtml, escapeHtml } from "@/lib/mailer";
import { sameSiteOrigin } from "@/lib/publishing/auth";
import { readBoundedJson } from "@/lib/publishing/request-body";
import { getSiteConfig } from "@/lib/get-site-config";
import { clientAddress, consumeDailyLimit } from "@/lib/request-limit";

/** 服务询价（PRD §4.4）：人类表单与 Agent 同构入口。询价单与站主收件箱同事务落库 + 邮件提醒。 */
const DAILY_LIMIT = 3;

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await readBoundedJson(request, 16 * 1024); } catch { return NextResponse.json({ message: "请求格式无效" }, { status: 400 }); }
  let input;
  try { input = parseInquiryInput(body); } catch (error) {
    return NextResponse.json({ message: error instanceof InquiryError ? error.message : "请求格式无效" }, { status: 400 });
  }

  const reader = await getReader();
  // 带登录会话的请求必须来自本站页面；Agent 按 card.json 匿名提交不受影响。
  if (reader.userId && !sameSiteOrigin(request.headers.get("origin"), process.env.SITE_URL)) {
    return NextResponse.json({ message: "请求来源无效。" }, { status: 403 });
  }
  const ip = clientAddress(request);
  const service = createSupabaseServiceClient({ timeoutMs: 8000 });

  // 联系邮箱：登录用户取账户邮箱；匿名必须留邮箱，且配置了 Turnstile 时需过人机校验
  let email = input.contactEmail;
  if (reader.userId) {
    email = (await service.auth.admin.getUserById(reader.userId)).data.user?.email ?? email;
  } else {
    if (!email) return NextResponse.json({ message: "请留下联系邮箱，或登录后提交。" }, { status: 400 });
    let config;
    try { config = await loadTurnstileRuntime(service); }
    catch { return NextResponse.json({ message: "人机校验暂时不可用，请稍后重试。" }, { status: 503 }); }
    const turnstile = turnstileFromConfig(config, turnstileHostname(), "inquiry");
    if (turnstile) {
      const token = typeof body.turnstile_token === "string" ? body.turnstile_token : "";
      if (!token || !(await turnstile.verify(token, ip))) {
        return NextResponse.json({ message: "人机校验未通过，请刷新后重试。" }, { status: 403 });
      }
    }
  }
  if (!email) return NextResponse.json({ message: "暂时无法确定联系邮箱，请留下邮箱后重试。" }, { status: 400 });

  const site = await getSiteConfig();
  let allowed: boolean;
  try { allowed = await consumeDailyLimit(service, `inquiry:${reader.userId ? `user:${reader.userId}` : `ip:${ip}`}`, DAILY_LIMIT, site.identity.timezone); }
  catch { return NextResponse.json({ message: "提交暂时不可用，请稍后再试。" }, { status: 503 }); }
  if (!allowed) return NextResponse.json({ message: "今日询价次数已达上限，请明天再来。" }, { status: 429 });

  const { data, error } = await service.rpc("submit_service_inquiry", {
    p_service_slug: input.slug, p_user: reader.userId, p_email: email, p_intent: input.intent,
    p_budget: input.budgetRange, p_deadline: input.deadline, p_links: input.contextLinks, p_ip: ip,
  });
  if (error || !data) return NextResponse.json({ message: "提交失败，请稍后再试。" }, { status: 500 });
  const result = data as { ok: boolean; service_title?: string };
  if (!result.ok) return NextResponse.json({ message: "服务不存在或未上架" }, { status: 404 });
  const serviceTitle = result.service_title ?? input.slug;

  // 邮件提醒站主（未配置静默）
  const mailer = mailerFromEnv();
  if (mailer) {
    try {
      const { data: ownerRow } = await service.from("profiles").select("id").eq("is_owner", true).maybeSingle();
      const { data: authData } = ownerRow ? await service.auth.admin.getUserById(ownerRow.id) : { data: { user: null } };
      if (authData.user?.email) {
        const siteUrl = (process.env.SITE_URL ?? "").replace(/\/$/, "");
        await mailer.send({
          to: authData.user.email,
          subject: `【${site.siteName}】新的服务询价：${serviceTitle}`,
          html: renderMailHtml({
            siteName: site.siteName,
            title: `服务询价 · ${serviceTitle}`,
            bodyHtml: `<p>来自 ${escapeHtml(email)} 的询价：</p><p style="padding:12px;background:#f6f6f6;border-radius:8px;">${escapeHtml(input.intent)}</p>${input.budgetRange ? `<p>预算区间：${escapeHtml(input.budgetRange)}</p>` : ""}${input.deadline ? `<p>期望交付：${escapeHtml(input.deadline)}</p>` : ""}`,
            ctaUrl: `${siteUrl}/admin?tab=inbox`,
            ctaLabel: "前往收件箱处理",
          }),
          text: `服务询价（${serviceTitle}）：${input.intent}`,
        });
      }
    } catch {
      console.error("[services] 询价提醒邮件失败（已落箱）");
    }
  }
  return NextResponse.json({ ok: true, message: "询价已提交，站主会尽快回复你留下的邮箱。" });
}
