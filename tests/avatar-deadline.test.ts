import test from "node:test";
import assert from "node:assert/strict";
import { withinSignal, providerSignal } from "../src/lib/avatar/deadline";
import { providerJSON } from "../src/lib/ai/transport";
test("deadline: abort bounds a promise which never settles", async () => {
  const controller = new AbortController();
  const pending = withinSignal(new Promise(() => {}), controller.signal);
  controller.abort(new Error("stopped"));
  await assert.rejects(pending, /stopped/);
  assert.equal(providerSignal(controller.signal).aborted, true);
});
test("deadline: stalled provider body is cancelled after headers", async () => {
  const controller = new AbortController(); let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  const pending = providerJSON(response, controller.signal);
  controller.abort(new Error("stopped"));
  await assert.rejects(pending);
  assert.equal(cancelled, true);
});
