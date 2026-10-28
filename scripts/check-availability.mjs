import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = new URL(process.argv[2] ?? "http://localhost:3000");
assert(["http:", "https:"].includes(base.protocol), "Expected an HTTP(S) application URL");
const rounds = Number(process.argv[3] ?? 10);
assert(Number.isInteger(rounds) && rounds >= 1 && rounds <= 100, "Rounds must be an integer from 1 to 100");
const uncached = process.argv[4] === "--uncached";
assert(process.argv.length <= 5 && (process.argv.length <= 4 || uncached), "The only supported option is --uncached");

const paths = ["/", "/card.json", "/llms.txt"];
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const samples = [];
for (let round = 1; round <= rounds; round++) {
  const results = await Promise.all(paths.map(async (path) => {
    const start = performance.now();
    try {
      const url = new URL(path, base);
      if (uncached) url.searchParams.set("availability_probe", randomUUID());
      const response = await fetch(url, {
        cache: "no-store",
        redirect: "manual",
        headers: bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : undefined,
        signal: AbortSignal.timeout(15_000),
      });
      const headersMs = Math.round(performance.now() - start);
      await response.arrayBuffer();
      const location = response.headers.get("location");
      let target = null;
      try { target = location ? new URL(location, url) : null; } catch { /* Do not fail a probe while formatting an invalid redirect. */ }
      return {
        round, path, status: response.status, ms: Math.round(performance.now() - start), headersMs,
        cache: response.headers.get("x-vercel-cache"), requestId: response.headers.get("x-vercel-id"),
        redirect: target ? `${target.origin}${target.pathname}` : null,
      };
    } catch (error) {
      return { round, path, status: error instanceof Error ? error.name : "unknown", ms: Math.round(performance.now() - start) };
    }
  }));
  samples.push(...results);
  for (const result of results.filter(({ status, cache }) => status !== 200 || (uncached && cache === "HIT"))) {
    console.error(`FAIL round ${result.round} ${result.path}: ${result.status} after ${result.ms} ms; headers=${result.headersMs ?? "none"}ms cache=${result.cache ?? "unknown"} request_id=${result.requestId ?? "none"}${result.redirect ? ` redirect=${result.redirect}` : ""}`);
  }
  for (const result of results.filter(({ status, ms }) => status === 200 && ms >= 3000)) {
    console.log(`SLOW round ${result.round} ${result.path}: ${result.ms}ms; headers=${result.headersMs ?? "none"}ms cache=${result.cache ?? "unknown"} request_id=${result.requestId ?? "none"}`);
  }
}

const failures = samples.filter(({ status, cache }) => status !== 200 || (uncached && cache === "HIT"));
const times = samples.map(({ ms }) => ms).sort((a, b) => a - b);
const percentile = (p) => times[Math.ceil(p * times.length) - 1];
const cacheCounts = new Map();
for (const { cache } of samples) cacheCounts.set(cache ?? "unknown", (cacheCounts.get(cache ?? "unknown") ?? 0) + 1);
console.log(`${failures.length ? "FAIL" : "PASS"} ${samples.length - failures.length}/${samples.length} anonymous availability checks${uncached ? " (unique URL per request)" : ""}; p50=${percentile(0.5)}ms p95=${percentile(0.95)}ms max=${times.at(-1)}ms; cache=${[...cacheCounts].map(([name, count]) => `${name}:${count}`).join(",")}`);
if (failures.length) process.exitCode = 1;
