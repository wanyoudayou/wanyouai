import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { isSeriesType, seriesPath } from "../src/lib/content-kinds";

type Row = { id: number; title: string; slug: string; type: string; status: string };
type Target = { sku_type: string; target_id: number | null };
type Content = { name: string; href: string | null; actionLabel: string };

async function load(articles: Row[], series: Row[]) {
  const source = await readFile(new URL("../src/lib/orders/describe.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { getOrderContents?: (client: unknown, orders: Target[]) => Promise<Content[]> } = {};
  runInNewContext(code, { exports, require: (name: string) => {
    if (name === "server-only") return {};
    if (name === "@/lib/content-kinds") return { isSeriesType, seriesPath };
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  const queries: string[] = [];
  const client = { from(table: string) {
    assert(["articles", "series"].includes(table));
    return { select(columns: string) {
      assert.equal(columns, "id,title,slug,type,status", "Only public metadata is needed");
      return { async in(column: string, ids: number[]) {
        assert.equal(column, "id"); queries.push(table);
        return { data: (table === "articles" ? articles : series).filter(row => ids.includes(row.id)) };
      } };
    } };
  } };
  return { get: (orders: Target[]) => exports.getOrderContents!(client, orders), queries };
}

test("order links use article and every supported album route with bounded metadata queries", async () => {
  const rows = ["collection", "handbook", "skill", "event"].map((type, index) => ({ id: index + 2, type, title: type, slug: type, status: "published" }));
  const fixture = await load([{ id: 1, title: "文章", slug: "a b", type: "blog", status: "published" }], rows);
  const orders = [{ sku_type: "single", target_id: 1 }, ...rows.map(row => ({ sku_type: row.type === "event" ? "event" : "series", target_id: row.id })), { sku_type: "single", target_id: 1 }];
  const result = await fixture.get(orders);
  assert.equal(result.map(item => item.href).join("|"), "/blog/a%20b|/handbooks/collection|/handbooks/handbook|/skills/skill|/events/event|/blog/a%20b");
  assert.equal(result[0].name, "单篇 · 文章");
  assert.equal(fixture.queries.length, 2, "One article and one series query for the whole list");
});

test("unavailable, mismatched and archived destinations have no fabricated link; paused content stays readable", async () => {
  const fixture = await load([
    { id: 1, title: "归档", slug: "archived", type: "blog", status: "archived" },
    { id: 2, title: "暂停", slug: "paused", type: "blog", status: "paused" },
    { id: 3, title: "章节", slug: "chapter", type: "chapter", status: "published" },
  ], [{ id: 4, title: "未知类型", slug: "unknown", type: "unknown", status: "published" }]);
  const result = await fixture.get([{ sku_type: "single", target_id: 1 }, { sku_type: "single", target_id: 2 }, { sku_type: "single", target_id: 3 }, { sku_type: "single", target_id: 999 }, { sku_type: "series", target_id: 4 }]);
  assert.equal(result.map(item => item.href ?? "none").join("|"), "none|/blog/paused|none|none|none");
});

test("subscription and empty order lists do not query unrelated content", async () => {
  const fixture = await load([], []);
  assert.equal((await fixture.get([])).length, 0);
  const result = await fixture.get([{ sku_type: "subscription", target_id: null }]);
  assert.equal(result[0].href, "/me");
  assert.equal(fixture.queries.length, 0);
});
