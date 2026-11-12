import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/server-bearer";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { escapeHtml, mailerFromEnv, renderMailHtml } from "@/lib/mailer";
import { isInReminderWindow } from "@/lib/expiry-window";

/**
 * 订阅到期前 7 天提醒。每日触发（vercel.json cron 或外部 cron）。
 * 鉴权：Bearer PUBLISH_TOKEN 或 CRON_SECRET（Vercel Cron 自动携带）。
 * 幂等：按 entitlement id 在 email_sends 去重；发送失败不记录，次日重试。
 */
export async function GET(request: Request) {
  return handle(request);
}
export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request) {
  if (!bearerMatches(request, process.env.PUBLISH_TOKEN, process.env.CRON_SECRET)) {
    return NextResponse.json({ message: "未授权" }, { status: 401 });
  }
  const mailer = mailerFromEnv();
  const service = createSupabaseServiceClient();
  const now = new Date();
  const upper = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const { data: rows } = await service
    .from("entitlements")
    .select("id,user_id,ends_at")
    .eq("type", "subscription")
    .is("revoked_at", null)
    .not("ends_at", "is", null)
    .lte("ends_at", upper)
    .limit(200);
  const expiring = (rows ?? []).filter((row) => row.ends_at && isInReminderWindow(row.ends_at, now));
  const summary = { scanned: expiring.length, sent: 0, skipped: 0, failed: 0, mailer: mailer !== null };
  if (!mailer) return NextResponse.json({ summary });

  const { data: site } = await service.from("site_config").select("site_name").limit(1).maybeSingle();
  const siteName: string = site?.site_name || "万有AI";
  const siteUrl = (process.env.SITE_URL ?? "").replace(/\/$/, "");
  const ctaUrl = `${siteUrl}/me`;

  for (const row of expiring) {
    const refId = String(row.id);
    const { data: existing } = await service.from("email_sends").select("id").eq("kind", "expiry_reminder").eq("ref_id", refId).maybeSingle();
    if (existing) {
      summary.skipped += 1;
      continue;
    }
    const { data: authData } = await service.auth.admin.getUserById(row.user_id);
    const email = authData.user?.email;
    if (!email) {
      summary.failed += 1;
      continue;
    }
    const endsDate = new Date(row.ends_at as string).toLocaleDateString("zh-CN");
    try {
      await mailer.send({
        to: email,
        subject: `【${siteName}】订阅将于 ${endsDate} 到期`,
        html: renderMailHtml({
          siteName,
          title: "订阅到期提醒",
          bodyHtml: `<p>你的全站订阅将于 <strong>${escapeHtml(endsDate)}</strong> 到期，到期后付费内容的订阅阅读权限将暂停。</p><p>注意：你已单独购买的<strong>专辑与单篇内容不受影响</strong>，仍可继续阅读。</p>`,
          summary: `权益摘要：全站订阅 · 有效期至 ${escapeHtml(endsDate)}`,
          ctaUrl,
          ctaLabel: "查看权益并续订",
        }),
        text: `【${siteName}】你的全站订阅将于 ${endsDate} 到期。已单独购买的专辑与单篇内容不受影响。查看权益并续订：${ctaUrl}`,
      });
      await service.from("email_sends").insert({ kind: "expiry_reminder", ref_id: refId, sent_to: email, meta: { ends_at: row.ends_at } });
      summary.sent += 1;
    } catch (mailError) {
      console.error("[mail] 到期提醒发送失败（不记录，次日重试）", mailError);
      summary.failed += 1;
    }
  }
  return NextResponse.json({ summary });
}
// HEAD probes must not execute the GET cron handler and send reminder emails.
export function HEAD() {
  return new Response(null, { status: 405, headers: { Allow: "GET, POST", "Cache-Control": "no-store" } });
}
