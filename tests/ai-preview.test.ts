import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePreview } from "../src/lib/ai/preview-evaluation";
import { evaluationCases } from "../src/lib/ai/evaluation-cases";
import { parseQuestionSuggestions } from "../src/lib/ai/knowledge-questions";
import { previewKnowledgeAnswer } from "../src/lib/ai/knowledge-answer-preview";

const cases = evaluationCases(Array.from({ length: 20 }, (_, i) => ({ question: `本站检查问题 ${i}`, expected: i < 10 ? ["article:known"] : [] })));
const matches = () => cases.map(item => [{ target: item.expected[0] ?? "article:unrelated", score: item.expected.length ? .9 : .2 }]);
const digest = "a".repeat(64);
test("Optional diagnostics accept one reviewed question without balanced groups", () => {
  assert.equal(evaluationCases(cases.slice(0, 1)).length, 1);
  assert.equal(evaluationCases(cases.slice(0, 19)).length, 19);
  assert.throws(() => evaluationCases([]), /CASES_REQUIRED/);
  assert.throws(() => evaluationCases(cases.map((item, i) => i === 0 ? { ...item, reviewed: false } : item)), /ANSWERS_UNREVIEWED/);
});
test("Diagnostics report low recall and false hits without a passed flag or activation authority", () => {
  const rows = matches(); rows[8] = rows[9] = [{ target: "article:miss", score: .9 }]; rows[10] = [{ target: "article:outside", score: .95 }];
  const result = evaluatePreview(cases, rows, digest, .5);
  assert.equal(result.report.recall, .8); assert.equal("passed" in result.report, false);
  assert.equal(result.report.falsePositives, 1);
  rows[7] = [{ target: "article:miss", score: .9 }];
  assert.equal(evaluatePreview(cases, rows, digest, .5).report.recall, .7);
});
test("Editing diagnostic labels cannot tune a fixed runtime cutoff", () => {
  const first = evaluatePreview(cases, matches(), digest);
  assert.equal(first.threshold, .5); assert.equal(first.report.policyVersion, 3);
  const changed = evaluatePreview(cases.map(item => ({ ...item, expected: ["article:unrelated"] })), matches(), digest);
  assert.equal(changed.threshold, first.threshold);
  const diagnostic = evaluatePreview(cases, matches(), digest, .97);
  assert.equal(diagnostic.threshold, .97); assert.equal(diagnostic.report.hits, 0);
  assert.throws(() => evaluatePreview(cases, matches().slice(1), digest), /INCOMPLETE/);
  assert.throws(() => evaluatePreview(cases, matches(), digest, NaN), /INCOMPLETE/);
});
test("Source ranking counts five different sources and any approved answer, never the sixth", () => {
  const rows = matches();
  rows[0] = Array.from({ length: 6 }, (_, i) => ({ target: i === 5 ? "article:known" : `article:other-${i}`, score: .99 - i * .01 }));
  assert.equal(evaluatePreview(cases, rows, digest, .5).report.hits, 9);
  rows[0] = Array.from({ length: 12 }, () => ({ target: "article:known", score: .9 }));
  assert.equal(evaluatePreview(cases, rows, digest, .5).report.hits, 10);
});
test("Generated questions preserve evidence but never mark their own answer correct", () => {
  const sources = [{ target: "article:known", content: "只作为出题依据的本站文字" }];
  const suggestions = parseQuestionSuggestions(JSON.stringify({ questions: [{ question: "本站问题？", target: "article:known" }, { question: "资料没有回答的问题？", target: null }] }), sources, true);
  assert(suggestions.every(item => item.reviewed === false && !item.expected.length));
  assert.equal(suggestions[0].evidence, sources[0].content);
  assert.equal(suggestions[0].suggestedTarget, "article:known");
  assert.throws(() => parseQuestionSuggestions('{"questions":[{"question":"未知来源？","target":"article:invented"}]}', sources, false), /OUTPUT_INVALID/);
  assert.throws(() => parseQuestionSuggestions('{"questions":[{"question":"库外？","target":null}]}', sources, false), /OUTPUT_INVALID/);
});

function answerFixture() {
  const state = { embedCalls: 0, generateCalls: 0, prompt: "", budget: "reserved", changed: false, sourceRevision: 1 };
  const settings = { id: 1, revision: "settings", generation_connection: "generation", embedding_connection: "embedding", owner_instructions: "站主补充规则", avatar_enabled: false };
  const connection = (id: string) => ({ id, purpose: id, protocol: id === "generation" ? "chat" : "embeddings", base_url: id === "generation" ? "https://api.deepseek.com" : "https://api.siliconflow.cn/v1", model: id === "generation" ? "synthetic-model" : "BAAI/bge-m3", api_key: "synthetic-test-key", verified_at: "2026-01-01" });
  const tables: Record<string, Record<string, unknown>[]> = {
    ai_settings: [settings], ai_connections: [connection("generation"), connection("embedding")],
    knowledge_evaluations: [{ id: "run", generation_id: "candidate", source_revision: 1, cases, results: matches(), digest, state: "complete", fixed_threshold: .5 }],
    articles: [{ id: 1, slug: "known", series_id: null, type: "blog", title: "受限文章", access: "paid", price: 1, status: "published", preview_md: "公开试读", tags: [] }], series: [],
  };
  const calls: string[] = [];
  const service = { from: (name: string) => {
    assert(name in tables, "preview must not read conversations or write the production cache");
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    const rows = () => tables[name].filter(row => filters.every(filter => filter(row)));
    const chain = { select: () => chain,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return chain; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return chain; },
      single: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: rows(), error: null }) };
    return chain;
  }, rpc: async (name: string) => {
    calls.push(name);
    if (name === "knowledge_index_status") return { data: { sourceRevision: state.sourceRevision, selectedConnection: "embedding", sourceCount: 1, evaluations: [], generations: [{ id: "candidate", connectionId: "embedding", state: "building", scanComplete: true, approvedRevision: 1, counts: { total: 1, ready: 1, pending: 0, leased: 0, failed: 0 } }] }, error: null };
    if (name === "match_knowledge") return { data: [{ item_id: "item", article_id: 1, target: "article:known", chunk_type: "body", access: "paid", content: "PAID_PREVIEW_SECRET", score: .95 }], error: null };
    return { data: name === "reserve_ai_call" ? state.budget : true, error: null };
  } };
  const answer = (ownerView: boolean, revision = "settings") => previewKnowledgeAnswer(service as never, "run", 0, "owner", ownerView, "request", new AbortController().signal, revision, {
    embed: async () => { state.embedCalls++; if (state.changed) state.sourceRevision++; return [[1, ...Array(1023).fill(0)]]; },
    generate: async (_connection, messages) => { state.generateCalls++; state.prompt = messages.map(item => item.content).join("\n"); return { content: "受控预演回答", usage: { prompt_tokens: 3, completion_tokens: 2 } }; },
  });
  return { state, answer, calls };
}
test("Candidate answer preview works with avatar off but anonymous cannot read paid evidence", async () => {
  const f = answerFixture(); const result = await f.answer(false);
  assert.equal(result.generated, false); assert(!result.text.includes("PAID_PREVIEW_SECRET"));
  assert.equal(f.state.embedCalls, 1); assert.equal(f.state.generateCalls, 0);
  assert.deepEqual(result.sources, [{ title: "受限文章", url: "/blog/known" }]);
  const owner = answerFixture(); assert.equal((await owner.answer(true)).generated, true);
  assert(owner.state.prompt.includes("PAID_PREVIEW_SECRET")); assert(owner.state.prompt.includes("站主补充规则"));
});
test("Preview rejects budget replay and changed content before dispatching a generated answer", async () => {
  const budget = answerFixture(); budget.state.budget = "duplicate";
  await assert.rejects(budget.answer(true), /AI_CALL_DUPLICATE/);
  assert.equal(budget.state.embedCalls + budget.state.generateCalls, 0);
  const changed = answerFixture(); changed.state.changed = true;
  await assert.rejects(changed.answer(true), /KNOWLEDGE_SOURCE_CHANGED/);
  assert.equal(changed.state.generateCalls, 0);
  const settings = answerFixture();
  await assert.rejects(settings.answer(true, "previous-settings"), /KNOWLEDGE_SETTINGS_CHANGED/);
  assert.equal(settings.state.embedCalls + settings.state.generateCalls, 0);
});
