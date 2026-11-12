import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcileAutomatic, reconcileBatch, reconcileCursor } from "../src/lib/payments/reconcile";
import type { PaymentOrder } from "../src/lib/payments/types";

const order = (id: number): PaymentOrder => ({ id, merchant_order_no: "91234567890123456789012345678901", user_id: "user", sku_type: "single", target_id: 1, amount: 10, status: "pending" });

test("reconcile rejects ambiguous, negative, fractional and unsafe cursors", () => {
  assert.equal(reconcileCursor(new URLSearchParams()), 0);
  assert.equal(reconcileCursor(new URLSearchParams("after=52")), 52);
  for (const input of ["after=", "after=-1", "after=1.5", "after=01", "after=1e2", "after=9007199254740992", "after=1&after=2"]) {
    assert.equal(reconcileCursor(new URLSearchParams(input)), null, input);
  }
});

test("a failed database scan cannot masquerade as a successful empty batch", async () => {
  const result = await reconcileBatch({ after: 7, deadline: 45_000, now: () => 0,
    readPage: async () => { throw new Error("transport failed"); },
    settle: async () => { assert.fail("must not settle"); },
  });
  assert.equal(result.complete, false);
  assert.equal(result.reason, "order_read_failed");
  assert.equal(result.nextAfter, 7);
  assert.equal(result.summary.scanned, 0);
});

test("a page of unpaid orders does not starve a later paid order", async () => {
  const orders = Array.from({ length: 52 }, (_, i) => order(i + 1));
  const paid: number[] = [];
  const options = { deadline: 45_000, now: () => 0,
    readPage: async (after: number, limit: number) => orders.filter(row => row.id > after).slice(0, limit),
    settle: async (row: PaymentOrder) => {
      if (row.id === 52) { paid.push(row.id); return "settled" as const; }
      return "unpaid" as const;
    },
  };
  const first = await reconcileBatch({ ...options, after: 0 });
  assert.equal(first.complete, false);
  assert.equal(first.nextAfter, 50);
  assert.equal(first.summary.unpaid, 50);
  const second = await reconcileBatch({ ...options, after: first.nextAfter! });
  assert.equal(second.complete, true);
  assert.equal(second.nextAfter, null);
  assert.deepEqual(paid, [52]);
});

test("budget exhaustion returns the last completed order and leaves the rest for continuation", async () => {
  let elapsed = 0;
  const seen: number[] = [];
  const result = await reconcileBatch({ after: 0, deadline: 45_000, now: () => elapsed,
    readPage: async () => [order(1), order(2), order(3)],
    settle: async row => { seen.push(row.id); elapsed += 18_000; return "unpaid"; },
  });
  assert.deepEqual(seen, [1, 2]);
  assert.equal(result.reason, "budget_exhausted");
  assert.equal(result.nextAfter, 2);
  assert.equal(result.complete, false);
});

test("ambiguous settlement stops before advancing past the failed order; continuation can replay safely", async () => {
  for (const throws of [false, true]) {
    const rows = [order(3), order(4), order(5)];
    const readPage = async (after: number) => rows.filter(row => row.id > after);
    const first = await reconcileBatch({ after: 2, deadline: 45_000, now: () => 0, readPage,
      settle: async row => {
        if (row.id === 4) { if (throws) throw new Error("response lost"); return "failed"; }
        return "settled";
      },
    });
    assert.equal(first.reason, "settlement_failed");
    assert.equal(first.nextAfter, 3);
    assert.equal(first.summary.scanned, 2);
    const retried: number[] = [];
    const second = await reconcileBatch({ after: first.nextAfter!, deadline: 45_000, now: () => 0, readPage,
      settle: async row => { retried.push(row.id); return "duplicate_or_already"; },
    });
    assert.deepEqual(retried, [4, 5]);
    assert.equal(second.complete, true);
    assert.equal(second.summary.already, 2);
  }
});

test("an expired batch does not start I/O; a genuinely empty scan is complete", async () => {
  const expired = await reconcileBatch({ after: 0, deadline: 0, now: () => 0,
    readPage: async () => { assert.fail("no budget"); }, settle: async () => "unpaid",
  });
  assert.equal(expired.reason, "budget_exhausted");
  const empty = await reconcileBatch({ after: 0, deadline: 45_000, now: () => 0,
    readPage: async () => [], settle: async () => "unpaid",
  });
  assert.equal(empty.complete, true);
  assert.equal(empty.reason, null);
});

test("automatic reconciliation claims only within budget and settles each claim once", async () => {
  let elapsed = 0;
  const claimed: number[] = [];
  const settled: number[] = [];
  const queue = [order(1), order(2), order(3)];
  const result = await reconcileAutomatic({ deadline: 45_000, now: () => elapsed,
    claim: async () => { const next = queue.shift() ?? null; if (next) claimed.push(next.id); return next; },
    settle: async row => { settled.push(row.id); elapsed += 18_000; return row.id === 1 ? "unpaid" : "settled"; },
  });
  assert.deepEqual(claimed, [1, 2]);
  assert.deepEqual(settled, [1, 2]);
  assert.equal(result.summary.scanned, 2);
  assert.equal(result.summary.settled, 1);
  assert.equal(result.reason, null);
  assert.equal(queue.length, 1);
});

test("automatic claim failure is unhealthy, not an empty successful tick", async () => {
  const result = await reconcileAutomatic({ deadline: 45_000, now: () => 0,
    claim: async () => { throw new Error("database unavailable"); },
    settle: async () => { assert.fail("must not settle"); },
  });
  assert.equal(result.reason, "claim_failed");
  assert.equal(result.summary.scanned, 0);
});

test("automatic settlement failure stops further claims; expiry never claims an order", async () => {
  let claims = 0;
  const claim = async () => { claims += 1; return order(claims); };
  const failed = await reconcileAutomatic({ deadline: 45_000, now: () => 0,
    claim, settle: async () => "failed",
  });
  assert.equal(failed.reason, "settlement_failed");
  assert.equal(failed.failedOrderId, 1);
  assert.equal(claims, 1);
  const expired = await reconcileAutomatic({ deadline: 19_999, now: () => 0,
    claim, settle: async () => { assert.fail("must not settle"); },
  });
  assert.equal(expired.summary.scanned, 0);
  assert.equal(claims, 1);
});
