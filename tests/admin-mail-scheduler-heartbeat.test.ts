import test from "node:test";
import assert from "node:assert/strict";
import { sendMailSchedulerHeartbeat } from "../src/lib/mail-scheduler-heartbeat";

test("mail scheduler heartbeat only sends an empty, bounded HTTPS success signal", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const request = (async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  for (const value of [undefined, "http://hc-ping.com/check", "https://user:token@hc-ping.com/check",
    "https://hc-ping.com/check?secret=1", "https://hc-ping.com/check#fragment", "invalid-url"])
    await sendMailSchedulerHeartbeat(value, request);
  assert.equal(calls.length, 0);

  await sendMailSchedulerHeartbeat("https://hc-ping.com/test-only-check", request);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://hc-ping.com/test-only-check");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(calls[0].init?.cache, "no-store");
  assert.equal(calls[0].init?.redirect, "error");
  assert.ok(calls[0].init?.signal);
  assert.equal(calls[0].init?.body, undefined);
  assert.equal(calls[0].init?.headers, undefined);
});

test("mail scheduler heartbeat failure never exposes its secret URL or fails the worker", async () => {
  const secret = "test-only-secret-should-not-appear";
  const request = (async () => { throw new Error(secret); }) as typeof fetch;
  await assert.doesNotReject(sendMailSchedulerHeartbeat(`https://hc-ping.com/${secret}`, request));
});

test("mail scheduler heartbeat does not wait for an unresponsive response stream", async () => {
  const request = (async () => new Response(new ReadableStream({
    cancel: () => new Promise<void>(() => {}),
  }))) as typeof fetch;
  await Promise.race([
    sendMailSchedulerHeartbeat("https://hc-ping.com/test-only-check", request),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Heartbeat stream cancellation hung")), 100)),
  ]);
});
