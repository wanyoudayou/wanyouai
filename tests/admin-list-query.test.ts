import test from "node:test";
import assert from "node:assert/strict";
import {
  parseListQuery,
  escapeLike,
  lastPage,
  listQueryString,
} from "../src/lib/admin/list-query";
import { seriesPath, isSeriesSellableType } from "../src/lib/content-kinds";

test("list query validates bounds without dropping Chinese or literal search characters", () => {
  const query = parseListQuery({
    q: " 中文 %_\\ ",
    page: "-2",
    pageSize: "5000",
    sort: "arbitrary",
    status: ["published"],
  });
  assert.equal(query.q, "中文 %_\\");
  assert.equal(escapeLike(query.q), "中文 \\%\\_\\\\");
  assert.equal(query.page, 1);
  assert.equal(query.pageSize, 20);
  assert.equal(query.sort, "newest");
  assert.equal(query.status, "");
  assert.equal(lastPage(0, 20), 1);
  assert.equal(lastPage(21, 20), 2);
  assert.match(listQueryString(query, { page: 2 }), /page=2/);
});
test("all collection URLs and commerce decisions are explicit", () => {
  assert.equal(
    seriesPath({ type: "collection", slug: "getting-started" }),
    "/handbooks/getting-started",
  );
  assert.equal(isSeriesSellableType("collection"), true);
  assert.equal(isSeriesSellableType("event"), false);
  assert.throws(() => seriesPath({ type: "future-type", slug: "x" }));
});

test("selected object children cross the API page cap and fail explicitly on read errors", async () => {
  const { readRelatedPages } = await import("../src/lib/admin/related-pages");
  const source = Array.from({ length: 1001 }, (_, id) => ({ id }));
  const result = await readRelatedPages(async (from, to) => ({
    data: source.slice(from, to + 1),
    error: null,
  }));
  assert.equal(result.data.length, 1001);
  assert.equal(result.data.at(-1)?.id, 1000);
  await assert.rejects(
    readRelatedPages(async () => ({ data: null, error: new Error("offline") })),
    /暂时不可用/,
  );
});
