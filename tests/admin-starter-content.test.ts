import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { installTestDatabase } from "./support/database";
import { publish, type PublisherStore } from "../src/lib/publishing/pipeline";
import { contentHash } from "../src/lib/publishing/validate";
import { sanitizeCustomHtml } from "../src/lib/custom-pages/sanitize";
import type {
  PublishInput,
  PublishResponse,
} from "../src/lib/publishing/types";
import template from "../src/generated/starter-content.json";

const inputs = template.articles as PublishInput[];
async function database() {
  const db = new PGlite({ extensions: { vector } });
  await installTestDatabase(db);
  return db;
}
const prepare = (db: PGlite) =>
  db.query("select public.prepare_starter_content($1,$2,$3)", [
    template.hash,
    sanitizeCustomHtml(template.pricing),
    inputs.map((input) => ({
      slug: input.frontmatter.slug,
      title: input.frontmatter.title,
      content_hash: contentHash(input),
    })),
  ]);
function store(db: PGlite): PublisherStore {
  return {
    async replay(id) {
      return (
        (
          await db.query<{ response: PublishResponse }>(
            "select response from public.publish_requests where client_request_id=$1",
            [id],
          )
        ).rows[0]?.response ?? null
      );
    },
    async commit(id, payload) {
      return (
        await db.query<{ result: PublishResponse }>(
          "select public.commit_starter_publication($1,$2) result",
          [id, payload],
        )
      ).rows[0].result;
    },
    revalidate() {},
    media: {
      publicUrl: (path) => `https://example.test/${path}`,
      download: async () => null,
      upload: async () => {},
    },
  };
}

test("starter resumes after lost responses, preserves one version and activates both navigation entries only when complete", async () => {
  const db = await database();
  try {
    await db.exec("set role service_role");
    await prepare(db);
    await prepare(db);
    const publisher = store(db);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.series where slug='getting-started' and nav_enabled",
        )
      ).rows[0].n,
      0,
    );
    const first = await publish(inputs[0], publisher);
    assert.notEqual(first.status, "blocked");
    assert.deepEqual(await publish(inputs[0], store(db)), first);
    for (const input of inputs.slice(1)) {
      const result = await publish(input, publisher);
      assert.notEqual(result.status, "blocked", JSON.stringify(result));
      assert.match(result.article!.url, /^\/handbooks\/getting-started/);
    }
    const job = (
      await db.query<{ completed: boolean; published_count: number }>(
        "select completed,published_count from public.starter_imports",
      )
    ).rows[0];
    assert.equal(job.completed, true);
    assert.equal(job.published_count, 8);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.article_versions where article_id in(select id from public.articles where slug like 'getting-started-%')",
        )
      ).rows[0].n,
      8,
    );
    await prepare(db);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.custom_pages where slug='pricing' and status='published' and placement='nav'",
        )
      ).rows[0].n,
      1,
    );
    await db.exec("reset role;set role anon");
    assert.equal(
      (
        await db
          .query("select * from public.starter_imports")
          .catch(() => ({ rows: [] }))
      ).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select public.prepare_starter_content($1,$2,$3)", [
        template.hash,
        template.pricing,
        [],
      ]),
      /permission denied/,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.article_bodies b join public.articles a on a.id=b.article_id where a.slug like 'getting-started-%'",
        )
      ).rows[0].n,
      8,
    );
  } finally {
    await db.close();
  }
});

test("starter refuses existing slugs and modifications without overwriting user content", async () => {
  const db = await database();
  try {
    await db.exec(
      "begin;insert into public.custom_pages(slug,title,html) values('pricing','My pricing','<p>Mine</p>');set role service_role",
    );
    await assert.rejects(prepare(db), /STARTER_SLUG_CONFLICT/);
    await db.exec("rollback;reset role;set role service_role");
    await prepare(db);
    await db.exec(
      "update public.articles set title='User edited' where slug='getting-started-overview'",
    );
    await assert.rejects(
      publish(inputs[0], store(db)),
      /STARTER_CONTENT_CHANGED/,
    );
    assert.equal(
      (
        await db.query<{ title: string }>(
          "select title from public.articles where slug='getting-started-overview'",
        )
      ).rows[0].title,
      "User edited",
    );
    assert.equal(
      (
        await db.query<{ published_count: number }>(
          "select published_count from public.starter_imports",
        )
      ).rows[0].published_count,
      0,
    );
  } finally {
    await db.close();
  }
});

test("starter stops final activation when a previously published chapter was edited", async () => {
  const db = await database();
  try {
    await db.exec("set role service_role");
    await prepare(db);
    for (const input of inputs.slice(0, 7)) await publish(input, store(db));
    await db.exec(
      "update public.articles set title='Retained user edit' where slug='getting-started-overview'",
    );
    await assert.rejects(
      publish(inputs[7], store(db)),
      /STARTER_CONTENT_CHANGED/,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.series where slug='getting-started' and nav_enabled",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query<{ published_count: number }>(
          "select published_count from public.starter_imports",
        )
      ).rows[0].published_count,
      7,
    );
    assert.equal(
      (
        await db.query<{ title: string }>(
          "select title from public.articles where slug='getting-started-overview'",
        )
      ).rows[0].title,
      "Retained user edit",
    );
  } finally {
    await db.close();
  }
});

for (const scope of ["blog", "series:demo-selection-handbook"]) {
  test(`starter preserves pending-only content in ${scope} when its slug conflicts`, async () => {
    const db = await database();
    try {
      await db.exec("set role service_role");
      const slug = inputs[0].frontmatter.slug;
      const snapshot = {
        frontmatter: {
          title: "站主已有的待审核内容",
          slug,
          type: scope === "blog" ? "blog" : "chapter",
          access: "public",
          ...(scope === "blog"
            ? {}
            : { series_slug: "demo-selection-handbook" }),
        },
        markdown: "保留站主未发布的正文，不被示例初始化占用。",
        media: [],
      } as Omit<PublishInput, "client_request_id">;
      const request = `pending-starter-conflict-${scope === "blog" ? "blog" : "chapter"}`;
      const revision = (
        await db.query<{ id: number }>(
          "select public.stage_content_file($1,'existing.md',$2,$3,$4,0,$5) id",
          [scope, slug, "a".repeat(64), snapshot, request],
        )
      ).rows[0].id;
      await assert.rejects(prepare(db), /STARTER_SLUG_CONFLICT/);
      assert.equal(
        (await db.query("select * from public.starter_imports")).rows.length,
        0,
      );
      assert.equal(
        (
          await db.query(
            "select * from public.series where slug='getting-started'",
          )
        ).rows.length,
        0,
      );
      assert.equal(
        (
          await db.query(
            "select * from public.custom_pages where slug='pricing'",
          )
        ).rows.length,
        0,
      );
      assert.equal(
        (await db.query("select * from public.articles where slug=$1", [slug]))
          .rows.length,
        0,
      );
      assert.deepEqual(
        (
          await db.query<{ snapshot: unknown }>(
            "select snapshot from public.content_file_revisions where id=$1",
            [revision],
          )
        ).rows[0].snapshot,
        snapshot,
      );
      const pendingStore: PublisherStore = {
        ...store(db),
        async commit(_id, payload) {
          return (
            await db.query<{ result: PublishResponse }>(
              "select public.commit_file_publication($1,$2) result",
              [revision, payload],
            )
          ).rows[0].result;
        },
      };
      const result = await publish(
        { client_request_id: request, ...snapshot },
        pendingStore,
      );
      assert.notEqual(result.status, "blocked", JSON.stringify(result));
      assert.equal(result.article?.version, 1);
      assert.equal(
        (
          await db.query<{ content: string }>(
            "select content from public.article_bodies where article_id=(select id from public.articles where slug=$1)",
            [slug],
          )
        ).rows[0].content,
        snapshot.markdown,
      );
    } finally {
      await db.close();
    }
  });
}
