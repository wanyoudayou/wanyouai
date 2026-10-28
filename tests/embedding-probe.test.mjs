import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { checkEmbedding, decodeProbeVectors, EMBEDDING_PROBE } from "../scripts/check-embedding.mjs";

const vector = axis => Array.from({ length: 1024 }, (_, index) => index === axis ? 1 : 0);
const payload = vectors => ({ model: EMBEDDING_PROBE.model,
  data: vectors.map((embedding, index) => ({ index, embedding })) });
const json = data => Response.json(data);
const modelList = () => json({ data: [{ id: EMBEDDING_PROBE.model }] });

test("embedding probe: routes a fixed provider, validates ordering and three semantic fixtures", async () => {
  const calls = [];
  const response = payload([vector(0), vector(1), vector(2), vector(0), vector(1), vector(2)]);
  response.data.reverse();
  const responses = [modelList(), json(response), json(payload([vector(0)]))];
  const report = await checkEmbedding({ apiKey: "synthetic-key", fetchImpl: async (url, init) => {
    calls.push({ url, init }); return responses.shift();
  } });
  assert.equal(report.semanticMatches, 3);
  assert.equal(report.dimensions, 1024);
  assert.equal(report.repeatSimilarity, 1);
  assert.deepEqual(calls.map(call => call.url), [
    "https://api.siliconflow.cn/v1/models?sub_type=embedding",
    "https://api.siliconflow.cn/v1/embeddings", "https://api.siliconflow.cn/v1/embeddings",
  ]);
  assert.ok(calls.every(call => call.init.redirect === "error" && call.init.headers.authorization === "Bearer synthetic-key"));
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.encoding_format, "float");
  assert.equal(body.model, "BAAI/bge-m3");
  assert.equal(body.input.length, 6);
  assert.equal(body.dimensions, undefined);
  assert.ok(!JSON.stringify(report).includes("synthetic-key"));
});

test("embedding probe: rejects wrong model, dimensions, non-finite values, indices and zero vectors", () => {
  const invalid = [
    { ...payload([vector(0)]), model: "other" },
    payload([]), payload([[1, 2]]), payload([Array(1024).fill(0)]),
    payload([Array(1024).fill(NaN)]), payload([Array(1024).fill(Infinity)]),
    payload([Array(1024).fill("1")]), payload([Array(1024).fill(1e100)]),
    payload([Array(1024).fill(1e-100)]),
    { ...payload([vector(0)]), data: [{ index: -1, embedding: vector(0) }] },
    { ...payload([vector(0)]), data: [{ index: 1, embedding: vector(0) }] },
    { ...payload([vector(0)]), data: [{ embedding: vector(0) }] },
  ];
  for (const value of invalid) assert.throws(() => decodeProbeVectors(value, 1));
  assert.throws(() => decodeProbeVectors({ model: EMBEDDING_PROBE.model,
    data: [{ index: 0, embedding: vector(0) }, { index: 0, embedding: vector(1) }] }, 2), /INVALID_VECTOR_INDEX/);
});

test("embedding probe: missing model stops before a billed embedding request", async () => {
  let calls = 0;
  await assert.rejects(checkEmbedding({ apiKey: "synthetic-key", fetchImpl: async () => {
    calls++; return json({ data: [] });
  } }), /MODEL_NOT_LISTED/);
  assert.equal(calls, 1);
});

test("embedding probe: transport and HTTP failures do not expose upstream messages or retry", async () => {
  for (const status of [401, 403, 429, 503]) {
    let calls = 0;
    await assert.rejects(checkEmbedding({ apiKey: "synthetic-key", fetchImpl: async () => {
      calls++; return new Response("PRIVATE_UPSTREAM_DETAIL", { status });
    } }), error => error.code === "PROVIDER_HTTP_ERROR" && error.status === status && !String(error).includes("PRIVATE"));
    assert.equal(calls, 1);
  }
  await assert.rejects(checkEmbedding({ apiKey: "synthetic-key", fetchImpl: async () => {
    throw new Error("SECRET_IN_PROXY_ERROR");
  } }), error => error.code === "TRANSPORT_ERROR" && !String(error).includes("SECRET"));
});

test("embedding probe: body size, malformed JSON and content type fail closed", async () => {
  for (const response of [
    new Response("x", { headers: { "content-type": "text/html" } }),
    new Response("not json", { headers: { "content-type": "application/json" } }),
    new Response("x".repeat(EMBEDDING_PROBE.maxResponseBytes + 1), { headers: { "content-type": "application/json" } }),
  ]) {
    await assert.rejects(checkEmbedding({ apiKey: "synthetic-key", fetchImpl: async () => response }),
      error => ["RESPONSE_TOO_LARGE", "INVALID_JSON_RESPONSE"].includes(error.code));
  }
});

test("embedding probe: abort closes a stalled response and a cancelled check starts no request", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const stalled = new Response(new ReadableStream({ cancel() { cancelled = true; } }),
    { headers: { "content-type": "application/json" } });
  const pending = checkEmbedding({ apiKey: "synthetic-key", signal: controller.signal,
    fetchImpl: async () => stalled });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, /DEADLINE_OR_CANCELLED/);
  assert.equal(cancelled, true);
  await assert.rejects(checkEmbedding({ apiKey: "synthetic-key", signal: controller.signal,
    fetchImpl: async () => assert.fail("must not fetch") }), /DEADLINE_OR_CANCELLED/);
});

test("embedding probe: identical or semantically inverted vectors cannot pass as useful retrieval", async () => {
  for (const vectors of [Array(6).fill(vector(0)), [vector(0), vector(1), vector(2), vector(2), vector(0), vector(1)]]) {
    const responses = [modelList(), json(payload(vectors)), json(payload([vector(0)]))];
    await assert.rejects(checkEmbedding({ apiKey: "synthetic-key", fetchImpl: async () => responses.shift() }), /SEMANTIC_SMOKE_FAILED/);
  }
  const responses = [modelList(), json(payload([vector(0), vector(1), vector(2), vector(0), vector(1), vector(2)])), json(payload([vector(1)]))];
  await assert.rejects(checkEmbedding({ apiKey: "synthetic-key", fetchImpl: async () => responses.shift() }), /REPEAT_INCONSISTENT/);
});

test("embedding probe CLI: default is offline; keys cannot be passed on the command line", () => {
  const help = spawnSync(process.execPath, ["scripts/check-embedding.mjs"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /no network calls without --live/);
  const invalid = spawnSync(process.execPath, ["scripts/check-embedding.mjs", "--key", "synthetic-secret"], { encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.ok(!invalid.stderr.includes("synthetic-secret"));
  assert.match(invalid.stderr, /USE_LIVE_FLAG_IN_INTERACTIVE_TERMINAL/);
});
