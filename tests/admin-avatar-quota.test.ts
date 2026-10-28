import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { installTestDatabase } from "./support/database";

const USER = "00000000-0000-4000-8000-000000000002";
const OTHER = "00000000-0000-4000-8000-000000000003";
async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const db = new PGlite({ extensions: { vector } }); t.after(() => db.close());
  await installTestDatabase(db, { fixtures: false });
  await db.query("insert into auth.users(id,email) values($1,'one@example.test'),($2,'two@example.test')", [USER, OTHER]);
  await db.exec(`update site_config set avatar_config='{"enabled":true,"anonymous_entry":true}'::jsonb; set role service_role`);
  const reserve = async (id = randomUUID(), user: string | null = USER, ip: string | null = null) =>
    (await db.query<{ result: string }>("select reserve_avatar_generation($1,$2,$3,'test-model') result", [id, user, ip])).rows[0].result;
  const dispatch = async (id: string) => (await db.query<{ result: boolean }>("select dispatch_avatar_generation($1) result", [id])).rows[0].result;
  const finish = async (id: string, outcome: string) => (await db.query<{ result: boolean }>("select finish_avatar_generation($1,$2,3,2) result", [id,outcome])).rows[0].result;
  return { db, reserve, dispatch, finish };
}

test("avatar quota: final daily slot, replay binding and client authority boundaries", async t => {
  const { db, reserve } = await setup(t);
  await db.query("insert into avatar_usage(user_id,model) select $1,'legacy' from generate_series(1,19)", [USER]);
  const id = randomUUID();
  assert.equal(await reserve(id), "reserved");
  assert.equal(await reserve(), "daily_limit");
  assert.equal(await reserve(id), "duplicate");
  await assert.rejects(reserve(id, OTHER), /GENERATION_REQUEST_MISMATCH/);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`reset role; set role ${role}`);
    await assert.rejects(reserve(), /permission denied/);
    await assert.rejects(db.query("select dispatch_avatar_generation($1)", [id]), /permission denied/);
    await assert.rejects(db.query("select finish_avatar_generation($1,'released',0,0)", [id]), /permission denied/);
    await assert.rejects(db.query("update avatar_usage set generation_state='released'"), /permission denied/);
  }
  await db.exec(`reset role; set role authenticated; set request.jwt.claims='{"sub":"${OTHER}"}'`);
  assert.equal((await db.query("select * from avatar_usage")).rows.length, 0);
});

test("avatar quota: dispatched attempts remain charged after unknown result, expiry and failed completion", async t => {
  const { db, reserve, dispatch, finish } = await setup(t);
  await db.exec(`reset role; update site_config set avatar_config=avatar_config||'{"monthly_limit":1}'::jsonb; set role service_role`);
  const id = randomUUID(); assert.equal(await reserve(id), "reserved");
  assert.equal(await dispatch(id), true); assert.equal(await dispatch(id), false);
  assert.equal(await finish(id,"released"), false);
  await db.query("update avatar_usage set reservation_expires_at=now()-interval '1 hour' where request_id=$1", [id]);
  assert.equal(await reserve(randomUUID(),OTHER), "monthly_limit");
  await assert.rejects(db.query("select finish_avatar_generation($1,'succeeded',-1,0)", [id]), /INVALID_GENERATION_OUTCOME/);
  assert.equal(await reserve(randomUUID(),OTHER), "monthly_limit");
  assert.equal(await finish(id,"unknown"), true);
  assert.equal(await finish(id,"succeeded"), false);
  assert.equal(await reserve(randomUUID(),OTHER), "monthly_limit");
});

test("avatar quota: unused reservations expire or release; prior UTC day cannot dispatch", async t => {
  const { db, reserve, dispatch, finish } = await setup(t);
  await db.exec(`reset role; update site_config set avatar_config=avatar_config||'{"monthly_limit":1}'::jsonb; set role service_role`);
  const expired = randomUUID(); await reserve(expired);
  await db.query("update avatar_usage set reservation_expires_at=now()-interval '1 second' where request_id=$1", [expired]);
  assert.equal(await dispatch(expired),false);
  const released=randomUUID(); assert.equal(await reserve(released),"reserved");
  assert.equal(await finish(released,"released"),true);
  assert.equal(await dispatch(released),false);
  const oldDay=randomUUID(); assert.equal(await reserve(oldDay),"reserved");
  await db.query("update avatar_usage set created_at=now()-interval '1 day' where request_id=$1",[oldDay]);
  assert.equal(await dispatch(oldDay),false);
  assert.equal(await finish(oldDay,"released"),true);
  assert.equal(await reserve(),"reserved");
});

test("avatar quota: subscription, anonymous, owner daily exemption and station monthly cap", async t => {
  const { db,reserve }=await setup(t);
  await db.query("insert into avatar_usage(user_id,model) select $1,'legacy' from generate_series(1,20)",[USER]);
  assert.equal(await reserve(),"daily_limit");
  await db.query("insert into entitlements(user_id,type,source,starts_at,ends_at) values($1,'subscription','admin',now()-interval '1 day',now()+interval '1 day')",[USER]);
  assert.equal(await reserve(),"reserved");
  for(let i=0;i<5;i++) assert.equal(await reserve(randomUUID(),null,"192.0.2.1"),"reserved");
  assert.equal(await reserve(randomUUID(),null,"192.0.2.1"),"daily_limit");
  await db.exec(`reset role; update profiles set is_owner=true where id='${OTHER}'; update site_config set avatar_config=avatar_config||'{"monthly_limit":0}'::jsonb; set role service_role`);
  assert.equal(await reserve(randomUUID(),OTHER),"monthly_limit");
  await db.exec(`reset role; update site_config set avatar_config=avatar_config||'{"monthly_limit":null}'::jsonb; set role service_role`);
  await db.query("insert into avatar_usage(user_id,model) select $1,'legacy' from generate_series(1,100)",[OTHER]);
  assert.equal(await reserve(randomUUID(),OTHER),"reserved");
});

test("avatar quota: UTC month rollover, disabled station and unsupported isolation fail closed", async t => {
  const { db,reserve,dispatch }=await setup(t);
  await db.exec(`reset role; update site_config set avatar_config=avatar_config||'{"monthly_limit":1}'::jsonb; set role service_role`);
  await db.query("insert into avatar_usage(user_id,model,created_at) values($1,'previous month',date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'-interval '1 second')",[USER]);
  const id=randomUUID(); assert.equal(await reserve(id),"reserved");
  await db.exec(`reset role; update site_config set avatar_config=avatar_config||'{"enabled":false}'::jsonb; set role service_role`);
  assert.equal(await dispatch(id),false); assert.equal(await reserve(),"disabled");
  await db.exec("begin isolation level repeatable read");
  await assert.rejects(reserve(),/QUOTA_REQUIRES_READ_COMMITTED/);
  await db.exec("rollback");
});
