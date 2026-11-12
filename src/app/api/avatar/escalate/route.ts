import { NextResponse } from "next/server";
import { getReader } from "@/lib/reading/viewer";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { mailerFromEnv, renderMailHtml, escapeHtml } from "@/lib/mailer";
import { sameSiteOrigin } from "@/lib/publishing/auth";
import { readBoundedJson } from "@/lib/publishing/request-body";
import { loadAvatarRuntime } from "@/lib/ai/avatar-runtime";
import { turnstileFromConfig, turnstileHostname } from "@/lib/turnstile";
import { loadTurnstileRuntime } from "@/lib/turnstile-config";
import { getSiteConfig } from "@/lib/get-site-config";
import { clientAddress, consumeDailyLimit } from "@/lib/request-limit";

/** 转人工（PRD §4.6）：留言进站主收件箱 + 邮件提醒站主；按账户 / IP 原子限频（站点时区每日 3 条）。 */
const DAILY_LIMIT = 3;

export async function POST(request: Request) {
  if (!sameSiteOrigin(request.headers.get("origin"), process.env.SITE_URL)) return NextResponse.json({ message: "请求来源无效。" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await readBoundedJson(request, 12 * 1024); } catch { return NextResponse.json({ message: "请求格式无效" }, { status: 400 }); }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 2000) return NextResponse.json({ message: "留言为空或过长（2000 字内）" }, { status: 400 });

  const reader = await getReader();
  const ip = clientAddress(request);
  const service = createSupabaseServiceClient({ timeoutMs: 8000 });

  // 匿名与匿名问答同一门槛：站点开启匿名入口且通过人机校验，否则请登录。
  if (!reader.userId) {
    const runtime = await loadAvatarRuntime(service).catch(() => null);
    let config;
    try { config = await loadTurnstileRuntime(service); }
    catch { return NextResponse.json({ message: "人机校验暂时不可用，请稍后重试。" }, { status: 503 }); }
    const turnstile = turnstileFromConfig(config, turnstileHostname(), "avatar");
    if (!runtime?.settings.anonymous_entry || !turnstile) {
      return NextResponse.json({ message: "转人工需登录后使用。[免费注册 / 登录](/login)", status: "login_required" }, { status: 401 });
    }
    const token = typeof body.turnstileToken === "string" ? body.turnstileToken : "";
    if (!token || !(await turnstile.verify(token, ip))) {
      return NextResponse.json({ message: "人机校验未通过，请刷新后重试。", status: "turnstile_failed" }, { status: 403 });
    }
  }

  const site = await getSiteConfig();
  let allowed: boolean;
  try { allowed = await consumeDailyLimit(service, `escalation:${reader.userId ? `user:${reader.userId}` : `ip:${ip}`}`, DAILY_LIMIT, site.identity.timezone); }
  catch { return NextResponse.json({ message: "提交暂时不可用，请稍后再试。" }, { status: 503 }); }
  if (!allowed) {
    return NextResponse.json({ message: "今日转人工次数已达上限，请明天再来；站主会按收件顺序处理留言。" }, { status: 429 });
  }

  const contact = reader.userId ? (await service.auth.admin.getUserById(reader.userId)).data.user?.email ?? null : null;
  const { error } = await service.from("inbox_items").insert({
    kind: "escalation",
    user_id: reader.userId,
    contact,
    payload: { message, ip },
  });
  if (error) return NextResponse.json({ message: "提交失败，请稍后再试。" }, { status: 500 });

  // 邮件提醒站主（未配置 Resend 时静默跳过，留言已在收件箱）
  const mailer = mailerFromEnv();
  if (mailer) {
    try {
      const { data: ownerRow } = await service.from("profiles").select("id").eq("is_owner", true).maybeSingle();
      const { data: authData } = ownerRow ? await service.auth.admin.getUserById(ownerRow.id) : { data: { user: null } };
      if (authData.user?.email) {
        const siteUrl = (process.env.SITE_URL ?? "").replace(/\/$/, "");
        await mailer.send({
          to: authData.user.email,
          subject: `【${site.siteName}】新的转人工留言`,
          html: renderMailHtml({
            siteName: site.siteName,
            title: "新的转人工留言",
            bodyHtml: `<p>${contact ? `来自 ${escapeHtml(contact)} 的` : "一条匿名"}留言：</p><p style="padding:12px;background:#f6f6f6;border-radius:8px;">${escapeHtml(message)}</p>`,
            ctaUrl: `${siteUrl}/admin?tab=inbox`,
            ctaLabel: "前往收件箱处理",
          }),
          text: `新的转人工留言：${message}（到 /admin?tab=inbox 处理）`,
        });
      }
    } catch {
      console.error("[avatar] 转人工提醒邮件失败（留言已落箱）");
    }
  }
  return NextResponse.json({ ok: true, message: "已转达站主，会尽快通过你留下的方式回复。" });
}
