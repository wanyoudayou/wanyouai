import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { installTestDatabase } from "./support/database";

const USER = "00000000-0000-4000-8000-000000000002";

type Order = { id: number; merchant_order_no: string; status: string };

test("legacy numeric settlement entrypoints cannot bypass merchant reference binding", async t => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await installTestDatabase(db);
  await db.exec("set role service_role");
  const order = await createOrder(db);
  for (const entrypoint of ["settle_payment", "settle_payment_queued"]) {
    for (const payload of [{}, { out_trade_no: String(order.id) }, { out_trade_no: "90000000000000000000000000000000" }]) {
      await assert.rejects(db.query(`select public.${entrypoint}($1,'old-trade',1,$2::jsonb)`,
        [order.id, JSON.stringify(payload)]), /PAYMENT_REFERENCE_MISMATCH/);
    }
  }
  assert.equal((await db.query<{ status: string }>("select status from orders where id=$1", [order.id])).rows[0].status, "pending");
  for (const table of ["payment_events", "email_outbox"]) {
    assert.equal((await db.query<{ count: number }>(`select count(*)::int count from ${table}`)).rows[0].count, 0);
  }
  assert.equal((await db.query<{ count: number }>("select count(*)::int count from entitlements where user_id=$1", [USER])).rows[0].count, 0);
});

async function createOrder(db: PGlite): Promise<Order> {
  return (await db.query<Order>(
    "insert into public.orders(user_id,sku_type,amount) values ($1,'subscription',1) returning id,merchant_order_no,status",
    [USER],
  )).rows[0];
}

test("merchant references isolate equal local IDs across independently installed sites", async t => {
  const first = new PGlite({ extensions: { vector } });
  const second = new PGlite({ extensions: { vector } });
  t.after(async () => { await first.close(); await second.close(); });
  await Promise.all([installTestDatabase(first), installTestDatabase(second)]);
  await Promise.all([first.exec("set role service_role"), second.exec("set role service_role")]);
  await createOrder(first);
  await createOrder(second);
  const oldOrder = await createOrder(first);
  const newOrder = await createOrder(second);
  assert.equal(oldOrder.id, newOrder.id);
  assert.equal(oldOrder.id, 2);
  assert.match(oldOrder.merchant_order_no, /^9[0-9]{31}$/);
  assert.match(newOrder.merchant_order_no, /^9[0-9]{31}$/);
  assert.notEqual(oldOrder.merchant_order_no, newOrder.merchant_order_no);

  const settle = (ref: string, event: string, payloadRef = ref) => second.query<{ result: string }>(
    "select public.settle_payment_reference($1,$2,1,$3::jsonb) result",
    [ref, event, JSON.stringify({ out_trade_no: payloadRef, trade_no: event })],
  );
  await assert.rejects(settle(oldOrder.merchant_order_no, "T-old"), /ORDER_NOT_FOUND/);
  await assert.rejects(settle(newOrder.merchant_order_no, "T-mismatch", oldOrder.merchant_order_no), /PAYMENT_REFERENCE_MISMATCH/);
  assert.equal((await second.query<{ count: number }>("select count(*)::int count from payment_events")).rows[0].count, 0);
  assert.equal((await second.query<Order>("select id,merchant_order_no,status from orders where id=$1", [newOrder.id])).rows[0].status, "pending");

  assert.equal((await settle(newOrder.merchant_order_no, "T-new")).rows[0].result, "settled");
  assert.equal((await settle(newOrder.merchant_order_no, "T-new")).rows[0].result, "duplicate");
  assert.equal((await second.query<Order>("select id,merchant_order_no,status from orders where id=$1", [newOrder.id])).rows[0].status, "paid");
  assert.equal((await second.query<{ count: number }>("select count(*)::int count from payment_events")).rows[0].count, 1);
  assert.equal((await second.query<{ count: number }>("select count(*)::int count from entitlements where user_id=$1 and type='subscription'", [USER])).rows[0].count, 1);

  await second.exec("reset role; set role authenticated");
  await assert.rejects(settle(newOrder.merchant_order_no, "T-evil"), /permission denied/);
  await second.exec("reset role; set role anon");
  await assert.rejects(settle(newOrder.merchant_order_no, "T-evil"), /permission denied/);
});

test("merchant reference migration refuses unresolved legacy pending orders", async t => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await installTestDatabase(db, { throughVersion: "20261010053221" });
  await db.exec("set role service_role");
  const pending = (await db.query<{ id: number }>(
    "insert into public.orders(user_id,sku_type,amount) values ($1,'subscription',1) returning id", [USER],
  )).rows[0];
  await db.exec("reset role");
  const migration = await readFile(new URL("../supabase/migrations/20261011115340_payment_external_reference.sql", import.meta.url), "utf8");
  await assert.rejects(db.exec(migration), /PAYMENT_REFERENCE_PENDING_ORDERS_REQUIRE_RECONCILIATION/);
  await db.exec("rollback");
  assert.equal((await db.query<{ version: string }>("select version from public.app_schema_version where id=1")).rows[0].version, "20261010053221");
  assert.equal((await db.query<{ count: number }>("select count(*)::int count from information_schema.columns where table_schema='public' and table_name='orders' and column_name='merchant_order_no'")).rows[0].count, 0);
  await db.query("update public.orders set status='failed' where id=$1", [pending.id]);
  await db.exec(migration);
  assert.equal((await db.query<{ version: string }>("select version from public.app_schema_version where id=1")).rows[0].version, "20261011115340");
  assert.equal((await db.query<{ merchant_order_no: string }>("select merchant_order_no from public.orders where id=$1", [pending.id])).rows[0].merchant_order_no, String(pending.id));
  const fresh = await createOrder(db);
  assert.match(fresh.merchant_order_no, /^9[0-9]{31}$/);
  // The review hardening is append-only; applying it must preserve all order references.
  await db.exec(await readFile(new URL("../supabase/migrations/20261011144257_enforce_payment_reference_at_settlement.sql", import.meta.url), "utf8"));
  assert.equal((await db.query<{ version: string }>("select version from public.app_schema_version where id=1")).rows[0].version, "20261011144257");
  assert.equal((await db.query<Order>("select id,merchant_order_no,status from orders where id=$1", [fresh.id])).rows[0].merchant_order_no, fresh.merchant_order_no);
  await db.exec("set role service_role");
  await assert.rejects(db.query("select settle_payment_queued($1,'stale-deployment',1,'{}')", [fresh.id]), /PAYMENT_REFERENCE_MISMATCH/);
  assert.equal((await db.query<{ result: string }>("select settle_payment_reference($1,'current-deployment',1,$2::jsonb) result", [fresh.merchant_order_no, JSON.stringify({ out_trade_no: fresh.merchant_order_no })])).rows[0].result, "settled");
});

test("bundled payment upgrade requires a pause, preserves records and installs the core guard atomically", async t => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await installTestDatabase(db, { throughVersion: "20261010053221" });
  const upgrade = await readFile(new URL("../supabase/upgrades/20261010053221-to-payment-reference.sql", import.meta.url), "utf8");
  await db.exec("update site_config set commerce=jsonb_set(commerce,'{payment_enabled}','true') where id=1");
  await assert.rejects(db.exec(upgrade), /PAYMENT_UPGRADE_REQUIRES_PAYMENTS_PAUSED/);
  await db.exec("rollback; update site_config set commerce=jsonb_set(commerce,'{payment_enabled}','false') where id=1");
  const oldOrder = (await db.query<{ id: number }>("insert into orders(user_id,sku_type,amount,status) values ($1,'subscription',1,'paid') returning id", [USER])).rows[0];
  const before = (await db.query("select id,user_id,sku_type,amount,status from orders")).rows;
  // Simulate an error in the second migration; none of the first may remain committed.
  await assert.rejects(db.exec(upgrade.replace("update public.app_schema_version set version='20261011144257'", "select 1/0; update public.app_schema_version set version='20261011144257'")), /division by zero/);
  await db.exec("rollback");
  assert.equal((await db.query<{ version: string }>("select version from app_schema_version where id=1")).rows[0].version, "20261010053221");
  assert.equal((await db.query<{ count: number }>("select count(*)::int count from information_schema.columns where table_schema='public' and table_name='orders' and column_name='merchant_order_no'")).rows[0].count, 0);
  await db.exec(upgrade);
  assert.deepEqual((await db.query("select id,user_id,sku_type,amount,status from orders")).rows, before);
  assert.equal((await db.query<Order>("select id,merchant_order_no,status from orders where id=$1", [oldOrder.id])).rows[0].merchant_order_no, String(oldOrder.id));
  assert.equal((await db.query<{ version: string }>("select version from app_schema_version where id=1")).rows[0].version, "20261011144257");
  await db.exec("set role service_role");
  const fresh = await createOrder(db);
  await assert.rejects(db.query("select settle_payment($1,'legacy',1,$2::jsonb)", [fresh.id, JSON.stringify({ out_trade_no: String(fresh.id) })]), /PAYMENT_REFERENCE_MISMATCH/);
  await assert.rejects(db.query("select settle_payment($1,'historic',1,$2::jsonb)", [oldOrder.id, JSON.stringify({ out_trade_no: String(oldOrder.id) })]), /PAYMENT_REFERENCE_MISMATCH/);
});
