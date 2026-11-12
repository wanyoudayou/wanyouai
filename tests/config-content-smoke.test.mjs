import test from "node:test";
import assert from "node:assert/strict";
import { applicationUrl, validateSmokeManifest, checkContentRoutes } from "../scripts/check-content-routes.mjs";

const base = applicationUrl("https://site.example.test");
const manifest = { format: "wanyou.content-smoke/1", forbiddenText: ["RELEASE_PRIVATE_SENTINEL"], cases: [
  { path: "/blog/release-check-paid", locked: true, price: 7, expectedText: ["公开试读"] },
  { path: "/handbooks/release-check-guide?article=readme", locked: false, expectedText: ["公开目录"] },
  { path: "/blog/release-check-missing", missing: true },
] };

test("explicit smoke manifests cannot target external sites, mutations, credentials or unidentifiable pages", () => {
  validateSmokeManifest(manifest, base);
  for (const path of ["//outside.test/blog/x", "https://outside.test/blog/x", "/api/payments/notify", "/blog/../../api/cron/mail-outbox", "/blog/x?sign=private", "/blog/x#private", "/blog/%2fapi"]) {
    assert.throws(() => validateSmokeManifest({ ...manifest, cases: [{ path, locked: false, expectedText: ["x"] }] }, base));
  }
  assert.throws(() => applicationUrl("https://user:private@site.example.test"));
  assert.throws(() => validateSmokeManifest({ ...manifest, forbiddenText: [] }, base));
  assert.throws(() => validateSmokeManifest({ ...manifest, cases: [{ path: "/blog/x", locked: false }] }, base));
});

test("anonymous smoke checks validate supplied prices, previews and noindex without following redirects", async () => {
  const requests = [];
  const results = await checkContentRoutes(base, validateSmokeManifest(manifest, base), async (url, options) => {
    requests.push({ url: url.href, options });
    const body = url.pathname.includes("paid") ? '<h1>公开试读</h1><div data-paywall></div><script type="application/ld+json">{"offers":{"price":7}}</script>' : url.pathname.includes("missing") ? '<meta name="robots" content="noindex, nofollow">内容不存在或已下架' : "公开目录";
    return new Response(body, { headers: { "content-type": "text/html" } });
  });
  assert(results.every(result => result.ok)); assert.equal(requests.length, 3);
  assert(requests.every(request => request.options.redirect === "manual" && request.options.credentials === "omit" && request.url.startsWith(base.origin)));
});

test("every failed case is reported without printing response bodies or private markers", async () => {
  const results = await checkContentRoutes(base, validateSmokeManifest(manifest, base), async () => new Response("RELEASE_PRIVATE_SENTINEL", { headers: { "content-type": "text/html" } }));
  assert.equal(results.filter(result => !result.ok).length, 3);
  assert(!JSON.stringify(results).includes("RELEASE_PRIVATE_SENTINEL"));
});
