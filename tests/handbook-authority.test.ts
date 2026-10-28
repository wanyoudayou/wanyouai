import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { installTestDatabase } from "./support/database";
import { publish, type PublisherStore } from "../src/lib/publishing/pipeline";
import type { PublishInput, PublishResponse } from "../src/lib/publishing/types";
const owner = "00000000-0000-4000-8000-000000000001";

test("scoped handbook authority publishes, rejects cross-kind writes, locks versions and recovers exact replays", async t => {
  const db = new PGlite({ extensions: { vector } }); t.after(() => db.close()); await installTestDatabase(db);
  const token = (await db.query<{ id: string }>("select create_handbook_credential($1,'Obsidian',$2) id", [owner, "a".repeat(64)])).rows[0].id;
  const operation = randomUUID();
  const create = () => db.query<{ result: { id: number } }>("select create_synced_handbook($1,$2,$3,'plugin-guide','Plugin Guide') result", [token, operation, "b".repeat(64)]);
  const series = (await create()).rows[0].result.id;
  assert.equal((await create()).rows[0].result.id, series);
  await assert.rejects(db.query("select create_synced_handbook($1,$2,$3,'different','Different')", [token, operation, "c".repeat(64)]), /OPERATION_CONFLICT/);
  const snap: Omit<PublishInput, "client_request_id"> = { frontmatter: { title: "Read me", slug: "plugin-readme", type: "chapter", series_slug: "plugin-guide", access: "public" }, markdown: "# Public guide", media: [] };
  const stage = async (hash: string, expected = 0, updated: string | null = null, body = snap, path = "README.md") => (await db.query<{ r: { id: number } }>("select stage_handbook_file($1,$2,$3,'series:plugin-guide',$4,$5,$6,$7,$8,$9,false) r", [token, randomUUID(), hash.repeat(64), path, body.frontmatter.slug, hash.repeat(64), JSON.stringify(body), expected, updated])).rows[0].r.id;
  const revision = await stage("c");
  const pubOperation = randomUUID(); const store: PublisherStore = {
    replay: async () => null, commit: async (_r, payload) => (await db.query<{ r: PublishResponse }>("select publish_handbook_revision($1,$2,$3,$4,$5) r", [token, pubOperation, "d".repeat(64), revision, JSON.stringify(payload)])).rows[0].r,
    media: { download: async () => null, upload: async () => {}, publicUrl: p => `https://test.invalid/${p}` }, revalidate: () => {},
  };
  const result = await publish({ ...snap, client_request_id: "handbook-test" }, store);
  assert.equal(result.status, "pass"); assert.equal(result.article?.version, 1);
  assert.deepEqual(await publish({ ...snap, client_request_id: "handbook-test" }, store), result);
  const current = (await db.query<{ updated_at: string }>("select updated_at::text from series where id=$1", [series])).rows[0];
  await db.query("select activate_synced_handbook($1,$2,$3,$4,$5,$6)", [token, randomUUID(), "e".repeat(64), series, revision, current.updated_at]);
  const updated = (await db.query<{ updated_at: string }>("select updated_at::text from articles where slug='plugin-readme'")).rows[0].updated_at;
  await db.exec("update articles set title='Web changed' where slug='plugin-readme'");
  await assert.rejects(stage("f", revision, updated), /ONLINE_CHANGED/);
  const reviewed = (await db.query<{ updated_at: string }>("select updated_at::text from articles where slug='plugin-readme'")).rows[0].updated_at;
  const forced = await stage("f", revision, reviewed, { ...snap, markdown: "# Explicit local replacement" });
  const draft = (await db.query<{ base: string; content: string }>("select base_updated_at::text as base,snapshot->>'markdown' as content from content_file_revisions where id=$1", [forced])).rows[0];
  assert.equal(draft.base, reviewed); assert.equal(draft.content, "# Explicit local replacement");
  assert.equal((await db.query<{ title: string }>("select title from articles where slug='plugin-readme'")).rows[0].title, "Web changed");
  await db.exec("update articles set title='Web changed after review' where slug='plugin-readme'");
  await assert.rejects(stage("a", forced, reviewed), /ONLINE_CHANGED/);
  const event = (await db.query<{ id: number }>("insert into series(slug,title,type,status) values('plugin-event','Event','event','draft') returning id")).rows[0].id;
  await assert.rejects(db.query("select handbook_principal($1,$2)", [token, event]), /HANDBOOK_REQUIRED/);
  await assert.rejects(db.query("select stage_handbook_file($1,$2,$3,'series:plugin-event','x.md','cross-kind',$3,$4,0,null,false)", [token, randomUUID(), "a".repeat(64), JSON.stringify({ ...snap, frontmatter: { ...snap.frontmatter, series_slug: "plugin-event" } })]), /HANDBOOK_REQUIRED/);
  await db.query("update handbook_credentials set revoked_at=now() where id=$1", [token]);
  await assert.rejects(create(), /CREDENTIAL_REVOKED/);
  await db.exec("set role anon"); await assert.rejects(db.exec("select * from handbook_credentials"), /permission denied/);
  await assert.rejects(db.query("select handbook_principal($1,$2)", [token, series]), /permission denied/);
});

test("public image binding cannot reuse another credential's upload or overwrite a changed image", async t => {
  const db = new PGlite({ extensions: { vector } }); t.after(() => db.close()); await installTestDatabase(db);
  const credential = async (hash: string) => (await db.query<{ id: string }>("select create_handbook_credential($1,'Plugin',$2) id", [owner, hash.repeat(64)])).rows[0].id;
  const first = await credential("a"), second = await credential("b");
  const series = (await db.query<{ id: number }>("select id from series where slug='demo-selection-handbook'")).rows[0].id;
  const upload = randomUUID(); await db.query("select prepare_handbook_image($1,$2,$3,'image.png',$4,'image/png',10)", [first, series, upload, "d".repeat(64)]);
  await assert.rejects(db.query("select prepare_handbook_image($1,$2,$3,'image.png',$4,'image/png',10)", [second, series, upload, "d".repeat(64)]), /UPLOAD_CONFLICT/);
  const asset = randomUUID();
  await db.query("insert into media_assets(id,name,storage_path,sha256,mime_type,byte_size,width,height) values($1,'image.png','media/library/'||$2||'.png',$2,'image/png',10,1,1)", [asset, "d".repeat(64)]);
  await db.query("update media_uploads set asset_id=$1 where id=$2", [asset, upload]);
  await db.query("select link_handbook_image($1,$2,$3,'_assets/test.png',null)", [first, series, upload]);
  await db.query("select link_handbook_image($1,$2,$3,'_assets/test.png',null)", [first, series, upload]);
  await assert.rejects(db.query("select link_handbook_image($1,$2,$3,'_assets/test.png',null)", [second, series, upload]), /UPLOAD_MISMATCH/);
});
