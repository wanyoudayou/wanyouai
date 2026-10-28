import test from "node:test";
import assert from "node:assert/strict";
import { currentCandidate, indexComplete, knowledgeStep } from "../src/lib/ai/knowledge-workflow";
import type { KnowledgeGeneration, KnowledgeStatus } from "../src/lib/ai/knowledge";

const generation = (patch: Partial<KnowledgeGeneration> = {}): KnowledgeGeneration => ({
  id: "candidate", connectionId: "connection", state: "building", scanCursor: "", scanComplete: true,
  approvedRevision: 8, providerAttempts: 3, threshold: null, evaluatedRevision: null, evaluation: null,
  counts: { total: 36, ready: 36, pending: 0, leased: 0, failed: 0, obsolete: 0 }, ...patch,
});
const status = (g = generation()): KnowledgeStatus => ({ sourceRevision: 8, selectedConnection: "connection", activeGeneration: null,
  sourceCount: 16, sourceBytes: 48000, generationCount: 1, generations: [g], evaluations: [] });

test("36/36 persisted vectors move directly to evaluation, not another build", () => {
  const s = status(); assert(indexComplete(s, s.generations[0])); assert.equal(knowledgeStep(s, true), 4);
  assert.equal(currentCandidate(s)?.id, "candidate");
  assert.equal(knowledgeStep(status(generation({ state: "ready", evaluatedRevision: 8 })), true), 4, "quality result alone never activates the index");
  assert.equal(knowledgeStep(status(generation({ state: "ready", evaluatedRevision: 8, acceptedRun: "accepted" })), true), 4);
  assert.equal(knowledgeStep(status(generation({ state: "ready", evaluatedRevision: 7 })), true), 4);
});
test("Uncertain counts, incomplete scans, source changes and unavailable prerequisites never unlock evaluation", () => {
  for (const patch of [{ pending: 1, ready: 35 }, { leased: 1, ready: 35 }, { failed: 1, ready: 35 }, { ready: 35 }]) {
    const s = status(generation({ counts: { ...generation().counts, ...patch } }));
    assert(!indexComplete(s, s.generations[0])); assert.equal(knowledgeStep(s, true), 3);
  }
  for (const patch of [{ approvedRevision: 7 }, { scanComplete: false }]) assert.equal(knowledgeStep(status(generation(patch)), true), 3);
  assert.equal(knowledgeStep(status(), false), 1);
  assert.equal(knowledgeStep({ ...status(), sourceCount: 0 }, true), 1);
});
test("Active indexes show ready only for the current sources and selected connection; pending candidates take precedence", () => {
  const active = generation({ id: "active", state: "active", evaluatedRevision: 8 });
  const s = { ...status(active), activeGeneration: active.id };
  assert.equal(knowledgeStep(s, true), 5);
  assert.equal(knowledgeStep({ ...s, sourceRevision: 9 }, true), 2);
  assert.equal(knowledgeStep({ ...s, selectedConnection: "other" }, true), 2);
  assert.equal(knowledgeStep({ ...s, generations: [active, generation()] }, true), 4);
  assert.equal(knowledgeStep({ ...s, generations: [] }, true), 2);
});

test("Status uses the installed RPC contract without assuming evaluation timestamp columns", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const { knowledgeStatus } = await import("../src/lib/ai/knowledge");
  const base = status();
  const run = { generationId: "candidate", sourceRevision: 8, state: "complete" as const, completed: 40, total: 40, attempts: 3 };
  base.evaluations = [{ ...run, id: "first" }, { ...run, id: "second" }];
  let unavailable = false;
  const requests: string[] = [];
  const client = createClient("https://synthetic.supabase.co", "synthetic-test-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async input => {
    const url = new URL(String(input)); requests.push(url.pathname);
    // Existing installations expose evaluation progress through this RPC. In
    // particular, knowledge_evaluations has no created_at column.
    if (url.pathname !== "/rest/v1/rpc/knowledge_index_status") return Response.json({ code: "42703", message: "undefined column" }, { status: 400 });
    return unavailable ? Response.json({ message: "unavailable" }, { status: 503 }) : Response.json(base);
  } } });
  const result = await knowledgeStatus(client as Parameters<typeof knowledgeStatus>[0]);
  assert.deepEqual(result, base);
  assert.deepEqual(requests, ["/rest/v1/rpc/knowledge_index_status"]);
  unavailable = true;
  await assert.rejects(knowledgeStatus(client as Parameters<typeof knowledgeStatus>[0]), /KNOWLEDGE_STATUS_UNAVAILABLE/);
});
