import { NextResponse } from "next/server";
import { getReader } from "@/lib/reading/viewer";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { parseInquiryInput, InquiryError } from "@/lib/services/inquiry-input";
import { turnstileFromConfig, turnstileHostname } from "@/lib/turnstile";
import { loadTurnstileRuntime } from "@/lib/turnstile-config";
import { mailerFromEnv, renderMailHtml, escapeHtml } from "@/lib/mailer";

/** 服务询价（PRD §4.4）：人类表单与 Agent 同构入口。落 inquiry 状态订单 + 站主收件箱 + 邮件提醒。 */
const DAILY_LIMIT = 3;

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ message: "请求格式无效" }, { status: 400 }); }
  let input;
  try { input = parseInquiryInput(body); } catch (error) {
    return NextResponse.json({ message: error instanceof InquiryError ? error.message : "请求格式无效" }, { status: 400 });
  }

  const reader = await getReader();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? "unknown";
  const service = createSupabaseServiceClient();

  // 服务存在且已上架
  const { data: svc } = await service.from("services").select("id,title,status").eq("slug", input.slug).maybeSingle();
  if (!svc || svc.status !== "published") return NextResponse.json({ message: "服务不存在或未上架" }, { status: 404 });

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

  // 限频：同账户或同 IP 当日最多 DAILY_LIMIT 条询价（按收件箱记录计）
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  let query = service.from("inbox_items").select("id", { count: "exact", head: true }).eq("kind", "inquiry").gte("created_at", dayStart.toISOString());
  query = reader.userId ? query.eq("user_id", reader.userId) : query.eq("payload->>ip", ip);
  const { count } = await query;
  if ((count ?? 0) >= DAILY_LIMIT) {
    return NextResponse.json({ message: "今日询价次数已达上限，请明天再来。" }, { status: 429 });
  }

  // 落库：inquiry 状态订单 + 收件箱
  const { data: booking, error: bookingError } = await service.from("bookings").insert({
    service_id: svc.id,
    user_id: reader.userId,
    email,
    intent: input.intent,
    budget_range: input.budgetRange,
    deadline: input.deadline,
    context_links: input.contextLinks,
    status: "inquiry",
  }).select("id").single();
  if (bookingError) return NextResponse.json({ message: "提交失败，请稍后再试。" }, { status: 500 });
  await service.from("inbox_items").insert({
    kind: "inquiry",
    user_id: reader.userId,
    contact: email,
    payload: { message: input.intent, service: svc.title, slug: input.slug, budget_range: input.budgetRange, deadline: input.deadline, ip, booking_id: booking?.id ?? null },
  });

  // 邮件提醒站主（未配置静默）
  const mailer = mailerFromEnv();
  if (mailer) {
    try {
      const { data: ownerRow } = await service.from("profiles").select("id").eq("is_owner", true).maybeSingle();
      const { data: site } = await service.from("site_config").select("site_name").eq("id", 1).maybeSingle();
      const { data: authData } = ownerRow ? await service.auth.admin.getUserById(ownerRow.id) : { data: { user: null } };
      if (authData.user?.email) {
        const siteUrl = (process.env.SITE_URL ?? "").replace(/\/$/, "");
        await mailer.send({
          to: authData.user.email,
          subject: `【${site?.site_name ?? "站点"}】新的服务询价：${svc.title}`,
          html: renderMailHtml({
            siteName: site?.site_name ?? "站点",
            title: `服务询价 · ${escapeHtml(svc.title)}`,
            bodyHtml: `<p>来自 ${escapeHtml(email ?? "匿名")} 的询价：</p><p style="padding:12px;background:#f6f6f6;border-radius:8px;">${escapeHtml(input.intent)}</p>${input.budgetRange ? `<p>预算区间：${escapeHtml(input.budgetRange)}</p>` : ""}${input.deadline ? `<p>期望交付：${escapeHtml(input.deadline)}</p>` : ""}`,
            ctaUrl: `${siteUrl}/admin?tab=inbox`,
            ctaLabel: "前往收件箱处理",
          }),
          text: `服务询价（${svc.title}）：${input.intent}`,
        });
      }
    } catch (mailError) {
      console.error("[services] 询价提醒邮件失败（已落箱）", mailError);
    }
  }
  return NextResponse.json({ ok: true, message: "询价已提交，站主会尽快回复你留下的邮箱。" });
}
