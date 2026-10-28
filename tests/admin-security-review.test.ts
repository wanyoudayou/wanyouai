import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { installTestDatabase } from "./support/database";
import { epaySign, zpayProvider } from "../src/lib/payments/zpay";
import { settleIfPaidRemotely } from "../src/lib/payments/settle";
import { gateHits } from "../src/lib/avatar/retrieve";
import type { ReadingArticle, ReadingSeries } from "../src/types/reading";

const USER = "00000000-0000-4000-8000-000000000002";
const config = { baseUrl: "https://pay.example.test", pid: "1001", key: "fixture-key" };
const order = { id: 7, user_id: USER, sku_type: "subscription", target_id: null, amount: 199, merchant_order_no: "91234567890123456789012345678901", status: "pending" };
const signed = (overrides: Record<string, string> = {}) => {
  const fields = { pid: config.pid, out_trade_no: "91234567890123456789012345678901", trade_no: "T7", money: "199.00", trade_status: "TRADE_SUCCESS", sign_type: "MD5", ...overrides };
  return new URLSearchParams({ ...fields, sign: epaySign(fields, config.key) });
};

test("review: signed callback cannot substitute first duplicate values", () => {
  const forged = new URLSearchParams({ out_trade_no: "8", trade_no: "FORGED", money: "999.00" });
  for (const [key, value] of signed()) forged.append(key, value);
  assert.equal(zpayProvider(config).verifyNotify(forged), null);
});

test("review: signed callbacks require this merchant, success and canonical amount/order", () => {
  const cases: Record<string, string>[] = [
    { pid: "another-merchant" }, { trade_status: "WAIT_BUYER_PAY" },
    { money: "" }, { money: "-1" }, { money: "1e2" }, { money: "1.001" },
    { out_trade_no: "9007199254740993" }, { out_trade_no: "7.0" },
  ];
  for (const overrides of cases) assert.equal(zpayProvider(config).verifyNotify(signed(overrides)), null, JSON.stringify(overrides));
});

test("review: paid query response must bind merchant/order and include transaction and money", async () => {
  const valid = { code: 1, status: 1, pid: "1001", out_trade_no: "91234567890123456789012345678901", trade_no: "T7", money: "199.00" };
  for (const overrides of [
    { code: 0 }, { pid: "other" }, { out_trade_no: "8" }, { money: null }, { trade_no: null },
  ]) {
    const provider = zpayProvider(config, async () => Response.json({ ...valid, ...overrides }));
    await assert.rejects(provider.queryOrder(order), /INVALID_PAYMENT_RESPONSE/);
  }
});

test("review: reconciliation cannot substitute local amount or synthetic trade ID", async () => {
  let calls = 0;
  const service = { rpc: async () => { calls++; return { data: "settled" }; } };
  for (const result of [{ paid: true, tradeNo: "T7", amount: null }, { paid: true, tradeNo: null, amount: 199 }]) {
    const provider = { ...zpayProvider(config), queryOrder: async () => result };
    assert.equal(await settleIfPaidRemotely(service as never, provider, order, "return"), "failed");
  }
  assert.equal(calls, 0);
});

test("review: terminal orders cannot grant, including replay after refund", async t => {
  const db = new PGlite({ extensions: { vector } }); t.after(() => db.close());
  await installTestDatabase(db);
  await db.exec("set role service_role");
  for (const status of ["failed", "refunded", "fulfilled"]) {
    const { rows: [row] } = await db.query<{ id: number }>("insert into orders(user_id,sku_type,amount,status) values($1,'subscription',199,$2) returning id", [USER, status]);
    await assert.rejects(db.query("select settle_payment($1,$2,199,(select jsonb_build_object('out_trade_no',merchant_order_no) from orders where id=$1))", [row.id, `terminal-${status}`]), /ORDER_NOT_PENDING/);
    assert.equal((await db.query<{ c: number }>("select count(*)::int c from entitlements where user_id=$1", [USER])).rows[0].c, 0);
  }
});

test("review: event replay binds order and still validates paid order amount", async t => {
  const db = new PGlite({ extensions: { vector } }); t.after(() => db.close());
  await installTestDatabase(db);
  await db.exec("set role service_role");
  const { rows } = await db.query<{ id: number }>("insert into orders(user_id,sku_type,amount) values($1,'subscription',199),($1,'subscription',199) returning id", [USER]);
  await db.query("select settle_payment($1,'bound-trade',199,(select jsonb_build_object('out_trade_no',merchant_order_no) from orders where id=$1))", [rows[0].id]);
  await assert.rejects(db.query("select settle_payment($1,'bound-trade',199,(select jsonb_build_object('out_trade_no',merchant_order_no) from orders where id=$1))", [rows[1].id]), /EVENT_ORDER_MISMATCH/);
  await assert.rejects(db.query("select settle_payment($1,'other-trade',1,(select jsonb_build_object('out_trade_no',merchant_order_no) from orders where id=$1))", [rows[0].id]), /AMOUNT_MISMATCH/);
});

test("review: old query aliases bind the original order; malformed legacy events fail closed", async t => {
  const db = new PGlite({ extensions: { vector } }); t.after(() => db.close());
  await installTestDatabase(db);
  await db.exec("set role service_role");
  const { rows } = await db.query<{ id: number }>("insert into orders(user_id,sku_type,amount,status) values($1,'subscription',199,'paid'),($1,'subscription',199,'pending') returning id", [USER]);
  await db.query("insert into payment_events(provider,event_id,payload) values('zpay',$1,$2::jsonb)", [`return:${rows[0].id}:OLD7`, JSON.stringify({ source: "return", trade_no: "OLD7" })]);
  assert.equal((await db.query<{ result: string }>("select settle_payment($1,'OLD7',199,(select jsonb_build_object('out_trade_no',merchant_order_no) from orders where id=$1)) result", [rows[0].id])).rows[0].result, "duplicate");
  await assert.rejects(db.query("select settle_payment($1,'OLD7',199,(select jsonb_build_object('out_trade_no',merchant_order_no) from orders where id=$1))", [rows[1].id]), /EVENT_ORDER_MISMATCH/);
  await db.exec("insert into payment_events(provider,event_id,payload) values('zpay','UNKNOWN','{}')");
  await assert.rejects(db.query("select settle_payment($1,'UNKNOWN',199,(select jsonb_build_object('out_trade_no',merchant_order_no) from orders where id=$1))", [rows[1].id]), /EVENT_BINDING_REQUIRED/);
  // Event aliases remain compatible only when the persisted merchant reference is supplied.
  await db.query("select settle_payment($1,$2,199,$3::jsonb || (select jsonb_build_object('out_trade_no',merchant_order_no) from orders where id=$1))", [rows[1].id, `reconcile:${rows[1].id}:NEW8`, JSON.stringify({ trade_no: "NEW8", settlement_order_id: "forged" })]);
  const event = (await db.query<{ event_id: string; bound: string }>("select event_id,payload->>'settlement_order_id' bound from payment_events where event_id='NEW8'")).rows[0];
  assert.deepEqual(event, { event_id: "NEW8", bound: String(rows[1].id) });
});

test("review: entitlement failure rolls back the order and inbox atomically", async t => {
  const db = new PGlite({ extensions: { vector } }); t.after(() => db.close());
  await installTestDatabase(db);
  const { rows: [row] } = await db.query<{ id: number }>("insert into orders(user_id,sku_type,amount) values($1,'subscription',199) returning id", [USER]);
  await db.exec("revoke insert on entitlements from service_role; set role service_role");
  await assert.rejects(db.query("select settle_payment($1,'ROLLBACK',199,(select jsonb_build_object('out_trade_no',merchant_order_no) from orders where id=$1))", [row.id]), /permission denied/);
  assert.equal((await db.query<{ status: string }>("select status from orders where id=$1", [row.id])).rows[0].status, "pending");
  assert.equal((await db.query<{ c: number }>("select count(*)::int c from payment_events where event_id='ROLLBACK'")).rows[0].c, 0);
});

test("review: parent lifecycle gates direct body/chunk RLS for anon and subscribers", async t => {
  const db = new PGlite({ extensions: { vector } }); t.after(() => db.close());
  await installTestDatabase(db);
  await db.exec("set role service_role");
  const { rows: [s] } = await db.query<{ id: number }>("select id from series where slug='demo-selection-handbook'");
  const { rows: [a] } = await db.query<{ id: number }>("insert into articles(slug,title,type,series_id,access,status,published_at) values('review-parent','Review','chapter',$1,'public','published',now()) returning id", [s.id]);
  await db.query("insert into article_bodies(article_id,content) values($1,'PARENT_LIFECYCLE_MARKER')", [a.id]);
  await db.query("insert into article_chunks(article_id,series_id,access,chunk_type,chunk_no,content) values($1,$2,'public','preview',0,'PARENT_LIFECYCLE_MARKER')", [a.id, s.id]);
  for (const status of ["draft", "archived", "paused", "published"]) {
    await db.exec("reset role; set role service_role");
    await db.query("update series set status=$1 where id=$2", [status, s.id]);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`reset role; set role ${role}`);
      await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: role === "anon" ? null : "00000000-0000-4000-8000-000000000003" })]);
      for (const table of ["article_bodies", "article_chunks"]) {
        assert.equal((await db.query<{ c: number }>(`select count(*)::int c from ${table} where article_id=$1`, [a.id])).rows[0].c, ["published", "paused"].includes(status) ? 1 : 0, `${role}/${status}/${table}`);
      }
    }
  }
});

test("review: avatar samples obey article and authoritative parent lifecycle", () => {
  const article = { id: 1, slug: "chapter", title: "Chapter", type: "chapter", series_id: 2, access: "public", status: "published" } as ReadingArticle;
  const reader = { userId: null, owner: false, entitlements: [] };
  for (const status of ["draft", "archived"]) {
    const series = { id: 2, slug: "parent", type: "handbook", status } as ReadingSeries;
    // Stale chunk metadata must not replace the parent recorded on the article.
    assert.deepEqual(gateHits([{ chunk_id: 1, article_id: 1, series_id: 99, access: "public", chunk_type: "preview", chunk_no: 0, content: "HIDDEN_SAMPLE" }], reader, new Map([[1, article]]), new Map([[2, series]])), []);
  }
});

test("review: reviewed conversations cannot receive unreviewed client appends", async t => {
  const db = new PGlite({ extensions: { vector } }); t.after(() => db.close());
  await installTestDatabase(db);
  await db.exec("set role service_role");
  const { rows: [c] } = await db.query<{ id: number }>("insert into conversations(user_id,status) values($1,'public') returning id", [USER]);
  await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: USER })]);
  await assert.rejects(db.query("insert into conversation_messages(conversation_id,role,content) values($1,'user','UNREVIEWED_APPEND')", [c.id]), /permission denied|row-level security/);
});

test("review: making a conversation public never exposes its raw messages or participant ID", async t => {
  const db = new PGlite({ extensions: { vector } }); t.after(() => db.close());
  await installTestDatabase(db);
  await db.exec("set role service_role");
  const { rows: [c] } = await db.query<{ id: number }>("insert into conversations(user_id,status) values($1,'public') returning id", [USER]);
  await db.query("insert into conversation_messages(conversation_id,role,content) values($1,'avatar','PAID_ANSWER_AND_PRIVATE_CONTACT')", [c.id]);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`reset role; set role ${role}`);
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: role === "anon" ? null : "00000000-0000-4000-8000-000000000006" })]);
    assert.equal((await db.query<{ c: number }>("select count(*)::int c from conversation_messages")).rows[0].c, 0);
    assert.equal((await db.query<{ c: number }>("select count(*)::int c from conversations")).rows[0].c, 0);
  }
});

test("review: owner direct table updates cannot bypass the archive retention clock", async t => {
  const db = new PGlite({ extensions: { vector } }); t.after(() => db.close());
  await installTestDatabase(db);
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: "00000000-0000-4000-8000-000000000001" })]);
  for (const table of ["articles", "series"]) {
    const { rows: [row] } = await db.query<{ id: number }>(`select id from ${table} where status='published' order by id limit 1`);
    await assert.rejects(db.query(`update ${table} set status='archived' where id=$1`, [row.id]), /INVALID_CONTENT_TRANSITION|RETENTION_PERIOD/);
    await db.query(`update ${table} set status='paused' where id=$1`, [row.id]);
    await assert.rejects(db.query(`update ${table} set paused_at=now()-interval '4 months' where id=$1`, [row.id]), /RETENTION_CLOCK_IMMUTABLE/);
    await assert.rejects(db.query(`update ${table} set status='archived' where id=$1`, [row.id]), /RETENTION_PERIOD/);
  }
});
