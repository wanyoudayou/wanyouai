import { createHash, timingSafeEqual } from "node:crypto";
import type { PaymentProvider } from "./types";

/** 易支付兼容协议：md5 签名（参数按 key 升序、排除空值与 sign/sign_type，拼接商户密钥）。 */
const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");

export function epaySign(params: Record<string, string>, key: string): string {
  const qs = Object.keys(params)
    .filter((k) => k !== "sign" && k !== "sign_type" && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return md5(qs + key);
}

export interface ZpayConfig { baseUrl: string; pid: string; key: string; }

/** 三值同配启用且 base URL 必须 HTTPS，否则返回 null（「暂未开通在线收款」）。 */
export function zpayConfigFromEnv(env: Record<string, string | undefined>): ZpayConfig | null {
  const baseUrl = (env.ZPAY_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const pid = (env.ZPAY_PID ?? "").trim();
  const key = (env.ZPAY_KEY ?? "").trim();
  if (!pid || !key || !/^https:\/\//i.test(baseUrl)) return null;
  return { baseUrl, pid, key };
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8"); const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Match the database numeric(8,2) range without accepting exponents or coercing null to zero. */
function paymentAmount(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value);
  if (!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(raw)) return null;
  const amount = Number(raw);
  return amount > 0 && amount <= 999999.99 ? amount : null;
}

const validTradeNo = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const validOrderNo = (value: string) => /^9[0-9]{31}$/.test(value);

export function zpayProvider(config: ZpayConfig, fetchImpl: typeof fetch = fetch): PaymentProvider {
  const { baseUrl, pid, key } = config;
  return {
    name: "zpay",
    createPayment({ order, productName, notifyUrl, returnUrl, channel }) {
      if (!validOrderNo(order.merchant_order_no)) throw new Error("INVALID_PAYMENT_REFERENCE");
      const params: Record<string, string> = {
        pid,
        // zpay 要求 type 非空：买家在我们的核对页选定渠道（支付宝/微信）后传入。
        type: channel,
        out_trade_no: order.merchant_order_no,
        notify_url: notifyUrl,
        return_url: returnUrl,
        name: productName,
        money: Number(order.amount).toFixed(2),
        sign_type: "MD5",
      };
      const signed = { ...params, sign: epaySign(params, key) };
      return { redirectUrl: `${baseUrl}/submit.php?${new URLSearchParams(signed).toString()}` };
    },
    verifyNotify(params) {
      // A single canonical record must feed both signature verification and settlement.
      const record: Record<string, string> = Object.create(null);
      for (const [name, value] of params) {
        if (Object.hasOwn(record, name)) return null;
        record[name] = value;
      }
      if (record.sign_type !== "MD5" || record.pid !== pid || record.trade_status !== "TRADE_SUCCESS") return null;
      const got = (record.sign ?? "").toLowerCase();
      if (!/^[a-f0-9]{32}$/.test(got)) return null;
      if (!safeEqual(epaySign(record, key), got)) return null;
      const orderNo = record.out_trade_no ?? "";
      const tradeNo = record.trade_no;
      const amount = paymentAmount(record.money);
      if (!validOrderNo(orderNo) || !validTradeNo(tradeNo) || amount === null) return null;
      return { orderNo, tradeNo, amount };
    },
    async queryOrder(order) {
      if (!validOrderNo(order.merchant_order_no)) throw new Error("INVALID_PAYMENT_REFERENCE");
      const qs = new URLSearchParams({ act: "order", pid, key, out_trade_no: order.merchant_order_no });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetchImpl(`${baseUrl}/api.php?${qs}`, { signal: controller.signal });
        if (!response.ok) throw new Error("查单请求失败");
        const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        if (data?.code !== 1 || String(data.pid) !== pid || String(data.out_trade_no) !== order.merchant_order_no) throw new Error("INVALID_PAYMENT_RESPONSE");
        if (data.status === 0) return { paid: false, tradeNo: null, amount: null };
        const amount = paymentAmount(data.money);
        if (data.status !== 1 || !validTradeNo(data.trade_no) || amount === null) throw new Error("INVALID_PAYMENT_RESPONSE");
        return { paid: true, tradeNo: data.trade_no, amount };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function zpayProviderFromEnv(env: Record<string, string | undefined> = process.env, fetchImpl?: typeof fetch): PaymentProvider | null {
  const config = zpayConfigFromEnv(env);
  return config ? zpayProvider(config, fetchImpl) : null;
}
