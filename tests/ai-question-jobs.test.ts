import test from "node:test";
import assert from "node:assert/strict";
import { stepQuestionDraft, questionDraft, beginQuestionDraft } from "../src/lib/ai/knowledge-questions";
import type { AIMessage } from "../src/lib/ai/generation";

function fixture() {
  const hash = "a".repeat(64);
  const manifest = Array.from({ length: 10 }, (_, i) => ({ id: `item-${i}`, target: `article:source-${i}`, sourceKey: `chunk:${i}`, sourceHash: hash }));
  const draft = { id: "draft", generation_id: "candidate", source_revision: 1, connection_id: "generation", state: "pending", next_item: 0, manifest, cases: [] as unknown[], lease_id: null as string | null, lease_expires_at: null as string | null };
  const state = { calls: 0, fail: false, invalid: false, revision: 1, mutate: false, budget: "reserved", indexState: "building" };
  const tables: Record<string, Record<string, unknown>[]> = {
    knowledge_question_drafts: [draft],
    ai_settings: [{ id: 1, generation_connection: "generation", embedding_connection: "embedding" }],
    ai_connections: [{ id: "generation", purpose: "generation", protocol: "chat", base_url: "https://api.deepseek.com", model: "synthetic-model", api_key: "synthetic-test-key", verified_at: "2026-01-01" }],
    knowledge_index_items: manifest.map(item => ({ id: item.id, generation_id: "candidate", state: "ready", content: `已确认来源 ${item.id}`, source_hash: hash })),
  };
  const ledger: string[] = [];
  const service = { from: (name: string) => {
    assert(name in tables);
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    let patch: Record<string, unknown> | null = null; let result: { data: Record<string, unknown>[]; error: null } | undefined;
    const get = () => {
      if (!result) { const rows = tables[name].filter(row => filters.every(filter => filter(row))); if (patch) rows.forEach(row => Object.assign(row, patch)); result = { data: rows.map(row => structuredClone(row)), error: null }; }
      return result;
    };
    const chain = { select: () => chain, update: (value: Record<string, unknown>) => { patch = value; return chain; },
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return chain; },
      gt: (key: string, value: string) => { filters.push(row => String(row[key]) > value); return chain; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return chain; },
      order: () => chain, limit: () => chain,
      single: async () => ({ ...get(), data: get().data[0] ?? null }), maybeSingle: async () => ({ ...get(), data: get().data[0] ?? null }),
      then: (resolve: (value: unknown) => unknown) => resolve(get()) };
    return chain;
  }, rpc: async (name: string) => {
    if (name === "knowledge_index_status") return { data: { sourceRevision: state.revision, sourceCount: 10, selectedConnection: "embedding", evaluations: [], generations: [{ id: "candidate", connectionId: "embedding", state: state.indexState, scanComplete: true, approvedRevision: 1, counts: { total: 10, ready: 10, pending: 0, leased: 0, failed: 0 } }] }, error: null };
    ledger.push(name); return { data: name === "reserve_ai_call" ? state.budget : true, error: null };
  } };
  const generate = async (_connection: unknown, messages: AIMessage[]) => {
    state.calls++;
    if (state.fail) throw new Error("SYNTHETIC_PROVIDER_OUTCOME_UNKNOWN");
    if (state.mutate) state.revision++;
    if (state.invalid) return { content: "not JSON", usage: { prompt_tokens: 2, completion_tokens: 1 } };
    const input = messages[1].content;
    const sources = JSON.parse(input.split("来源：\n")[1].split("\n不要重复")[0]) as { id: string }[];
    const count = Number(input.match(/编写 (\d+) 个/)![1]);
    const questions = Array.from({ length: count }, (_, i) => ({ question: `批次 ${state.calls} 的站内问题 ${i}`, sourceId: sources[i % sources.length].id }));
    if (input.includes("以及 10 个库外问题")) for (let i = 0; i < 10; i++) questions.push({ question: `批次 ${state.calls} 的库外问题 ${i}`, sourceId: null as never });
    return { content: JSON.stringify({ questions }), usage: { prompt_tokens: 2, completion_tokens: 1 } };
  };
  const step = (retry = false) => stepQuestionDraft(service as never, "draft", "owner", new AbortController().signal, retry, { generate });
  return { state, draft, ledger, service, step };
}

test("Question generation persists three bounded batches and reading a completed draft is free", async () => {
  const f = fixture();
  assert.equal((await f.step()).cases.length, 4); assert.equal((await f.step()).cases.length, 8);
  const done = await f.step(); assert.equal(done.state, "complete"); assert.equal(done.cases.length, 20);
  assert(done.cases.every(item => item.reviewed === false && !item.expected.length));
  assert.equal(done.cases[8].evidence, "已确认来源 item-8", "evidence is tied to the actual fragment, not just the article title");
  await f.step(); await questionDraft(f.service as never, "candidate"); assert.equal(f.state.calls, 3);
});
test("A lost or invalid generation result retains prior batches and requires explicit retry", async () => {
  const f = fixture(); await f.step(); f.state.fail = true;
  await assert.rejects(f.step(), /SYNTHETIC_PROVIDER_OUTCOME_UNKNOWN/);
  assert.equal(f.draft.state, "failed"); assert.equal(f.draft.cases.length, 4);
  f.state.fail = false;
  await assert.rejects(f.step(), /MANUAL_RETRY_REQUIRED/); assert.equal(f.state.calls, 2);
  await f.step(true); await f.step(); assert.equal(f.draft.cases.length, 20);
  const invalid = fixture(); invalid.state.invalid = true; await assert.rejects(invalid.step(), /OUTPUT_INVALID/); assert.equal(invalid.draft.state, "failed");
});
test("Parallel dispatch cannot claim the same batch twice; expired leases need fresh consent", async () => {
  const f = fixture(); await Promise.allSettled([f.step(), f.step()]); assert.equal(f.state.calls, 1);
  f.draft.state = "leased"; f.draft.lease_id = "expired"; f.draft.lease_expires_at = "2020-01-01";
  assert.equal((await questionDraft(f.service as never, "candidate"))?.state, "failed");
  await assert.rejects(f.step(), /MANUAL_RETRY_REQUIRED/); assert.equal(f.state.calls, 1);
  await f.step(true); assert.equal(f.state.calls, 2);
});
test("Source drift and budget rejection never silently rebuild a question job", async () => {
  const f = fixture(); f.state.revision++;
  await assert.rejects(f.step(), /INCOMPLETE/); assert.equal(f.state.calls, 0);
  const budget = fixture(); budget.state.budget = "monthly_limit";
  await assert.rejects(budget.step(), /MONTHLY_LIMIT/); assert.equal(budget.state.calls, 0); assert.equal(budget.draft.state, "failed");
  const changed = fixture(); changed.state.mutate = true;
  await assert.rejects(changed.step(), /INCOMPLETE|SOURCE_CHANGED/); assert.equal(changed.draft.cases.length, 0); assert.equal(changed.draft.state, "failed");
  const connection = fixture();
  await assert.rejects(beginQuestionDraft(connection.service as never, "candidate", "new-request", 1, "previous-generation-connection"), /SETTINGS_CHANGED/);
  assert.equal(connection.state.calls, 0);
});

test("Optional question drafts remain usable after activation but reject retired indexes before paid work", async () => {
  const active = fixture(); active.state.indexState = "active";
  assert.equal((await active.step()).cases.length, 4); assert.equal(active.state.calls, 1);
  const retired = fixture(); retired.state.indexState = "retired";
  await assert.rejects(retired.step(), /KNOWLEDGE_INCOMPLETE/); assert.equal(retired.state.calls, 0);
});
