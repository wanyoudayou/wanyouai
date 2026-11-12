/** 服务询价输入校验（纯函数，可测）。字段对应 PRD §4.4：intent / budget_range / deadline / context_links。 */
export type InquiryInput = {
  slug: string;
  intent: string;
  budgetRange: string | null;
  deadline: string | null;
  contextLinks: string[];
  contactEmail: string | null;
};

export class InquiryError extends Error {}

export function parseInquiryInput(raw: unknown): InquiryInput {
  const body = (raw ?? {}) as Record<string, unknown>;
  const slug = String(body.slug ?? "").trim();
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) throw new InquiryError("服务标识无效。");
  const intent = String(body.intent ?? "").trim();
  if (intent.length < 10 || intent.length > 2000) throw new InquiryError("请用至少 10 个字描述你的需求（2000 字内）。");
  const budgetRange = String(body.budget_range ?? "").trim().slice(0, 120) || null;
  const deadlineRaw = String(body.deadline ?? "").trim();
  const deadline = deadlineRaw ? deadlineRaw : null;
  if (deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || !Number.isFinite(Date.parse(deadline)))) throw new InquiryError("期望交付时间格式无效。");
  const contextLinks = (Array.isArray(body.context_links) ? body.context_links : [])
    .map((v) => String(v).trim()).filter(Boolean).slice(0, 5)
    .map((v) => {
      try { const url = new URL(v); if (url.protocol !== "https:") throw new Error(); return v; } catch { throw new InquiryError("参考链接需为有效 HTTPS 地址。"); }
    });
  const contactEmail = String(body.contact_email ?? "").trim() || null;
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contactEmail)) throw new InquiryError("联系邮箱格式无效。");
  return { slug, intent, budgetRange, deadline, contextLinks, contactEmail };
}
