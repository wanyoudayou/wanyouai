import test from "node:test";
import assert from "node:assert/strict";
import { deliverGrant, outboxConfig, renderGrantMessage, runMailOutbox, type MailJob, type OutboxGateway, type Delivery } from "../src/lib/payments/mail-outbox";

const clock = Date.parse("2026-09-29T12:00:00Z");
const config = outboxConfig({ RESEND_API_KEY: "test-only-key", EMAIL_FROM: "Site <sender@example.test>", SITE_URL: "https://site.example" })!;
const job = (): MailJob => ({ id: "00000000-0000-4000-8000-000000000001", lease_token: "lease", lease_until: new Date(clock + 120000).toISOString(), attempts: 1,
  snapshot: { version: 1, user_id: "user", order_id: 1, site_name: "<Configured Site>", description: "<Safe Title>", ends_at: null },
  message: null, provider_fingerprint: null, started_at: null });
const prepared = (): MailJob => {
  const value = job(); value.message = renderGrantMessage(value, "fixture@example.test", config);
  value.started_at = new Date(clock).toISOString(); value.provider_fingerprint = config.fingerprint;
  return value;
};
const gateway = (value = job()) => {
  let next: MailJob | null = value;
  const records: Delivery[] = [];
  const api: OutboxGateway = {
    async claim() { const result = next; next = null; return result; },
    async recipient() { return "fixture@example.test"; },
    async prepare(j, message, fingerprint) { Object.assign(j, { message, provider_fingerprint: fingerprint, started_at: new Date(clock).toISOString() }); return j; },
    async finish(_j, delivery) { records.push(delivery); return true; },
    async health() { return { pending: 0, processing: 0, dead: 0, sent: 0, oldest_due_seconds: 0 }; },
  };
  return { api, records, recover() { next = value; } };
};

test("mail worker: disabled or exhausted runtime never claims or sends", async () => {
  const fail = async () => { throw new Error("Must not touch credentials or queue"); };
  assert.equal((await runMailOutbox({ claim: fail } as never, null)).enabled, false);
  const g = gateway(); g.api.claim = fail;
  assert.equal((await runMailOutbox(g.api, config, { budgetMs: 34000 })).summary.claimed, 0);
  assert.equal(outboxConfig({}), null);
  assert.equal(outboxConfig({ RESEND_API_KEY: "key", EMAIL_FROM: "sender", SITE_URL: "https://user:secret@site.example" }), null);
});

test("mail worker: lost acknowledgement/restart reuses frozen recipient, sender, body and provider key", async () => {
  const value = job(), g = gateway(value), requests: { key: string; body: string }[] = [];
  const stub = (async (_url, init) => {
    const key = new Headers(init?.headers).get("Idempotency-Key")!;
    requests.push({ key, body: String(init?.body) });
    return Response.json({ id: "same-provider-receipt" });
  }) as typeof fetch;
  const deliver: typeof deliverGrant = (c, j) => deliverGrant(c, j, stub);
  g.api.finish = async () => { throw new Error("Database unreachable after provider acceptance"); };
  await assert.rejects(runMailOutbox(g.api, config, { now: () => clock, deliver }));
  assert.ok(value.message && value.started_at);
  g.recover(); g.api.recipient = async () => { throw new Error("Must not re-read a changed recipient"); };
  g.api.prepare = async () => { throw new Error("Must not re-render config"); };
  g.api.finish = async (_j, outcome) => { g.records.push(outcome); return true; };
  const updated = { ...config, from: "Changed <other@example.test>", siteUrl: "https://other.example" };
  const result = await runMailOutbox(g.api, updated, { now: () => clock + 121000, deliver });
  // The lease is refreshed on re-claim by the database; simulate it for this pure gateway.
  assert.equal(result.summary.retry, 1);
  g.recover(); value.lease_until = new Date(clock + 300000).toISOString();
  const retry = await runMailOutbox(g.api, updated, { now: () => clock + 122000, deliver });
  assert.equal(retry.summary.sent, 1);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(requests[0].key, `grant/${value.id}`);
  assert.equal(requests[0].body.includes("Changed"), false);
  assert.match(value.message.html, /&lt;Safe Title&gt;/);
});

test("mail delivery: provider failure classification never exposes response bodies or keys", async () => {
  for (const [status, body, outcome, code] of [
    [429, {}, "retry", "provider_retry"], [503, {}, "retry", "provider_retry"],
    [400, { message: "private sender" }, "dead", "provider_rejected"],
    [401, { message: "sensitive" }, "dead", "provider_rejected"],
    [403, { message: "private domain" }, "dead", "provider_rejected"], [422, {}, "dead", "provider_rejected"],
    [409, { name: "concurrent_idempotent_requests" }, "retry", "provider_retry"],
    [409, { name: "invalid_idempotent_request" }, "dead", "provider_rejected"],
    [200, { unexpected: "secret" }, "retry", "invalid_response"],
  ] as const) {
    const stub = (async () => Response.json(body, { status })) as typeof fetch;
    assert.deepEqual(await deliverGrant(config, prepared(), stub), {
      outcome, code, ...(status >= 400 ? { providerStatus: status } : {}),
    });
  }
  const fail = (async () => { throw new Error("private recipient + key"); }) as typeof fetch;
  assert.deepEqual(await deliverGrant(config, prepared(), fail), { outcome: "retry", code: "network" });
  assert.deepEqual(await deliverGrant({ ...config, fingerprint: "other-account" }, prepared(), fail), { outcome: "dead", code: "config_changed" });
});

test("mail worker: 23h safe window, stale lease, missing recipient and partial acknowledgement", async () => {
  const deliver = async () => { throw new Error("No external send is allowed"); };
  const expired = gateway(prepared());
  assert.equal((await runMailOutbox(expired.api, config, { now: () => clock + 23 * 3600_000, deliver })).summary.dead, 1);
  assert.deepEqual(expired.records, [{ outcome: "dead", code: "window_expired" }]);
  const missing = gateway(); missing.api.recipient = async () => null;
  assert.equal((await runMailOutbox(missing.api, config, { now: () => clock, deliver })).summary.dead, 1);
  assert.deepEqual(missing.records, [{ outcome: "dead", code: "recipient_missing" }]);
  const lost = gateway(prepared()); lost.api.finish = async () => false;
  const result = await runMailOutbox(lost.api, config, { now: () => clock + 120000, deliver });
  assert.equal(result.summary.leaseLost, 1); assert.equal(result.summary.sent, 0);
  const lastAttempt = prepared(); lastAttempt.attempts = 8;
  const exhausted = gateway(lastAttempt);
  assert.equal((await runMailOutbox(exhausted.api, config, { now: () => clock, deliver: async () => ({ outcome: "retry", code: "network" }) })).summary.dead, 1);
  assert.deepEqual(exhausted.records, [{ outcome: "dead", code: "attempts_exhausted" }]);
});
