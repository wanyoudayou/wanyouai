import test from "node:test";
import assert from "node:assert/strict";
import { answerAvatarQuestion, avatarCacheKey, questionHash } from "../src/lib/avatar/answer";
import type { Reader } from "../src/types/reading";

const uid = "00000000-0000-4000-8000-000000000002";
const reader = (over: Partial<Reader> = {}): Reader => ({ userId: uid, owner: false, entitlements: [], ...over });
function fixture() {
  const settings = { id: 1, revision: "settings-1", generation_connection: "generation-1", embedding_connection: "embedding-new", avatar_enabled: true, anonymous_entry: true, owner_instructions: "SYNTHETIC_OWNER_RULE", monthly_limit: null };
  const control = { id: 1, active_generation: "index-1", source_revision: 1 };
  const article = { id: 1, slug: "paid", series_id: null, type: "blog", title: "付费文章", summary: null, cover_url: null, tags: [], access: "paid", price: 1, status: "published", published_at: "2026-01-01", preview_md: "公开预览" };
  const connection = (id: string, purpose: string) => ({ id, purpose, protocol: purpose === "generation" ? "chat" : "embeddings", base_url: purpose === "generation" ? "https://api.deepseek.com" : "https://api.siliconflow.cn/v1", model: purpose === "generation" ? "synthetic-model" : "BAAI/bge-m3", api_key: "synthetic-test-key", verified_at: "2026-01-01" });
  const tables: Record<string, Record<string, unknown>[]> = { ai_settings: [settings], site_config: [{ id: 1, avatar_config: { enabled: true } }], knowledge_index_control: [control],
    knowledge_index_generations: [{ id: "index-1", connection_id: "embedding-old", state: "active", threshold: 0.8 }], ai_connections: [connection("generation-1", "generation"), connection("embedding-old", "embedding")], articles: [article], series: [], avatar_cache: [] };
  const state = { hits: [{ item_id: "hit", article_id: 1 as number | null, source_key: "chunk:1", target: "article:paid", chunk_type: "body", access: "paid", content: "PAID_SECRET", score: 0.9 }], budget: "reserved", errorTable: "", generateCalls: 0, embedCalls: 0, prompt: "", embeddingConnection: "", failGenerate: false, failEmbed: false, mutateDuringEmbed: false };
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const from = (table: string) => {
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    const result = () => ({ data: (tables[table] ?? []).filter(row => filters.every(filter => filter(row))), error: state.errorTable === table ? { message: "PRIVATE_DIAGNOSTIC" } : null });
    const chain = { select: () => chain, eq: (field: string, value: unknown) => { filters.push(row => row[field] === value); return chain; }, in: (field: string, values: unknown[]) => { filters.push(row => values.includes(row[field])); return chain; },
      single: async () => ({ ...result(), data: result().data[0] ?? null }), maybeSingle: async () => ({ ...result(), data: result().data[0] ?? null }),
      then: (resolve: (value: unknown) => unknown) => resolve(result()),
      upsert: async (row: Record<string, unknown>) => { tables[table].push(row); return { error: null }; },
    }; return chain;
  };
  const service = { from, rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "match_knowledge") return { data: state.hits, error: null };
    if (name === "reserve_ai_call") return { data: state.budget, error: null };
    return { data: true, error: null };
  } };
  const answer = (principal = reader()) => answerAvatarQuestion({ service: service as never, reader: principal, question: "如何使用？", dependencies: {
    embed: async connection => { state.embedCalls++; state.embeddingConnection = connection.id; if (state.failEmbed) throw new Error("PRIVATE_PROVIDER"); if (state.mutateDuringEmbed) control.source_revision++; return [[1, ...Array(1023).fill(0)]]; },
    generate: async (_connection, messages) => { state.generateCalls++; state.prompt = messages.map(message => message.content).join("\n"); if (state.failGenerate) throw new Error("PRIVATE_PROVIDER"); return { content: state.prompt.includes("PAID_SECRET") ? "PAID_SECRET" : "公开回答", usage: { prompt_tokens: 10, completion_tokens: 2 } }; },
  } });
  return { settings, control, article, state, calls, tables, answer };
}

test("Avatar requires enabled verified generation and active knowledge; no environment fallback", async () => {
  for (const scenario of ["off", "no-index", "unverified"]) {
    const f = fixture(); if (scenario === "off") f.settings.avatar_enabled = false;
    if (scenario === "no-index") f.tables.knowledge_index_control[0].active_generation = null;
    if (scenario === "unverified") f.tables.ai_connections[0].verified_at = null;
    assert.equal((await f.answer()).status, "disabled"); assert.equal(f.state.embedCalls + f.state.generateCalls, 0);
  }
});
test("Avatar refuses quota before paid query embedding", async () => {
  for (const limit of ["daily_limit", "monthly_limit", "rate_limit", "disabled", "unverified", "unexpected"]) {
    const f = fixture(); f.state.budget = limit;
    assert.notEqual((await f.answer()).status, "ok"); assert.equal(f.state.embedCalls + f.state.generateCalls, 0);
  }
});
test("No hit or only locked evidence releases generation reservation without free chat", async () => {
  const f = fixture(); const locked = await f.answer();
  assert.equal(f.state.embedCalls, 1); assert.equal(f.state.generateCalls, 0); assert(!locked.text.includes("PAID_SECRET")); assert(locked.text.includes("/blog/paid"));
  assert(f.calls.some(call => call.name === "finish_ai_call" && call.args.p_outcome === "released"));
  f.state.hits = []; assert.equal((await f.answer()).sources.length, 0); assert.equal(f.state.generateCalls, 0);
});
test("Actual gate controls owner, subscription, buyer and anonymous context, including QA", async () => {
  const ent = { user_id: uid, type: "single" as const, target_id: 1, ends_at: null, revoked_at: null };
  for (const principal of [reader({ owner: true }), reader({ entitlements: [ent] }), reader({ entitlements: [{ ...ent, type: "subscription", target_id: null }] })]) {
    const f = fixture(); assert((await f.answer(principal)).text.includes("PAID_SECRET")); assert(f.state.prompt.includes("SYNTHETIC_OWNER_RULE")); assert.equal(f.state.embeddingConnection, "embedding-old", "active index retains its original embedding connection");
  }
  const f = fixture(); assert(!(await f.answer(reader({ userId: null }))).text.includes("PAID_SECRET"));
  f.state.hits[0] = { ...f.state.hits[0], chunk_type: "qa", source_key: "qa:1", content: "OWNER_APPROVED_PUBLIC_COPY" };
  assert.equal((await f.answer()).status, "ok"); assert(f.state.prompt.includes("OWNER_APPROVED_PUBLIC_COPY")); assert(!f.state.prompt.includes("PAID_SECRET"));
});
test("Cache cannot cross readers, expiry, content epochs or owner instruction versions; hits skip query and quota", async () => {
  const f = fixture(); const buyer = reader({ entitlements: [{ user_id: uid, type: "single", target_id: 1, ends_at: null, revoked_at: null }] });
  assert.equal((await f.answer(buyer)).status, "ok"); f.state.budget = "monthly_limit";
  assert.equal((await f.answer(buyer)).status, "cached"); assert.equal(f.state.embedCalls, 1);
  f.state.budget = "reserved";
  assert(!(await f.answer(reader())).text.includes("PAID_SECRET"));
  assert(!(await f.answer(reader({ userId: "other" }))).text.includes("PAID_SECRET"));
  f.settings.revision = "settings-2"; assert.equal((await f.answer(buyer)).status, "ok");
  f.control.source_revision++; assert.equal((await f.answer(buyer)).status, "ok");
  const base = { reader: buyer, question: "Q", pins: [], revision: "1", sourceRevision: 1, indexId: "1" };
  const expiring = { ...buyer, entitlements: [{ ...buyer.entitlements[0], ends_at: "2026-01-01T00:00:00Z" }] };
  assert.notEqual(avatarCacheKey({ ...base, reader: expiring, now: Date.parse("2025-12-31") }), avatarCacheKey({ ...base, reader: expiring, now: Date.parse("2026-01-02") }));
  assert.equal(avatarCacheKey({ ...base, reader: reader({ userId: null }) }), null);
  assert.equal(questionHash("  Q  "), questionHash("q"));
});
test("Changed source or failed authority reads cannot inject text; dispatched unknown generation stays charged", async () => {
  for (const scenario of ["source", "permission", "embedding", "generation"]) {
    const f = fixture(); f.article.access = "public";
    if (scenario === "source") f.state.mutateDuringEmbed = true;
    if (scenario === "permission") f.state.errorTable = "articles";
    if (scenario === "embedding") f.state.failEmbed = true;
    if (scenario === "generation") f.state.failGenerate = true;
    const answer = await f.answer(); assert.equal(answer.status, "degraded"); assert(!answer.text.includes("PRIVATE_"));
    assert.equal(f.state.generateCalls, scenario === "generation" ? 1 : 0);
    const finishes = f.calls.filter(call => call.name === "finish_ai_call"); assert.equal(finishes.at(-1)?.args.p_outcome, scenario === "generation" ? "unknown" : "released");
  }
});
