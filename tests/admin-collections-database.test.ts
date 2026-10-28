import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { installTestDatabase } from "./support/database";

const db = new PGlite({ extensions: { vector } });
const owner = "00000000-0000-4000-8000-000000000001";
const buyer = "b1111111-1111-4111-8111-111111111111";
let collectionId: number;
before(async () => {
  await installTestDatabase(db);
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'collection-buyer@example.test',now())",
    [buyer],
  );
  collectionId = (
    await db.query<{ id: number }>(
      "insert into public.series(slug,type,title,price,status) values('collection-probe','collection','Collection probe',2.34,'published') returning id",
    )
  ).rows[0].id;
});
after(async () => {
  await db.close();
});
const role = async (name: string, uid?: string) => {
  await db.exec(`reset role; reset request.jwt.claims; set role ${name}`);
  if (uid)
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: uid }),
    ]);
};

test("logical documents include pending-only files and merge changed published titles before pagination", async () => {
  await role("postgres");
  await db.query(
    "insert into public.articles(slug,series_id,type,title,status,access,published_at) values('collection-live',$1,'chapter','Original title','published','paid',now())",
    [collectionId],
  );
  for (const slug of ["collection-live", "collection-staged"]) {
    const id = (
      await db.query<{ id: number }>(
        "insert into public.content_files(scope,path,article_slug) values('series:collection-probe',$1,$2) returning id",
        [`${slug}.md`, slug],
      )
    ).rows[0].id;
    await db.query(
      "insert into public.content_file_revisions(file_id,version,input_hash,request_id,snapshot) values($1,1,repeat('a',64),$2,$3)",
      [
        id,
        slug,
        {
          frontmatter: { title: "New " + slug, access: "paid" },
          markdown: "PRIVATE_BODY_MUST_NOT_APPEAR_IN_LIST",
        },
      ],
    );
  }
  await role("authenticated", owner);
  const rows = (
    await db.query<Record<string, unknown>>(
      "select * from public.admin_documents where series_id=$1 order by document_key",
      [collectionId],
    )
  ).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((r) => r.article_id === null).length, 1);
  assert.equal(rows.filter((r) => r.pending_revision_id !== null).length, 2);
  assert.equal(
    JSON.stringify(rows).includes("PRIVATE_BODY_MUST_NOT_APPEAR_IN_LIST"),
    false,
  );
  assert.equal(
    (
      await db.query(
        "select * from public.admin_documents where search_text ilike '%Original title%'",
      )
    ).rows.length,
    1,
  );
  assert.equal(
    (
      await db.query(
        "select * from public.admin_documents where search_text ilike '%New collection-live%'",
      )
    ).rows.length,
    1,
  );
});

test("documents beyond previous limits remain reachable in stable pages", async () => {
  await role("postgres");
  await db.exec(
    "insert into public.articles(slug,type,title,status,published_at) select 'paging-'||n,'blog','分页测试 '||n,'published',now() from generate_series(1,101) n",
  );
  await role("authenticated", owner);
  const total = (
    await db.query<{ n: number }>(
      "select count(*)::int n from public.admin_documents where title like '分页测试 %'",
    )
  ).rows[0].n;
  assert.equal(total, 101);
  const last = (
    await db.query(
      "select document_key from public.admin_documents where title like '分页测试 %' order by updated_at desc,document_key desc limit 20 offset 100",
    )
  ).rows;
  assert.equal(last.length, 1);
});

test("non-owners cannot read the projection or call the email directory", async () => {
  await role("anon");
  await assert.rejects(
    db.query("select * from public.admin_documents"),
    /permission denied/,
  );
  await assert.rejects(
    db.query("select public.admin_user_directory()"),
    /permission denied/,
  );
  await role("authenticated", buyer);
  assert.equal(
    (await db.query("select * from public.admin_documents")).rows.length,
    0,
  );
  await assert.rejects(
    db.query("select public.admin_user_directory()"),
    /permission denied/,
  );
  await role("service_role");
  const directory = (
    await db.query<{
      result: { items: { id: string }[]; filteredTotal: number };
    }>(
      "select public.admin_user_directory('collection-buyer','','newest',0,20) result",
    )
  ).rows[0].result;
  assert.equal(directory.filteredTotal, 1);
  assert.equal(directory.items[0].id, buyer);
});

test("collection pricing uses the existing authority and duplicate settlement produces one entitlement and mail", async () => {
  await role("service_role");
  await assert.rejects(
    db.query("select public.create_pending_order($1,'series',$2,1)", [
      buyer,
      collectionId,
    ]),
    /NOT_SELLABLE/,
  );
  const order = (
    await db.query<{ result: { id: number; merchant_order_no: string } }>(
      "select public.create_pending_order($1,'series',$2,2.34) result",
      [buyer, collectionId],
    )
  ).rows[0].result;
  const settle = () =>
    db.query<{ result: string }>(
      "select public.settle_payment_reference($1,'collection-payment',2.34,jsonb_build_object('out_trade_no',$1::text)) result",
      [order.merchant_order_no],
    );
  assert.equal((await settle()).rows[0].result, "settled");
  assert.equal((await settle()).rows[0].result, "duplicate");
  assert.equal(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from public.entitlements where user_id=$1 and type='series' and target_id=$2",
        [buyer, collectionId],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from public.email_outbox where order_id=$1",
        [order.id],
      )
    ).rows[0].n,
    1,
  );
});
