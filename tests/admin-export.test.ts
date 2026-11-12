import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';

test('export zip: crc32 已知向量 + store 结构可回读（V1-S1）', async () => {
  const { crc32, buildZip } = await import('../src/lib/admin/export-zip');
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);

  const zip = buildZip([
    { path: 'content/demo/a.md', content: '# 你好\n' },
    { path: 'data/orders.csv', content: 'id,amount\n1,25\n' },
  ], new Date('2026-09-22T12:00:00Z'));
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // EOCD 在末尾 22 字节
  const eocd = zip.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50);
  assert.equal(view.getUint16(eocd + 8, true), 2);
  // 第一个 local header
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const nameLen = view.getUint16(26, true);
  const name = new TextDecoder().decode(zip.slice(30, 30 + nameLen));
  assert.equal(name, 'content/demo/a.md');
  const size = view.getUint32(18, true);
  const body = new TextDecoder().decode(zip.slice(30 + nameLen, 30 + nameLen + size));
  assert.equal(body, '# 你好\n');
  assert.equal(view.getUint32(14, true), crc32(new TextEncoder().encode('# 你好\n')));
  // 路径安全
  assert.throws(() => buildZip([{ path: '../evil', content: 'x' }]), /非法导出路径/);
  assert.throws(() => buildZip([{ path: '/abs', content: 'x' }]), /非法导出路径/);
  assert.throws(() => buildZip(Array.from({ length: 65536 }, (_, i) => ({ path: `x/${i}`, content: '' }))), /ZIP32 上限/);
});

test('export zip: Unicode and binary entries retain the original archive bytes', async () => {
  const { buildZip } = await import('../src/lib/admin/export-zip');
  const zip = buildZip([
    { path: '内容/😀.md', content: '中文😀\nA\ud800Z' },
    { path: 'data/raw.bin', content: Uint8Array.from([0, 1, 2, 255]) },
  ], new Date(2026, 9, 10, 12, 34, 56));
  assert.equal(zip.length, 246);
  assert.equal(createHash('sha256').update(zip).digest('hex'), '95e5e2b36e82da59a2283680699c0f68e4e8c7b0c43cd00aa86c58ffa1bd993a');
});

test('export coverage: install.sql 应用表均有导出或明确排除', async () => {
  const { EXPORT_TABLES, EXPORT_OMITTED_TABLES, exportCursorColumns } = await import('../src/lib/admin/export-pagination');
  const sql = readFileSync(new URL('../supabase/install.sql', import.meta.url), 'utf8');
  const installed = [...sql.matchAll(/create table public\.(?:"([a-z_]+)"|([a-z_]+))\s*\(/g)]
    .map((match) => match[1] ?? match[2]).sort();
  assert.deepEqual([...EXPORT_TABLES, ...EXPORT_OMITTED_TABLES].sort(), installed);
  assert.deepEqual(exportCursorColumns('content_assets'), ['scope', 'path']);
});

test('export pagination: 跨越旧条数上限且遵循复合主键', async () => {
  const { collectExportRows, collectExportUsers } = await import('../src/lib/admin/export-pagination');
  const source = Array.from({ length: 1205 }, (_, i) => ({ id: i + 1 }));
  let calls = 0;
  const rows = await collectExportRows('orders', ['id'], async (after, includeCount, pageSize) => {
    calls++;
    const data = source.filter((row) => after === null || row.id > Number(after)).slice(0, Math.min(pageSize, 200));
    return { data, count: includeCount ? source.length : null };
  }, async () => ({ count: source.length }));
  assert.equal(rows.length, 1205);
  assert.equal(calls, 7);
  assert.equal(rows.at(-1)?.id, 1205);

  let finalCounts = 0;
  const onePage = await collectExportRows('site_config', ['id'], async () => ({ data: [{ id: 1 }], count: 1 }), async () => {
    finalCounts++;
    return { count: 1 };
  });
  assert.equal(onePage.length, 1);
  assert.equal(finalCounts, 0, '单页精确计数不应再发一次网络请求');

  const assets = [{ scope: 'a', path: '1' }, { scope: 'a', path: '2' }, { scope: 'b', path: '1' }];
  const assetRows = await collectExportRows('content_assets', ['scope', 'path'], async (after) => ({
    data: assets.filter((row) => after === null || JSON.stringify([row.scope, row.path]) > after).slice(0, 2),
    count: after === null ? 3 : null,
  }), async () => ({ count: 3 }), 2);
  assert.deepEqual(assetRows, assets);

  const authSource = Array.from({ length: 1001 }, (_, i) => ({ id: `user-${i}` }));
  const users = await collectExportUsers(async (page, perPage) => ({
    users: authSource.slice((page - 1) * perPage, page * perPage), total: authSource.length,
  }), 200);
  assert.equal(users.length, 1001);
  assert.equal(users.at(-1)?.id, 'user-1000');
});

test('export pagination: 读取失败或中途变化拒绝生成部分结果', async () => {
  const { collectExportRows, collectExportUsers } = await import('../src/lib/admin/export-pagination');
  await assert.rejects(() => collectExportRows('orders', ['id'], async () => ({ data: [{ id: 1 }], count: 2 }), async () => ({ count: 2 }), 1), /主键顺序异常/);
  await assert.rejects(() => collectExportRows('orders', ['id'], async (after) => ({ data: after === null ? [{ id: 1 }] : [], count: 2 }), async () => ({ count: 2 })), /提前结束/);
  await assert.rejects(() => collectExportRows('orders', ['id'], async (after) => ({
    data: after === null ? [{ id: 1 }] : [{ id: 2 }], count: after === null ? 2 : null,
  }), async () => ({ count: 3 }), 1), /总数变化/);
  await assert.rejects(() => collectExportUsers(async (page) => ({ users: page === 1 ? [{ id: 'u1' }, { id: 'u2' }] : [{ id: 'u2' }], total: 3 }), 2), /分页重复/);
  await assert.rejects(() => collectExportUsers(async (page) => ({ users: page === 1 ? [{ id: 'u1' }, { id: 'u2' }] : [], total: 3 }), 2), /提前结束/);
});

test('export compose: 内容 Markdown + 数据 CSV 编排', async () => {
  const { composeExport } = await import('../src/lib/admin/export-compose');
  const entries = composeExport({
    siteConfig: { identity: { name: '测试站' } },
    series: [{ id: 1, slug: 'handbook-x', title: '手册X', type: 'handbook', status: 'published', price: 0 }],
    articles: [
      { id: 1, slug: 'readme', title: 'README', type: 'chapter', access: 'public', status: 'published', price: null, series_id: 1, published_at: '2026-09-01T00:00:00Z' },
      { id: 2, slug: 'ch1', title: '第一章: 开始', type: 'chapter', access: 'paid', status: 'published', price: '12.00', series_id: 1, published_at: '2026-09-02T00:00:00Z' },
      { id: 3, slug: 'solo', title: '独立博客', type: 'blog', access: 'public', status: 'published', price: null, series_id: null, published_at: null },
    ],
    bodies: [
      { article_id: 1, content: 'README 正文' },
      { article_id: 2, content: '付费正文' },
    ],
    orders: [{ id: 1, merchant_order_no: '91234567890123456789012345678901', user_id: 'u1', sku_type: 'event', target_id: 5, amount: '25.00', status: 'paid', created_at: 't' }],
    entitlements: [{ id: 1, user_id: 'u1', type: 'event', target_id: 5, ends_at: null, revoked_at: null, source: 'order', created_at: 't' }],
    registrations: [{ id: 1, series_id: 5, email: 'a@b.c', status: 'attended', created_at: 't' }],
    services: [],
    bookings: [],
    evaluations: [],
    customPages: [{ id: 1, slug: "landing-x", title: "落地页", html: "<section class=\"cp-section\">hi</section>", status: "published" }],
    userEmails: { u1: 'u1@example.com' },
  });
  const byPath = new Map(entries.map((e) => [e.path, e.content as string]));
  // 系列目录组织 + 独立文章目录
  assert.ok(byPath.has('content/handbook-x/readme.md'));
  assert.ok(byPath.has('content/handbook-x/ch1.md'));
  assert.ok(byPath.has('content/_standalone/solo.md'));
  // frontmatter 与正文
  const ch1 = byPath.get('content/handbook-x/ch1.md')!;
  assert.ok(ch1.startsWith('---\n'));
  assert.ok(ch1.includes('title: "第一章: 开始"')); // 含冒号需引号
  assert.ok(ch1.includes('access: paid'));
  assert.ok(ch1.includes('series: handbook-x'));
  assert.ok(ch1.endsWith('付费正文\n'));
  const solo = byPath.get('content/_standalone/solo.md')!;
  assert.ok(!solo.includes('series:'), '独立文章不写 series 行');
  assert.ok(!solo.includes('published_at:'), '空字段不写');
  // 缺 body 的文章导出空正文（不抛错）
  assert.ok(byPath.get('content/_standalone/solo.md')!.endsWith('---\n\n\n'));
  // CSV：邮箱映射 + 表头
  const orders = byPath.get('data/orders.csv')!;
  assert.ok(orders.startsWith('id,merchant_order_no,user_email,sku_type,'));
  assert.ok(orders.includes('91234567890123456789012345678901'));
  assert.ok(orders.includes('u1@example.com'));
  assert.ok(byPath.get('data/entitlements.csv')!.includes('u1@example.com'));
  assert.ok(byPath.get('data/registrations.csv')!.includes('a@b.c,attended'));
  // 空表不产出 CSV
  assert.ok(!byPath.has('data/services.csv'));
  // 自定义页面：CSV 元数据 + 独立 HTML 文件
  assert.ok(byPath.has('data/custom_pages.csv'));
  assert.equal(byPath.get('pages/landing-x.html'), '<section class="cp-section">hi</section>\n');
  // site_config
  assert.ok(byPath.get('site_config.json')!.includes('测试站'));
});

test('export Markdown remains editable when titles contain YAML syntax or line breaks', async () => {
  const { composeExport } = await import('../src/lib/admin/export-compose');
  for (const title of ['true', '123', '[draft]', '第一行\n第二行', '引号 " 与反斜杠 \\']) {
    const body = '# 可继续编辑\n\n<!-- paywall -->\n\n正文。';
    const entries = composeExport({
      siteConfig: {}, series: [],
      articles: [{ id: 1, slug: 'editable', title, type: 'blog', access: 'paid', status: 'published', price: '12.00', series_id: null, published_at: null }],
      bodies: [{ article_id: 1, content: body }],
      orders: [], entitlements: [], registrations: [], services: [], bookings: [], evaluations: [], customPages: [], userEmails: {},
    });
    const markdown = entries.find((entry) => entry.path === 'content/_standalone/editable.md')!.content as string;
    const end = markdown.indexOf('\n---\n', 4);
    const metadata = parseYaml(markdown.slice(4, end));
    assert.equal(metadata.title, title, 'generic YAML readers must preserve the title as text');
    assert.equal(metadata.access, 'paid');
    assert.equal(markdown.slice(end + 6), body + '\n', 'body and paywall marker remain unchanged');
  }
});
