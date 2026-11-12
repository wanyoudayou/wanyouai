import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { installTestDatabase } from "./support/database";

test("request limits: daily bucket is atomic, per day and service-only", async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await installTestDatabase(db);
  const consume = async (bucket: string, day: string) =>
    (await db.query<{ ok: boolean }>("select consume_request_limit($1,$2::date,3) ok", [bucket, day])).rows[0].ok;
  await db.exec("set role service_role");
  assert.deepEqual([await consume("ip:1", "2026-11-11"), await consume("ip:1", "2026-11-11"), await consume("ip:1", "2026-11-11"), await consume("ip:1", "2026-11-11")], [true, true, true, false]);
  assert.equal(await consume("ip:2", "2026-11-11"), true, "buckets are independent");
  assert.equal(await consume("ip:1", "2026-11-12"), true, "a new site-local day resets");
  await assert.rejects(db.query("select consume_request_limit('',current_date,3)"), /INVALID_LIMIT/);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`reset role; set role ${role}`);
    await assert.rejects(db.query("select consume_request_limit('x',current_date,3)"), /permission denied/);
    await assert.rejects(db.query("select * from request_limits"), /permission denied/);
  }
});

test("service inquiry: booking and owner inbox commit together", async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await installTestDatabase(db);
  await db.exec("reset role");
  await db.query("insert into services(slug,title,status,price) values('consult','咨询','published',100),('hidden','隐藏','draft',100)");
  await db.exec("set role service_role");
  const submit = (slug: string, intent = "需要一次完整的架构咨询") =>
    db.query<{ r: { ok: boolean; code?: string; booking_id?: number } }>(
      "select submit_service_inquiry($1,null,'buyer@example.test',$2,'1k',null,array['https://example.test'],'203.0.113.1') r", [slug, intent]);
  const ok = (await submit("consult")).rows[0].r;
  assert.equal(ok.ok, true);
  const inbox = await db.query<{ n: number }>("select count(*)::int n from inbox_items where kind='inquiry' and (payload->>'booking_id')::bigint=$1", [ok.booking_id]);
  assert.equal(inbox.rows[0].n, 1);
  assert.equal((await submit("hidden")).rows[0].r.code, "NOT_FOUND");
  await assert.rejects(submit("consult", "太短"), /INVALID_INQUIRY/);
  assert.equal((await db.query<{ n: number }>("select count(*)::int n from bookings")).rows[0].n, 1, "rejected inquiries leave no booking");
  await db.exec("reset role; set role authenticated");
  await assert.rejects(submit("consult"), /permission denied/);
});
