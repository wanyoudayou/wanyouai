import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { installTestDatabase } from "./support/database";
import { preparePublication } from "../src/lib/publishing/pipeline";
import { inspectMarkdown } from "../src/lib/publishing/markdown";
import { chapterSlug, rootMarkdownPath } from "../src/lib/importing/selection";
const db = new PGlite({ extensions: { vector } });
const owner = "00000000-0000-4000-8000-000000000001";
before(async () => {
  await installTestDatabase(db);
});
after(() => db.close());
const role = async (name: string, id?: string) => {
  await db.exec(`reset role; reset request.jwt.claims; set role ${name}`);
  if (id)
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: id }),
    ]);
};
const value = async <T>(sql: string, args: unknown[] = []) =>
  (await db.query<{ v: T }>(sql, args)).rows[0].v;
const album = async () => {
  await role("postgres");
  return value<{ id: number; slug: string; updated_at: string }>(
    "insert into series(slug,type,title,status) values($1,'handbook','Workflow','draft') returning to_jsonb(series) v",
    ["workflow-" + randomUUID()],
  );
};
const media = {
  download: async () => null,
  upload: async () => {},
  publicUrl: (p: string) => p,
};
async function stage(
  s: { slug: string },
  name: string,
  access: "public" | "paid" = "public",
  expected = 0,
) {
  await role("service_role");
  const snapshot = {
    frontmatter: {
      title: name,
      slug: s.slug + "-" + name,
      type: "chapter" as const,
      series_slug: s.slug,
      access,
    },
    markdown:
      "Preview\n\n<!-- paywall -->\n\nPRIVATE_WORKFLOW\n\n<!-- paywall -->\n\nEND",
    media: [],
  };
  const request = randomUUID();
  const payload = await preparePublication(
    { client_request_id: request, ...snapshot },
    media,
  );
  const id = await value<number>(
    "select stage_content_file($1,$2,$3,$4,$5,$6,$7) v",
    [
      `series:${s.slug}`,
      name + ".md",
      snapshot.frontmatter.slug,
      createHash("sha256").update(request).digest("hex"),
      snapshot,
      expected,
      request,
    ],
  );
  return { id, payload };
}
async function batch(
  s: { id: number; updated_at: string },
  items: object[],
  activate = false,
  readme: string | null = null,
  request = randomUUID(),
) {
  await role("service_role");
  return value<{ results: unknown[]; activated: boolean }>(
    "select commit_series_publication($1,$2,$3,$4,$5,$6) v",
    [s.id, s.updated_at, request, items, activate, readme],
  );
}
test("marker presence and repetition never block publication; only the first real marker exposes preview", () => {
  const md = "Intro\n\n<!-- paywall -->\n\nPRIVATE\n\n<!-- paywall -->\n\nMORE";
  for (const access of ["registered", "subscriber", "paid"]) {
    const result = inspectMarkdown(md, access);
    assert.equal(result.preview, "Intro");
    assert(result.diagnostics.every((d) => d.severity === "warning"));
    assert.equal(inspectMarkdown("PRIVATE", access).preview, "");
  }
  assert.equal(inspectMarkdown(md, "public").preview, md);
  assert.equal(
    inspectMarkdown(
      "```html\n<!-- paywall -->\n```\n\nIntro\n\n<!-- paywall -->\n\nPRIVATE",
      "paid",
    ).preview,
    "```html\n<!-- paywall -->\n```\n\nIntro",
  );
});
test("root selection excludes nested and unrelated files; automatic slugs are stable, bounded and namespaced", () => {
  assert.equal(rootMarkdownPath("Folder/readme.MD"), "readme.MD");
  for (const p of [
    "Folder/sub/a.md",
    "Folder/.secret.md",
    "Folder/file.pdf",
    "Folder/picture.png",
  ])
    assert.equal(rootMarkdownPath(p), null);
  assert.equal(chapterSlug("xyz", "README.md", "a".repeat(64)), "xyz-readme");
  assert.equal(
    chapterSlug("xyz", "chapter.md", "b".repeat(64)),
    "xyz-" + "b".repeat(24),
  );
  assert(
    chapterSlug("x".repeat(120), "chapter.md", "a".repeat(64)).length <= 120,
  );
});
test("combined owner settings are optimistic, atomic and denied to non-owners", async () => {
  const s = await album();
  const fields = {
    title: "Updated",
    task: "Intro",
    tags: ["tag"],
    audiences: [],
    nav_enabled: true,
    nav_label: "Guide",
    nav_order: 2,
    featured: true,
    price: "2.50",
    readme_article_id: null,
  };
  await role("authenticated", "00000000-0000-4000-8000-000000000002");
  await assert.rejects(
    value("select save_series_settings($1,$2,$3) v", [
      s.id,
      s.updated_at,
      fields,
    ]),
    /OWNER_REQUIRED/,
  );
  await role("authenticated", owner);
  const bad = await value<{ ok: boolean }>(
    "select save_series_settings($1,$2,$3) v",
    [s.id, s.updated_at, { ...fields, readme_article_id: 999999 }],
  );
  assert.equal(bad.ok, false);
  assert.equal(
    await value("select title v from series where id=$1", [s.id]),
    "Workflow",
  );
  const good = await value<{ ok: boolean }>(
    "select save_series_settings($1,$2,$3) v",
    [s.id, s.updated_at, fields],
  );
  assert.equal(good.ok, true);
  const stale = await value<{ ok: boolean }>(
    "select save_series_settings($1,$2,$3) v",
    [s.id, s.updated_at, { ...fields, title: "Stale" }],
  );
  assert.equal(stale.ok, false);
});
test("batch publication activates only after all selected chapters commit; replay does not add versions or expose paid bodies", async () => {
  const s = await album();
  const intro = await stage(s, "readme");
  const chapter = await stage(s, "chapter", "paid");
  const request = randomUUID();
  const result = await batch(
    s,
    [intro, chapter],
    true,
    s.slug + "-readme",
    request,
  );
  assert.equal(result.results.length, 2);
  assert.equal(result.activated, true);
  assert.deepEqual(
    await batch(s, [intro, chapter], true, s.slug + "-readme", request),
    result,
  );
  await assert.rejects(
    batch(s, [intro], true, s.slug + "-readme", request),
    /REPLAY_CHANGED/,
  );
  await role("postgres");
  assert.equal(
    await value(
      "select count(*)::int v from article_versions where article_id in(select id from articles where series_id=$1)",
      [s.id],
    ),
    2,
  );
  await role("anon");
  assert.equal(
    await value(
      "select count(*)::int v from article_bodies where article_id=(select id from articles where slug=$1)",
      [s.slug + "-chapter"],
    ),
    0,
  );
  assert.equal(
    await value("select preview_md v from articles where slug=$1", [
      s.slug + "-chapter",
    ]),
    "Preview",
  );
  await assert.rejects(
    value("select series_pending_revisions($1) v", [s.id]),
    /permission denied/,
  );
  await role("authenticated", owner);
  await assert.rejects(batchAsOwner(s, intro), /permission denied/);
});
async function batchAsOwner(
  s: { id: number; updated_at: string },
  item: object,
) {
  return value("select commit_series_publication($1,$2,$3,$4,false,null) v", [
    s.id,
    s.updated_at,
    randomUUID(),
    [item],
  ]);
}
test("invalid second chapter rolls back the first chapter and receipts; no partial activation", async () => {
  const s = await album();
  const first = await stage(s, "readme"),
    second = await stage(s, "second");
  const newer = await stage(s, "second", "public", second.id);
  await assert.rejects(
    batch(s, [first, second], true, s.slug + "-readme"),
    /REVISION_CHANGED/,
  );
  await role("postgres");
  assert.equal(
    await value("select count(*)::int v from articles where series_id=$1", [
      s.id,
    ]),
    0,
  );
  assert.equal(
    await value(
      "select publication v from content_file_revisions where id=$1",
      [first.id],
    ),
    null,
  );
  assert.equal(
    await value("select status v from series where id=$1", [s.id]),
    "draft",
  );
  await batch(s, [first, newer], true, s.slug + "-readme");
});
test("cross-series, modified snapshots, missing README and stale online versions are rejected", async () => {
  const a = await album(),
    b = await album();
  const first = await stage(a, "readme"),
    foreign = await stage(b, "chapter");
  await assert.rejects(batch(a, [first, foreign]), /SCOPE_CHANGED/);
  await assert.rejects(batch(a, [first], true, "missing"), /README_INVALID/);
  await assert.rejects(
    batch(a, [{ ...first, payload: { ...first.payload, snapshot: {} } }]),
    /SCOPE_CHANGED/,
  );
  await batch(a, [first]);
  const update = await stage(a, "readme", "public", first.id);
  await role("postgres");
  await db.query("update articles set title=$1 where slug=$2", [
    "Web changed",
    a.slug + "-readme",
  ]);
  await assert.rejects(batch(a, [update]), /ONLINE_CHANGED/);
});
