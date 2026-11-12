import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";

const template = JSON.parse(await readFile(new URL("../src/generated/starter-content.json", import.meta.url), "utf8"));
const parse = markdown => unified().use(remarkParse).use(remarkGfm).parse(markdown);

test("default handbook preserves stable public chapter identities and excludes private maintenance sources", () => {
  assert.deepEqual(template.articles.map(article => article.frontmatter.slug), [
    "getting-started-overview", "getting-started-preparation", "getting-started-supabase", "getting-started-vercel",
    "getting-started-publishing", "getting-started-navigation", "getting-started-optional", "getting-started-maintenance",
  ]);
  for (const article of template.articles) {
    assert.equal(article.frontmatter.access, "public");
    assert.equal(article.frontmatter.type, "chapter");
    assert.equal(article.frontmatter.series_slug, "getting-started");
    assert.doesNotMatch(article.markdown, /\.local-archive|\/Users\/|docs\/development\/|本次测试来源/);
  }
});

test("generated handbook links point to existing chapters and actual reading section IDs", () => {
  const headings = new Map(template.articles.map(article => {
    let count = 0;
    visit(parse(article.markdown), "heading", () => { count++; });
    return [article.frontmatter.slug, count];
  }));
  let internalLinks = 0, sectionLinks = 0;
  for (const article of template.articles) visit(parse(article.markdown), "link", link => {
    assert.match(link.url, /^(?:https?:|mailto:|\/|#)/, `Unresolved source link in ${article.frontmatter.slug}: ${link.url}`);
    if (!link.url.startsWith("/handbooks/getting-started")) return;
    const target = new URL(link.url, "https://site.invalid");
    const slug = target.searchParams.get("article");
    assert(headings.has(slug), `Unknown handbook chapter: ${slug}`);
    internalLinks++;
    if (target.hash) {
      assert.match(target.hash, /^#section-[1-9]\d*$/);
      assert(Number(target.hash.slice(9)) <= headings.get(slug), `Unknown reading section: ${link.url}`);
      sectionLinks++;
    }
  });
  assert(internalLinks > 0);
  assert(sectionLinks > 0);
});

test("installation and maintenance instructions are separated rather than duplicated into one chapter", () => {
  const chapter = slug => template.articles.find(article => article.frontmatter.slug === slug).markdown;
  assert.match(chapter("getting-started-supabase"), /Enable Data API/);
  assert.match(chapter("getting-started-supabase"), /supabase\/install\.sql/);
  assert.doesNotMatch(chapter("getting-started-supabase"), /## 3\. Vercel/);
  assert.match(chapter("getting-started-vercel"), /Email Templates/);
  assert.doesNotMatch(chapter("getting-started-vercel"), /## 6\.2 在线支付/);
  assert.match(chapter("getting-started-optional"), /BAAI\/bge-m3|同步内容变化/);
  assert.doesNotMatch(chapter("getting-started-maintenance"), /SET session_replication_role|pg_dump/);
});
