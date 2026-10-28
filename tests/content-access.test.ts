import assert from "node:assert/strict";
import test from "node:test";
import { visible, readVisibleArticle, hasEntitlement } from "../src/lib/reading/access";
import type { Entitlement, Reader, ReadingArticle, ReadingSeries } from "../src/types/reading";

const now = Date.parse("2026-09-13T00:00:00Z");
const anon: Reader = { userId: null, owner: false, entitlements: [] };
const registered: Reader = { ...anon, userId: "reader-a" };
const entitlement = (type: Entitlement["type"], target_id: number | null): Entitlement => ({ user_id: "reader-a", type, target_id, ends_at: null, revoked_at: null });
const subscriber = { ...registered, entitlements: [entitlement("subscription", null)] };
const seriesBuyer = { ...registered, entitlements: [entitlement("series", 10)] };
const singleBuyer = { ...registered, entitlements: [entitlement("single", 1)] };
const ticketHolder = { ...registered, entitlements: [entitlement("event", 10)] };
const article: ReadingArticle = { id: 1, slug: "content", series_id: null, type: "blog", title: "Content", summary: null, cover_url: null, tags: [], access: "paid", price: 10, status: "published", published_at: "2026-09-01T00:00:00Z", preview_md: "PUBLIC PREVIEW" };
const series: ReadingSeries = { id: 10, slug: "collection", title: "Collection", type: "handbook", readme_article_id: 2, price: 99, status: "published", tags: [], task: null, audiences: [], featured: false, created_at: "", updated_at: "" };
const chapter: ReadingArticle = { ...article, type: "chapter", series_id: 10, price: null };

test("阅读权限矩阵：匿名、注册、订阅、专辑、单篇、活动票", () => {
  const readers = [anon, registered, subscriber, seriesBuyer, singleBuyer, ticketHolder];
  const cases: [ReadingArticle, ReadingSeries | null, number[]][] = [
    [{ ...article, access: "public" }, null, [1,1,1,1,1,1]],
    [{ ...article, access: "registered" }, null, [0,1,1,1,1,1]],
    [{ ...article, access: "subscriber" }, null, [0,0,1,0,0,0]],
    [article, null, [0,0,1,0,1,0]],
    [chapter, series, [0,0,1,1,0,0]],
    [{ ...chapter, id: 2, access: "subscriber" }, series, [1,1,1,1,1,1]],
    [{ ...chapter, access: "subscriber" }, { ...series, type: "event" }, [0,0,1,0,0,1]],
    [{ ...chapter, access: "subscriber" }, series, [0,0,1,0,0,0]],
  ];
  for (const [item, parent, expected] of cases) assert.deepEqual(readers.map((reader) => Number(visible(reader, item, parent, now) === "full")), expected);
});

test("已撤销、到期、错误用户和无关目标不能解锁；到期订阅不抹掉永久权益", () => {
  for (const extra of [{ revoked_at: "2026-01-01" }, { ends_at: "2026-09-13T00:00:00Z" }, { ends_at: "invalid" }, { user_id: "reader-b" }, { target_id: 99 }]) {
    assert.equal(visible({ ...registered, entitlements: [{ ...entitlement("single", 1), ...extra }] }, article, null, now), "preview");
  }
  const reader = { ...registered, entitlements: [{ ...entitlement("subscription", null), ends_at: "2020-01-01" }, entitlement("single", 1)] };
  assert.equal(visible(reader, article, null, now), "full");
  assert.equal(hasEntitlement(reader, "subscription", null, now), false);
  const expiredWithSeries = { ...registered, entitlements: [{ ...entitlement("subscription", null), ends_at: "2020-01-01" }, entitlement("series", series.id)] };
  assert.equal(visible(expiredWithSeries, chapter, series, now), "full");
  assert.equal(visible({ ...registered, entitlements: [{ ...entitlement("subscription", null), ends_at: new Date(now).toISOString() }] }, { ...article, access: "subscriber" }, null, now), "preview");
});

test("paused 停售仍读；draft/archived 与错误父专辑一律隐藏，包括站主和 README", () => {
  assert.equal(visible(singleBuyer, { ...article, status: "paused" }), "full");
  for (const status of ["draft", "archived"] as const) {
    assert.equal(visible({ ...registered, owner: true }, { ...article, status }), "hidden");
    assert.equal(visible(subscriber, { ...chapter, id: 2 }, { ...series, status }), "hidden");
  }
  assert.equal(visible(subscriber, chapter, { ...series, id: 99 }), "hidden");
  assert.equal(visible(subscriber, chapter, null), "hidden");
});

test("未授权或隐藏对象结构上不查询正文；RLS 再拒绝时保守降级", async () => {
  let calls = 0;
  const readBody = async () => { calls++; return "RESTRICTED BODY"; };
  assert.equal((await readVisibleArticle(anon, article, null, readBody))?.markdown, "PUBLIC PREVIEW");
  assert.equal(await readVisibleArticle(subscriber, { ...article, status: "archived" }, null, readBody), null);
  assert.equal(calls, 0);
  assert.equal((await readVisibleArticle(singleBuyer, article, null, readBody))?.markdown, "RESTRICTED BODY");
  assert.equal(calls, 1);
  assert.equal((await readVisibleArticle(singleBuyer, article, null, async () => null))?.full, false);
  await assert.rejects(() => readVisibleArticle(anon, { ...article, access: "public" }, null, async () => null));
});
