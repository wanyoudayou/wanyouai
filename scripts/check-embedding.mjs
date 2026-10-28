import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";

// This opt-in probe is separate from application configuration and indexing.
export const EMBEDDING_PROBE = Object.freeze({
  origin: "https://api.siliconflow.cn",
  model: "BAAI/bge-m3",
  dimensions: 1024,
  maxResponseBytes: 1024 * 1024,
  requestTimeoutMs: 15_000,
});

const fixtures = [
  "订阅到期后，订阅权益停止；此前单独购买的文章仍可阅读。",
  "在素材库上传图片，然后在文章编辑器选择图片并插入正文。",
  "Deploy the application on Vercel and configure the production domain.",
  "会员过期了，之前单买的文章还能看吗？",
  "如何把上传的图片放进文章？",
  "Where do I deploy the website and set its domain?",
];

export class EmbeddingProbeError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function bounded(operation, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new EmbeddingProbeError("DEADLINE_OR_CANCELLED"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function requestJson(path, apiKey, body, fetchImpl, parentSignal) {
  const signal = AbortSignal.any([
    AbortSignal.timeout(EMBEDDING_PROBE.requestTimeoutMs),
    ...(parentSignal ? [parentSignal] : []),
  ]);
  if (signal.aborted) throw new EmbeddingProbeError("DEADLINE_OR_CANCELLED");
  let reader;
  try {
    const response = await bounded(fetchImpl(`${EMBEDDING_PROBE.origin}${path}`, {
      method: body ? "POST" : "GET",
      redirect: "error",
      headers: { authorization: `Bearer ${apiKey}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal,
    }), signal);
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new EmbeddingProbeError("PROVIDER_HTTP_ERROR", response.status);
    }
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "") || !response.body) {
      void response.body?.cancel().catch(() => {});
      throw new EmbeddingProbeError("INVALID_JSON_RESPONSE");
    }
    reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    while (true) {
      const part = await bounded(reader.read(), signal);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > EMBEDDING_PROBE.maxResponseBytes) throw new EmbeddingProbeError("RESPONSE_TOO_LARGE");
      chunks.push(part.value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new EmbeddingProbeError("INVALID_JSON_RESPONSE"); }
  } catch (error) {
    if (error instanceof EmbeddingProbeError) throw error;
    // Do not print transport errors: providers/proxies may include credentials or bodies.
    throw new EmbeddingProbeError(signal.aborted ? "DEADLINE_OR_CANCELLED" : "TRANSPORT_ERROR");
  } finally {
    if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}

export function decodeProbeVectors(payload, count) {
  if (payload?.model !== EMBEDDING_PROBE.model) throw new EmbeddingProbeError("MODEL_MISMATCH");
  if (!Array.isArray(payload.data) || payload.data.length !== count) throw new EmbeddingProbeError("VECTOR_COUNT_MISMATCH");
  const vectors = new Array(count);
  for (const item of payload.data) {
    if (!Number.isInteger(item?.index) || item.index < 0 || item.index >= count || vectors[item.index]) {
      throw new EmbeddingProbeError("INVALID_VECTOR_INDEX");
    }
    const vector = item.embedding;
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_PROBE.dimensions ||
      !vector.every(value => typeof value === "number" && Number.isFinite(value) && Number.isFinite(Math.fround(value)))) {
      throw new EmbeddingProbeError("INVALID_VECTOR_VALUES_OR_DIMENSION");
    }
    const norm = Math.hypot(...vector.map(Math.fround));
    if (!Number.isFinite(norm) || norm === 0) throw new EmbeddingProbeError("ZERO_OR_INVALID_VECTOR");
    vectors[item.index] = vector;
  }
  return vectors;
}

function cosine(left, right) {
  const ln = Math.hypot(...left), rn = Math.hypot(...right);
  return left.reduce((sum, value, index) => sum + (value / ln) * (right[index] / rn), 0);
}

export async function checkEmbedding({ apiKey, fetchImpl = fetch, signal } = {}) {
  if (typeof apiKey !== "string" || !apiKey.trim() || /[\r\n]/.test(apiKey)) throw new EmbeddingProbeError("INVALID_API_KEY_INPUT");
  const models = await requestJson("/v1/models?sub_type=embedding", apiKey, undefined, fetchImpl, signal);
  if (!Array.isArray(models?.data) || !models.data.some(item => item?.id === EMBEDDING_PROBE.model)) {
    throw new EmbeddingProbeError("MODEL_NOT_LISTED");
  }
  const embed = async input => decodeProbeVectors(await requestJson("/v1/embeddings", apiKey, {
    model: EMBEDDING_PROBE.model, input, encoding_format: "float",
    // BGE-M3 uses its native dimension; SiliconFlow's dimensions option is for Qwen.
  }, fetchImpl, signal), input.length);
  const vectors = await embed(fixtures);
  const repeated = (await embed([fixtures[0]]))[0];
  const repeatSimilarity = cosine(vectors[0], repeated);
  if (repeatSimilarity < 0.99) throw new EmbeddingProbeError("REPEAT_INCONSISTENT");
  const rankings = [3, 4, 5].map(query => [0, 1, 2]
    .map(document => ({ document, score: cosine(vectors[query], vectors[document]) }))
    .sort((a, b) => b.score - a.score || a.document - b.document));
  const semanticMatches = rankings.filter((ranking, index) =>
    ranking[0].document === index && ranking[0].score > ranking[1].score + 1e-6).length;
  if (semanticMatches !== 3) throw new EmbeddingProbeError("SEMANTIC_SMOKE_FAILED");
  return {
    provider: "siliconflow.cn", model: EMBEDDING_PROBE.model, dimensions: EMBEDDING_PROBE.dimensions,
    requests: 3, embeddedTexts: 7, repeatSimilarity: Number(repeatSimilarity.toFixed(6)), semanticMatches,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || (args.length === 1 && args[0] === "--help")) {
    console.log("Embedding compatibility probe (no network calls without --live).\n" +
      "Run: npm run embedding:check -- --live\n" +
      "Prompts for a SiliconFlow Key without echo. Fixed target: api.siliconflow.cn; BAAI/bge-m3.\n" +
      "At most 3 HTTP requests, including 2 embedding requests (7 synthetic texts); may incur fees.\n" +
      "Does not load .env files, query/write Supabase, index articles, or call a chat model.");
    return;
  }
  if (args.length !== 1 || args[0] !== "--live" || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new EmbeddingProbeError("USE_LIVE_FLAG_IN_INTERACTIVE_TERMINAL");
  }
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  const muted = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const readline = createInterface({ input: process.stdin, output: muted, terminal: true });
  readline.once("SIGINT", interrupt);
  process.stdout.write("SiliconFlow API Key（输入不回显，不要粘贴其他平台的 Key）：");
  let apiKey;
  try { apiKey = (await readline.question("", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]) })).trim(); }
  catch { throw new EmbeddingProbeError("KEY_INPUT_CANCELLED"); }
  finally { readline.close(); process.stdout.write("\n"); process.removeListener("SIGINT", interrupt); }
  try {
    const result = await checkEmbedding({ apiKey });
    console.log(JSON.stringify({ passed: true, ...result }));
  } finally { apiKey = undefined; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(JSON.stringify({ passed: false, code: error instanceof EmbeddingProbeError ? error.code : "PROBE_FAILED",
      ...(error instanceof EmbeddingProbeError && error.status ? { status: error.status } : {}) }));
    process.exitCode = 1;
  });
}
