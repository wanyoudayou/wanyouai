import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { mailerFromEnv, renderMailHtml, escapeHtml } from "@/lib/mailer";

type BookingRow = {
  id: number; service_id: number; email: string | null; status: string;
  quote_snapshot: { price?: number | null; plan?: string; delivery_date?: string } | null;
  delivery_snapshot: { note?: string; links?: string[] } | null;
};

async function loadContext(bookingId: number) {
  const service = createSupabaseServiceClient();
  const [{ data: booking }, { data: site }] = await Promise.all([
    service.from("bookings").select("id,service_id,email,status,quote_snapshot,delivery_snapshot").eq("id", bookingId).maybeSingle(),
    service.from("site_config").select("site_name").eq("id", 1).maybeSingle(),
  ]);
  if (!booking) return null;
  const { data: svc } = await service.from("services").select("title").eq("id", booking.service_id).maybeSingle();
  const siteUrl = (process.env.SITE_URL ?? "").replace(/\/$/, "");
  return {
    booking: booking as BookingRow,
    serviceTitle: svc?.title ?? "服务",
    siteName: site?.site_name ?? "站点",
    trackingUrl: `${siteUrl}/me/services/${bookingId}`,
    adminUrl: `${siteUrl}/admin/orders`,
  };
}

async function ownerEmail(): Promise<string | null> {
  const service = createSupabaseServiceClient();
  const { data: ownerRow } = await service.from("profiles").select("id").eq("is_owner", true).maybeSingle();
  if (!ownerRow) return null;
  const { data } = await service.auth.admin.getUserById(ownerRow.id);
  return data.user?.email ?? null;
}

/** 报价已发送 → 通知客户（含报价单要点与接受入口）。未配置邮件静默。 */
export async function notifyClientQuote(bookingId: number) {
  const mailer = mailerFromEnv();
  if (!mailer) return;
  const ctx = await loadContext(bookingId);
  if (!ctx?.booking.email || !ctx.booking.quote_snapshot) return;
  const q = ctx.booking.quote_snapshot;
  try {
    await mailer.send({
      to: ctx.booking.email,
      subject: `【${ctx.siteName}】服务报价：${ctx.serviceTitle}`,
      html: renderMailHtml({
        siteName: ctx.siteName,
        title: `服务报价 · ${escapeHtml(ctx.serviceTitle)}`,
        bodyHtml: `<p>方案要点：</p><p style="padding:12px;background:#f6f6f6;border-radius:8px;">${escapeHtml(q.plan ?? "")}</p>${q.price != null ? `<p>报价：${escapeHtml(String(q.price))} 元</p>` : ""}${q.delivery_date ? `<p>预计交付：${escapeHtml(q.delivery_date)}</p>` : ""}<p>确认无误请在订单页接受报价；有疑问可直接回复站主。</p>`,
        ctaUrl: ctx.trackingUrl,
        ctaLabel: "查看并接受报价",
      }),
      text: `服务报价（${ctx.serviceTitle}）：${q.plan ?? ""}`,
    });
  } catch (error) {
    console.error("[booking] 报价邮件发送失败（状态已流转）", error);
  }
}

/** 交付已提交 → 通知客户（含交付说明与链接、验收入口）。未配置邮件静默。 */
export async function notifyClientDelivery(bookingId: number) {
  const mailer = mailerFromEnv();
  if (!mailer) return;
  const ctx = await loadContext(bookingId);
  if (!ctx?.booking.email || !ctx.booking.delivery_snapshot) return;
  const d = ctx.booking.delivery_snapshot;
  const links = (d.links ?? []).map((l) => `<li><a href="${escapeHtml(l)}">${escapeHtml(l)}</a></li>`).join("");
  try {
    await mailer.send({
      to: ctx.booking.email,
      subject: `【${ctx.siteName}】服务已交付：${ctx.serviceTitle}`,
      html: renderMailHtml({
        siteName: ctx.siteName,
        title: `服务已交付 · ${escapeHtml(ctx.serviceTitle)}`,
        bodyHtml: `<p>交付说明：</p><p style="padding:12px;background:#f6f6f6;border-radius:8px;">${escapeHtml(d.note ?? "")}</p>${links ? `<p>交付链接：</p><ul>${links}</ul>` : ""}<p>请在订单页验收；如需修改可在订单页说明修改意见。</p>`,
        ctaUrl: ctx.trackingUrl,
        ctaLabel: "前往验收",
      }),
      text: `服务已交付（${ctx.serviceTitle}）：${d.note ?? ""}`,
    });
  } catch (error) {
    console.error("[booking] 交付邮件发送失败（状态已流转）", error);
  }
}

/** 客户动作（接受/谢绝报价、验收、要求修改）→ 通知站主。未配置邮件静默。 */
export async function notifyOwnerBookingEvent(bookingId: number, label: string) {
  const mailer = mailerFromEnv();
  if (!mailer) return;
  const ctx = await loadContext(bookingId);
  if (!ctx) return;
  const to = await ownerEmail();
  if (!to) return;
  try {
    await mailer.send({
      to,
      subject: `【${ctx.siteName}】服务订单动态：${ctx.serviceTitle}`,
      html: renderMailHtml({
        siteName: ctx.siteName,
        title: `订单 #${bookingId} · ${escapeHtml(ctx.serviceTitle)}`,
        bodyHtml: `<p>${escapeHtml(label)}</p>`,
        ctaUrl: ctx.adminUrl,
        ctaLabel: "前往订单管理",
      }),
      text: `订单 #${bookingId}（${ctx.serviceTitle}）：${label}`,
    });
  } catch (error) {
    console.error("[booking] 站主通知邮件发送失败", error);
  }
}

/** 条款已发送确认 → 通知客户查看并确认。未配置邮件静默。 */
export async function notifyClientAgreementSent(bookingId: number) {
  const mailer = mailerFromEnv();
  if (!mailer) return;
  const ctx = await loadContext(bookingId);
  if (!ctx?.booking.email) return;
  try {
    await mailer.send({
      to: ctx.booking.email,
      subject: `【${ctx.siteName}】请确认订单条款：${ctx.serviceTitle}`,
      html: renderMailHtml({
        siteName: ctx.siteName,
        title: `请确认订单条款 · ${escapeHtml(ctx.serviceTitle)}`,
        bodyHtml: `<p>站主已完善本单的合作条款（范围 / 交付 / 节奏 / 酬劳 / 退出 / 归属），请在订单页查看并确认；如有异议可直接在订单页提出。</p>`,
        ctaUrl: ctx.trackingUrl,
        ctaLabel: "查看并确认条款",
      }),
      text: `请确认订单条款（${ctx.serviceTitle}）`,
    });
  } catch (error) {
    console.error("[booking] 条款确认邮件发送失败（状态已流转）", error);
  }
}

/** 开工 → 通知客户。未配置邮件静默。 */
export async function notifyClientStarted(bookingId: number) {
  const mailer = mailerFromEnv();
  if (!mailer) return;
  const ctx = await loadContext(bookingId);
  if (!ctx?.booking.email) return;
  try {
    await mailer.send({
      to: ctx.booking.email,
      subject: `【${ctx.siteName}】订单已开工：${ctx.serviceTitle}`,
      html: renderMailHtml({
        siteName: ctx.siteName,
        title: `订单已开工 · ${escapeHtml(ctx.serviceTitle)}`,
        bodyHtml: `<p>条款已确认，站主已开工。你可以在订单页查看里程碑进度；如有需要你配合的检查点，会显示「当前等待你」。</p>`,
        ctaUrl: ctx.trackingUrl,
        ctaLabel: "查看订单进度",
      }),
      text: `订单已开工（${ctx.serviceTitle}）`,
    });
  } catch (error) {
    console.error("[booking] 开工邮件发送失败（状态已流转）", error);
  }
}

/** 检查点需求请求 → 通知客户（含请求内容，不作卡点）。未配置邮件静默。 */
export async function notifyClientMilestoneRequest(bookingId: number, milestoneTitle: string, note: string) {
  const mailer = mailerFromEnv();
  if (!mailer) return;
  const ctx = await loadContext(bookingId);
  if (!ctx?.booking.email) return;
  try {
    await mailer.send({
      to: ctx.booking.email,
      subject: `【${ctx.siteName}】订单需要你提供信息：${ctx.serviceTitle}`,
      html: renderMailHtml({
        siteName: ctx.siteName,
        title: `检查点「${escapeHtml(milestoneTitle)}」需要你的反馈`,
        bodyHtml: `<p>站主的请求：</p><p style="padding:12px;background:#f6f6f6;border-radius:8px;">${escapeHtml(note)}</p><p>请在订单页直接回复（文字即可，素材可贴链接）。不着急——这不阻塞订单的其他进展。</p>`,
        ctaUrl: ctx.trackingUrl,
        ctaLabel: "前往反馈",
      }),
      text: `检查点「${milestoneTitle}」需要你的反馈：${note}`,
    });
  } catch (error) {
    console.error("[booking] 检查点请求邮件发送失败", error);
  }
}

/** 节点交付 → 通知客户验收。未配置邮件静默。 */
export async function notifyClientMilestoneDelivered(bookingId: number, milestoneTitle: string) {
  const mailer = mailerFromEnv();
  if (!mailer) return;
  const ctx = await loadContext(bookingId);
  if (!ctx?.booking.email) return;
  try {
    await mailer.send({
      to: ctx.booking.email,
      subject: `【${ctx.siteName}】节点已交付，请验收：${ctx.serviceTitle}`,
      html: renderMailHtml({
        siteName: ctx.siteName,
        title: `检查点「${escapeHtml(milestoneTitle)}」已交付`,
        bodyHtml: `<p>站主已交付该节点的成果，请在订单页查看交付记录并确认验收；如有问题可驳回并注明原因，站主会返工后重新交付。</p>`,
        ctaUrl: ctx.trackingUrl,
        ctaLabel: "前往验收",
      }),
      text: `检查点「${milestoneTitle}」已交付，请验收`,
    });
  } catch (error) {
    console.error("[booking] 节点交付邮件发送失败", error);
  }
}
