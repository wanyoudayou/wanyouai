import type { NotifyVerification } from "./types";

type Settlement = (args: { p_merchant_order_no: string; p_event_id: string; p_amount: number; p_payload: Record<string, string> }) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;

/** Verification is done by the provider; only a recognized committed DB result is acknowledged. */
export async function applyPaymentNotification(verified: NotifyVerification, payload: Record<string, string>, settle: Settlement) {
  if (!/^9[0-9]{31}$/.test(verified.orderNo)) return { body: "fail", status: 400 };
  try {
    const { data, error } = await settle({ p_merchant_order_no: verified.orderNo, p_event_id: verified.tradeNo, p_amount: verified.amount, p_payload: payload });
    if (error) {
      const rejected = ["AMOUNT_MISMATCH", "ORDER_NOT_FOUND", "PAYMENT_REFERENCE_MISMATCH", "EMPTY_EVENT", "ORDER_NOT_PENDING", "EVENT_ORDER_MISMATCH", "EVENT_BINDING_REQUIRED", "PROVIDER_MISMATCH"];
      return { body: "fail", status: rejected.some(code => error.message?.includes(code)) ? 400 : 500 };
    }
    const committed = typeof data === "string" && ["settled", "duplicate", "already_paid"].includes(data);
    return { body: committed ? "success" : "fail", status: committed ? 200 : 500 };
  } catch { return { body: "fail", status: 500 }; }
}
