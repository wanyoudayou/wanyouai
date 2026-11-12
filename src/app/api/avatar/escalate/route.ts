import { NextResponse } from "next/server";
import { getReader } from "@/lib/reading/viewer";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { mailerFromEnv, renderMailHtml, escapeHtml } from "@/lib/mailer";

/** 转人工（PRD §4.6）：留言进站主收件箱 + 邮件提醒站主；按账户 / IP 限频（每日 3 条）。 */
const DAILY_LIMIT = 3;

export async function POST(request: Request) {
  let body: { message?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ message: "请求格式无效" }, { status: 400 }); }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 2000) return NextResponse.json({ message: "留言为空或过长（2000 字内）" }, { status: 400 });

  const reader = await getReader();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip");
  const service = createSupabaseServiceClient();

  // 限频：同账户或同 IP 当日最多 DAILY_LIMIT 条
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  let query = service.from("inbox_items").select("id", { count: "exact", head: true }).eq("kind", "escalation").gte("created_at", dayStart.toISOString());
  query = reader.userId ? query.eq("user_id", reader.userId) : query.eq("payload->>ip", ip ?? "unknown");
  const { count } = await query;
  if ((count ?? 0) >= DAILY_LIMIT) {
    return NextResponse.json({ message: "今日转人工次数已达上限，请明天再来；站主会按收件顺序处理留言。" }, { status: 429 });
  }

  const contact = reader.userId ? (await service.auth.admin.getUserById(reader.userId)).data.user?.email ?? null : null;
  const { error } = await service.from("inbox_items").insert({
    kind: "escalation",
    user_id: reader.userId,
    contact,
    payload: { message, ip: ip ?? "unknown" },
  });
  if (error) return NextResponse.json({ message: "提交失败，请稍后再试。" }, { status: 500 });

  // 邮件提醒站主（未配置 Resend 时静默跳过，留言已在收件箱）
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
          subject: `【${site?.site_name ?? "站点"}】新的转人工留言`,
          html: renderMailHtml({
            siteName: site?.site_name ?? "站点",
            title: "新的转人工留言",
            bodyHtml: `<p>${contact ? `来自 ${escapeHtml(contact)} 的` : "一条匿名"}留言：</p><p style="padding:12px;background:#f6f6f6;border-radius:8px;">${escapeHtml(message)}</p>`,
            ctaUrl: `${siteUrl}/admin?tab=inbox`,
            ctaLabel: "前往收件箱处理",
          }),
          text: `新的转人工留言：${message}（到 /admin?tab=inbox 处理）`,
        });
      }
    } catch (mailError) {
      console.error("[avatar] 转人工提醒邮件失败（留言已落箱）", mailError);
    }
  }
  return NextResponse.json({ ok: true, message: "已转达站主，会尽快通过你留下的方式回复。" });
}
