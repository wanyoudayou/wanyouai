import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Anonymous reads only. Demonstration fixtures belong in isolated environments.
const legacyCases = [
  { path: "/blog/demo-public-blog", locked: false },
  { path: "/blog/demo-registered-blog", locked: true },
  { path: "/blog/demo-subscriber-blog", locked: true },
  { path: "/blog/demo-paid-single-blog", locked: true, price: 19 },
  { path: "/handbooks/demo-selection-handbook", locked: false, price: 199 },
  { path: "/handbooks/demo-selection-handbook?article=demo-selection-scorecard", locked: true, price: 199 },
  { path: "/handbooks/demo-selection-handbook?article=demo-selection-workflow", locked: false },
  { path: "/skills/demo-agent-briefing-skill", locked: false, price: 99 },
  { path: "/events/demo-opc-review-event", locked: false, price: 49 },
  { path: "/events/demo-opc-review-event?article=demo-opc-review-event-notes", locked: true },
  { path: "/handbooks/demo-selection-handbook?article=demo-opc-review-event-notes", missing: true },
  { path: "/skills/demo-selection-handbook", missing: true },
  { path: "/blog/no-such-article", missing: true },
];

export function applicationUrl(value) {
  let base;
  try { base = new URL(value); } catch { throw new Error("Expected an HTTP(S) application URL"); }
  assert(["http:", "https:"].includes(base.protocol) && !base.username && !base.password && !base.search && !base.hash, "Application URL must not contain credentials or query parameters");
  return base;
}

export function validateSmokeManifest(data, base) {
  assert(data?.format === "wanyou.content-smoke/1", "Unsupported content smoke manifest");
  assert(Array.isArray(data.cases) && data.cases.length > 0 && data.cases.length <= 100, "Expected 1–100 explicit cases");
  assert(Array.isArray(data.forbiddenText) && data.forbiddenText.length > 0 && data.forbiddenText.length <= 30 && data.forbiddenText.every(text => typeof text === "string" && text.length > 0 && text.length <= 256), "Expected synthetic private-text markers");
  for (const item of data.cases) {
    assert(item && Object.keys(item).every(key => ["path", "locked", "missing", "price", "expectedText"].includes(key)), "Unknown case field");
    assert(typeof item.path === "string" && item.path.length <= 1024 && item.path.startsWith("/") && !item.path.startsWith("//") && !/[\\#]/.test(item.path) && !/%(?:2f|5c|2e)/i.test(item.path), "Expected a local content path");
    const url = new URL(item.path, base);
    assert(url.origin === base.origin && /^\/(?:$|card\/?$|(?:blog|handbooks|collections|skills|events|services|p)\/[^/]+\/?$)/.test(url.pathname), "Only same-origin public content routes can be checked");
    assert([...url.searchParams.keys()].every(key => key === "article") && url.searchParams.getAll("article").length <= 1, "Only the chapter selector is supported");
    assert(item.missing === undefined || typeof item.missing === "boolean", "missing must be boolean");
    if (item.missing) assert(item.locked === undefined && item.price === undefined, "A missing page cannot have a paywall or price expectation");
    else {
      assert(typeof item.locked === "boolean", "Specify the expected anonymous paywall state");
      assert(Array.isArray(item.expectedText) && item.expectedText.length > 0 && item.expectedText.length <= 10 && item.expectedText.every(text => typeof text === "string" && text.length > 0 && text.length <= 200), "Specify expected public text to identify the page");
    }
    if (item.price !== undefined) assert(Number.isFinite(item.price) && item.price >= 0, "Invalid expected price");
  }
  return { cases: data.cases, forbiddenText: data.forbiddenText };
}

export async function checkContentRoutes(base, config, request = fetch) {
  let cursor = 0;
  const results = new Array(config.cases.length);
  async function worker() {
    for (;;) {
      const index = cursor++; if (index >= config.cases.length) return;
      const item = config.cases[index];
      try {
        const response = await request(new URL(item.path, base), { redirect: "manual", credentials: "omit", signal: AbortSignal.timeout(30000) });
        const html = await response.text();
        assert(config.forbiddenText.every(text => !html.includes(text)), "Restricted fixture text leaked");
        assert(response.headers.get("content-type")?.includes("text/html"), "Expected an HTML content response");
        if (item.missing) {
          assert([200, 404].includes(response.status) && html.includes("内容不存在或已下架"), "Expected the content-not-found page");
          assert(/content=["']noindex(?:[, ]|["'])/.test(html), "Missing page must be noindex");
        } else {
          assert.equal(response.status, 200, "Unexpected HTTP status or redirect");
          assert.equal(/data-paywall/.test(html), item.locked, "Anonymous paywall state differs");
          for (const text of item.expectedText ?? []) assert(html.includes(text), "Expected public content is missing");
          if (!item.expectedText) assert(!html.includes("内容暂时加载失败"), "Content load failed");
        }
        if (item.price !== undefined) {
          const matches = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g)];
          let offers;
          try { offers = matches.map(match => JSON.parse(match[1]).offers).filter(Boolean); } catch { throw new Error("Invalid JSON-LD"); }
          assert(offers.some(offer => offer.price === item.price), "JSON-LD price differs from the supplied authority");
        }
        results[index] = { path: item.path, ok: true };
      } catch (error) {
        const message = error?.code === "ERR_ASSERTION" || error?.message === "Invalid JSON-LD" ? error.message.split("\n")[0] : `HTTP check failed (${error instanceof Error ? error.name : "unknown"})`;
        results[index] = { path: item.path, ok: false, message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, config.cases.length) }, worker));
  return results;
}

export async function contentSmoke(args) {
  const [origin = "http://127.0.0.1:3000", option, file, ...extra] = args;
  const base = applicationUrl(origin);
  assert(extra.length === 0 && (!option || ["--cases", "--prices"].includes(option)) && (!!option === !!file), "Usage: <site> [--cases manifest.json | --prices legacy-prices.json]");
  let config;
  if (option === "--cases") config = validateSmokeManifest(JSON.parse(await readFile(file, "utf8")), base);
  else {
    config = { cases: legacyCases.map(item => ({ ...item })), forbiddenText: ["DEMO-PAID-BODY", "DEMO-PAID-SINGLE-BODY", "DEMO-SUBSCRIBER-BODY", "DEMO-RESTRICTED-BODY", "完整评分维度", "物流约束：体积"] };
    if (option === "--prices") {
      const prices = JSON.parse(await readFile(file, "utf8")); const priced = config.cases.filter(item => item.price !== undefined);
      const slugs = new Set(priced.map(item => new URL(item.path, base).pathname.split("/").at(-1)));
      assert(prices && typeof prices === "object" && !Array.isArray(prices) && Object.keys(prices).every(slug => slugs.has(slug)), "Unexpected legacy price entry");
      for (const item of priced) { const slug = new URL(item.path, base).pathname.split("/").at(-1); assert(Object.hasOwn(prices, slug) && Number.isFinite(prices[slug]) && prices[slug] >= 0, "Missing or invalid legacy price"); item.price = prices[slug]; }
    }
  }
  const results = await checkContentRoutes(base, config);
  for (const result of results.filter(result => !result.ok)) console.error(`FAIL ${result.path}: ${result.message}`);
  const passed = results.filter(result => result.ok).length;
  console.log(`${passed === results.length ? "PASS" : "FAIL"} ${passed}/${results.length} anonymous content checks (no business writes)`);
  return passed === results.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if (!await contentSmoke(process.argv.slice(2))) process.exitCode = 1; }
  catch (error) { console.error(error instanceof Error ? error.message : "Content smoke check failed"); process.exitCode = 1; }
}
