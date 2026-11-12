import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { ClientRequest, IncomingMessage } from "node:http";
import { connectionDefinition, type AIConnection } from "../src/lib/ai/connections";
import { createProviderTransport, providerJSON, publicAddress, type AITransport } from "../src/lib/ai/transport";
import { generate } from "../src/lib/ai/generation";
import { embed, embeddingVectors } from "../src/lib/ai/embedding";
import { fixtures, events } from "./helpers/ai-protocol";

const connection = (protocol: AIConnection["protocol"] = "chat"): AIConnection => ({
  id: "00000000-0000-4000-8000-000000000001", purpose: protocol === "embeddings" ? "embedding" : "generation", protocol,
  baseUrl: protocol === "messages" ? "https://api.anthropic.com/v1" : protocol === "embeddings" ? "https://api.siliconflow.cn/v1" : "https://api.openai.com/v1",
  model: protocol === "embeddings" ? "BAAI/bge-m3" : "synthetic-model", apiKey: "synthetic-key-only", verifiedAt: null,
});
const signal = () => AbortSignal.timeout(2000);
const vector = (n: number) => Array.from({ length: 1024 }, (_, i) => i === 0 ? n : 0);

test("AI targets reject arbitrary hosts, alternate ports, credentials and implicit embedding capabilities", () => {
  for (const baseUrl of ["http://api.openai.com/v1", "https://api.openai.com:444/v1", "https://api.openai.com.evil.test/v1", "https://localhost/v1", "https://user:pass@api.openai.com/v1", "https://api.openai.com/v1?url=x", "https://api.openai.com/v1/proxy"]) {
    assert.throws(() => connectionDefinition({ ...connection(), baseUrl }), /INVALID_CONNECTION/);
  }
  assert.throws(() => connectionDefinition({ ...connection(), purpose: "embedding" }), /INVALID_CONNECTION/);
  assert.throws(() => connectionDefinition({ ...connection("embeddings"), model: "unverified-model" }), /INVALID_CONNECTION/);
  assert.equal(connectionDefinition(connection("messages")).protocol, "messages");
});

test("AI DNS policy blocks private, metadata, mapped, multicast and reserved networks", () => {
  for (const address of ["0.0.0.0", "10.0.0.1", "127.0.0.1", "100.64.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "198.18.1.1", "192.0.2.1", "224.0.0.1", "255.255.255.255", "::", "::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8", "fc00::1", "fe80::1", "2001:db8::1", "2002:7f00:1::", "invalid"])
    assert.equal(publicAddress(address), false, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700::1111", "2001:4860:4860::8888"]) assert.equal(publicAddress(address), true, address);
});

test("AI transport rejects a mixed DNS answer before opening a credential-bearing connection", async () => {
  let opened = false;
  const transport = createProviderTransport({ resolve: async () => [{ address: "1.1.1.1", family: 4 }, { address: "127.0.0.1", family: 4 }], open: () => { opened = true; throw Error("must not open"); } });
  await assert.rejects(transport(connection(), "/chat/completions", {}, { signal: signal() }), /UNSAFE_PROVIDER_ADDRESS/);
  assert.equal(opened, false);
});

test("AI transport pins validated DNS, keeps TLS hostname, chooses protocol auth, and never follows redirects", async () => {
  for (const protocol of ["chat", "messages"] as const) for (const status of [200, 302]) {
    let calls = 0;
    const transport = createProviderTransport({
      resolve: async host => { assert.equal(host, new URL(connection(protocol).baseUrl).hostname); return [{ address: "1.1.1.1", family: 4 }]; },
      open: (url, options, receive) => {
        calls++; assert.equal(url.hostname, new URL(connection(protocol).baseUrl).hostname); assert.equal(options.agent, false); assert.equal(options.family, 4);
        const headers = options.headers as Record<string, string>;
        assert.equal(headers[protocol === "chat" ? "authorization" : "x-api-key"], protocol === "chat" ? "Bearer synthetic-key-only" : "synthetic-key-only");
        options.lookup!(url.hostname, {}, (error, address, family) => { assert.equal(error, null); assert.equal(address, "1.1.1.1"); assert.equal(family, 4); });
        const req = new EventEmitter();
        Object.assign(req, { end: () => {
          const response = Readable.from([Buffer.from('{"ok":true}')]) as IncomingMessage;
          response.statusCode = status; response.headers = { "content-type": "application/json", location: "https://untrusted.invalid" }; receive(response);
        } });
        return req as ClientRequest;
      },
    });
    const operation = transport(connection(protocol), protocol === "chat" ? "/chat/completions" : "/messages", {}, { signal: signal() });
    if (status === 200) assert.deepEqual(await providerJSON(await operation, signal()), { ok: true });
    else await assert.rejects(operation, /PROVIDER_REDIRECT_DENIED/);
    assert.equal(calls, 1);
  }
});

test("AI body bounds and cancellation apply to JSON and streams without exposing provider text", async () => {
  await assert.rejects(providerJSON(new Response("x".repeat(65)), signal(), 64), /PROVIDER_RESPONSE_TOO_LARGE/);
  await assert.rejects(providerJSON(new Response("sensitive diagnostic", { status: 500 }), signal()), error => String(error) === "AIError: PROVIDER_HTTP_ERROR");
  const controller = new AbortController(); controller.abort();
  await assert.rejects(providerJSON(new Response(new ReadableStream({ start() {} })), controller.signal));
});

for (const protocol of ["chat", "responses", "messages"] as const) for (const streaming of [false, true]) test(`AI ${protocol} ${streaming ? "SSE" : "JSON"} preserves task messages, terminal state and usage`, async () => {
  const deltas: string[] = [];
  const transport: AITransport = async (_connection, path, value) => {
    assert.equal(path, protocol === "chat" ? "/chat/completions" : protocol === "responses" ? "/responses" : "/messages");
    const body = value as Record<string, unknown>;
    if (protocol === "chat") assert.deepEqual(body.messages, [{ role: "system", content: "fixed contract" }, { role: "user", content: "task text" }]);
    else if (protocol === "messages") assert.deepEqual(body.system, [{ type: "text", text: "fixed contract" }]);
    else assert.deepEqual((body.input as { role: string; content: unknown }[])[0], { role: "system", content: "fixed contract" });
    if (protocol === "responses") assert.equal(body.store, false);
    if (!streaming) return Response.json(fixtures[protocol]);
    const bytes = Buffer.from(events[protocol].map(event => `data: ${event}\r\n\r\n`).join(""));
    return new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 5) c.enqueue(bytes.subarray(i, i + 5)); c.close(); } }));
  };
  const result = await generate(connection(protocol), [{ role: "system", content: "fixed contract" }, { role: "user", content: "task text" }], { signal: signal(), maxTokens: 50, transport, ...(streaming ? { onToken: delta => deltas.push(delta) } : {}) });
  assert.deepEqual(result, { content: "你好", usage: { prompt_tokens: 7, completion_tokens: 2 } });
  if (streaming) assert.equal(deltas.join(""), "你好");
});

test("AI truncated, tool, failed and interrupted outputs cannot become completed answers", async () => {
  for (const [protocol, value] of [
    ["chat", { choices: [{ index: 0, finish_reason: "length", message: { content: "partial" } }] }],
    ["responses", { ...fixtures.responses, status: "incomplete" }],
    ["messages", { ...fixtures.messages, stop_reason: "tool_use" }],
  ] as const) await assert.rejects(generate(connection(protocol), [{ role: "user", content: "test" }], { signal: signal(), maxTokens: 50, transport: async () => Response.json(value) }), /GENERATION_INCOMPLETE/);
  await assert.rejects(generate(connection(), [{ role: "user", content: "test" }], { signal: signal(), maxTokens: 50, onToken() {}, transport: async () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n') }), /GENERATION_INCOMPLETE|INVALID_PROVIDER_RESPONSE/);
  for (const [protocol, value] of [
    ["responses", { ...fixtures.responses, output: [{ type: "function_call", name: "unrequested" }, ...fixtures.responses.output] }],
    ["messages", { ...fixtures.messages, content: [{ type: "text", text: "answer" }, { type: "tool_use", name: "unrequested" }] }],
  ] as const) await assert.rejects(generate(connection(protocol), [{ role: "user", content: "test" }], { signal: signal(), maxTokens: 50, transport: async () => Response.json(value) }), /UNSUPPORTED_GENERATION_OUTPUT|INVALID_PROVIDER_RESPONSE/);
});

test("Embedding validates model, batch order, finite float32 values, dimensions and nonzero vectors", async () => {
  assert.deepEqual(embeddingVectors({ model: "BAAI/bge-m3", data: [{ index: 1, embedding: vector(2) }, { index: 0, embedding: vector(1) }] }, 2, "BAAI/bge-m3"), [vector(1), vector(2)]);
  for (const raw of [
    { model: "wrong", data: [{ index: 0, embedding: vector(1) }] },
    { model: "BAAI/bge-m3", data: [] },
    { model: "BAAI/bge-m3", data: [{ index: 1, embedding: vector(1) }] },
    ...[[0], Array(1024).fill(0), [Infinity, ...vector(1).slice(1)], [1e300, ...vector(1).slice(1)]].map(embedding => ({ model: "BAAI/bge-m3", data: [{ index: 0, embedding }] })),
  ]) assert.throws(() => embeddingVectors(raw, 1, "BAAI/bge-m3"));
  let calls = 0;
  await embed(connection("embeddings"), ["完整片段"], signal(), async (_connection, path, body) => {
    calls++; assert.equal(path, "/embeddings"); assert.deepEqual(body, { model: "BAAI/bge-m3", input: ["完整片段"], encoding_format: "float" });
    return Response.json({ model: "BAAI/bge-m3", data: [{ index: 0, embedding: vector(1) }] });
  });
  await assert.rejects(embed(connection("embeddings"), ["中".repeat(1000)], signal(), async () => { throw Error("must not call"); }), /INVALID_EMBEDDING_INPUT/);
  assert.equal(calls, 1);
});
