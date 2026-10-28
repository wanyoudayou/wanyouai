import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { escapeHtml, mailerFromEnv, renderMailHtml } from "@/lib/mailer";

/**
 * 停售通知邮件。
 * 语义：停售 = 停售不停读 + 已购权益保留 3 个月；停售动作成功即向直接购买者发本通知。
 * 归档不再发邮件（时间闸满 3 个月后静默归档）。
 * 通知范围：只通知直接购买者（series/single 权益持有者），不通知全站订阅者。
 * 幂等：email_sends 按 `kind:id:YYYYMMDD` 去重；同日重复停售不重复通知，跨日重新停售会再次通知（新保留期）。
 */
export async function sendPauseNotice(kind: "article" | "series", id: number): Promise<{ notified: number; alreadySent: boolean; mailerConfigured: boolean }> {
  const service = createSupabaseServiceClient();
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const table = kind === "series" ? "series" : "articles";
  const { data: content, error: contentError } = await service.from(table).select("title,type").eq("id", id).maybeSingle();
  if (contentError) throw new Error("停售通知对象暂时无法读取");
  const title: string = content?.title ?? `${kind} #${id}`;

  const entitlementType = kind === "series" ? "series" : content?.type === "skill" ? "skill" : "single";
  const targets: { type: string; id: number }[] = [{ type: entitlementType, id }];
  let canonicalKind = kind; let canonicalId = id;
  if (content?.type === "skill") {
    const mapped = await service.from("skills").select("id,legacy_series_id").eq(kind === "series" ? "legacy_series_id" : "id", id).maybeSingle();
    if (mapped.error) throw new Error("停售通知关联暂时无法读取");
    if (mapped.data?.legacy_series_id) { targets.push(kind === "series" ? { type: "skill", id: mapped.data.id } : { type: "series", id: mapped.data.legacy_series_id }); canonicalKind = "series"; canonicalId = mapped.data.legacy_series_id; }
  }
  // The old and new management entrypoints refer to the same paused product.
  const refId = `${canonicalKind}:${canonicalId}:${day}`;
  const { data: existing, error: noticeError } = await service.from("email_sends").select("id").eq("kind", "pause_notice").eq("ref_id", refId).maybeSingle();
  if (noticeError) throw new Error("停售通知记录暂时无法读取");
  if (existing) return { notified: 0, alreadySent: true, mailerConfigured: true };
  const holders = [] as { user_id: string; starts_at: string; ends_at: string | null }[];
  for (const target of targets) {
    const result = await service.from("entitlements").select("user_id,starts_at,ends_at").eq("type", target.type).eq("target_id", target.id).is("revoked_at", null);
    if (result.error) throw new Error("停售通知接收者暂时无法读取");
    holders.push(...result.data);
  }
  const active = [...new Map(holders.filter(h => Date.parse(h.starts_at) <= Date.now() && (!h.ends_at || Date.parse(h.ends_at) > Date.now())).map(h => [h.user_id, h])).values()];
  if (active.length === 0) return { notified: 0, alreadySent: false, mailerConfigured: true };

  const mailer = mailerFromEnv();
  if (!mailer) {
    console.warn(`[mail] 未配置 Resend，跳过停售通知（${refId}，${active.length} 位持有者）`);
    return { notified: 0, alreadySent: false, mailerConfigured: false };
  }

  const { data: site } = await service.from("site_config").select("site_name").limit(1).maybeSingle();
  const siteName: string = site?.site_name || "万有AI";
  const siteUrl = (process.env.SITE_URL ?? "").replace(/\/$/, "");
  const ctaUrl = `${siteUrl}/me`;
  const retainUntil = new Date(Date.now() + 92 * 86_400_000).toLocaleDateString("zh-CN");

  const sentTo: string[] = [];
  for (const holder of active) {
    const { data: authData } = await service.auth.admin.getUserById(holder.user_id);
    const email = authData.user?.email;
    if (!email) continue;
    try {
      await mailer.send({
        to: email,
        subject: `【${siteName}】停售通知：${title}`,
        html: renderMailHtml({
          siteName,
          title: "停售通知",
          bodyHtml: `<p>你购买的内容<strong>《${escapeHtml(title)}》</strong>已停售：即日起不再对外销售。</p><p>你的已购权益<strong>保留 3 个月（至 ${escapeHtml(retainUntil)}）</strong>，期间可正常阅读；到期后内容将归档并停止阅读。</p><p>知识性数字虚拟商品一经售出概不退款；如有疑问，请通过站内联系方式与站主沟通。</p>`,
          summary: `权益摘要：${escapeHtml(kind === "series" ? "专辑" : "单篇")} · ${escapeHtml(title)} · 保留至 ${escapeHtml(retainUntil)}`,
          ctaUrl,
          ctaLabel: "查看我的权益",
        }),
        text: `【${siteName}】你购买的内容《${title}》已停售，不再对外销售。你的已购权益保留 3 个月（至 ${retainUntil}），期间可正常阅读；到期后内容将归档并停止阅读。知识性数字虚拟商品一经售出概不退款。查看我的权益：${ctaUrl}`,
      });
      sentTo.push(email);
    } catch {
      console.error("[mail] 停售通知发送失败");
    }
  }
  if (sentTo.length > 0) {
    await service.from("email_sends").insert({ kind: "pause_notice", ref_id: refId, sent_to: sentTo.join(","), meta: { title, holders: active.length, retain_until: retainUntil } });
  }
  return { notified: sentTo.length, alreadySent: false, mailerConfigured: true };
}
