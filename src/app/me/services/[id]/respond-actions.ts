"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { notifyOwnerBookingEvent } from "@/lib/services/booking-mail";

type Result = { ok: boolean; message: string };
const ACTIONS = ["accept_quote", "decline_quote", "accept_agreement", "object_agreement", "accept_delivery", "request_revision", "respond_milestone", "accept_milestone", "object_milestone"] as const;
const LABELS: Record<string, string> = {
  accept_quote: "客户已接受报价，订单成交",
  decline_quote: "客户谢绝了报价",
  accept_agreement: "客户已确认条款，可以开工",
  object_agreement: "客户对条款提出异议",
  accept_delivery: "客户已验收交付",
  request_revision: "客户要求修改",
  respond_milestone: "客户反馈了检查点",
  accept_milestone: "客户已验收检查点",
  object_milestone: "客户驳回了检查点",
};

/** 客户侧订单响应：接受/谢绝报价、验收/要求修改。RPC 内校验当事人身份。 */
export async function respondBooking(_previous: Result, form: FormData): Promise<Result> {
  const id = Number(form.get("id"));
  const action = String(form.get("action") ?? "");
  if (!Number.isInteger(id) || id <= 0 || !ACTIONS.includes(action as (typeof ACTIONS)[number])) {
    return { ok: false, message: "参数无效，请刷新后重试" };
  }
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("client_respond_booking", {
    p_id: id,
    p_action: action,
    p_value: {
      note: String(form.get("note") ?? "").trim() || null,
      ...(form.get("milestone_id") ? { milestone_id: Number(form.get("milestone_id")) } : {}),
    },
  });
  if (error || !data) return { ok: false, message: "操作暂时不可用，请稍后再试。" };
  const result = data as Result;
  if (result.ok) {
    const note = String(form.get("note") ?? "").trim();
    await notifyOwnerBookingEvent(id, LABELS[action] + (note ? `：${note}` : ""));
    revalidatePath(`/me/services/${id}`);
  }
  return result;
}
