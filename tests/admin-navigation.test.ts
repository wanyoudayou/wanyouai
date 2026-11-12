import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { installTestDatabase } from "./support/database";
import { activeHref, matchesPath } from "../src/lib/navigation/match";
import { validateNavItems } from "../src/lib/navigation/validate";
import { buildNavigation, toNavLink, type PublicNavRow } from "../src/lib/navigation/links";
import { navLinks } from "../src/lib/navigation/types";
import { decideSectionAccess } from "../src/lib/sections/access";

const owner = "00000000-0000-4000-8000-000000000001";
const member = "00000000-0000-4000-8000-000000000002";
const db = new PGlite({ extensions: { vector } });
before(() => installTestDatabase(db));
after(() => db.close());

const role = async (name: string, id?: string) => {
  await db.exec(`reset role; reset request.jwt.claims; set role ${name}`);
  if (id) await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id })]);
};
const value = async <T>(sql: string, args: unknown[] = []) => (await db.query<{ v: T }>(sql, args)).rows[0].v;

test("active navigation is the longest matching path segment prefix", () => {
  const hrefs = ["/", "/handbooks", "/handbooks/guide", "/lab/git", "/p/pricing"];
  assert.equal(activeHref("/", hrefs), "/");
  assert.equal(activeHref("/handbooks", hrefs), "/handbooks");
  assert.equal(activeHref("/handbooks/guide/chapter-1", hrefs), "/handbooks/guide");
  assert.equal(activeHref("/handbooks/other", hrefs), "/handbooks");
  assert.equal(activeHref("/lab/git/step/2", hrefs), "/lab/git");
  assert.equal(activeHref("/lab/github", hrefs), null, "segment match, not string prefix");
  assert.equal(activeHref("/blog", hrefs), null);
  assert.equal(matchesPath("/x", "https://example.com/x"), false);
});

test("navigation input is validated and normalised before the database", () => {
  const ok = validateNavItems([
    { kind: "external", label: " 工具 ", icon: "external-link", url: "https://example.com/a b".replace(" ", "") },
    { kind: "page", label: "方案", icon: "credit-card", page_id: 3 },
    { kind: "series", label: "指南", icon: "book-open", series_id: 4, enabled: false },
    { kind: "section", label: "实验", icon: "flask", section: "git-lab", access: "subscriber" },
  ]);
  assert.ok(ok.ok);
  assert.deepEqual(
    ok.items.map((item) => [item.kind, item.label, item.url ?? item.page_id ?? item.series_id ?? item.section, item.access, item.enabled]),
    [
      ["external", "工具", "https://example.com/ab", "public", true],
      ["page", "方案", 3, "public", true],
      ["series", "指南", 4, "public", false],
      ["section", "实验", "git-lab", "subscriber", true],
    ],
  );
  const rejects: [unknown, RegExp][] = [
    [[{ kind: "external", label: "x", icon: "link", url: "http://example.com" }], /https/],
    [[{ kind: "external", label: "x", icon: "link", url: "javascript:alert(1)" }], /https/],
    [[{ kind: "page", label: "x", icon: "link", page_id: 1, access: "login" }], /访问级别只适用于代码栏目/],
    [[{ kind: "page", label: "x", icon: "bogus", page_id: 1 }], /图标/],
    [[{ kind: "page", label: "", icon: "link", page_id: 1 }], /名称/],
    [[{ kind: "section", label: "x", icon: "link", section: "../etc" }], /栏目名称无效/],
    [[{ kind: "page", label: "a", icon: "link", page_id: 1 }, { kind: "page", label: "b", icon: "link", page_id: 1 }], /同一目标/],
    [Array.from({ length: 51 }, (_, i) => ({ kind: "page", label: "x", icon: "link", page_id: i + 1 })), /最多 50 项/],
    [{ not: "an array" }, /无效/],
  ];
  for (const [input, message] of rejects) {
    const result = validateNavItems(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, message);
  }
});

test("public rows become links; unknown sections and unsafe URLs are dropped", () => {
  const row = (patch: Partial<PublicNavRow>): PublicNavRow => ({
    id: 1, parent_id: null, kind: "page", label: "L", icon: "link", url: null, page_slug: null,
    series_slug: null, series_type: null, section: null, access: "public", ...patch,
  });
  assert.deepEqual(toNavLink(row({ kind: "page", page_slug: "pricing" })), { label: "L", icon: "link", kind: "page", href: "/p/pricing", external: false });
  assert.equal(toNavLink(row({ kind: "series", series_slug: "guide", series_type: "event" }))?.href, "/events/guide");
  assert.equal(toNavLink(row({ kind: "external", url: "https://example.com" }))?.external, true);
  assert.equal(toNavLink(row({ kind: "external", url: "http://example.com" })), null);
  assert.equal(toNavLink(row({ kind: "section", section: "git-lab" }), () => false), null);
  assert.equal(toNavLink(row({ kind: "section", section: "git-lab" }), () => true)?.href, "/lab/git-lab");
});

test("section access: 404 unless registered and enabled, owner preview, login and subscriber gates", () => {
  const base = { registered: true, enabled: true, access: "public" as const, loggedIn: false, subscribed: false, owner: false };
  assert.deepEqual(decideSectionAccess({ ...base, registered: false, owner: true }), { state: "missing" });
  assert.deepEqual(decideSectionAccess({ ...base, enabled: false }), { state: "missing" });
  assert.deepEqual(decideSectionAccess({ ...base, enabled: false, owner: true }), { state: "open", preview: true });
  assert.deepEqual(decideSectionAccess(base), { state: "open", preview: false });
  assert.deepEqual(decideSectionAccess({ ...base, access: "login" }), { state: "login" });
  assert.deepEqual(decideSectionAccess({ ...base, access: "login", loggedIn: true }), { state: "open", preview: false });
  assert.deepEqual(decideSectionAccess({ ...base, access: "subscriber" }), { state: "login" });
  assert.deepEqual(decideSectionAccess({ ...base, access: "subscriber", loggedIn: true }), { state: "subscribe" });
  assert.deepEqual(decideSectionAccess({ ...base, access: "subscriber", loggedIn: true, subscribed: true }), { state: "open", preview: false });
  assert.deepEqual(decideSectionAccess({ ...base, access: "subscriber", owner: true }), { state: "open", preview: false });
});

test("nav_items is owner-only; the public projection exposes enabled live targets only", async () => {
  await role("postgres");
  const page = await value<number>("insert into custom_pages(slug,title,html,status) values('nav-live','Live','<p>x</p>','published') returning id v");
  const draft = await value<number>("insert into custom_pages(slug,title,html,status) values('nav-draft','Draft','<p>x</p>','draft') returning id v");
  const series = await value<number>("insert into series(slug,type,title,status) values('nav-guide','handbook','Guide','published') returning id v");
  await role("authenticated", owner);
  const version = await value<string>("select public.nav_items_version() v");
  const items = [
    { kind: "page", label: "Live", icon: "file-text", page_id: page },
    { kind: "page", label: "Draft", icon: "file-text", page_id: draft },
    { kind: "series", label: "Guide", icon: "book-open", series_id: series, enabled: false },
    { kind: "external", label: "Tools", icon: "external-link", url: "https://example.com/tools" },
    { kind: "section", label: "Lab", icon: "flask", section: "git-lab", access: "login" },
  ];
  const saved = await value<{ ok: boolean; version: string }>("select public.save_nav_items($1,$2) v", [version, JSON.stringify(items)]);
  assert.equal(saved.ok, true);
  const stale = await value<{ ok: boolean; message: string }>("select public.save_nav_items($1,$2) v", [version, "[]"]);
  assert.equal(stale.ok, false, "stale version is refused");
  assert.match(stale.message, /刷新/);
  assert.deepEqual(
    (await db.query<{ label: string; sort_order: number }>("select label,sort_order from nav_items order by sort_order")).rows.map((row) => row.label),
    ["Live", "Draft", "Guide", "Tools", "Lab"],
  );

  for (const [name, id] of [["anon", undefined], ["authenticated", member]] as const) {
    await role(name, id);
    assert.deepEqual(
      (await db.query<{ kind: string; label: string; page_slug: string | null; access: string }>("select kind,label,page_slug,access from public.public_navigation()")).rows,
      [
        { kind: "page", label: "Live", page_slug: "nav-live", access: "public" },
        { kind: "external", label: "Tools", page_slug: null, access: "public" },
        { kind: "section", label: "Lab", page_slug: null, access: "login" },
      ],
    );
    const columns = (await db.query("select * from public.public_navigation() limit 1")).fields.map((field) => field.name);
    assert.ok(!columns.includes("enabled") && !columns.includes("updated_at"));
  }
  await role("anon");
  await assert.rejects(db.query("select * from nav_items"), /permission denied/);
  await assert.rejects(db.query("select public.save_nav_items('x','[]')"), /permission denied/);
  await role("authenticated", member);
  assert.equal((await db.query("select * from nav_items")).rows.length, 0, "RLS hides rows from non-owners");
  await assert.rejects(db.query("select public.save_nav_items('x','[]')"), /OWNER_REQUIRED/);
  await assert.rejects(db.query("insert into nav_items(kind,label,url) values('external','x','https://e.com')"), /row-level security/);

  await role("authenticated", owner);
  const current = await value<string>("select public.nav_items_version() v");
  for (const bad of [
    [{ kind: "external", label: "x", url: "http://example.com" }],
    [{ kind: "page", label: "x", page_id: page, access: "login" }],
    [{ kind: "page", label: "x", page_id: page }, { kind: "page", label: "y", page_id: page }],
    [{ kind: "section", label: "x", section: "Bad Name" }],
  ])
    await assert.rejects(db.query("select public.save_nav_items($1,$2)", [current, JSON.stringify(bad)]));
  assert.equal(await value<string>("select public.nav_items_version() v"), current, "failed saves roll back");

  await role("postgres");
  await db.exec(`delete from custom_pages where id=${page}`);
  assert.equal(await value<number>("select count(*)::int v from nav_items where kind='page' and label='Live'"), 0, "deleting a page removes its entry");
});

test("upgrade copies album and page sidebar choices into nav_items without changing existing rows", async () => {
  const legacy = new PGlite({ extensions: { vector } });
  try {
    await installTestDatabase(legacy, { fixtures: false, throughVersion: "20261111000200" });
    await legacy.exec(`
      insert into series(slug,type,title,status,nav_enabled,nav_label,nav_order) values
        ('old-guide','handbook','Old guide','published',true,'指南',5),
        ('old-event','event','Old event','published',true,null,7),
        ('hidden','handbook','Hidden','published',false,null,0);
      insert into custom_pages(slug,title,html,status,placement,nav_label,nav_order) values
        ('old-page','Old page','<p>x</p>','published','nav','方案',3),
        ('footer-page','Footer page','<p>x</p>','published','footer','页脚',1);
    `);
    const migration = await readFile(new URL("../supabase/migrations/20261111120000_navigation_items.sql", import.meta.url), "utf8");
    await legacy.exec(migration);
    assert.deepEqual(
      (await legacy.query<{ kind: string; label: string; icon: string; sort_order: number }>("select kind,label,icon,sort_order from nav_items order by sort_order")).rows,
      [
        { kind: "page", label: "方案", icon: "file-text", sort_order: 3 },
        { kind: "series", label: "指南", icon: "book-open", sort_order: 5 },
        { kind: "series", label: "Old event", icon: "calendar", sort_order: 7 },
      ],
    );
    // Legacy values stay as they were (data-preserving upgrade; rollback-compatible); the app ignores them.
    assert.deepEqual(
      (await legacy.query<{ slug: string; placement: string }>("select slug,placement from custom_pages order by slug")).rows,
      [
        { slug: "footer-page", placement: "footer" },
        { slug: "old-page", placement: "nav" },
      ],
    );
    assert.equal(
      (await legacy.query<{ n: number }>("select count(*)::int n from series where nav_enabled")).rows[0].n,
      2,
    );
  } finally {
    await legacy.close();
  }
});

test("two-level input: children follow their group, one level only", () => {
  const ok = validateNavItems([
    { kind: "group", label: "资源", icon: "folder" },
    { kind: "page", label: "方案", icon: "credit-card", page_id: 3, child: true },
    { kind: "external", label: "文档", icon: "external-link", url: "https://example.com/docs", child: true },
    { kind: "section", label: "实验", icon: "flask", section: "git-lab", access: "login", child: true },
    { kind: "external", label: "顶层", icon: "link", url: "https://example.com/top" },
  ]);
  assert.ok(ok.ok);
  assert.deepEqual(ok.items.map((item) => [item.kind, item.child]), [["group", false], ["page", true], ["external", true], ["section", true], ["external", false]]);
  const rejects: [unknown[], RegExp][] = [
    [[{ kind: "page", label: "x", icon: "link", page_id: 1, child: true }], /父级目录之后/],
    [[{ kind: "group", label: "a", icon: "folder" }, { kind: "group", label: "b", icon: "folder", child: true }], /不能再放进/],
    [[{ kind: "group", label: "a", icon: "folder" }, { kind: "page", label: "x", icon: "link", page_id: 1 }, { kind: "page", label: "y", icon: "link", page_id: 2, child: true }], /父级目录之后/],
    [[{ kind: "group", label: "a", icon: "folder", access: "login" }], /访问级别/],
  ];
  for (const [input, message] of rejects) {
    const result = validateNavItems(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, message);
  }
});

test("public rows become a two-level tree; empty groups and unresolvable children disappear", () => {
  const row = (patch: Partial<PublicNavRow>): PublicNavRow => ({
    id: 1, parent_id: null, kind: "page", label: "L", icon: "link", url: null, page_slug: null,
    series_slug: null, series_type: null, section: null, access: "public", ...patch,
  });
  const tree = buildNavigation([
    row({ id: 1, kind: "page", label: "首", page_slug: "first" }),
    row({ id: 2, kind: "group", label: "资源", icon: "folder" }),
    row({ id: 3, parent_id: 2, kind: "external", label: "文档", url: "https://example.com/docs" }),
    row({ id: 4, parent_id: 2, kind: "section", label: "实验", section: "git-lab" }),
    row({ id: 5, parent_id: 2, kind: "section", label: "已删除", section: "gone" }),
    row({ id: 6, kind: "group", label: "空目录" }),
    row({ id: 7, parent_id: 99, kind: "page", label: "孤儿", page_slug: "orphan" }),
  ], (name) => name === "git-lab");
  assert.deepEqual(tree, [
    { label: "首", icon: "link", kind: "page", href: "/p/first", external: false },
    { kind: "group", key: "group-2", label: "资源", icon: "folder", children: [
      { label: "文档", icon: "link", kind: "external", href: "https://example.com/docs", external: true },
      { label: "实验", icon: "link", kind: "section", href: "/lab/git-lab", external: false },
    ] },
  ]);
  assert.deepEqual(navLinks(tree).map((link) => link.href), ["/p/first", "https://example.com/docs", "/lab/git-lab"]);
});

test("groups save as parents; disabled groups hide children; the database keeps one level", async () => {
  await role("postgres");
  const page = await value<number>("insert into custom_pages(slug,title,html,status) values('nav-group-page','P','<p>x</p>','published') returning id v");
  await role("authenticated", owner);
  const save = async (items: unknown[]) =>
    value<{ ok: boolean }>("select public.save_nav_items($1,$2) v", [await value<string>("select public.nav_items_version() v"), JSON.stringify(items)]);
  const items = [
    { kind: "group", label: "资源", icon: "folder" },
    { kind: "page", label: "页面", icon: "file-text", page_id: page, child: true },
    { kind: "section", label: "实验", icon: "flask", section: "git-lab", access: "subscriber", child: true },
    { kind: "external", label: "顶层", icon: "link", url: "https://example.com/top" },
  ];
  assert.equal((await save(items)).ok, true);
  const rows = (await db.query<{ label: string; parent: string | null }>(
    "select n.label, g.label parent from nav_items n left join nav_items g on g.id=n.parent_id order by n.sort_order")).rows;
  assert.deepEqual(rows, [
    { label: "资源", parent: null }, { label: "页面", parent: "资源" }, { label: "实验", parent: "资源" }, { label: "顶层", parent: null },
  ]);

  await role("anon");
  const visible = async () => (await db.query<{ label: string; parent_id: number | null; kind: string }>(
    "select label,parent_id,kind from public.public_navigation()")).rows;
  const projected = await visible();
  assert.deepEqual(projected.map((row) => [row.label, row.parent_id !== null]), [["资源", false], ["页面", true], ["实验", true], ["顶层", false]]);

  await role("authenticated", owner);
  assert.equal((await save([{ ...items[0], enabled: false }, ...items.slice(1)])).ok, true);
  await role("anon");
  assert.deepEqual((await visible()).map((row) => row.label), ["顶层"], "children of a disabled group stay hidden");

  await role("authenticated", owner);
  const current = await value<string>("select public.nav_items_version() v");
  for (const bad of [
    [{ kind: "page", label: "x", icon: "link", page_id: page, child: true }],
    [items[0], { kind: "group", label: "嵌套", icon: "folder", child: true }],
    [{ kind: "group", label: "x", icon: "folder", url: "https://example.com" }],
  ])
    await assert.rejects(db.query("select public.save_nav_items($1,$2)", [current, JSON.stringify(bad)]));
  const leaf = await value<number>("select id v from nav_items where label='顶层'");
  await assert.rejects(
    db.query("insert into nav_items(kind,label,url,parent_id) values('external','x','https://e.com/x',$1)", [leaf]),
    /NAV_PARENT_INVALID/,
    "a parent must be a group",
  );
  const group = await value<number>("select id v from nav_items where kind='group'");
  await assert.rejects(db.query("update nav_items set kind='external', url='https://e.com/g' where id=$1", [group]), /NAV_PARENT_INVALID/);
  await db.query("delete from nav_items where id=$1", [group]);
  assert.equal(await value<number>("select count(*)::int v from nav_items where parent_id is not null"), 0, "deleting a group removes its children");
});

test("navigation groups upgrade keeps existing entries top-level and unchanged", async () => {
  const legacy = new PGlite({ extensions: { vector } });
  try {
    await installTestDatabase(legacy, { fixtures: false, throughVersion: "20261111120000" });
    await legacy.exec(`insert into nav_items(kind,label,icon,url,sort_order) values
      ('external','工具','external-link','https://example.com/tools',10),('external','文档','link','https://example.com/docs',20);`);
    const before = (await legacy.query("select id,kind,label,icon,url,sort_order,enabled from nav_items order by id")).rows;
    const migration = await readFile(new URL("../supabase/migrations/20261112090000_navigation_groups.sql", import.meta.url), "utf8");
    await legacy.exec(migration);
    assert.deepEqual((await legacy.query("select id,kind,label,icon,url,sort_order,enabled from nav_items order by id")).rows, before);
    assert.equal((await legacy.query<{ n: number }>("select count(*)::int n from nav_items where parent_id is not null")).rows[0].n, 0);
    assert.equal((await legacy.query<{ v: string }>("select version v from app_schema_version")).rows[0].v, "20261112090000");
  } finally {
    await legacy.close();
  }
});
