import test from "node:test";
import assert from "node:assert/strict";
import { applyPaymentNotification } from "../src/lib/payments/notification";

const verified = { orderNo: "91234567890123456789012345678901", tradeNo: "T7", amount: 19 };
test("payment notification: only committed recognized outcomes acknowledge success", async () => {
  for (const data of ["settled", "duplicate", "already_paid"]) {
    assert.deepEqual(await applyPaymentNotification(verified, {}, async args => {
      assert.equal(args.p_merchant_order_no, "91234567890123456789012345678901"); assert.equal(args.p_event_id, "T7"); assert.equal(args.p_amount, 19);
      return { data, error: null };
    }), { body: "success", status: 200 });
  }
  for (const data of [null, "unpaid", "unknown", ["settled"]])
    assert.deepEqual(await applyPaymentNotification(verified, {}, async () => ({ data, error: null })), { body: "fail", status: 500 });
  assert.deepEqual(await applyPaymentNotification(verified, {}, async () => { throw new Error("Timeout after possible commit; private key"); }), { body: "fail", status: 500 });
  assert.deepEqual(await applyPaymentNotification(verified, {}, async () => ({ data: null, error: { message: "AMOUNT_MISMATCH" } })), { body: "fail", status: 400 });
  assert.deepEqual(await applyPaymentNotification({ ...verified, orderNo: "9007199254740993" }, {}, async () => { throw new Error("Must not query"); }), { body: "fail", status: 400 });
});
