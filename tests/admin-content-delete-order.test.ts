import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { installTestDatabase } from "./support/database";
import { keepClassification } from "../src/lib/admin/draft";

test("imported files keep the editor's chapter type and album unless they set their own", () => {
  const chapter = { title: "", slug: "", type: "chapter" as const, access: "public" as const, series_slug: "getting-started" };
  const imported = { title: "分身", slug: "getting-started-avatar", type: "blog" as const, access: "public" as const };
  assert.deepEqual(keepClassification(imported, chapter, ["title"]), { ...imported, type: "chapter", series_slug: "getting-started" });
  assert.deepEqual(keepClassification({ ...imported, series_slug: "other" }, chapter, ["series_slug"]), { ...imported, type: "chapter", series_slug: "other" });
  assert.deepEqual(keepClassification(imported, chapter, ["type"]), imported);
  const blog = { ...imported, title: "", slug: "" };
  assert.deepEqual(keepClassification({ ...imported, series_slug: "x" }, blog, ["series_slug"]), imported);
});

test("chapter positions follow the album and free unsold content can be deleted", async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await installTestDatabase(db);
  await db.exec("reset role");
  const album = (await db.query<{ id: number }>("insert into series(slug,title,type) values ('order-guide','指南','handbook') returning id")).rows[0].id;
  const chapter = async (slug: string, sort: number, access = "public") =>
    (await db.query<{ id: number }>("insert into articles(slug,title,type,series_id,access,status,sort_order,published_at) values ($1,$1,'chapter',$2,$3,'published',$4,now()) returning id", [slug, album, access, sort])).rows[0].id;
  const first = await chapter("order-one", 0);
  await chapter("order-two", 1);
  await chapter("order-three", 2);
  const paidChapter = await chapter("order-paid", 3, "paid");
  await db.query("insert into article_bodies values ($1,'ONE')", [first]);
  await db.exec("set role service_role");
  const stage = async (path: string, slug: string) =>
    (await db.query<{ id: number }>("select stage_content_file('series:order-guide',$1,$2,$3,'{}'::jsonb,0,$4) id", [path, slug, "a".repeat(64), "req-" + slug])).rows[0].id;
  const sortOf = async (slug: string) => (await db.query<{ sort: number }>("select sort from content_files where article_slug=$1", [slug])).rows[0].sort;
  // Editing an existing chapter keeps its place; a new chapter goes after the last one.
  await stage("one.md", "order-one");
  assert.equal(await sortOf("order-one"), 0);
  await stage("new.md", "order-new");
  assert.equal(await sortOf("order-new"), 4);

  const ids = (await db.query<{ id: number }>("select id from articles where series_id=$1 order by sort_order,id", [album])).rows.map((row) => row.id);
  await db.query("select order_series_chapters($1,$2::bigint[])", [album, [ids[1], ids[0], ...ids.slice(2)]]);
  assert.deepEqual((await db.query<{ slug: string }>("select slug from articles where series_id=$1 order by sort_order,id", [album])).rows.map((row) => row.slug), ["order-two", "order-one", "order-three", "order-paid"]);
  assert.equal(await sortOf("order-one"), 2);
  assert.equal(await sortOf("order-new"), 5, "unpublished files follow the published chapters");

  const stamp = async (id: number) => (await db.query<{ updated_at: string }>("select updated_at::text from articles where id=$1", [id])).rows[0].updated_at;
  const remove = async (id: number, at?: string) =>
    (await db.query<{ r: { ok: boolean; message: string } }>("select delete_free_article($1,$2) r", [id, at ?? (await stamp(id))])).rows[0].r;
  assert.equal((await remove(paidChapter)).ok, false, "paid content keeps the pause → archive lifecycle");
  assert.equal((await remove(first, "2000-01-01T00:00:00Z")).ok, false, "stale page cannot delete");
  await db.exec("reset role");
  await db.query("update series set readme_article_id=$1 where id=$2", [first, album]);
  await db.exec("set role service_role");
  assert.match((await remove(first)).message, /README/);
  await db.exec("reset role");
  await db.query("update series set readme_article_id=null where id=$1", [album]);
  const buyer = "00000000-0000-4000-8000-000000000002";
  const order = (await db.query<{ id: number }>("insert into orders(user_id,sku_type,target_id,amount) values ($1,'series',$2,9) returning id", [buyer, album])).rows[0].id;
  await db.exec("set role service_role");
  assert.match((await remove(first)).message, /订单或购买/, "chapters of a sold album stay");
  await db.exec("reset role");
  await db.query("delete from orders where id=$1", [order]);
  await db.exec("set role service_role");
  const deleted = await remove(first);
  assert.equal(deleted.ok, true);
  assert.equal((await db.query("select 1 from articles where slug='order-one'")).rows.length, 0);
  assert.equal((await db.query("select 1 from article_bodies where article_id=$1", [first])).rows.length, 0);
  assert.equal((await db.query("select 1 from content_files where article_slug='order-one'")).rows.length, 0);
  // The slug is free again.
  await stage("one-again.md", "order-one");

  await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: "00000000-0000-4000-8000-000000000001" })]);
  await assert.rejects(db.query("select delete_free_article($1,now())", [paidChapter]), /permission denied/);
  await assert.rejects(db.query("select order_series_chapters($1,array[]::bigint[])", [album]), /permission denied/);
});
