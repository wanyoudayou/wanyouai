import assert from "node:assert/strict";
import { test } from "node:test";
import { snapshot, type VaultReader } from "../plugins/obsidian/src/snapshot";
import { siteOrigin, type Inventory } from "../packages/handbook-protocol/src";
import { PartialSyncError, Sync, type Compared, type Journal } from "../plugins/obsidian/src/sync";
import { HandbookClient, HandbookNetworkError, HandbookRequestError } from "../plugins/obsidian/src/client";
import { ensureReadme, findReadme } from "../plugins/obsidian/src/readme";
import { preservedHandbookAccess } from "../src/lib/importing/access";
import { handbookStageProblem } from "../src/lib/importing/stage-guard";
import { HandbookConnection } from "../plugins/obsidian/src/connection";
import { loadFolders, inventoryFiles, statusLabel, versionLabel, type Binding } from "../plugins/obsidian/src/manager";
import type { Handbook, ConnectionInfo } from "../packages/handbook-protocol/src";
import type { Snapshot } from "../plugins/obsidian/src/snapshot";

const empty: Inventory = { files: [], assets: [], total: 0, page: 1 };
test("credentials selected for one site cannot be sent to another origin", () => {
  const token = "whp_" + "a".repeat(64);
  assert.throws(() => new HandbookClient("https://new.example", token, "https://original.example"), /站点已变更/);
  assert.throws(() => new HandbookClient("https://new.example", token, ""));
  assert.equal(new HandbookClient("https://original.example", token, "https://original.example").origin, "https://original.example");
});
test("omitted access inherits an unpublished draft, while current article access wins over an old draft", () => {
  for (const access of ["public", "registered", "subscriber", "paid"]) assert.equal(preservedHandbookAccess(undefined, null, { frontmatter: { access } }), access);
  assert.equal(preservedHandbookAccess(undefined, "paid", { frontmatter: { access: "public" } }), "paid");
  assert.equal(preservedHandbookAccess(undefined, null, null), undefined);
  assert.equal(preservedHandbookAccess(undefined, null, { frontmatter: { access: "unknown" } }), undefined);
  assert.equal(preservedHandbookAccess("public", "paid", null, { draftUpload: true }), "paid");
  assert.equal(preservedHandbookAccess("public", null, { frontmatter: { access: "subscriber" } }, { draftUpload: true }), "subscriber");
  assert.equal(preservedHandbookAccess("public", null, null, { draftUpload: true }), "registered");
});
test("silent connections coalesce concurrent reads and do not reuse credentials after a site change", async () => {
  const settings = { origin: "https://site.test", secretOrigin: "https://site.test", secretRef: "ref" };
  let calls = 0; let finish!: (value: ConnectionInfo) => void;
  const make = () => ({ get: async () => { calls++; return new Promise<ConnectionInfo>(resolve => finish = resolve); } }) as unknown as HandbookClient;
  const cache = new HandbookConnection(() => "whp_" + "a".repeat(64), make);
  const first = cache.ensure(settings), second = cache.ensure(settings);
  finish({ protocol: 1, scope: "handbooks", uploadOrigin: "https://storage.test", publicKey: "public", imagesPublic: true, capabilities: ["draft-upload-v2"] });
  assert.equal(await first, await second); await cache.ensure(settings); await cache.ensure({ ...settings, origin: settings.origin + "/" }); assert.equal(calls, 1);
  assert.equal(cache.peek({ ...settings, origin: "https://other.test" }), null);
  await assert.rejects(cache.ensure({ ...settings, origin: "https://other.test" }), /站点已变更/); assert.equal(calls, 1);
  cache.clear(); const third = cache.ensure(settings); cache.clear(); finish({ protocol: 1, scope: "handbooks", uploadOrigin: "https://storage.test", publicKey: "public", imagesPublic: true, capabilities: ["draft-upload-v2"] });
  await assert.rejects(third, /配置已变更/); assert.equal(cache.peek(settings), null);
});
test("force overwrite needs a reviewed hash and current online timestamp, and only saves a draft", () => {
  const check = { hash: "reviewed", updatedAt: "current", onlineChanged: true };
  const operation = { checkedHash: "reviewed", updatedAt: "current", overwriteOnline: true };
  assert.equal(handbookStageProblem(check, { ...operation, overwriteOnline: false }, true), "OVERWRITE_CONFIRMATION_REQUIRED");
  assert.equal(handbookStageProblem(check, operation, false), "OVERWRITE_CONFIRMATION_REQUIRED");
  assert.equal(handbookStageProblem(check, { ...operation, updatedAt: "old" }, true), "ONLINE_CHANGED");
  assert.equal(handbookStageProblem(check, { ...operation, checkedHash: "other" }, true), "PREVIEW_CHANGED");
  assert.equal(handbookStageProblem(check, operation, true), null);
  assert.equal(handbookStageProblem({ ...check, onlineChanged: false, change: "changed" }, { ...operation, overwriteOnline: false }, true), "OVERWRITE_CONFIRMATION_REQUIRED");
});
test("the plugin cannot send publish, activate or delete operations", async () => {
  const client = new HandbookClient("https://site.test", "whp_" + "a".repeat(64), "https://site.test");
  for (const action of ["publish", "activate", "delete"]) await assert.rejects(client.post(action, {}), /网页后台/);
});
test("online metadata from later pages updates local publication state without dropping pending drafts", async () => {
  const client = { get: async (_: string, q: { page: string }) => q.page === "1" ? { ...empty, total: 101, files: [{ id: 1, path: "chapter.md", article_slug: "chapter", latest: { id: 4, version: 3, input_hash: "draft", publication: null } }], onlineArticles: [] } : { ...empty, total: 101, onlineArticles: [{ id: 20, slug: "chapter", title: "Chapter", status: "paused", version: 7, updated_at: "current" }] } } as unknown as HandbookClient;
  const inventory = await new Sync(client, {}, async () => {}, () => {}).inventory("guide");
  assert.equal(inventory.files[0].online?.version, 7); assert.equal(inventory.files[0].online?.status, "paused");
  const files = inventoryFiles(inventory); assert.equal(files["chapter.md"].publishedVersion, 7); assert.equal(files["chapter.md"].draftVersion, 3);
});
function reader(files: Record<string, string>, resolve: (ref: string, source: string) => string = () => "shared/图.png") {
  const reads: string[] = [];
  const value: VaultReader = {
    markdownFiles: () => Object.keys(files), readText: async path => { reads.push(path); return files[path]; }, resolve,
    readImage: async path => { reads.push(path); return new Uint8Array([1, 2, 3]); },
  };
  return { value, reads };
}
test("shared Vault images are resolved only from selected notes; private notes are never followed", async () => {
  const vault = reader({ "guide/README.md": "# Guide", "guide/教程.md": "# 教程\n![[图.png|300]]\n[[private/diary]]", "private/diary.md": "PRIVATE", "guide/.private/secret.md": "SECRET" });
  const result = await snapshot(vault.value, "guide", "demo-guide", empty);
  assert.equal(result.notes.length, 2); assert.equal(result.images.length, 1);
  assert.deepEqual(vault.reads, ["guide/README.md", "guide/教程.md", "shared/图.png"]);
  assert.match(result.notes[1].candidate.input.markdown, /_assets\/[a-f0-9]{64}\.png/);
  assert.equal(result.notes[0].candidate.input.frontmatter.access, "public");
  assert.equal(result.notes[1].candidate.input.frontmatter.access, "registered");
});
test("local permissions are ignored, addresses stay bound, and note embeds remain blocked", async () => {
  const vault = reader({ "guide/README.md": "# Guide", "guide/chapter.md": "# Text" });
  const inventory: Inventory = { ...empty, files: [{ id: 1, path: "chapter.md", article_slug: "paid-existing", latest: null }] };
  const result = await snapshot(vault.value, "guide", "demo-guide", inventory);
  assert.equal(result.notes[1].candidate.input.frontmatter.access, "registered");
  assert.equal(result.notes[1].candidate.input.frontmatter.slug, "paid-existing");
  const readme = await snapshot(reader({ "guide/README.md": "---\naccess: paid\n---\nIntro" }).value, "guide", "guide", empty);
  assert.equal(readme.notes[0].candidate.input.frontmatter.access, "public"); assert(readme.ignored.some(text => text.includes("网页后台")));
  await assert.rejects(snapshot(reader({ "guide/README.md": "![[private-note]]" }).value, "guide", "guide", empty), /不支持的嵌入/);
  await assert.rejects(snapshot(reader({ "guide/README.md": "![x](secret.png)" }, () => ".obsidian/secret.png").value, "guide", "guide", empty), /普通文件路径/);
  await assert.rejects(snapshot(reader({ "guide/doc.md": "No README" }).value, "guide", "guide", empty), /缺少 README/);
});
test("Vault classification and website-owned settings cannot block or redirect a handbook upload", async () => {
  const files = { "guide/README.md": "# Guide", "guide/chapter.md": "---\ntype: internal-note\naccess: [private]\nprice: not-for-sale\nseries_slug: [other]\npublished_at: tomorrow\n---\n# Chapter\nText" };
  const frozen = await snapshot(reader(files).value, "guide", "guide", empty);
  const input = frozen.notes.find(note => note.path === "chapter.md")!.candidate.input;
  assert.equal(input.frontmatter.type, "chapter");
  assert.equal(input.frontmatter.series_slug, "guide");
  assert.equal(input.frontmatter.access, "registered");
  assert.equal(input.frontmatter.price, undefined);
  assert.equal(input.frontmatter.published_at, undefined);
  assert.match(input.markdown, /# Chapter\nText/);
  assert(frozen.ignored.some(message => message.includes("chapter.md") && message.includes("type")));
  await assert.rejects(snapshot(reader({ ...files, "guide/chapter.md": "---\ntitle: [invalid]\n---\nText" }).value, "guide", "guide", empty), /chapter\.md：文件属性 title 应为文本/);
});
test("image-only changes alter frozen digest; uploaded snapshot does not mutate with Vault", async () => {
  const vault = reader({ "guide/README.md": "![x](a.png)" });
  const first = await snapshot(vault.value, "guide", "guide", empty);
  vault.value.readImage = async () => new Uint8Array([5, 6]);
  const second = await snapshot(vault.value, "guide", "guide", empty);
  assert.notEqual(first.digest, second.digest); assert.equal(first.images[0].bytes.length, 3);
  for (const origin of ["http://site.example", "https://user:pass@site.example", "https://site.example/path", "https://site.example/?token=x"]) assert.throws(() => siteOrigin(origin));
});
test("README detection ignores case, requires the root, and refuses ambiguous duplicates", async () => {
  for (const name of ["README.md", "Readme.md", "readme.md", "README.MD"]) {
    const path = `guide/${name}`;
    assert.equal(findReadme([path, "guide/sub/README.md"], "guide"), path);
    const frozen = await snapshot(reader({ [path]: "" }).value, "guide", "guide", empty);
    assert.equal(frozen.notes[0].candidate.input.frontmatter.access, "public");
  }
  assert.equal(findReadme(["guide/sub/README.md"], "guide"), null);
  assert.throws(() => findReadme(["guide/README.md", "guide/readme.md"], "guide"), /多个/);
});
test("creating a blank README requires consent and cannot overwrite an existing or concurrently created file", async () => {
  const files = new Map<string, string>();
  const vault = { paths: () => [...files.keys()], create: async (path: string, text: string) => { if (files.has(path)) throw new Error("File exists"); files.set(path, text); } };
  await assert.rejects(ensureReadme(vault, "guide", false), /勾选/); assert.equal(files.size, 0);
  await ensureReadme(vault, "guide", true); assert.equal(files.get("guide/README.md"), "");
  files.clear(); files.set("guide/Readme.md", "owner's introduction");
  assert.equal(await ensureReadme(vault, "guide", true), "guide/Readme.md"); assert.equal(files.size, 1); assert.equal(files.get("guide/Readme.md"), "owner's introduction");
  files.clear();
  await assert.rejects(ensureReadme({ ...vault, create: async (path, text) => { files.set(path, "concurrent edit"); return vault.create(path, text); } }, "guide", true), /File exists/);
  assert.equal(files.get("guide/README.md"), "concurrent edit");
  await assert.rejects(ensureReadme(vault, "../outside", true), /普通文件路径/);
});
test("a lost response is recovered immediately by a read, without a second write or hiding an unresolved network error", async () => {
  let posts = 0; let gets = 0; let response: object | null = { id: 20 };
  const client = { get: async () => { gets++; return { operation: response ? { response } : null }; }, post: async () => { posts++; throw new HandbookNetworkError("ECONNRESET", "发布文稿"); } } as unknown as HandbookClient;
  const journal: Journal = {}; const sync = new Sync(client, journal, async () => {}, () => {});
  assert.deepEqual(await sync.operation("series:guide:publish:20", "publish", { revision: 20 }), { id: 20 });
  assert.equal(posts, 1); assert.equal(gets, 1); assert.equal(Object.values(journal)[0].done, true);
  response = null;
  await assert.rejects(sync.operation("series:guide:publish:21", "publish", { revision: 21 }), /发布文稿：连接被中断（ECONNRESET）/);
  assert.equal(posts, 2); assert.equal(gets, 2); assert.equal(journal["series:guide:publish:21"].done, false);
});
test("query recovery is scoped to the selected handbook and never dispatches a write", async () => {
  const journal: Journal = {};
  for (const [key, action] of [["series:guide:publish:20", "publish"], ["series:guide:stage:chapter:hash", "stage"], ["series:guide:publish:21", "publish"], ["series:guide:image:hash", "image"], ["series:other:publish:20", "publish"]]) journal[key] = { id: key, action, hash: "hash", done: false };
  const calls: string[] = [];
  const client = { get: async (_: string, { id }: { id: string }) => { calls.push(id); return { operation: { response: id.endsWith("20") ? { status: "pass", article: {} } : id.endsWith("21") ? { status: "blocked" } : null } }; }, post: async () => { assert.fail("Read-only recovery cannot write"); } } as unknown as HandbookClient;
  assert.deepEqual(await new Sync(client, journal, async () => {}, () => {}).reconcile("guide"), { confirmed: 1, unfinished: 1, blocked: 1 });
  assert.equal(calls.length, 3); assert(calls.every(id => id.startsWith("series:guide:") && !id.includes(":image:")));
  assert.equal(journal["series:other:publish:20"].done, false);
});
test("a server error after committing also recovers by ID, without retrying publication", async () => {
  let posts = 0;
  const client = { get: async () => ({ operation: { response: { status: "pass" } } }), post: async () => { posts++; throw new HandbookRequestError("发布文稿（HTTP 503）", 503); } } as unknown as HandbookClient;
  const sync = new Sync(client, {}, async () => {}, () => {});
  assert.deepEqual(await sync.operation("series:guide:publish:20", "publish", { revision: 20 }), { status: "pass" });
  assert.equal(posts, 1);
});
test("unknown publish response is resolved by operation ID before any second write", async () => {
  const journal: Journal = {}; let posts = 0; let stored: object | null = null;
  const client = { get: async () => ({ operation: stored ? { response: stored } : null }), post: async () => { posts++; stored = { id: 20 }; throw new Error("network lost"); } } as unknown as HandbookClient;
  const sync = new Sync(client, journal, async () => {}, () => {});
  await assert.rejects(sync.operation("key", "stage", { candidate: "frozen" }), /network lost/);
  assert.deepEqual(await sync.operation("key", "stage", { candidate: "frozen" }), { id: 20 }); assert.equal(posts, 1);
  assert.equal(Object.values(journal)[0].done, true); assert.equal(JSON.stringify(journal).includes("frozen"), false);
});

test("root-only folders may be bound independently without duplicate bindings", () => {
  const loaded = loadFolders(["existing"], ["guide-a", "guide-b", "guide-a/sub", "existing"]);
  assert.deepEqual(loaded.folders, ["existing", "guide-a", "guide-b", "guide-a/sub"]);
  assert.equal(loaded.skipped.length, 1);
  assert.throws(() => loadFolders([], ["../private"]));
  assert.equal(statusLabel(), "待创建线上手册");
});
test("mixed completion does not label draft revisions as published versions", () => {
  const binding = { files: { a: { version: 2, publishedVersion: 1 }, b: { version: 3 } }, changed: true, failures: [{ path: "b", message: "failed" }] } as unknown as Binding;
  assert.equal(versionLabel(binding), "已发布版本：v1（1 篇）；草稿修订：v3（1 篇）");
  assert.equal(statusLabel(binding), "部分完成 · 1 篇待处理");
});
test("draft upload ignores local access and keeps published or saved permissions in server authority", async () => {
  const source = reader({ "guide/README.md": "# Intro", "guide/old.md": "---\naccess: public\n---\nChanged", "guide/new.md": "---\naccess: public\n---\nNew" });
  const inventory: Inventory = { ...empty, files: [{ id: 1, path: "old.md", article_slug: "paid-old", latest: null }] };
  const frozen = await snapshot(source.value, "guide", "guide", inventory);
  assert.equal(frozen.notes.find(n => n.path === "old.md")!.candidate.input.frontmatter.access, "registered");
  assert.equal(preservedHandbookAccess("registered", "paid", null, { draftUpload: true }), "paid");
  assert.equal(frozen.notes.find(n => n.path === "new.md")!.candidate.input.frontmatter.access, "registered");
  assert.equal(frozen.notes.find(n => n.path === "README.md")!.candidate.input.frontmatter.access, "public");
});
const connection: ConnectionInfo = { protocol: 1, scope: "handbooks", uploadOrigin: "https://storage.example", publicKey: "public", imagesPublic: true };
const handbook: Handbook = { id: 1, slug: "guide", title: "Guide", status: "draft", updated_at: "2026-10-26T00:00:00Z", readme_article_id: null };
function comparisons(frozen: Snapshot, unchanged = false): Compared[] {
  return frozen.notes.map((note, index) => ({ note, check: { hash: `hash-${index}`, updatedAt: null, expected: unchanged ? index + 1 : 0, version: 1, previousAccess: null, accessChanged: false, onlineChanged: false, change: unchanged ? "unchanged" : "new", input: note.candidate.input, previousMarkdown: "" } }));
}
test("save draft never publishes or activates; progress and version labels use actual revisions", async () => {
  const frozen = await snapshot(reader({ "guide/README.md": "# Intro", "guide/chapter.md": "# Text" }).value, "guide", "guide", empty);
  const actions: string[] = []; const progress: string[] = [];
  const current: Inventory = { ...empty, files: [] };
  const client = { get: async () => current, post: async (action: string, body: { candidate: Snapshot["notes"][number]["candidate"] }) => {
    actions.push(action); assert.equal(action, "stage"); const id = current.files.length + 1;
    current.files.push({ id, path: body.candidate.path, article_slug: `note-${id}`, latest: { id, version: 2, input_hash: "saved", publication: null } }); return { id };
  } } as unknown as HandbookClient;
  const sync = new Sync(client, {}, async () => {}, text => progress.push(text));
  const result = await sync.saveDrafts(frozen, comparisons(frozen), handbook, empty, connection);
  assert.deepEqual(actions, ["stage", "stage"]);
  for (const phase of [1, 2, 3]) assert(progress.some(text => text.includes(`（${phase}/3）`)));
  const binding = { files: inventoryFiles(result), changed: false, outcome: "draft" } as Binding;
  assert.equal(versionLabel(binding), "草稿修订：v2（2 篇）"); assert.equal(statusLabel(binding), "草稿已上传，待网页发布");
});
test("partial draft uploads recompare and skip completed drafts without publishing or deleting", async () => {
  const frozen = await snapshot(reader({ "guide/README.md": "# Intro", "guide/chapter.md": "# Text" }).value, "guide", "guide", empty);
  const current: Inventory = { ...empty, files: [] }; const stored = new Map<string, object>(); const calls: { path: string; id: string }[] = []; let fail = true;
  const client = {
    get: async (action: string, query: { id: string }) => action === "status" ? { operation: stored.has(query.id) ? { response: stored.get(query.id) } : null } : current,
    post: async (action: string, body: { operationId: string; candidate: Snapshot["notes"][number]["candidate"]; draftUpload: boolean }) => {
      assert.equal(action, "stage"); assert.equal(body.draftUpload, true); const path = body.candidate.path; calls.push({ path, id: body.operationId });
      if (path === "chapter.md" && fail) throw new HandbookRequestError("临时保存失败", 409);
      const id = current.files.length + 1; current.files.push({ id, path, article_slug: `note-${id}`, latest: { id, version: 1, input_hash: "saved", publication: null } }); const response = { id }; stored.set(body.operationId, response); return response;
    },
  } as unknown as HandbookClient;
  const sync = new Sync(client, {}, async () => {}, () => {});
  await assert.rejects(sync.saveDrafts(frozen, comparisons(frozen), handbook, empty, connection), error => { assert(error instanceof PartialSyncError); assert.equal(error.completed, 1); assert.equal(error.failures[0].path, "chapter.md"); return true; });
  fail = false; const second = comparisons(frozen, true); second[1].check!.change = "new"; second[1].check!.expected = 0;
  await sync.saveDrafts(frozen, second, handbook, current, connection);
  assert.deepEqual(calls.map(c => c.path), ["README.md", "chapter.md", "chapter.md"]); assert.equal(calls[1].id, calls[2].id);
});

test("subfolder notes are ignored before parsing or reading and cannot block root uploads", async () => {
  const vault = reader({ "guide/README.md": "Intro", "guide/chapter.md": "# Chapter", "guide/sub/broken.md": "---\n[invalid yaml", "guide/.hidden/secret.md": "PRIVATE" });
  const result = await snapshot(vault.value, "guide", "guide", empty);
  assert.deepEqual(result.notes.map(n => n.path), ["README.md", "chapter.md"]);
  assert.deepEqual(vault.reads, ["guide/README.md", "guide/chapter.md"]);
  assert.match(result.ignored.join(""), /忽略.*2/);
});
test("a later web publication clears the stale uploaded-draft label", () => {
  const binding = { changed: false, outcome: "draft", files: { a: { version: 2, publishedVersion: 2 } } } as unknown as Binding;
  assert.equal(statusLabel(binding), "已同步线上发布");
});
