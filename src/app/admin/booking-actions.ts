"use server";
import { revalidatePath } from "next/cache";
import { getAdminIdentity } from "@/lib/admin/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { notifyClientQuote, notifyClientDelivery, notifyClientAgreementSent, notifyClientStarted, notifyClientMilestoneRequest, notifyClientMilestoneDelivered } from "@/lib/services/booking-mail";

type Result = { ok: boolean; message: string };

async function callManage(id: string, updated: string, action: string, value: Record<string, unknown>): Promise<Result> {
  if (!(await getAdminIdentity()).owner) return { ok: false, message: "需要站主身份" };
  if (!/^\d+$/.test(id) || !Number.isFinite(Date.parse(updated))) return { ok: false, message: "参数无效，请刷新后重试" };
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("manage_booking", { p_id: Number(id), p_expected_updated_at: updated, p_action: action, p_value: value });
  if (error || !data) return { ok: false, message: "操作暂时不可用，请确认数据库升级已完成后重试。" };
  const result = data as Result;
  if (result.ok) {
    revalidatePath("/admin/orders", "page");
    revalidatePath("/admin", "page");
  }
  return result;
}

/** 状态推进（婉拒 / 开始交付 / 代验收 / 结案）。报价与交付走带内容的 quoteBooking / deliverBooking。 */
export async function advanceBooking(_previous: Result, form: FormData) {
  const next = String(form.get("next") ?? "");
  if (!["declined", "in_progress", "accepted", "settled"].includes(next)) return { ok: false, message: "流转目标无效" };
  const result = await callManage(String(form.get("id") ?? ""), String(form.get("updated") ?? ""), "status", { status: next });
  if (result.ok && next === "in_progress") await notifyClientStarted(Number(form.get("id")));
  return result;
}

// 条款八项（双方主体与联系方式，加服务六要素）：乙方/甲方主体与联系方式 + 原六要素
const SIX_KEYS = ["party_owner", "party_client", "scope", "deliverable", "cadence", "compensation", "exit", "ownership"] as const;

/** 发送条款给客户确认（锁定草稿 + 邮件通知）。 */
export async function sendAgreement(_previous: Result, form: FormData) {
  const result = await callManage(String(form.get("id") ?? ""), String(form.get("updated") ?? ""), "send_agreement", {});
  if (result.ok) await notifyClientAgreementSent(Number(form.get("id")));
  return result;
}

/** 成交登记：六要素快照 + 签约日期；里程碑由 RPC 按服务交付清单自动创建（之后在检查点列表中调整）。 */
export async function bookDeal(_previous: Result, form: FormData) {
  const agreement = Object.fromEntries(SIX_KEYS.map((key) => [key, String(form.get(`agreement.${key}`) ?? "").trim()]));
  if (SIX_KEYS.some((key) => !agreement[key])) return { ok: false, message: "条款需完整填写（双方主体与六要素）" };
  const agreedAt = String(form.get("agreed_at") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(agreedAt)) return { ok: false, message: "请填写签约日期" };
  return callManage(String(form.get("id") ?? ""), String(form.get("updated") ?? ""), "book", { agreement, agreed_at: agreedAt });
}

/** 立即启动检查点（todo → doing，预计完成日期必填）。 */
export async function startMilestone(_previous: Result, form: FormData) {
  return callManage(String(form.get("id") ?? ""), String(form.get("updated") ?? ""), "milestone_start", {
    id: Number(form.get("milestone_id") ?? 0),
    expected_at: String(form.get("expected_at") ?? "").trim(),
  });
}

/** 节点交付（doing → done，交付说明必填，实际日期自动写当天）。 */
export async function deliverMilestone(_previous: Result, form: FormData) {
  const result = await callManage(String(form.get("id") ?? ""), String(form.get("updated") ?? ""), "milestone_deliver", {
    id: Number(form.get("milestone_id") ?? 0),
    note: String(form.get("note") ?? "").trim(),
  });
  if (result.ok) await notifyClientMilestoneDelivered(Number(form.get("id")), String(form.get("milestone_title") ?? "检查点"));
  return result;
}

/** 在检查点上向客户发需求请求（球到客户侧，不作卡点）；成功后邮件通知客户。 */
export async function requestMilestone(_previous: Result, form: FormData) {
  const note = String(form.get("note") ?? "").trim();
  const milestoneId = Number(form.get("milestone_id") ?? 0);
  const result = await callManage(String(form.get("id") ?? ""), String(form.get("updated") ?? ""), "milestone_request", { id: milestoneId, note });
  if (result.ok) await notifyClientMilestoneRequest(Number(form.get("id")), String(form.get("milestone_title") ?? "检查点"), note);
  return result;
}

/** 添加检查点。 */
export async function addMilestone(_previous: Result, form: FormData) {
  const party = String(form.get("owner_party") ?? "owner");
  return callManage(String(form.get("id") ?? ""), String(form.get("updated") ?? ""), "milestone_add", {
    title: String(form.get("title") ?? "").trim(),
    owner_party: ["owner", "client", "third"].includes(party) ? party : "owner",
    expected_at: String(form.get("expected_at") ?? "") || null,
  });
}

/** 更新检查点（状态 / 实际日期 / 归属）。 */
export async function updateMilestone(_previous: Result, form: FormData) {
  const value: Record<string, unknown> = { id: Number(form.get("milestone_id") ?? 0) };
  value.actual_at = String(form.get("actual_at") ?? "") || null;
  if (form.has("expected_at")) value.expected_at = String(form.get("expected_at") ?? "") || null;
  const party = String(form.get("owner_party") ?? "");
  if (["owner", "client", "third"].includes(party)) value.owner_party = party;
  return callManage(String(form.get("id") ?? ""), String(form.get("updated") ?? ""), "milestone_update", value);
}

/** 发送报价（inquiry/quoted → quoted）：方案要点 + 预计交付日期 + 选填金额；成功后邮件通知客户。 */
export async function quoteBooking(_previous: Result, form: FormData) {
  const result = await callManage(String(form.get("id") ?? ""), String(form.get("updated") ?? ""), "quote", {
    plan: String(form.get("plan") ?? "").trim(),
    delivery_date: String(form.get("delivery_date") ?? "").trim(),
    price: String(form.get("price") ?? "").trim() || null,
  });
  if (result.ok) await notifyClientQuote(Number(form.get("id")));
  return result;
}

/** 提交交付（in_progress → delivered）：交付说明 + 交付链接（每行一个）；成功后邮件通知客户。 */
export async function deliverBooking(_previous: Result, form: FormData) {
  const links = String(form.get("links") ?? "").split("\n").map((v) => v.trim()).filter((v) => /^https?:\/\//.test(v)).slice(0, 20);
  const result = await callManage(String(form.get("id") ?? ""), String(form.get("updated") ?? ""), "deliver", {
    note: String(form.get("note") ?? "").trim(),
    links,
  });
  if (result.ok) await notifyClientDelivery(Number(form.get("id")));
  return result;
}
