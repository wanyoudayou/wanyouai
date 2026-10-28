import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Anonymous HTTP checks only: no credentials, valid callbacks or business writes.
const base = new URL(process.argv[2] ?? "http://localhost:3000");
assert(["http:", "https:"].includes(base.protocol), "Expected an HTTP(S) application URL");
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const request = async (path, options = {}) => {
  try { return await fetch(new URL(path, base), {
    ...options,
    headers: { ...options.headers, ...(bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : {}) },
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  }); }
  catch (error) { throw new Error(`HTTP check failed: ${path} (${error instanceof Error ? error.name : "unknown"})`); }
};
let passed = 0;
const manifest = JSON.parse(await readFile(new URL("../supabase/release-manifest.json", import.meta.url), "utf8"));
for (const method of ["GET", "POST"]) {
  for (const body of ["sign=invalid", "out_trade_no=1&out_trade_no=2&money=10&sign=invalid"]) {
    const response = await request(`/api/payments/notify${method === "GET" ? `?${body}` : ""}`, {
      method, ...(method === "POST" ? { body, headers: { "content-type": "application/x-www-form-urlencoded" } } : {}),
    });
    assert.equal(response.status, 400, `${method} invalid notify must be rejected`);
    assert.equal(await response.text(), "fail");
    passed++;
  }
}
const order = await request("/api/orders", { method: "POST", headers: { "content-type": "application/json", origin: base.origin }, body: '{"sku_type":"subscription"}' });
assert.equal(order.status, 401, "Anonymous order creation must require authentication");
passed++;
for (const method of ["GET", "POST"]) {
  const worker = await request("/api/cron/mail-outbox", { method });
  assert.equal(worker.status, 401, "Anonymous callers must not run the mail worker");
  assert.equal(worker.headers.get("cache-control"), "no-store");
  assert.deepEqual(await worker.json(), { message: "未授权" });
  passed++;
}
const paymentCron = await request("/api/cron/payment-reconcile", { method: "POST" });
assert.equal(paymentCron.status, 401, "Anonymous callers must not reconcile payments");
assert.equal(paymentCron.headers.get("cache-control"), "no-store");
assert.deepEqual(await paymentCron.json(), { message: "未授权" });
passed++;
for (const path of ["/api/cron/mail-outbox", "/api/cron/expiry-reminder"]) {
  const response = await request(path, { method: "HEAD" });
  assert.equal(response.status, 405, `${path} must not execute GET for HEAD`);
  assert.equal(response.headers.get("allow"), "GET, POST");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), "");
  passed++;
}
const paymentHead = await request("/api/cron/payment-reconcile", { method: "HEAD" });
assert.equal(paymentHead.status, 405, "HEAD must not execute payment reconciliation");
assert.equal(paymentHead.headers.get("allow"), "POST");
assert.equal(paymentHead.headers.get("cache-control"), "no-store");
assert.equal(await paymentHead.text(), "");
passed++;
const setup = await request("/admin/setup");
const setupHtml = await setup.text();
assert([200, 303, 307, 308].includes(setup.status));
assert(!setupHtml.includes("按顺序完成：检查部署配置"), "Anonymous response must not contain owner diagnostics");
assert(manifest.schema_version);
assert(!setupHtml.includes(manifest.schema_version), "Anonymous response must not contain database version diagnostics");
assert(setup.headers.get("location")?.includes("/admin") || /NEXT_REDIRECT.*\/admin/.test(setupHtml), "Anonymous diagnostics must redirect to admin login");
passed++;
// These requests stop at authentication: no owner session, publisher token or model consent.
for (const path of ["/api/admin/files", "/api/admin/media", "/api/admin/skills", "/api/admin/handbook-credentials", "/api/admin/ai/check", "/api/admin/ai/index", "/api/admin/pages/generate", "/api/skills/delivery", "/api/skills/chat", "/api/handbooks/v1/connect"]) {
  const response = await request(path, { method: "POST", headers: { origin: base.origin, "content-type": "application/json" }, body: "{}" });
  assert.equal(response.status, 401, `${path} must reject anonymous writes before any business action`);
  assert.equal(response.headers.get("cache-control"), "no-store", `${path} authentication failures must not be cached`);
  passed++;
}
for (const path of ["/api/admin/skills?id=1", "/api/admin/handbook-credentials", "/api/admin/ai/index", "/api/handbooks/v1/connect"]) {
  const response = await request(path);
  assert.equal(response.status, 401, `${path} must reject anonymous private reads`);
  assert.equal(response.headers.get("cache-control"), "no-store");
  passed++;
}
for (const path of ["/card.json", "/llms.txt"]) {
  const response = await request(path);
  assert.equal(response.status, 200, `${path} must be available`);
  const body = await response.text();
  const etag = response.headers.get("etag");
  assert(etag && response.headers.get("cache-control"), `${path} cache headers are required`);
  assert(!/DEMO-(PAID(-SINGLE)?|SUBSCRIBER|RESTRICTED)-BODY/.test(body), `${path} restricted fixture body leaked`);
  const repeat = await request(path, { headers: { "if-none-match": etag } });
  assert.equal(repeat.status, 304, `${path} ETag must support conditional requests`);
  passed++;
}
console.log(`PASS ${passed}/${passed} anonymous security HTTP checks (no business writes)`);
