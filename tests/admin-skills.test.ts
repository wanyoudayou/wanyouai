import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { installTestDatabase } from "./support/database";
import { publisherCanEdit } from "../src/lib/publishing/identity";

const db = new PGlite({ extensions: { vector } });
const owner = "00000000-0000-4000-8000-000000000001";
const buyer = "00000000-0000-4000-8000-000000000002";
let skill: number;
before(async () => {
  await installTestDatabase(db);
  skill = (await db.query<{ id: number }>(`insert into public.articles(slug,type,title,access,status,published_at) values('independent-skill','skill','Skill','public','published',now()) returning id`)).rows[0].id;
});
after(() => db.close());

test("Skill descriptions use articles while package tables and RPCs stay private", async () => {
  assert.equal((await db.query<{ n: number }>("select count(*)::int n from public.skills where id=$1", [skill])).rows[0].n, 1);
  await db.exec("set role anon");
  assert.equal((await db.query<{ n: number }>("select count(*)::int n from public.articles where id=$1", [skill])).rows[0].n, 1);
  await assert.rejects(db.query("select * from public.skill_releases"), /permission denied/);
  await assert.rejects(db.query("select public.can_use_skill($1,$2)", [skill, owner]), /permission denied/);
  await db.exec("reset role");
  await assert.rejects(db.query("update public.articles set access='paid' where id=$1", [skill]), /article_price_check/);
});

test("Skill authorization distinguishes anonymous, free, paid, expired and legacy rights", async () => {
  const allowed = async (user: string | null) => (await db.query<{ ok: boolean }>("select public.can_use_skill($1,$2) ok", [skill, user])).rows[0].ok;
  assert.equal(await allowed(null), false);
  assert.equal(await allowed(buyer), true);
  await db.query("update public.skills set price=10 where id=$1", [skill]);
  assert.equal(await allowed(buyer), false);
  assert.equal(await allowed(owner), true);
  await db.query("insert into public.entitlements(user_id,type,target_id,ends_at,source) values($1,'skill',$2,now()-interval '1 second','order')", [buyer, skill]);
  assert.equal(await allowed(buyer), false);
  await db.query("update public.entitlements set ends_at=null where user_id=$1 and type='skill'", [buyer]);
  assert.equal(await allowed(buyer), true);
  await db.query("update public.entitlements set revoked_at=now() where user_id=$1 and type='skill'", [buyer]);
  assert.equal(await allowed(buyer), false);
});

test("no package means no sale; release ownership and immutability are enforced", async () => {
  await assert.rejects(db.query("select public.create_pending_order($1,'skill',$2,10)", [buyer, skill]), /NOT_SELLABLE/);
  await db.exec("set role service_role");
  await assert.rejects(db.exec("update public.skill_releases set version='changed'"), /permission denied/);
  await db.exec("reset role");
});

test("handbook credentials cannot edit another content kind or blog scope", () => {
  const identity = { kind: "handbook", ownerId: owner, credentialId: "credential" } as const;
  assert.equal(publisherCanEdit(identity, { type: "handbook", scope: "series:guide" }), true);
  for (const type of ["skill", "event", "collection", "blog"]) assert.equal(publisherCanEdit(identity, { type, scope: "series:guide" }), false);
  assert.equal(publisherCanEdit(identity, { type: "handbook", scope: "blog" }), false);
});

test("release publication, delivery revocation and conversation replay preserve authority", async () => {
  await db.exec("reset role");
  const upload = "10000000-0000-4000-8000-000000000001";
  await db.query("select public.reserve_skill_upload($1,$2,$3,'1.0.0','First',$4,10)", [upload, skill, owner, "a".repeat(64)]);
  await assert.rejects(db.query("select public.reserve_skill_upload($1,$2,$3,'1.0.1','First',$4,10)", [upload, skill, owner, "a".repeat(64)]), /UPLOAD_CONFLICT/);
  assert.equal((await db.query<{ ok: boolean }>("select public.claim_skill_confirmation($1,$2) ok", [upload, owner])).rows[0].ok, true);
  assert.equal((await db.query<{ ok: boolean }>("select public.claim_skill_confirmation($1,$2) ok", [upload, owner])).rows[0].ok, false);
  const manifest = JSON.stringify([{ path: "SKILL.md", size: 10, sha256: "b".repeat(64), text: true }]);
  await db.query("select public.confirm_skill_release($1,$2,$3,'test-skill','Test',true)", [upload, owner, manifest]);
  await db.query("select public.save_skill_settings($1,$2,1,10,$3,true,'Provide text')", [skill, owner, upload]);
  await assert.rejects(db.query("select public.save_skill_settings($1,$2,1,0,$3,true,'Old')", [skill, owner, upload]), /SETTINGS_CONFLICT/);
  await assert.rejects(db.query("select public.create_pending_order($1,'skill',$2,1)", [buyer, skill]), /NOT_SELLABLE/);
  const order = (await db.query<{ result: { id: number; amount: number } }>("select public.create_pending_order($1,'skill',$2,10) result", [buyer, skill])).rows[0].result;
  assert.equal(Number(order.amount), 10);
  assert.equal((await db.query<{ result: { id: number } }>("select public.create_pending_order($1,'skill',$2,10) result", [buyer, skill])).rows[0].result.id, order.id);
  await assert.rejects(db.query("select public.issue_skill_install_grant($1,$2,$3)", [buyer, upload, "c".repeat(64)]), /FORBIDDEN/);
  const settle = () => db.query<{ result: string }>("select settle_payment_queued($1,'skill-payment',10,(select jsonb_build_object('out_trade_no',merchant_order_no) from orders where id=$1)) result", [order.id]);
  assert.equal((await settle()).rows[0].result, "settled");
  assert.equal((await settle()).rows[0].result, "duplicate");
  assert.equal((await db.query<{ n: number }>("select count(*)::int n from entitlements where source_ref=$1 and type='skill'", [`order:${order.id}`])).rows[0].n, 1);
  assert.equal((await db.query<{ n: number }>("select count(*)::int n from email_outbox where order_id=$1", [order.id])).rows[0].n, 1);
  await db.query("select public.issue_skill_install_grant($1,$2,$3)", [buyer, upload, "c".repeat(64)]);
  await db.query("select public.redeem_skill_install_grant($1)", ["c".repeat(64)]);
  await db.query("update public.entitlements set revoked_at=now() where user_id=$1 and type='skill'", [buyer]);
  await assert.rejects(db.query("select public.redeem_skill_install_grant($1)", ["c".repeat(64)]), /FORBIDDEN/);
  const session = "20000000-0000-4000-8000-000000000001"; const turn = "30000000-0000-4000-8000-000000000001";
  const begin = () => db.query<{ result: { new: boolean } }>("select public.begin_skill_turn($1,$2,$3,$4,'question') result", [owner, skill, session, turn]);
  assert.equal((await begin()).rows[0].result.new, true);
  assert.equal((await begin()).rows[0].result.new, false);
  await assert.rejects(db.query("select public.begin_skill_turn($1,$2,$3,$4,'different')", [owner, skill, session, turn]), /TURN_CONFLICT/);
  await assert.rejects(db.query("select public.begin_skill_turn($1,$2,$3,$4,'next')", [owner, skill, session, "30000000-0000-4000-8000-000000000002"]), /TURN_RUNNING/);
  await db.query("update public.skill_turns set lease_until=now()-interval '1 second' where id=$1", [turn]);
  assert.equal((await begin()).rows[0].result.new, false, "expired turn is unknown, never dispatched twice");
});
