import type { PaymentOrder } from "./types";
import type { SettleOutcome } from "./settle";

export const RECONCILE_LIMIT = 50;
// A platform query can take 10 seconds, followed by an 8-second settlement RPC.
const MIN_ORDER_BUDGET_MS = 20_000;
export const AUTOMATIC_RECONCILE_LIMIT = 2;

export function reconcileCursor(params: URLSearchParams): number | null {
  const values = params.getAll("after");
  if (values.length === 0) return 0;
  if (values.length !== 1 || !/^(0|[1-9]\d*)$/.test(values[0])) return null;
  const value = Number(values[0]);
  return Number.isSafeInteger(value) ? value : null;
}

/** One bounded page. Only confirmed outcomes advance the cursor; failed orders are retried. */
export async function reconcileBatch({ after, deadline, readPage, settle, now = Date.now }: {
  after: number;
  deadline: number;
  readPage: (after: number, limit: number) => Promise<PaymentOrder[]>;
  settle: (order: PaymentOrder) => Promise<SettleOutcome>;
  now?: () => number;
}) {
  const summary = { scanned: 0, settled: 0, already: 0, unpaid: 0, failed: 0 };
  let cursor = after;
  const partial = (reason: "budget_exhausted" | "order_read_failed" | "settlement_failed") => ({
    summary, complete: false, nextAfter: cursor, reason,
  });
  if (deadline - now() < MIN_ORDER_BUDGET_MS) return partial("budget_exhausted");
  let orders: PaymentOrder[];
  try {
    orders = await readPage(after, RECONCILE_LIMIT + 1);
  } catch {
    return partial("order_read_failed");
  }
  for (const order of orders.slice(0, RECONCILE_LIMIT)) {
    if (deadline - now() < MIN_ORDER_BUDGET_MS) return partial("budget_exhausted");
    summary.scanned += 1;
    let outcome: SettleOutcome;
    try { outcome = await settle(order); } catch { outcome = "failed"; }
    if (outcome === "failed") {
      summary.failed += 1;
      return { ...partial("settlement_failed"), failedOrderId: order.id };
    }
    if (outcome === "settled") summary.settled += 1;
    else if (outcome === "duplicate_or_already") summary.already += 1;
    else summary.unpaid += 1;
    cursor = order.id;
  }
  const complete = orders.length <= RECONCILE_LIMIT;
  return { summary, complete, nextAfter: complete ? null : cursor, reason: null };
}

/** Cron claims one order at a time, so an expiring invocation never strands a preclaimed batch. */
export async function reconcileAutomatic({ deadline, claim, settle, now = Date.now }: {
  deadline: number;
  claim: () => Promise<PaymentOrder | null>;
  settle: (order: PaymentOrder) => Promise<SettleOutcome>;
  now?: () => number;
}) {
  const summary = { scanned: 0, settled: 0, already: 0, unpaid: 0, failed: 0 };
  for (let i = 0; i < AUTOMATIC_RECONCILE_LIMIT && deadline - now() >= MIN_ORDER_BUDGET_MS; i++) {
    let order: PaymentOrder | null;
    try { order = await claim(); }
    catch { return { summary, reason: "claim_failed" as const }; }
    if (!order) return { summary, reason: null };
    summary.scanned += 1;
    let outcome: SettleOutcome;
    try { outcome = await settle(order); } catch { outcome = "failed"; }
    if (outcome === "failed") {
      summary.failed += 1;
      return { summary, reason: "settlement_failed" as const, failedOrderId: order.id };
    }
    if (outcome === "settled") summary.settled += 1;
    else if (outcome === "duplicate_or_already") summary.already += 1;
    else summary.unpaid += 1;
  }
  return { summary, reason: null };
}
