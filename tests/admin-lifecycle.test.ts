import test from "node:test";
import assert from "node:assert/strict";
import { installTestDatabase } from "./support/database";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { parseSeriesInput } from "../src/lib/admin/series-input";

test("series form validates URL identifiers, type and decimal price", () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({ title: "手册", slug: "my-handbook", type: "handbook", price: "0.29" })) form.set(key, value);
  assert.equal(parseSeriesInput(form).price, 0.29);
  for (const [key, bad] of [["slug", "../oops"], ["price", "1.001"], ["price", "NaN"], ["type", "team"]]) {
    const previous = form.get(key)!; form.set(key, bad); assert.throws(() => parseSeriesInput(form)); form.set(key, previous);
  }
  form.set("type", "event"); assert.throws(() => parseSeriesInput(form));
});

test("owner lifecycle: README, transitions, stale edits and anonymous access", async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await installTestDatabase(db);
  await db.exec("reset role");
  const login = async (id: number) => { await db.exec("reset role; set role authenticated"); await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: `00000000-0000-4000-8000-00000000000${id}` })]); };
  await login(1);
  const album = (await db.query<{ id: number }>("insert into series(slug,title) values ('lifecycle-test','测试专辑') returning id")).rows[0].id;
  const row = async (kind: string, id: number) => (await db.query<{ updated_at: string; paused_at: string | null }>(`select updated_at::text, paused_at::text from ${kind === 'series' ? 'series' : 'articles'} where id=$1`, [id])).rows[0];
  const change = async (kind: string, id: number, action: string, value: string, notice = false, stamp?: string) => (await db.query<{ result: { ok: boolean; message: string } }>("select manage_content($1,$2,$3,$4,$5,$6) result", [kind, id, stamp ?? (await row(kind, id)).updated_at, action, value, notice])).rows[0].result;
  assert.equal((await change('series', album, 'featured', 'true')).ok, true);
  assert.equal((await change('series', album, 'price', '29.99')).ok, true);
  assert.equal((await change('series', album, 'price', '1.001')).ok, false);
  assert.equal((await change('series', album, 'featured', 'invalid')).ok, false);
  const eventId = (await db.query<{ id: number }>("insert into series(slug,title,type) values ('event-admin-test','活动测试','event') returning id")).rows[0].id;
  const eventDetails = { starts_at: '2026-10-01T14:00:00+08:00', state: 'upcoming', kind: 'open', ticket_price: '12.50', location_text: '线上', registration: '公开说明', capacity: '20人' };
  const saveEvent = async (state: string, stamp?: string) => (await db.query<{ result: { ok: boolean } }>('select save_event_details($1,$2,$3::jsonb) result', [eventId, stamp ?? (await row('series', eventId)).updated_at, JSON.stringify({ ...eventDetails, state })])).rows[0].result;
  assert.equal((await saveEvent('ended')).ok, false);
  assert.equal((await saveEvent('upcoming')).ok, true);
  const oldEventStamp = (await row('series', eventId)).updated_at;
  assert.equal((await saveEvent('registering')).ok, true);
  assert.equal((await saveEvent('ended', oldEventStamp)).ok, false);
  assert.equal((await saveEvent('upcoming')).ok, false);
  assert.equal((await saveEvent('ended')).ok, true);
  assert.equal((await saveEvent('registering')).ok, false);
  assert.equal((await change('series', eventId, 'price', '20')).ok, false);
  assert.equal((await change('series', album, 'status', 'published')).ok, false);
  // Fixture bodies are inserted only under the local database administrator.
  await db.exec("reset role");
  const article = (await db.query<{ id: number }>("insert into articles(slug,title,type,series_id,access,status,published_at) values ('lifecycle-readme','README','chapter',$1,'public','published',now()) returning id", [album])).rows[0].id;
  await db.query("insert into article_bodies values ($1,'README_VISIBLE')", [article]);
  await login(1);
  assert.equal((await change('series', album, 'readme', 'demo-selection-scorecard')).ok, false);
  assert.equal((await change('series', album, 'readme', 'lifecycle-readme')).ok, true);
  assert.equal((await change('series', album, 'status', 'published')).ok, true);
  const stamp = (await row('series', album)).updated_at;
  assert.equal((await change('series', album, 'status', 'archived', true)).ok, false);
  assert.equal((await change('series', album, 'status', 'paused')).ok, true);
  assert.ok((await row('series', album)).paused_at !== null); // 停售打 paused_at 时钟
  const earlyArchive = await change('series', album, 'status', 'archived', true);
  assert.equal(earlyArchive.ok, false);
  assert.match(earlyArchive.message, /3 个月/); // 权益保留期时间闸
  assert.equal((await change('series', album, 'status', 'published', false, stamp)).ok, false);
  await db.exec("reset role; reset request.jwt.claims; set role anon");
  assert.equal((await db.query('select * from article_bodies where article_id=$1', [article])).rows.length, 1);
  await assert.rejects(db.query("select manage_content('series',$1,now(),'status','published',false)", [album]));
  await login(2);
  assert.equal((await change('series', album, 'status', 'published', false, stamp)).ok, false);
  await assert.rejects(db.query("insert into series(slug,title) values ('intruder','intruder')"));
  await login(1);
  assert.equal((await change('article', article, 'status', 'paused')).ok, true);
  assert.equal((await change('article', article, 'status', 'archived', true)).ok, false);
  assert.equal((await change('series', album, 'status', 'published')).ok, true);
  assert.equal((await row('series', album)).paused_at, null); // 恢复发布清空时钟
  assert.equal((await change('series', album, 'status', 'paused')).ok, true);
  assert.equal((await change('series', album, 'status', 'archived')).ok, false);
  assert.equal((await change('series', album, 'status', 'archived', true)).ok, false); // 勾选但未满 3 个月仍拒绝
  await db.exec("reset role");
  await db.query("update series set paused_at = now() - interval '4 months' where id=$1", [album]); // 站外回拨时钟，模拟保留期届满
  await login(1);
  assert.equal((await change('series', album, 'status', 'archived', true)).ok, true);
  assert.equal((await change('series', album, 'status', 'published')).ok, false);
  assert.equal((await change('article', article, 'status', 'published')).ok, false);
  await db.exec("reset role");
  await db.query("update articles set paused_at = now() - interval '4 months' where id=$1", [article]);
  await login(1);
  assert.equal((await change('article', article, 'status', 'archived', true)).ok, true);
  await db.exec("reset role; reset request.jwt.claims; set role anon");
  assert.equal((await db.query('select * from article_bodies where article_id=$1', [article])).rows.length, 0);
});
