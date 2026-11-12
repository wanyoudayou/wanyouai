import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { installTestDatabase } from "./support/database";

const OWNER = "00000000-0000-4000-8000-000000000001";
const CLIENT = "c0000000-0000-4000-8000-000000000001";
const OTHER = "c0000000-0000-4000-8000-000000000002";

test("user-scoped authorities: evaluations, public reviews and check-in lookup", async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await installTestDatabase(db);
  await db.exec("reset role");
  for (const [id, mail] of [[CLIENT, "client@example.test"], [OTHER, "other@example.test"]]) await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [id, mail]);
  const service = (await db.query<{ id: number }>("insert into services(slug,title,status,price) values('consult','咨询','published',100) returning id")).rows[0].id;
  const settled = (await db.query<{ id: number }>("insert into bookings(service_id,user_id,email,intent,status) values($1,$2,'client@example.test','需要一次完整的架构咨询','settled') returning id", [service, CLIENT])).rows[0].id;
  const open = (await db.query<{ id: number }>("insert into bookings(service_id,user_id,email,intent,status) values($1,$2,'client@example.test','需要一次完整的架构咨询','in_progress') returning id", [service, CLIENT])).rows[0].id;
  const as = async (id: string | null) => {
    await db.exec(`reset role; reset request.jwt.claims; set role ${id ? "authenticated" : "anon"}`);
    if (id) await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, role: "authenticated" })]);
  };
  const evaluate = async (booking: number) => (await db.query<{ r: { ok: boolean; code?: string } }>("select submit_evaluation($1,5,'很好') r", [booking])).rows[0].r;

  await as(OTHER);
  assert.equal((await evaluate(settled)).code, "NOT_FOUND", "another user cannot review");
  await as(CLIENT);
  assert.equal((await evaluate(open)).code, "NOT_SETTLED");
  assert.equal((await evaluate(settled)).ok, true);
  assert.equal((await evaluate(settled)).code, "DUPLICATE");
  await as(null);
  await assert.rejects(evaluate(settled), /permission denied/);
  const reviews = await db.query<Record<string, unknown>>("select * from public_service_evaluations($1,20)", [service]);
  assert.equal(reviews.rows.length, 1);
  assert.deepEqual(Object.keys(reviews.rows[0]).sort(), ["content", "created_at", "id", "rating"], "no booking or personal fields");

  await db.exec("reset role");
  const event = (await db.query<{ id: number }>("insert into series(slug,title,type,status) values('ev','活动','event','published') returning id")).rows[0].id;
  const token = (await db.query<{ t: string }>("insert into registrations(series_id,user_id,email) values($1,$2,'client@example.test') returning checkin_token t", [event, CLIENT])).rows[0].t;
  const lookup = async () => (await db.query<{ r: Record<string, unknown> }>("select checkin_lookup($1::uuid) r", [token])).rows[0].r;
  await as(null);
  const anonymous = await lookup();
  assert.equal(anonymous.found, true);
  assert.equal(anonymous.email, undefined, "anonymous viewer never sees the email");
  await as(CLIENT);
  assert.equal((await lookup()).is_self, true);
  assert.equal((await lookup()).email, undefined);
  await as(OWNER);
  assert.equal((await lookup()).email, "client@example.test");
  assert.equal(((await db.query<{ r: { found: boolean } }>("select checkin_lookup('00000000-0000-0000-0000-000000000000'::uuid) r")).rows[0].r).found, false);
});
