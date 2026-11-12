import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("payment start enforces the site switch even for a direct bookmarked checkout URL", async () => {
  // Execute the actual route with framework/auth/database adapters replaced.
  const source = await readFile(new URL("../src/app/api/payments/start/route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let enabled = false;
  let calls = 0;
  let sellable = true;
  class OrderError extends Error {}
  const order = { id: 2, user_id: "buyer", sku_type: "single", target_id: 9, status: "pending", amount: 1, merchant_order_no: "91234567890123456789012345678901" };
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: order, error: null }) };
  const adapters: Record<string, unknown> = {
    "next/server": { NextResponse: { json: Response.json, redirect: Response.redirect } },
    "@/lib/account/session": { getUserIdentity: async () => ({ user: { id: "buyer" } }) },
    "@/lib/orders/describe": { describeOrder: async () => "Fixture" },
    "@/lib/orders/service": { OrderError, currentSellablePrice: async () => { if (!sellable) throw new OrderError("NOT_SELLABLE"); return 1; } },
    "@/lib/orders/supabase": { supabaseOrderGateway: () => ({}) },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => ({ from: () => query }) },
    "@/lib/get-site-config": { getSiteConfig: async () => ({ siteName: "Test", commerce: { paymentEnabled: enabled, paymentChannels: ["alipay"] } }) },
    "@/lib/site-url": { getSiteUrl: () => "https://site.example.test" },
    "@/lib/payments/zpay": { zpayProviderFromEnv: () => ({ createPayment: () => { calls++; return { redirectUrl: "https://pay.example.test/submit.php" }; } }) },
  };
  const exports: { GET?: (request: Request) => Promise<Response> } = {};
  runInNewContext(code, { exports, URL, require: (name: string) => { assert.ok(name in adapters, `Unexpected dependency ${name}`); return adapters[name]; } });
  const request = () => new Request("https://site.example.test/api/payments/start?order=2&channel=alipay");
  const paused = await exports.GET!(request());
  assert.equal(paused.status, 503);
  assert.equal(paused.headers.get("location"), null);
  assert.equal(calls, 0, "Paused site must not generate a provider payment URL");
  enabled = true;
  const active = await exports.GET!(request());
  assert.equal(active.status, 302);
  assert.equal(active.headers.get("location"), "https://pay.example.test/submit.php");
  assert.equal(calls, 1);
  // 待付单创建后商品停售：不得再生成收银台地址。
  sellable = false;
  const stopped = await exports.GET!(request());
  assert.equal(stopped.status, 409);
  assert.equal(calls, 1, "A product that stopped selling must not reach the provider");
});
