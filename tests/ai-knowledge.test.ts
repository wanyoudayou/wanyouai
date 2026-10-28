import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { installTestDatabase } from "./support/database";
import { knowledgeParts } from "../src/lib/ai/knowledge";

function query<T = Record<string, unknown>>(db: PGlite, sql: string, params?: unknown[]) { return db.query<T>(sql, params); }
const owner = "00000000-0000-4000-8000-000000000001";
const vectorOne = Array.from({ length: 1024 }, (_, i) => i === 0 ? 1 : 0);
const evaluation = { policyVersion: 2, hits: 20, recall: 1, falsePositives: 0, recommended: true, passed: true, positiveCases: 20, negativeCases: 20, holdoutRecall: 1, holdoutFalsePositives: 0, digest: "a".repeat(64) };

async function savedEvaluation(db: PGlite, id: unknown, epoch: unknown) {
  const cases = Array.from({ length: 40 }, (_, i) => ({ question: `synthetic approval ${i}`, expected: i % 2 ? [] : ["article:demo-public-blog"], split: i < 20 ? "train" : "holdout" }));
  return (await query<{ id: string }>(db, "insert into knowledge_evaluations(generation_id,source_revision,digest,cases,results,state,next_case) values($1,$2,$3,$4,$5,'complete',40) returning id", [id, epoch, evaluation.digest, JSON.stringify(cases), JSON.stringify(cases.map(() => []))])).rows[0].id;
}
async function approve(db: PGlite, id: unknown, epoch: unknown) {
  const run = await savedEvaluation(db, id, epoch);
  const connection = (await query(db, "select connection_id from knowledge_index_generations where id=$1", [id])).rows[0].connection_id;
  await query(db, "select enable_knowledge_index($1,$2,$3,$4,true)", [owner, id, epoch, connection]);
  // Historical references are retained only for optional comparisons.
  await query(db, "update knowledge_index_generations set accepted_run=$2 where id=$1", [id, run]);
  return run;
}

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const db = new PGlite({ extensions: { vector } }); t.after(() => db.close()); await installTestDatabase(db);
  await db.exec("set role service_role");
  const connection = (await db.query<{ id: string }>("insert into ai_connections(purpose,protocol,base_url,model,api_key,verified_at) values('embedding','embeddings','https://api.siliconflow.cn/v1','BAAI/bge-m3','synthetic-test-key',now()) returning id")).rows[0].id;
  const generationConnection = (await db.query<{ id: string }>("insert into ai_connections(purpose,protocol,base_url,model,api_key,verified_at) values('generation','chat','https://api.deepseek.com','synthetic-model','synthetic-test-key',now()) returning id")).rows[0].id;
  await query(db, "update ai_settings set embedding_connection=$1,generation_connection=$2,avatar_enabled=true", [connection, generationConnection]);
  const begin = async () => (await db.query<{ id: string }>("select begin_knowledge_index($1,true) id", [owner])).rows[0].id;
  const scan = async (id: string) => {
    const sources = (await db.query<{ source_key: string; source_hash: string; content: string }>("select * from knowledge_sources order by source_key")).rows;
    for (const source of sources) await query(db, "select register_knowledge_source($1,$2,$3,$4)", [id, source.source_key, source.source_hash, JSON.stringify(knowledgeParts(source.content))]);
    assert.equal((await query(db, "select complete_knowledge_scan($1) ok", [id])).rows[0].ok, true);
    return sources;
  };
  const claim = async (id: string, lease: string) => (await db.query<{ item_id: string; content: string }>("select * from claim_knowledge_batch($1,$2)", [id, lease])).rows;
  const finish = async (id: string, lease: string, items: { item_id: string }[]) => (await query(db, "select finish_knowledge_batch($1,$2,$3) ok", [id, lease, JSON.stringify(items.map(item => ({ id: item.item_id, vector: vectorOne })))])).rows[0].ok;
  return { db, begin, scan, claim, finish, connection };
}

test("Knowledge splitting covers complete Unicode text beyond the former 64-part boundary", () => {
  const text = ("中文🙂e\u0301\n".repeat(13000)) + "FINAL-SECTION";
  const parts = knowledgeParts(text);
  assert(parts.length > 64); assert.equal(parts.map(part => part.content).join(""), text);
  assert(parts.every(part => Buffer.byteLength(part.content) <= 2048 && part.end - part.start === Array.from(part.content).length));
  assert.equal(parts.at(-1)?.end, Array.from(text).length);
  assert(parts.at(-1)?.content.endsWith("FINAL-SECTION"));
});

test("Knowledge jobs cover long sources, lease disjoint batches, and activate a complete snapshot with owner consent and no evaluation requirement", async t => {
  const { db, begin, scan, claim, finish } = await setup(t);
  await db.exec("delete from article_chunks");
  const content = "汉🙂".repeat(24000) + "最后一节";
  await query(db, "insert into article_chunks(article_id,access,chunk_type,chunk_no,content) select id,access,'body',1,$1 from articles where slug='demo-public-blog'", [content]);
  const id = await begin(); await scan(id);
  const count = (await db.query<{ n: number }>("select count(*)::int n from knowledge_index_items where generation_id=$1", [id])).rows[0].n;
  assert(count > 64);
  await assert.rejects(query(db, "select enable_knowledge_index($1,$2,(select source_revision from knowledge_index_control),(select connection_id from knowledge_index_generations where id=$2),true)", [owner, id]), /KNOWLEDGE_INCOMPLETE/);
  const leaseA = crypto.randomUUID(); const leaseB = crypto.randomUUID();
  const a = await claim(id, leaseA); const b = await claim(id, leaseB);
  assert.equal(a.length, 16); assert.equal(b.length, 16);
  assert(!a.some(item => b.some(other => other.item_id === item.item_id)));
  assert.equal(await finish(id, leaseA, a), true); assert.equal(await finish(id, leaseA, a), false);
  assert.equal(await finish(id, leaseB, b), true);
  for (;;) { const lease = crypto.randomUUID(); const items = await claim(id, lease); if (!items.length) break; assert.equal(await finish(id, lease, items), true); }
  assert.equal((await query(db, "select count(*)::int n from knowledge_index_items where generation_id=$1 and state='ready'", [id])).rows[0].n, count);
  const manifest = (await query<{ manifest: Record<string, unknown>[] }>(db, "select knowledge_question_manifest($1) manifest", [id])).rows[0].manifest;
  assert.equal(manifest.length, 10); assert(manifest.every(item => !('content' in item) && Number(item.bytes) <= 2048));
  const epoch = (await query(db, "select source_revision from knowledge_index_control")).rows[0].source_revision;
  const connection = (await query(db, "select connection_id from knowledge_index_generations where id=$1", [id])).rows[0].connection_id;
  const enable = (principal = owner, confirm = true, revision = epoch, selected = connection) => query(db, "select enable_knowledge_index($1,$2,$3,$4,$5)", [principal, id, revision, selected, confirm]);
  await assert.rejects(enable(owner, false), /ACCEPTANCE_REQUIRED/);
  await assert.rejects(enable("00000000-0000-4000-8000-000000000002"), /OWNER_REQUIRED/);
  await assert.rejects(enable(owner, true, Number(epoch) - 1), /SOURCE_CHANGED/);
  await assert.rejects(enable(owner, true, epoch, crypto.randomUUID()), /CONNECTION_CHANGED/);
  await enable();
  assert.equal((await query(db, "select count(*)::int n from knowledge_evaluations")).rows[0].n, 0, "activation must not manufacture a passing evaluation");
  assert.equal((await query(db, "select threshold from knowledge_index_generations where id=$1", [id])).rows[0].threshold, .5);
  assert.equal((await query(db, "select avatar_config->>'enabled' enabled from site_config")).rows[0].enabled, "true");
  const hit = (await query(db, "select * from match_knowledge($1,$2::extensions.vector,0.8)", [id, JSON.stringify(vectorOne)])).rows;
  assert.equal(hit.length, 24);
  await assert.rejects(query(db, "select discard_knowledge_generation($1,$2)", [owner, id]), /ACTIVE_DELETE_DENIED/);
  await query(db, "update article_chunks set content='新版公开资料' where article_id=(select id from articles where slug='demo-public-blog')");
  assert.equal((await query(db, "select count(*)::int n from match_knowledge($1,$2::extensions.vector,0.8)", [id, JSON.stringify(vectorOne)])).rows[0].n, 0, "stale source bodies must not be retrievable");
  assert.equal((await query(db, "select avatar_config->>'enabled' enabled from site_config")).rows[0].enabled, "false");
});

test("Expired and uncertain provider work requires explicit retry; source changes reject stale work and invalidate consent", async t => {
  const { db, begin, scan, claim, finish } = await setup(t);
  const id = await begin(); await scan(id);
  const lease = crypto.randomUUID(); const items = await claim(id, lease); assert(items.length);
  await query(db, "update knowledge_index_items set lease_expires_at=now()-interval '1 second' where lease_id=$1", [lease]);
  assert.deepEqual(await claim(id, crypto.randomUUID()), []);
  assert.equal((await query(db, "select count(*)::int n from knowledge_index_items where state='failed'")).rows[0].n, items.length);
  await assert.rejects(query(db, "select retry_knowledge_failures($1,$2,false)", [owner, id]), /RETRY_CONFIRMATION_REQUIRED/);
  await query(db, "select retry_knowledge_failures($1,$2,true)", [owner, id]);
  const nextLease = crypto.randomUUID(); const next = await claim(id, nextLease); assert(next.length);
  await query(db, "update article_chunks set content=content||'更新' where id=(select substring(source_key from 7)::bigint from knowledge_index_items where id=$1)", [next[0].item_id]);
  assert.equal(await finish(id, nextLease, next), true);
  assert.equal((await query(db, "select state from knowledge_index_items where id=$1", [next[0].item_id])).rows[0].state, "obsolete");
  await assert.rejects(claim(id, crypto.randomUUID()), /SCAN_REQUIRED|SOURCE_CHANGED/);
  await query(db, "select begin_knowledge_index($1,true,$2)", [owner, id]);
  await scan(id);
  assert((await claim(id, crypto.randomUUID())).length);
});

test("Knowledge data and trigger functions have no browser or direct trigger execution entry", async t => {
  const { db } = await setup(t); await db.exec("reset role");
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    for (const table of ["knowledge_sources", "knowledge_index_items", "knowledge_index_generations", "knowledge_index_control", "knowledge_evaluations", "knowledge_question_drafts"]) await assert.rejects(query(db, `select * from public.${table}`), /permission denied/);
    await assert.rejects(query(db, "select public.knowledge_index_status()"), /permission denied/);
    await assert.rejects(query(db, "select enable_knowledge_index($1,$2,0,$2,true)", [owner, owner]), /permission denied/);
    await assert.rejects(query(db, "select knowledge_runtime_threshold($1)", [owner]), /permission denied/);
    await assert.rejects(query(db, "select accept_knowledge_preview($1,$2,true)", [owner, owner]), /permission denied/);
    await assert.rejects(query(db, "select knowledge_question_manifest($1)", [owner]), /permission denied/);
    await assert.rejects(query(db, "select knowledge_missing_sources('{}')"), /permission denied/);
    await db.exec("reset role");
  }
  for (const role of ["anon", "authenticated", "service_role"]) assert.equal((await query(db, "select has_function_privilege($1,'ai_internal.knowledge_sources_changed()','EXECUTE') allowed", [role])).rows[0].allowed, false);
});

test("Index consent binds the source revision and evaluation leases persist uncertain batches without silently replaying", async t => {
  const { db, begin, scan, claim, finish, connection } = await setup(t);
  const revision = (await query(db, "select source_revision from knowledge_index_control")).rows[0].source_revision;
  await assert.rejects(query(db, "select begin_knowledge_index($1,true,null,$2,$3)", [owner, Number(revision) - 1, connection]), /SOURCE_CHANGED/);
  const id = await begin(); await scan(id);
  for (;;) { const lease = crypto.randomUUID(); const items = await claim(id, lease); if (!items.length) break; await finish(id, lease, items); }
  const cases = Array.from({ length: 40 }, (_, i) => ({ question: `synthetic ${i}`, expected: i % 2 ? [] : ["article:demo-public-blog"], split: i < 20 ? "train" : "holdout" }));
  const start = () => query(db, "select begin_knowledge_evaluation($1,$2,$3,true) id", [owner, id, JSON.stringify(cases)]);
  const run = (await start()).rows[0].id;
  assert.equal((await start()).rows[0].id, run, "a resumed suite must retain its completed batches");
  const lease = crypto.randomUUID();
  const claimed = (await query<{ batch: { state: string; cases: unknown[] } }>(db, "select claim_knowledge_evaluation($1,$2) batch", [run, lease])).rows[0].batch;
  assert.equal(claimed.cases.length, 16);
  const other = (await query<{ batch: { state: string; cases?: unknown[] } }>(db, "select claim_knowledge_evaluation($1,$2) batch", [run, crypto.randomUUID()])).rows[0].batch;
  assert.equal(other.state, "leased"); assert.equal(other.cases, undefined);
  await query(db, "select finish_knowledge_evaluation($1,$2,'[]',true)", [run, lease]);
  const failed = (await query<{ batch: { state: string } }>(db, "select claim_knowledge_evaluation($1,$2) batch", [run, crypto.randomUUID()])).rows[0].batch;
  assert.equal(failed.state, "failed");
  await assert.rejects(query(db, "select retry_knowledge_evaluation($1,$2,false)", [owner, run]), /CONFIRMATION_REQUIRED/);
  await query(db, "select retry_knowledge_evaluation($1,$2,true)", [owner, run]);
  const resumed = (await query<{ batch: { offset: number } }>(db, "select claim_knowledge_evaluation($1,$2) batch", [run, crypto.randomUUID()])).rows[0].batch;
  assert.equal(resumed.offset, 0);
});

test("Incremental candidates reuse only verified current vectors, preserve active serving, and allow optional diagnostic comparisons without a score gate", async t => {
  const { db, begin, scan, claim, finish, connection } = await setup(t);
  const id = await begin(); const originals = await scan(id);
  for (;;) { const lease = crypto.randomUUID(); const items = await claim(id, lease); if (!items.length) break; await finish(id, lease, items); }
  const epoch = () => query<{ n: number }>(db, "select source_revision n from knowledge_index_control").then(result => result.rows[0].n);
  const baselineRun = await approve(db, id, await epoch());
  await query(db, "select activate_knowledge_index($1,$2)", [owner, id]);
  const start = async (mode: string, selected = connection) => (await query<{ id: string }>(db, "select start_knowledge_task($1,$2,true,$3,$4) id", [owner, mode, await epoch(), selected])).rows[0].id;
  assert.equal(await start("sync"), id, "unchanged sync does not create or bill work");
  await assert.rejects(start("initialize"), /ALREADY_INITIALIZED/);
  const changed = originals.find(source => source.source_key.startsWith("chunk:"))!;
  await query(db, "update article_chunks set content=content||'新增知识内容' where id=$1", [changed.source_key.slice(6)]);
  const candidate = await start("sync"); await scan(candidate);
  const summary = (await query<{ state: string; evaluation: unknown; base_generation: string }>(db, "select state,evaluation,base_generation from knowledge_index_generations where id=$1", [candidate])).rows[0];
  assert.equal(summary.base_generation, id); assert.equal(summary.evaluation, null); assert.equal(summary.state, "building");
  assert.equal((await query(db, "select active_generation from knowledge_index_control")).rows[0].active_generation, id);
  const reused = (await query<{ n: number }>(db, "select count(*)::int n from knowledge_index_items where generation_id=$1 and reused and state='ready'", [candidate])).rows[0].n;
  assert(reused > 0);
  const lease = crypto.randomUUID(); const pending = await claim(candidate, lease);
  assert(pending.length > 0); assert(pending.every(item => item.content.includes("新增知识内容")), "unchanged texts never reach provider batches");
  await finish(candidate, lease, pending);
  assert.deepEqual(await claim(candidate, crypto.randomUUID()), []);
  await assert.rejects(query(db, "select activate_knowledge_index($1,$2)", [owner, candidate]), /ACCEPTANCE_REQUIRED/);
  await assert.rejects(claim(id, crypto.randomUUID()), /SCAN_REQUIRED/);
  await assert.rejects(query(db, "select begin_knowledge_index($1,true,$2)", [owner, id]), /GENERATION_UNAVAILABLE/);
  const baselineCases = (await query<{ cases: unknown }>(db, "select cases from knowledge_evaluations where id=$1", [baselineRun])).rows[0].cases;
  const regression = (await query<{ id: string }>(db, "select begin_knowledge_evaluation($1,$2,$3,true) id", [owner, candidate, JSON.stringify(baselineCases)])).rows[0].id;
  const fixed = (await query(db, "select fixed_threshold,regression_from from knowledge_evaluations where id=$1", [regression])).rows[0];
  assert.equal(fixed.fixed_threshold, .5); assert.equal(fixed.regression_from, baselineRun, "source updates preserve the accepted mechanism and reusable questions");
  await query(db, "delete from knowledge_evaluations where id=$1", [regression]);
  await approve(db, candidate, await epoch());
  await query(db, "select activate_knowledge_index($1,$2)", [owner, candidate]);
  assert.equal((await query(db, "select state from knowledge_index_generations where id=$1", [id])).rows[0].state, "retired");
  const rebuild = await start("rebuild"); await scan(rebuild);
  assert.equal((await query(db, "select count(*)::int n from knowledge_index_items where generation_id=$1 and state='ready'", [rebuild])).rows[0].n, 0, "full rebuild must not copy vectors");
  assert((await claim(rebuild, crypto.randomUUID())).length > 0);
});

test("Source choices are literal metadata-only owner resources and reject invalid expected sources", async t => {
  const { db } = await setup(t);
  const choices = (await query<{ target: string; title: string }>(db, "select * from knowledge_source_choices('')")).rows;
  assert(choices.length > 0 && choices.length <= 30);
  assert.deepEqual(Object.keys(choices[0]).sort(), ["target", "title"]);
  assert.equal((await query(db, "select * from knowledge_source_choices('%')")).rows.length, 0, "percent is literal, not wildcard");
  assert.equal((await query(db, "select knowledge_evaluation_sources_valid($1) ok", [[choices[0].target]])).rows[0].ok, true);
  assert.equal((await query(db, "select knowledge_evaluation_sources_valid($1) ok", [["article:missing-private-draft"]])).rows[0].ok, false);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`reset role; set role ${role}`);
    await assert.rejects(query(db, "select * from knowledge_source_choices('')"), /permission denied/);
    await assert.rejects(query(db, "select knowledge_evaluation_sources_valid('{}')"), /permission denied/);
    await assert.rejects(query(db, "select start_knowledge_task($1,'initialize',true,0,null)", [owner]), /permission denied/);
  }
});

test("Low-scoring diagnostics never gate activation, change vectors, or tune runtime policy", async t => {
  const { db, begin, scan, claim, finish, connection } = await setup(t);
  const id = await begin(); await scan(id);
  for (;;) { const lease = crypto.randomUUID(); const batch = await claim(id, lease); if (!batch.length) break; await finish(id, lease, batch); }
  const epoch = (await query(db, "select source_revision from knowledge_index_control")).rows[0].source_revision;
  const cases = [{ question: "真实且复杂的用户问题", expected: ["article:demo-public-blog"] }];
  const run = (await query(db, "select begin_knowledge_evaluation($1,$2,$3,true) id", [owner, id, JSON.stringify(cases)])).rows[0].id;
  const lease = crypto.randomUUID();
  await query(db, "select claim_knowledge_evaluation($1,$2)", [run, lease]);
  await query(db, "select finish_knowledge_evaluation($1,$2,$3)", [run, lease, JSON.stringify([[{ target: "article:wrong", score: .9 }]])]);
  const original = (await query(db, "select cases,results,fixed_threshold,policy_version from knowledge_evaluations where id=$1", [run])).rows[0];
  assert.equal(original.fixed_threshold, .5); assert.equal(original.policy_version, 3);
  const vectors = (await query(db, "select id,embedding::text from knowledge_index_items where generation_id=$1 order by id", [id])).rows;
  await assert.rejects(query(db, "select confirm_knowledge_evaluation($1,$2,.01,$3)", [id, epoch, evaluation]), /DIAGNOSTIC_ONLY/);
  await query(db, "update ai_connections set verified_at=null where id=$1", [connection]);
  await assert.rejects(query(db, "select enable_knowledge_index($1,$2,$3,$4,true)", [owner, id, epoch, connection]), /CONNECTION_UNVERIFIED/);
  assert.equal((await query(db, "select accepted_at from knowledge_index_generations where id=$1", [id])).rows[0].accepted_at, null, "failed enabling must roll back confirmation");
  await query(db, "update ai_connections set verified_at=now() where id=$1", [connection]);
  await query(db, "select enable_knowledge_index($1,$2,$3,$4,true)", [owner, id, epoch, connection]);
  assert.equal((await query(db, "select active_generation from knowledge_index_control")).rows[0].active_generation, id);
  assert.deepEqual((await query(db, "select cases,results,fixed_threshold,policy_version from knowledge_evaluations where id=$1", [run])).rows[0], original);
  assert.deepEqual((await query(db, "select id,embedding::text from knowledge_index_items where generation_id=$1 order by id", [id])).rows, vectors);
  assert.equal((await query(db, "select threshold from knowledge_index_generations where id=$1", [id])).rows[0].threshold, .5);
  // Diagnostics remain optional after enabling and still cannot mutate the runtime cutoff.
  await query(db, "select begin_knowledge_evaluation($1,$2,$3,true)", [owner, id, JSON.stringify([{ question: "另一问题", expected: [] }])]);
  assert.equal((await query(db, "select threshold from knowledge_index_generations where id=$1", [id])).rows[0].threshold, .5);
});
