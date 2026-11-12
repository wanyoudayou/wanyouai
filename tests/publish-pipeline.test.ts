import test from "node:test";
import assert from "node:assert/strict";
import { installTestDatabase } from "./support/database";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import sharp from "sharp";
import { publish, type PublisherStore } from "../src/lib/publishing/pipeline";
import { inspectMarkdown } from "../src/lib/publishing/markdown";
import { contentHash, validateFrontmatter } from "../src/lib/publishing/validate";
import { validPublisherToken, sameSiteOrigin } from "../src/lib/publishing/auth";
import { resolveMedia } from "../src/lib/publishing/media";
import type { PublishInput, PublishResponse } from "../src/lib/publishing/types";

const input = (id: string, markdown = '公开预览\n\n<!-- paywall -->\n\nPRIVATE_PUBLISH_TEST'): PublishInput => ({
  client_request_id: id, frontmatter: { title: "事务测试", slug: "publish-test", type: "blog", access: "paid", price: 12.34 }, markdown, media: [],
});

test("publisher token and cookie origin gates", () => {
  const secret = "s".repeat(40);
  assert.equal(validPublisherToken(`Bearer ${secret}`, secret), true);
  for (const header of [null, "Bearer wrong", "bearer " + secret]) assert.equal(validPublisherToken(header, secret), false);
  assert.equal(validPublisherToken("Bearer short", "short"), false);
  assert.equal(sameSiteOrigin("https://evil.test", "https://site.test"), false);
  assert.equal(sameSiteOrigin(null, "https://site.test"), false);
  assert.equal(sameSiteOrigin("https://site.test", "https://site.test/path"), true);
});

test("AST cutpoints fail closed and hashing is independent of object key order", () => {
  assert.equal(inspectMarkdown(input("x").markdown, "paid").preview, "公开预览");
  for (const markdown of ['```html\n<!-- paywall -->\n```', '`<!-- paywall -->`']) {
    assert.equal(inspectMarkdown(markdown, "paid").preview, "");
    assert.ok(inspectMarkdown(markdown, "paid").diagnostics.every((d) => d.severity !== "error"));
  }
  assert.ok(inspectMarkdown('> <!-- paywall -->', "paid").diagnostics.every((d) => d.severity !== "error"));
  assert.ok(inspectMarkdown('<!-- paywall -->\n\n<!-- paywall -->', "paid").diagnostics.some((d) => d.code === "MULTIPLE_PAYWALL_MARKERS"));
  assert.equal(inspectMarkdown("SECRET", "paid").preview, "");
  assert.ok(inspectMarkdown('<video src="x.mp4"/>', "public").diagnostics.some((d) => d.code === "MEDIA_TYPE_BLOCKED"));
  const value = input("a");
  assert.equal(contentHash(value), contentHash({ ...value, client_request_id: "b", frontmatter: Object.fromEntries(Object.entries(value.frontmatter).reverse()) as PublishInput["frontmatter"] }));
  assert.notEqual(contentHash(value), contentHash(input("a", "changed")));
  assert.ok(validateFrontmatter({ ...value.frontmatter, published_at: "2026-02-30T12:00:00Z" }).length);
  assert.ok(validateFrontmatter({ ...value.frontmatter, price: 1000000 }).length);
  assert.ok(validateFrontmatter({ ...value.frontmatter, price: 1.001 }).length);
  assert.deepEqual(validateFrontmatter({ ...value.frontmatter, price: 0.29 }), []);
});

test("media byte hashes, actual format, missing refs and SVG rasterization", async () => {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
  const hash = createHash("sha256").update(bytes).digest("hex");
  const value = input("media", '![图](local.png)');
  value.media = [{ source_path: "local.png", storage_path: `media/publish-test/${hash}.png`, sha256: hash, mime_type: "image/png", width: 2, height: 2 }];
  const store = { download: async () => bytes, upload: async () => {}, publicUrl: (p: string) => `https://storage.test/${p}` };
  const result = await resolveMedia(value, store);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.markdown.includes(`https://storage.test/media/publish-test/${hash}.png`));
  const oldUrl = `https://old-project.supabase.co/storage/v1/object/public/media/media/publish-test/${hash}.png`;
  const historical = await resolveMedia({ ...value, frontmatter: { ...value.frontmatter, cover: oldUrl }, markdown: `![图](<${oldUrl}>)` }, {
    ...store, publicUrl: (path) => `/media/${path.slice("media/".length)}`,
  });
  assert.deepEqual(historical.diagnostics, []);
  assert.equal(historical.cover, `/media/publish-test/${hash}.png`);
  assert.ok(historical.markdown.includes(`](</media/publish-test/${hash}.png>)`));
  const unverifiedUrl = `https://old-project.supabase.co/storage/v1/object/public/media/media/other-article/${hash}.png`;
  const external = await resolveMedia({ ...value, markdown: `![图](<${unverifiedUrl}>)` }, {
    ...store, publicUrl: (path) => `/media/${path.slice("media/".length)}`,
  });
  assert.ok(external.markdown.includes(unverifiedUrl));
  assert.ok(external.diagnostics.some((entry) => entry.code === "EXTERNAL_IMAGE"));
  assert.ok((await resolveMedia(value, { ...store, download: async () => Buffer.from("bad") })).diagnostics.some((d) => d.code === "MEDIA_HASH_MISMATCH"));
  assert.ok((await resolveMedia({ ...value, media: [] }, store)).diagnostics.some((d) => d.code === "MEDIA_MISSING"));
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><script>alert(1)</script><image href="http://127.0.0.1/private"/><rect width="2" height="2" fill="red"/></svg>');
  const svgHash = createHash("sha256").update(svg).digest("hex");
  let uploaded = false;
  const rendered = await resolveMedia({ ...value, media: [{ ...value.media[0], storage_path: `media/publish-test/${svgHash}.svg`, sha256: svgHash, mime_type: "image/svg+xml" }] }, {
    ...store, download: async () => svg, upload: async (path, body) => { assert.match(path, /\.png$/); assert.equal((await sharp(body).metadata()).format, "png"); uploaded = true; },
  });
  assert.deepEqual(rendered.diagnostics, []);
  assert.equal(uploaded, true);
});

test("clean Postgres schema, RLS fixtures and publication transaction", async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await installTestDatabase(db);
  await db.exec('reset role');
  const count = async (sql: string) => Number((await db.query<{ count: string }>(sql)).rows[0].count);
  assert.equal(await count("select count(*) from profiles where is_owner"), 1);
  assert.equal(await count("select count(*) from profiles where is_owner and id = '00000000-0000-4000-8000-000000000007'"), 0);
  // M1: every fixture auth user auto-got a profiles row via handle_new_user; exactly one owner.
  assert.equal(await count("select count(*) from profiles"), 7);
  // New signups never self-grant owner.
  await db.query("insert into auth.users (id, email, email_confirmed_at, aud, role, raw_user_meta_data, raw_app_meta_data) values ('00000000-0000-4000-8000-000000000099', 'new-signup@example.test', now(), 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb)");
  assert.equal(await count("select count(*) from profiles where id = '00000000-0000-4000-8000-000000000099' and is_owner = false"), 1);
  // Trigger function is not directly executable by authenticated.
  const exec = await db.query<{ v: boolean }>("select has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE') as v");
  assert.equal(exec.rows[0].v, false);
  const matrix: [number, string, number][] = [
    [2, 'demo-registered-blog', 1], [2, 'demo-subscriber-blog', 0],
    [3, 'demo-subscriber-blog', 1], [3, 'demo-selection-scorecard', 1],
    [4, 'demo-selection-scorecard', 1], [4, 'demo-paid-single-blog', 0],
    [5, 'demo-paid-single-blog', 1], [5, 'demo-selection-scorecard', 0],
    [6, 'demo-opc-review-event-notes', 1], [6, 'demo-subscriber-blog', 0],
  ];
  for (const [user, slug, expected] of matrix) {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: `00000000-0000-4000-8000-00000000000${user}`, role: 'authenticated' })]);
    assert.equal(Number((await db.query<{ count: number }>('select count(*) from article_bodies where article_id=(select id from articles where slug=$1)', [slug])).rows[0].count), expected, `RLS user ${user} / ${slug}`);
    await db.exec("reset role; reset request.jwt.claims");
  }
  const invalidated: string[] = [];
  const store: PublisherStore = {
    async replay(id) { return (await db.query<{ response: PublishResponse }>('select response from publish_requests where client_request_id=$1', [id])).rows[0]?.response ?? null; },
    async commit(id, payload) { return (await db.query<{ response: PublishResponse }>('select commit_publication($1, $2::jsonb) as response', [id, JSON.stringify(payload)])).rows[0].response; },
    media: { download: async () => null, upload: async () => {}, publicUrl: (p) => `https://storage.test/${p}` },
    revalidate: (path) => { invalidated.push(path); },
  };
  await db.exec('set role service_role');
  const first = await publish(input("first"), store);
  assert.equal(first.article?.version, 1);
  assert.equal(first.status, 'pass');
  const staleStore = { ...store, commit: (id: string, payload: object) => store.commit(id, { ...payload, expected_updated_at: '2000-01-01T00:00:00Z' }) };
  assert.equal((await publish(input('stale-admin-change', 'stale overwrite'), staleStore)).status, 'blocked');
  assert.equal(await count("select count(*) from article_versions v join articles a on a.id=v.article_id where a.slug='publish-test'"), 1);
  assert.ok(invalidated.includes('/blog/publish-test'));
  assert.deepEqual(await publish({ ...input("first"), frontmatter: {} }, store), first);
  assert.equal((await publish(input("same"), store)).article?.version, 1);
  assert.equal((await publish(input("changed", "新预览\n\n<!-- paywall -->\n\nCHANGED_SECRET"), store)).article?.version, 2);
  assert.equal(await count("select count(*) from article_versions v join articles a on a.id=v.article_id where a.slug='publish-test'"), 2);
  assert.equal(await count("select count(*) from article_chunks c join articles a on a.id=c.article_id where a.slug='publish-test' and (c.chunk_type='body' or c.content like '%CHANGED_SECRET%')"), 0);
  const bad = await publish(input("bad", '<video src="unsafe.mp4"/>'), store);
  assert.equal(bad.status, "blocked");
  assert.deepEqual(await publish(input("bad"), store), bad);
  assert.equal((await publish({ ...input("series-missing"), frontmatter: { title: '章节', slug: 'chapter-test', type: 'chapter', access: 'public', series_slug: 'missing-series' } }, store)).diagnostics[0].code, 'SERIES_NOT_FOUND');
  // A cache failure occurs after commit; retry returns the same version and repairs invalidation.
  await assert.rejects(publish(input("cache-failure", "另一个预览\n\n<!-- paywall -->\n\nNEXT_SECRET"), { ...store, revalidate: () => { throw new Error('test invalidation failure'); } }));
  assert.equal((await publish(input("cache-failure"), store)).article?.version, 3);
  // A database failure halfway through the transaction leaves no body/version/request changes.
  await db.exec(`reset role; create function reject_test_version() returns trigger language plpgsql as $$ begin if new.client_request_id = 'rollback-test' then raise exception 'test rollback'; end if; return new; end $$; create trigger test_rollback before insert on article_versions for each row execute function reject_test_version(); set role service_role;`);
  await assert.rejects(publish(input("rollback-test", "ROLLBACK_SECRET"), store));
  assert.equal(await count("select count(*) from publish_requests where client_request_id='rollback-test'"), 0);
  assert.equal(await count("select count(*) from article_bodies where content='ROLLBACK_SECRET'"), 0);
  await db.exec("update articles set status='paused' where slug='publish-test'");
  assert.equal((await publish(input('paused-update', '新预览\n\n<!-- paywall -->\n\nPAUSED_SECRET'), store)).status, 'pass');
  assert.equal(await count("select count(*) from articles where slug='publish-test' and status='paused'"), 1);
  await db.exec("update articles set status='archived' where slug='publish-test'");
  assert.equal((await publish(input('archived-update'), store)).status, 'blocked');
  await db.exec("update articles set status='paused' where slug='publish-test'");
  const chapter: PublishInput = { ...input('readme-paid'), frontmatter: { title: 'README', slug: 'demo-selection-handbook-readme', type: 'chapter', series_slug: 'demo-selection-handbook', access: 'paid' } };
  assert.equal((await publish(chapter, store)).status, 'blocked');
  const chapterResponse = await publish({ ...chapter, client_request_id: 'new-chapter', frontmatter: { ...chapter.frontmatter, slug: 'publish-chapter', access: 'public' }, markdown: '公开章节' }, store);
  assert.equal(chapterResponse.article?.url, '/handbooks/demo-selection-handbook?article=publish-chapter');
  await db.exec('reset role; drop trigger test_rollback on article_versions; set role anon');
  assert.equal(await count("select count(*) from article_bodies where article_id=(select id from articles where slug='publish-test')"), 0);
  await assert.rejects(db.query('select commit_publication($1,$2::jsonb)', ['anon-attack', '{}']), /permission denied/);
  await db.exec('reset role; set role authenticated');
  await assert.rejects(db.query('select commit_publication($1,$2::jsonb)', ['user-attack', '{}']), /permission denied/);
});
