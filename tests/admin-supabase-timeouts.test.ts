import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { supabaseRequestOptions } from "../src/lib/supabase/request-options";
import { needsSessionRefresh } from "../src/lib/supabase/session-routing";

const client = (fetchImpl: typeof fetch, timeoutMs = 20, retryReadOnce = false) => createClient("https://fixture.example", "fixture-key", {
  ...supabaseRequestOptions({ timeoutMs, fetchImpl, retryReadOnce }),
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

test("machine/signature/Bearer routes skip unrelated browser Auth, while cookie-authorized routes retain it", () => {
  for (const path of ["/card.json", "/llms.txt", "/api/payments/notify", "/api/cron/mail-outbox", "/api/cron/expiry-reminder"])
    assert.equal(needsSessionRefresh(path), false);
  for (const path of ["/card", "/checkout/7", "/api/payments/reconcile", "/api/orders", "/admin/setup", "/me", "/api/cron/mail-outbox/unrelated"])
    assert.equal(needsSessionRefresh(path), true);
});

test("bounded Supabase reads do not multiply requests or honour unbounded Retry-After sleeps", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return Response.json({ message: "unavailable" }, { status: 503, headers: { "Retry-After": "0" } });
  }) as typeof fetch;
  const result = await client(fetchImpl).from("site_config").select("id");
  assert.ok(result.error);
  assert.equal(calls, 1, "SDK retries must not restart a bounded request");
});

test("opted-in read retries one transport failure, without retrying an HTTP error", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    if (calls === 1) throw new TypeError("fetch failed");
    return Response.json([{ id: 1 }]);
  }) as typeof fetch;
  const recovered = await client(fetchImpl, 1000, true).from("site_config").select("id");
  assert.equal(recovered.error, null);
  assert.deepEqual(recovered.data, [{ id: 1 }]);
  assert.equal(calls, 2);

  const unavailable = await client((async () => {
    calls++;
    return Response.json({ message: "unavailable" }, { status: 503, headers: { "Retry-After": "0" } });
  }) as typeof fetch, 1000, true).from("site_config").select("id");
  assert.ok(unavailable.error);
  assert.equal(calls, 3, "HTTP responses are not transport retries");
});

test("opted-in read retries its own timeout, but never a write", async () => {
  let calls = 0;
  const fetchImpl = (async (_input, init) => {
    calls++;
    if (calls > 1) return Response.json([{ id: 1 }]);
    return new Promise<Response>((resolve, reject) => {
      // A real socket keeps the loop alive; AbortSignal.timeout alone uses an unref'ed timer.
      const timer = setTimeout(() => resolve(Response.json([])), 1000);
      const stop = () => { clearTimeout(timer); reject(init?.signal?.reason); };
      if (init?.signal?.aborted) stop(); else init?.signal?.addEventListener("abort", stop, { once: true });
    });
  }) as typeof fetch;
  const recovered = await client(fetchImpl, 20, true).from("site_config").select("id");
  assert.equal(recovered.error, null);
  assert.equal(calls, 2);

  calls = 0;
  const failedWrite = await client((async () => {
    calls++;
    throw new TypeError("fetch failed");
  }) as typeof fetch, 20, true).from("site_config").update({ site_name: "Fixture" }).eq("id", 1);
  assert.ok(failedWrite.error);
  assert.equal(calls, 1, "an ambiguous write must not be replayed");
});

test("caller cancellation does not retry a read", async () => {
  const parent = new AbortController();
  let calls = 0;
  const transport = supabaseRequestOptions({ retryReadOnce: true, signal: parent.signal, fetchImpl: (async (_input, init) => {
    calls++;
    parent.abort();
    throw init?.signal?.reason;
  }) as typeof fetch }).global!;
  await assert.rejects(transport.fetch("https://fixture.example"));
  assert.equal(calls, 1);
});

test("bounded Supabase read timeout is one deadline, not four deadlines plus backoff", async () => {
  let calls = 0;
  const fetchImpl = (async (_input, init) => {
    calls++;
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(Response.json([])), 1000);
      const stop = () => { clearTimeout(timer); reject(init?.signal?.reason); };
      if (init?.signal?.aborted) stop(); else init?.signal?.addEventListener("abort", stop, { once: true });
    });
  }) as typeof fetch;
  const started = performance.now();
  const result = await client(fetchImpl).from("site_config").select("id");
  const elapsed = performance.now() - started;
  assert.ok(result.error);
  assert.equal(calls, 1, `20 ms request made ${calls} attempts in ${Math.round(elapsed)} ms`);
  assert.ok(elapsed < 500, `20 ms request took ${Math.round(elapsed)} ms`);
});

test("bounded transport preserves both request cancellation and the worker's total deadline", async () => {
  const parent = new AbortController(), request = new AbortController();
  let forwarded: AbortSignal | null | undefined;
  const fetchImpl = (async (_input, init) => { forwarded = init?.signal; return Response.json([]); }) as typeof fetch;
  const transport = supabaseRequestOptions({ timeoutMs: 1000, signal: parent.signal, fetchImpl }).global!;
  await transport.fetch(new Request("https://fixture.example", { signal: request.signal }));
  request.abort(); assert.equal(forwarded?.aborted, true);
  const next = new AbortController();
  await transport.fetch("https://fixture.example", { signal: next.signal });
  parent.abort(); assert.equal(forwarded?.aborted, true);
});
