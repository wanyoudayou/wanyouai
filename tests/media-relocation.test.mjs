import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

test("isolated media relocation preserves history and fails closed", { timeout: 30000 }, async (t) => {
  const db = new PGlite({ extensions: { vector } });
  const sql = await readFile(new URL("../supabase/operations/relocate-one-media.sql", import.meta.url), "utf8");
  const slug = "relocation-fixture";
  const file = `${"a".repeat(64)}.png`;
  const path = `media/${slug}/${file}`;
  const old = `https://${"a".repeat(20)}.supabase.co/storage/v1/object/public/media/${path}`;
  const replacement = `/${path}`;
  const config = JSON.stringify({ source_url: old, article_slug: slug });
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,
        raw_user_meta_data jsonb,raw_app_meta_data jsonb,created_at timestamptz not null default now());
      create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
      grant usage on schema auth to anon,authenticated,service_role;
      create schema storage; create table storage.objects(bucket_id text,name text);`);
    // This one-off repair is approved only for 20260929134545. Keep its fixture at
    // that version instead of widening the operation's guard when new migrations land.
    for (const migration of ["20260928124423_release_baseline.sql", "20260928155549_security_review_payment_and_visibility.sql", "20260929134545_payment_mail_outbox.sql"]) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
    }
    const { rows: [{ id }] } = await db.query("insert into articles(slug,type,title,cover_url,preview_md,access,price,status,published_at) values($1,'blog','Fixture',$2,$2,'paid',1,'published',now()) returning id", [slug, old]);
    await db.query("insert into article_bodies values($1,$2)", [id, `${old}\nPAID_SENTINEL`]);
    await db.query("insert into article_chunks(article_id,access,chunk_type,chunk_no,content) values($1,'public','preview',0,$2)", [id, old]);
    await db.query("insert into article_versions(article_id,version,content_hash,snapshot,client_request_id) values($1,1,'unchanged-hash',$2,'unchanged-request')", [id, JSON.stringify({ markdown: old, media: [{ url: old }] })]);
    await db.query("insert into storage.objects values('media',$1)", [path]);
    const before = async () => (await db.query("select to_jsonb(a) article, (select content from article_bodies where article_id=a.id) body, (select jsonb_agg(to_jsonb(v)) from article_versions v where article_id=a.id) versions from articles a where id=$1", [id])).rows[0];
    const baseline = await before();
    const begin = async () => { await db.exec("begin"); await db.query("select set_config('wanyou.media_relocation',$1,true)", [config]); };
    t.afterEach(async () => { await db.exec("rollback; reset role"); });

    await t.test("rollback rehearsal preserves history and anonymous RLS", async () => {
      await begin(); await db.exec(sql);
      assert.equal((await before()).body, `${replacement}\nPAID_SENTINEL`);
      assert.deepEqual((await before()).versions, baseline.versions);
      await db.exec("set local role anon");
      assert.equal((await db.query("select * from article_bodies")).rows.length, 0);
      await db.exec("reset role; rollback");
      assert.deepEqual(await before(), baseline);
    });
    await t.test("unexpected source link aborts without mutation", async () => {
      await begin(); await db.query("update article_bodies set content=content||$1 where article_id=$2", [old.replace(file, `b${file.slice(1)}`), id]);
      await assert.rejects(db.exec(sql), /UNMAPPED_URL/); await db.exec("rollback");
      assert.deepEqual(await before(), baseline);
    });
    await t.test("existing embedding requires explicit review", async () => {
      await begin(); await db.query("update article_chunks set embedding=$1::extensions.vector where article_id=$2", [JSON.stringify(Array(1024).fill(0)), id]);
      await assert.rejects(db.exec(sql), /EMBEDDING_REVIEW_REQUIRED/); await db.exec("rollback");
    });
    await t.test("URL suffix is not silently rewritten as an exact object match", async () => {
      await begin(); await db.query("update article_bodies set content=replace(content,$1,$2) where article_id=$3", [old, `${old}?token=unexpected`, id]);
      await assert.rejects(db.exec(sql), /URL_SUFFIX_REVIEW_REQUIRED/); await db.exec("rollback");
      assert.deepEqual(await before(), baseline);
    });
    await t.test("missing object aborts before mutation", async () => {
      await begin(); await db.exec("delete from storage.objects");
      await assert.rejects(db.exec(sql), /OBJECT_MISSING/); await db.exec("rollback");
      assert.deepEqual(await before(), baseline);
    });
    await t.test("trigger side effects roll back all changes", async () => {
      await begin(); await db.exec(`create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin if tg_table_name='articles' then update public.site_config set identity='{"test":"unexpected"}'; end if; new.updated_at=now(); return new; end $$;`);
      await assert.rejects(db.exec(sql), /INVARIANT_FAILED: site_config/); await db.exec("rollback");
      assert.deepEqual(await before(), baseline);
    });
    await t.test("unknown triggers require review before any update", async () => {
      await begin(); await db.exec(`create function public.test_media_side_effect() returns trigger language plpgsql as $$ begin return new; end $$;
        create trigger test_media_side_effect after update on public.article_bodies for each row execute function public.test_media_side_effect();`);
      await assert.rejects(db.exec(sql), /UNREVIEWED_TRIGGER/); await db.exec("rollback");
      assert.deepEqual(await before(), baseline);
    });
    await t.test("commit is durable and a rerun is rejected", async () => {
      await begin(); await db.exec(sql); await db.exec("commit");
      assert.equal((await before()).article.cover_url, replacement);
      assert.deepEqual((await before()).versions, baseline.versions);
      await begin(); await assert.rejects(db.exec(sql), /COVER_MISMATCH/); await db.exec("rollback");
      assert.equal((await before()).body, `${replacement}\nPAID_SENTINEL`);
    });
  } finally { await db.close(); }
});
