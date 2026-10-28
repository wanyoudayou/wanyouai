// 同 mailer.ts：本文件被 tsx 单测直接导入，故不 import "server-only"（毒药包）；服务端约束由调用方（路由/页面）保证。
import type { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { PaymentOrder, PaymentProvider } from "@/lib/payments/types";

export type SettleOutcome = "settled" | "duplicate_or_already" | "unpaid" | "failed";

/**
 * 平台查单 → 已付则走 settle_payment_reference 校验并入箱，事务内记录权益邮件任务。
 * event_id 始终为平台 trade_no；`reconcile` / `return` 仅记录触发来源。
 * 邮件由独立 worker 发送；异常一律吞为 "failed"（不阻断页面渲染）。
 */
export async function settleIfPaidRemotely(
  service: ReturnType<typeof createSupabaseServiceClient>,
  provider: PaymentProvider,
  order: PaymentOrder,
  eventPrefix: string,
): Promise<SettleOutcome> {
  try {
    const result = await provider.queryOrder(order);
    if (!result.paid) return "unpaid";
    if (!result.tradeNo || result.amount === null || !Number.isFinite(result.amount) || result.amount <= 0) return "failed";
    const { data, error } = await service.rpc("settle_payment_reference", {
      p_merchant_order_no: order.merchant_order_no,
      p_event_id: result.tradeNo,
      p_amount: result.amount,
      p_payload: { source: eventPrefix, trade_no: result.tradeNo, out_trade_no: order.merchant_order_no },
    });
    if (error) return "failed";
    return data === "settled" ? "settled" : data === "duplicate" || data === "already_paid" ? "duplicate_or_already" : "failed";
  } catch {
    return "failed";
  }
}

/** 跳回场景的带重试版本：平台「已支付」可查状态通常滞后同步跳转几秒，unpaid 时按间隔重试。 */
export async function settleIfPaidRemotelyWithRetry(
  service: ReturnType<typeof createSupabaseServiceClient>,
  provider: PaymentProvider,
  order: PaymentOrder,
  eventPrefix: string,
  attempts = 3,
  delayMs = 1500,
): Promise<SettleOutcome> {
  for (let i = 0; i < attempts; i++) {
    const outcome = await settleIfPaidRemotely(service, provider, order, eventPrefix);
    if (outcome !== "unpaid") return outcome;
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return "unpaid";
}
