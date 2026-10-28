import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { installTestDatabase } from "./support/database";
import { aiSettingsView } from "../src/lib/ai/settings";
import { withAICall } from "../src/lib/ai/call-control";

function query<T = Record<string, unknown>>(db: PGlite, sql: string, params?: unknown[]) { return db.query<T>(sql, params); }
const owner = "00000000-0000-4000-8000-000000000001";
const user = "00000000-0000-4000-8000-000000000002";
const generation = { purpose: "generation", protocol: "chat", baseUrl: "https://api.deepseek.com", model: "synthetic-model" };
const embedding = { purpose: "embedding", protocol: "embeddings", baseUrl: "https://api.siliconflow.cn/v1", model: "BAAI/bge-m3" };
const avatar = { enabled: false, anonymousEntry: false, instructions: "synthetic instructions", monthlyLimit: 1 };

test("Question and answer preview calls require owner authority and keep the monthly budget with avatar off", async t => {
  const db = new PGlite({ extensions: { vector } }); t.after(() => db.close()); await installTestDatabase(db); await db.exec("set role service_role");
  const saved = (await query<{ revision: string }>(db, "select revision from ai_settings")).rows[0];
  await query(db, "select save_ai_settings($1,$2,$3,$4,$5,$6,false,$7)", [owner, saved.revision, generation, "synthetic-generation-key", embedding, "synthetic-embedding-key", avatar]);
  await query(db, "update ai_connections set verified_at=now()");
  const connections = (await query<{ generation_connection: string; embedding_connection: string }>(db, "select generation_connection,embedding_connection from ai_settings")).rows[0];
  for (const task of ["knowledge_questions", "knowledge_preview", "knowledge_preview_retrieval"]) {
    const connection = task === "knowledge_preview_retrieval" ? connections.embedding_connection : connections.generation_connection;
    await assert.rejects(query(db, "select reserve_ai_call($1,$2,$3,$4,null)", [crypto.randomUUID(), task, connection, user]), /OWNER_REQUIRED/);
  }
  const id = crypto.randomUUID();
  assert.equal((await query(db, "select reserve_ai_call($1,'knowledge_questions',$2,$3,null) state", [id, connections.generation_connection, owner])).rows[0].state, "reserved");
  assert.equal((await query(db, "select dispatch_ai_call($1) ok", [id])).rows[0].ok, true);
  await query(db, "select finish_ai_call($1,'unknown',0,0)", [id]);
  assert.equal((await query(db, "select reserve_ai_call($1,'knowledge_preview',$2,$3,null) state", [crypto.randomUUID(), connections.generation_connection, owner])).rows[0].state, "monthly_limit");
});

test("AI private configuration: no browser access, atomic pairs, conflict prevention and credential target binding", async t => {
  const db = new PGlite({ extensions: { vector } }); t.after(() => db.close()); await installTestDatabase(db);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    for (const table of ["ai_settings", "ai_connections", "ai_calls"]) await assert.rejects(query(db, `select * from public.${table}`), /permission denied/);
    await assert.rejects(query(db, "select public.save_ai_settings($1,$2,$3,$4,$5,$6,$7,$8)", [owner, owner, generation, "synthetic-key", null, "", false, avatar]), /permission denied/);
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  const current = async () => (await query(db, "select * from ai_settings where id=1")).rows[0] as { revision: string; generation_connection: string | null; embedding_connection: string | null; owner_instructions: string };
  const save = (revision: string, gen: unknown, genKey: string, emb: unknown, embKey: string, reuse = false, principal = owner) => query(db, "select public.save_ai_settings($1,$2,$3,$4,$5,$6,$7,$8)", [principal, revision, gen, genKey, emb, embKey, reuse, avatar]);
  const initial = await current();
  await assert.rejects(save(initial.revision, generation, "synthetic-deepseek-key", embedding, ""), /AI_TARGET_KEY_REQUIRED/);
  assert.equal((await current()).revision, initial.revision);
  assert.equal((await query(db, "select count(*)::int n from ai_connections")).rows[0].n, 0, "failed second connection must roll back the first");
  await assert.rejects(save(initial.revision, generation, "synthetic-deepseek-key", null, "", false, user), /OWNER_REQUIRED/);
  await save(initial.revision, generation, "synthetic-deepseek-key", embedding, "synthetic-embedding-key");
  const first = await current();
  assert(first.generation_connection && first.embedding_connection);
  await query(db, "update ai_connections set verified_at=now() where id=$1", [first.generation_connection]);
  await assert.rejects(save(initial.revision, generation, "synthetic-overwrite", null, ""), /SETTINGS_CONFLICT/);
  await save(first.revision, generation, "", embedding, "");
  const unchanged = await current();
  assert.equal(unchanged.generation_connection, first.generation_connection);
  assert.equal(unchanged.embedding_connection, first.embedding_connection);
  assert((await query(db, "select verified_at from ai_connections where id=$1", [first.generation_connection])).rows[0].verified_at);
  const sharedGeneration = { ...generation, baseUrl: "https://api.siliconflow.cn/v1" };
  await assert.rejects(save(unchanged.revision, sharedGeneration, "", embedding, "", true), /AI_TARGET_KEY_REQUIRED/);
  await assert.rejects(save(unchanged.revision, generation, "", embedding, "", true), /AI_SHARED_KEY_TARGET_MISMATCH/);
  assert.equal((await current()).revision, unchanged.revision);
  await save(unchanged.revision, sharedGeneration, "synthetic-shared-key", embedding, "", true);
  const shared = await current();
  assert.notEqual(shared.generation_connection, first.generation_connection);
  const pairs = (await query(db, "select purpose,api_key,verified_at from ai_connections where id in ($1,$2)", [shared.generation_connection, shared.embedding_connection])).rows;
  assert.equal(pairs.length, 2); assert(pairs.every(row => row.api_key === "synthetic-shared-key" && row.verified_at === null));
  assert.equal((await query(db, "select api_key from ai_connections where id=$1", [first.embedding_connection])).rows[0].api_key, "synthetic-embedding-key", "old connection remains bound to an in-progress/active index");
  const published = (await query(db, "select avatar_config from site_config where id=1")).rows[0].avatar_config as Record<string, unknown>;
  assert.deepEqual(published, { enabled: false, anonymous_entry: false, monthly_limit: 1 });
  assert.equal("model" in published, false);
  await db.exec("reset role; alter function public.save_ai_settings(uuid,uuid,jsonb,text,jsonb,text,boolean,jsonb) rename to missing_ai_settings");
  const verification = await db.query<{ check_name: string; passed: boolean }>(await readFile(new URL("../supabase/verify.sql", import.meta.url), "utf8"));
  assert.equal(verification.rows.find(row => row.check_name === "ai_rpc_service_only")?.passed, false, "a missing required RPC must fail verification");
});

test("AI call authority: page generation works with avatar off, replay cannot dispatch twice, unknown outcomes stay charged", async t => {
  const db = new PGlite({ extensions: { vector } }); t.after(() => db.close()); await installTestDatabase(db); await db.exec("set role service_role");
  const revision = (await query(db, "select revision from ai_settings where id=1")).rows[0].revision;
  await query(db, "select save_ai_settings($1,$2,$3,$4,$5,$6,$7,$8)", [owner, revision, generation, "synthetic-generation-key", null, "", false, avatar]);
  const connection = (await query(db, "select generation_connection from ai_settings where id=1")).rows[0].generation_connection;
  const reserve = async (request: string, task = "page", principal = owner) => (await query(db, "select reserve_ai_call($1,$2,$3,$4,null) state", [request, task, connection, principal])).rows[0].state;
  const one = "10000000-0000-4000-8000-000000000001";
  const two = "10000000-0000-4000-8000-000000000002";
  assert.equal(await reserve(one), "unverified");
  await query(db, "update ai_connections set verified_at=now() where id=$1", [connection]);
  await assert.rejects(reserve(one, "page", user), /OWNER_REQUIRED/);
  assert.equal(await reserve(one, "avatar"), "disabled");
  assert.equal(await reserve(one), "reserved");
  assert.equal(await reserve(one), "duplicate");
  assert.equal((await query(db, "select dispatch_ai_call($1) ok", [one])).rows[0].ok, true);
  assert.equal((await query(db, "select dispatch_ai_call($1) ok", [one])).rows[0].ok, false);
  assert.equal((await query(db, "select finish_ai_call($1,'released') ok", [one])).rows[0].ok, false);
  assert.equal((await query(db, "select finish_ai_call($1,'unknown') ok", [one])).rows[0].ok, true);
  assert.equal(await reserve(two), "monthly_limit");
  assert.equal(await reserve(two, "generation_probe"), "reserved", "explicit small probes do not consume the monthly answer budget");
});

test("AI management projection does not read or serialize credentials", async () => {
  const raw = { id: owner, purpose: "generation", protocol: "chat", base_url: generation.baseUrl, model: "synthetic-model", verified_at: null, get api_key() { return assert.fail("credential accessed while building management metadata"); } };
  const service = { from(table: string) { return { select(fields: string) {
    assert(!fields.split(",").includes("api_key"));
    return { eq() { return this; }, single: async () => ({ data: { revision: owner, generation_connection: owner, embedding_connection: null, owner_instructions: "instructions", monthly_limit: null } }), in: async () => ({ data: table === "ai_connections" ? [raw] : [] }) };
  } }; } };
  const view = await aiSettingsView(service as never);
  assert.equal(view.generation?.keySet, true); assert.equal(view.generation?.baseUrl, generation.baseUrl);
  assert.equal(JSON.stringify(view).includes("api_key"), false);
});

test("AI orchestration never performs provider I/O after quota, replay or dispatch uncertainty", async () => {
  for (const state of ["duplicate", "daily_limit", "rate_limit", "monthly_limit", "unverified", "disabled", "dispatch-unknown"]) {
    let calls = 0; const finishes: string[] = [];
    const service = { rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "reserve_ai_call") return { data: state === "dispatch-unknown" ? "reserved" : state, error: null };
      if (name === "dispatch_ai_call") return { data: null, error: { message: "private diagnostic" } };
      finishes.push(String(args.p_outcome)); return { data: false, error: null };
    } };
    await assert.rejects(withAICall(service as never, { id: owner, task: "page", connectionId: owner, userId: owner }, async () => { calls++; return { value: true }; }));
    assert.equal(calls, 0); assert.deepEqual(finishes, state === "dispatch-unknown" ? ["released"] : []);
  }
});

test("AI usage aggregate exposes only the current authenticated user's chargeable calls", async t => {
  const db = new PGlite({ extensions: { vector } }); t.after(() => db.close()); await installTestDatabase(db);
  const connection = (await query(db, "insert into ai_connections(purpose,protocol,base_url,model,api_key) values('generation','chat','https://api.deepseek.com','synthetic','synthetic-key') returning id")).rows[0].id;
  await query(db, "insert into ai_calls(request_id,task,connection_id,user_id,state,expires_at) values($1,'avatar',$2,$3,'succeeded',now()),($4,'avatar',$2,$5,'unknown',now()),($6,'avatar',$2,$3,'released',now())", [crypto.randomUUID(), connection, user, crypto.randomUUID(), owner, crypto.randomUUID()]);
  await db.exec("set role anon"); await assert.rejects(query(db, "select avatar_usage_today()"), /permission denied/);
  await db.exec("reset role; set role authenticated");
  await assert.rejects(query(db, "select avatar_usage_today()"), /AUTH_REQUIRED/);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user })]);
  assert.equal(Number((await query(db, "select avatar_usage_today() n")).rows[0].n), 1);
  await assert.rejects(query(db, "select * from ai_calls"), /permission denied/);
  await assert.rejects(query(db, "select admin_dashboard_card('avatar')"), /OWNER_REQUIRED/);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner })]);
  const summary = (await query(db, "select admin_dashboard_card('avatar') data")).rows[0].data as { avatarGenerationsThisMonth: number };
  assert.equal(Number(summary.avatarGenerationsThisMonth), 2, "owner summary combines chargeable calls without exposing private rows");
});
