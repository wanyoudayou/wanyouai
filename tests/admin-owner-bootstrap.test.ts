import test from "node:test";
import assert from "node:assert/strict";
import { installTestDatabase } from "./support/database";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { ensureOwnerAfterLogin } from "../src/lib/admin/owner-bootstrap";

const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

test("owner bootstrap: verified configured email is the only first claimant", async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await installTestDatabase(db, { fixtures: false });
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'owner@example.test',now()),($2,'other@example.test',null)", [OWNER, OTHER]);

  assert.equal((await db.query<{ old: string | null }>("select to_regprocedure('public.claim_owner()')::text old")).rows[0].old, null);
  assert.equal((await db.query<{ allowed: boolean }>("select has_function_privilege('authenticated','public.claim_owner_for(uuid,text)','EXECUTE') allowed")).rows[0].allowed, false);
  assert.equal((await db.query<{ allowed: boolean }>("select has_function_privilege('anon','public.claim_owner_for(uuid,text)','EXECUTE') allowed")).rows[0].allowed, false);
  assert.equal((await db.query<{ allowed: boolean }>("select has_function_privilege('service_role','public.claim_owner_for(uuid,text)','EXECUTE') allowed")).rows[0].allowed, true);

  await db.exec("set role authenticated");
  await assert.rejects(db.query("select public.claim_owner_for($1,$2)", [OWNER, "owner@example.test"]), /permission denied/);
  await db.exec("reset role; set role service_role");
  const claim = async (id: string, email: string) => (await db.query<{ result: boolean }>(
    "select public.claim_owner_for($1,$2) result", [id, email],
  )).rows[0].result;

  assert.equal(await claim(OTHER, "other@example.test"), false); // unverified
  assert.equal(await claim(OWNER, "wrong@example.test"), false);
  assert.equal(await claim(OWNER, " OWNER@EXAMPLE.TEST "), true);
  assert.equal(await claim(OWNER, "owner@example.test"), true); // idempotent
  await db.exec("reset role");
  await db.query("update auth.users set email_confirmed_at=now() where id=$1", [OTHER]);
  await db.exec("set role service_role");
  assert.equal(await claim(OTHER, "other@example.test"), false); // one owner
  assert.equal((await db.query<{ count: number }>("select count(*)::int count from public.profiles where is_owner")).rows[0].count, 1);
});

test("owner bootstrap: post-login gate covers OTP and link handlers", async () => {
  const calls: string[] = [];
  const gateway = {
    isOwner: async () => false,
    claim: async (id: string, email: string) => { calls.push(`${id}:${email}`); return true; },
  };
  const user = { id: OWNER, email: "Owner@Example.Test", email_confirmed_at: "2026-09-28T00:00:00Z" };
  assert.equal(await ensureOwnerAfterLogin(user, undefined, gateway), "unconfigured");
  assert.equal(await ensureOwnerAfterLogin(user, "other@example.test", gateway), "not_allowed");
  assert.equal(await ensureOwnerAfterLogin({ ...user, email_confirmed_at: null }, "owner@example.test", gateway), "unverified");
  assert.deepEqual(calls, []);
  assert.equal(await ensureOwnerAfterLogin(user, " owner@example.test ", gateway), "claimed");
  assert.deepEqual(calls, [`${OWNER}:owner@example.test`]);
  assert.equal(await ensureOwnerAfterLogin(user, undefined, { isOwner: async () => true, claim: gateway.claim }), "owner");
});
