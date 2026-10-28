import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import { buildLlmsText, buildMachineCard, machineResponse } from "../src/lib/machine-output";
import type { PublicCatalog } from "../src/lib/public-catalog";
import { normalizeAvatarConfig, normalizeCommerceConfig, normalizeConstraintsConfig, normalizeContactConfig, normalizeHomeConfig, normalizeIdentityConfig } from "../src/types/site";
const stamp = "2026-09-14T00:00:00Z";
const catalog: PublicCatalog = {
 site: { siteName: "测试站", ownerName: "站主", tagline: null, footerCredit: true, identity: normalizeIdentityConfig({ one_liner: "公开事实", languages: ["zh-CN"], timezone: "Asia/Shanghai", focus_areas: [] }), home: normalizeHomeConfig({}), avatar: normalizeAvatarConfig({}), commerce: normalizeCommerceConfig({}), contact: normalizeContactConfig({ email: "owner@example.test" }), constraints: normalizeConstraintsConfig({}) },
 updated: stamp, services: [], readmes: [{ article_id: 1, content: "PUBLIC README" }], events: [{ series_id: 2, ticket_price: 50, state: "ended" }],
 series: [{ id: 1, slug: "book", title: "手册", type: "handbook", price: 10, status: "published", readme_article_id: 1, task: "任务", updated_at: stamp }, { id: 2, slug: "old-event", title: "已结束活动", type: "event", price: 0, status: "published", readme_article_id: 1, task: null, updated_at: stamp }],
 articles: [{ id: 1, slug: "readme", title: "README", type: "chapter", series_id: 1, access: "public", price: null, status: "published", preview_md: "PUBLIC README", summary: null, updated_at: stamp }, { id: 2, slug: "paid", title: "付费文章", type: "blog", series_id: null, access: "paid", price: 12, status: "published", preview_md: "PUBLIC PREVIEW", summary: "公开摘要", updated_at: stamp }, { id: 3, slug: "paused", title: "已暂停", type: "blog", series_id: null, access: "paid", price: 10, status: "paused", preview_md: "PAUSED_PREVIEW", summary: null, updated_at: stamp }]
};
test("machine card validates schema, excludes paused/ended offers and restricted bodies", async () => {
 const ajv = new Ajv2020({ strict: false }); addFormats(ajv);
 const validate = ajv.compile(JSON.parse(await readFile('docs/card.schema.json', 'utf8')));
 const card = buildMachineCard(catalog, 'https://example.test');
 assert.equal(validate(card), true, JSON.stringify(validate.errors));
 const body = JSON.stringify(card); assert.ok(!body.includes('old-event')); assert.ok(!body.includes('/paused')); assert.ok(!body.includes('pricing_policy')); assert.ok(!body.includes('endpoint'));
 const text = buildLlmsText(catalog, 'https://example.test'); assert.ok(text.includes('PUBLIC README')); assert.ok(text.includes('PUBLIC PREVIEW')); assert.ok(!text.includes('PAUSED_PREVIEW'));
});
test("ETag is stable; weak/list/wildcard requests return 304; changed content changes tag", async () => {
 const body = JSON.stringify(buildMachineCard(catalog, 'https://example.test'));
 const first = machineResponse(body, 'application/json', new Request('https://example.test/card.json'));
 const tag = first.headers.get('etag')!;
 assert.equal(machineResponse(body, 'application/json', new Request('https://example.test/card.json')).headers.get('etag'), tag);
 for (const value of [tag, `W/${tag}`, `"other", ${tag}`, '*']) assert.equal(machineResponse(body, 'application/json', new Request('https://example.test/card.json', { headers: { 'If-None-Match': value } })).status, 304);
 assert.notEqual(machineResponse(body + ' ', 'application/json', new Request('https://example.test/card.json')).headers.get('etag'), tag);
});
