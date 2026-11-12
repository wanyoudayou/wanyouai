import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { installTestDatabase } from "./support/database";
const owner = "00000000-0000-4000-8000-000000000001";
const buyer = "00000000-0000-4000-8000-000000000002";
const migration = new URL("../supabase/migrations/20261024131326_skill_compatibility_and_delivery.sql", import.meta.url);

test("conversion preserves IDs, paid bodies, late settlement and both lifecycle entrypoints", async t => {
  const db = new PGlite({ extensions: { vector } }); t.after(() => db.close());
  await installTestDatabase(db, { throughVersion: "20261024072558" });
  const series = (await db.query<{ id: number }>("insert into series(slug,title,type,status,price,task) values('legacy-private-skill','Original','skill','published',9,'Public summary') returning id")).rows[0].id;
  const chapter = (await db.query<{ id: number }>("insert into articles(slug,title,type,series_id,status,access,published_at) values('private-skill-chapter','Private','chapter',$1,'published','paid',now()) returning id", [series])).rows[0].id;
  await db.query("insert into article_bodies(article_id,content) values($1,'PAID_BODY_TRAP')", [chapter]);
  await db.query("update series set readme_article_id=$1 where id=$2", [chapter, series]);
  const paidChapter = (await db.query<{ id: number }>("insert into articles(slug,title,type,series_id,status,access,published_at) values('private-skill-body','Paid body','chapter',$1,'published','paid',now()) returning id", [series])).rows[0].id;
  await db.query("insert into article_bodies(article_id,content) values($1,'RESTRICTED_CHAPTER_TRAP')", [paidChapter]);
  const collection = (await db.query<{ id: number }>("insert into series(slug,title,type) values('old-collection','Existing','collection') returning id")).rows[0].id;
  await db.exec("set role service_role");
  const order = (await db.query<{ result: { id: number; merchant_order_no: string } }>("select create_pending_order($1,'series',$2,9) result", [buyer, series])).rows[0].result;
  await db.exec("reset role");
  await db.exec(await readFile(migration, "utf8"));
  await db.exec("set role service_role");
  await db.query("select migrate_content_kinds($1)", [owner]);
  assert.deepEqual((await db.query<{ result: unknown }>("select migrate_content_kinds($1) result", [owner])).rows[0].result, { skills: 0, handbooks: 0 });
  const skill = (await db.query<{ id: number }>("select id from skills where legacy_series_id=$1", [series])).rows[0].id;
  assert.equal((await db.query<{ type: string }>("select type from series where id=$1", [collection])).rows[0].type, "handbook");
  const body = (await db.query<{ content: string }>("select content from article_bodies where article_id=$1", [skill])).rows[0].content;
  assert.equal(body, "Public summary"); assert.doesNotMatch(body, /PAID_BODY_TRAP/);
  await assert.rejects(db.query("select create_pending_order($1,'series',$2,9)", [owner, series]), /NOT_SELLABLE/);
  const settle = () => db.query<{ result: string }>("select settle_payment_queued($1,'legacy-late',9,jsonb_build_object('out_trade_no',$2::text)) result", [order.id, order.merchant_order_no]);
  assert.equal((await settle()).rows[0].result, "settled");
  assert.equal((await settle()).rows[0].result, "duplicate");
  assert.equal((await db.query<{ ok: boolean }>("select can_use_skill($1,$2) ok", [skill, buyer])).rows[0].ok, true);
  assert.equal((await db.query<{ n: number }>("select count(*)::int n from email_outbox where order_id=$1", [order.id])).rows[0].n, 1);
  assert.equal((await db.query<{ id: number }>("select target_id id from entitlements where user_id=$1 and type='series' and target_id=$2", [buyer, series])).rows[0].id, series);
  await db.exec(`reset role; set role authenticated; set request.jwt.claims='{"sub":"${owner}"}'`);
  await db.query("update articles set status='paused' where id=$1", [skill]);
  assert.equal((await db.query<{ status: string }>("select status from series where id=$1", [series])).rows[0].status, "paused");
  await db.query("update series set status='published' where id=$1", [series]);
  assert.equal((await db.query<{ status: string }>("select status from articles where id=$1", [skill])).rows[0].status, "published");
  await db.exec("reset role; reset request.jwt.claims; set role anon");
  assert.equal((await db.query("select content from article_bodies where article_id=$1", [paidChapter])).rows.length, 0);
});

test("private package policy defeats broad Storage grants and cleanup excludes committed versions", async t => {
  const db = new PGlite({ extensions: { vector } }); t.after(() => db.close());
  await installTestDatabase(db, { throughVersion: "20261024072558" });
  await db.exec(`create schema storage; create table storage.objects(id uuid primary key,bucket_id text,name text);
    alter table storage.objects enable row level security; grant usage on schema storage to anon,authenticated,service_role;
    grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
    create policy broad on storage.objects for all to anon,authenticated using(true) with check(true);
    insert into storage.objects values('${randomUUID()}','skill-packages','private.zip'),('${randomUUID()}','media','public.png');`);
  // Exercise the upgrade from broad Storage grants through the current schema.
  // verify.sql describes that schema, not the historical compatibility snapshot.
  const directory = new URL("../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(directory)).filter(file => /^\d{14}_[\w-]+\.sql$/.test(file) && file.slice(0, 14) > "20261024072558").sort()) {
    await db.exec(await readFile(new URL(file, directory), "utf8"));
  }
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    assert.deepEqual((await db.query<{ name: string }>("select name from storage.objects")).rows.map(r => r.name), ["public.png"]);
    await assert.rejects(db.query("insert into storage.objects values($1,'skill-packages','evil.zip')", [randomUUID()]), /row-level security/);
    await db.exec("reset role");
  }
  const skill = (await db.query<{ id: number }>("insert into articles(slug,title,type,access,status,published_at) values('cleanup-skill','Cleanup','skill','public','published',now()) returning id")).rows[0].id;
  const expired = randomUUID(), completed = randomUUID();
  for (const [id, version] of [[expired,"1"],[completed,"2"]]) await db.query("select reserve_skill_upload($1,$2,$3,$4,'',$5,10)", [id, skill, owner, version, "a".repeat(64)]);
  await db.query("select confirm_skill_release($1,$2,$3,'cleanup-skill','Example',true)", [completed, owner, JSON.stringify([{ path: "SKILL.md", size: 10, sha256: "a".repeat(64), text: true }])]);
  await db.query("update skill_uploads set expires_at=now()-interval '2 hours' where id=any($1::uuid[])", [[expired, completed]]);
  assert.deepEqual((await db.query<{ id: string }>("select id from expired_skill_uploads($1,$2)", [owner, skill])).rows.map(r => r.id), [expired]);
  await assert.rejects(db.query("select confirm_skill_release($1,$2,$3,'cleanup-skill','Example',true)", [expired, owner, JSON.stringify([{ path: "SKILL.md", size: 10, sha256: "a".repeat(64), text: true }])]), /UPLOAD_EXPIRED/);
  const checks = await db.query<{ check_name: string; passed: boolean }>(await readFile(new URL("../supabase/verify.sql", import.meta.url), "utf8"));
  assert.deepEqual(checks.rows.filter(r => !r.passed), []);
});
