import assert from "node:assert/strict";
import test from "node:test";
import { AIError, type AIConnection } from "../src/lib/ai/connections";
import { generate } from "../src/lib/ai/generation";
import { embed } from "../src/lib/ai/embedding";
import { providerFetch } from "../src/lib/ai/sdk";
import { withAICall } from "../src/lib/ai/call-control";
import type { AITransport } from "../src/lib/ai/transport";
import { fixtures, events } from "./helpers/ai-protocol";

const connection = (protocol: AIConnection["protocol"], baseUrl?: string): AIConnection => ({
  id: "synthetic", purpose: protocol === "embeddings" ? "embedding" : "generation", protocol,
  baseUrl: baseUrl ?? (protocol === "messages" ? "https://api.anthropic.com/v1" : protocol === "embeddings" ? "https://api.siliconflow.cn/v1" : "https://api.openai.com/v1"),
  model: protocol === "embeddings" ? "BAAI/bge-m3" : "synthetic-model", apiKey: "synthetic-key-only", verifiedAt: null,
});
const question = [{ role: "user" as const, content: "synthetic question" }];
const signal = () => AbortSignal.timeout(2000);
const sse = (values: string[]) => new Response(values.map(value => `data: ${value}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
const options = () => ({ signal: signal(), maxTokens: 100 });

for (const [protocol, base] of [
  ["chat", "https://api.openai.com/v1"], ["responses", "https://api.openai.com/v1"],
  ["chat", "https://api.deepseek.com"], ["responses", "https://api.deepseek.com"],
  ["chat", "https://api.siliconflow.cn/v1"], ["messages", "https://api.anthropic.com/v1"],
] as const) for (const streaming of [false, true]) test(`SDK direct ${base} ${protocol} ${streaming ? "stream" : "JSON"}: one dispatch, bounded settings, no implicit provider`, async () => {
  let calls = 0;
  const target = connection(protocol, base);
  const transport: AITransport = async (resolved, path, value) => {
    calls++; assert.equal(resolved.id, target.id); assert.equal(resolved.apiKey, target.apiKey);
    assert.equal(resolved.baseUrl, base);
    assert.equal(path, protocol === "chat" ? "/chat/completions" : protocol === "responses" ? "/responses" : "/messages");
    const body = value as Record<string, unknown>;
    assert.equal(body.model, target.model);
    assert.equal(body.max_tokens ?? body.max_completion_tokens ?? body.max_output_tokens, 100);
    assert.equal(body.tools, undefined);
    assert.equal(body.previous_response_id, undefined);
    assert.equal(body.conversation, undefined);
    if (protocol === "responses") assert.equal(body.store, false);
    if (base.includes("deepseek")) assert.deepEqual(protocol === "chat" ? body.thinking : body.reasoning, protocol === "chat" ? { type: "disabled" } : { effort: "none" });
    if (streaming && protocol === "chat") assert.deepEqual(body.stream_options, { include_usage: true });
    return streaming ? sse(events[protocol]) : Response.json(fixtures[protocol]);
  };
  const result = await generate(target, question, { ...options(), transport, ...(streaming ? { onToken() {} } : {}) });
  assert.equal(calls, 1); assert.deepEqual(result, { content: "你好", usage: { prompt_tokens: 7, completion_tokens: 2 } });
});

test("SDK fetch rejects URL/path/method/model changes and a second dispatch, including Request inputs", async () => {
  let calls = 0;
  const c = connection("chat"); const url = c.baseUrl + "/chat/completions";
  const fetch = providerFetch(c, signal(), async () => { calls++; return Response.json(fixtures.chat); });
  const init = { method: "POST", body: JSON.stringify({ model: c.model }) };
  for (const changed of ["https://evil.invalid/chat/completions", `${url}?key=synthetic`, `${url}#fragment`, c.baseUrl + "/responses"])
    await assert.rejects(fetch(changed, init), /INVALID_PROVIDER_PATH/);
  await assert.rejects(fetch(url, { method: "GET" }), /INVALID_PROVIDER_PATH/);
  await assert.rejects(fetch(url, { ...init, body: JSON.stringify({ model: "changed" }) }), /INVALID_CONNECTION/);
  assert.equal(calls, 0);
  await (await fetch(new Request(url, init))).text();
  await assert.rejects(fetch(url, init), /PROVIDER_REPEAT_DISPATCH_DENIED/);
  assert.equal(calls, 1);
});

test("SDK preserves every host instruction without silently removing policy or enabling mid-turn beta APIs", async () => {
  for (const protocol of ["chat", "responses", "messages"] as const) {
    const messages = [{ role: "system" as const, content: "fixed policy" }, ...question, { role: "assistant" as const, content: "earlier answer" }, { role: "system" as const, content: "final call policy" }];
    await generate({ ...connection(protocol), model: "o1-preview" }, messages, { ...options(), transport: async (_c, _path, value) => {
      const body = value as Record<string, unknown>;
      if (protocol === "chat") assert.deepEqual(body.messages, messages);
      else if (protocol === "messages") assert.deepEqual(body.system, [{ type: "text", text: "fixed policy\n\nfinal call policy" }]);
      else {
        const instruction = (body.input as { role: string; content: string }[])[0];
        assert(["system", "developer"].includes(instruction.role));
        assert.equal(instruction.content, "fixed policy\n\nfinal call policy");
      }
      return Response.json(fixtures[protocol]);
    } });
  }
  let calls = 0;
  await assert.rejects(generate(connection("chat"), [{ role: "user", content: [{ type: "image", image: new URL("https://evil.invalid/private") }] }] as never, { ...options(), transport: async () => { calls++; return Response.json(fixtures.chat); } }), /INVALID_GENERATION_INPUT/);
  assert.equal(calls, 0);
});

test("SDK bridge rejects oversized UTF-8 inputs before dispatch and bounds response bodies", async () => {
  let calls = 0;
  await assert.rejects(generate(connection("chat"), [{ role: "user", content: "中".repeat(45000) }], { ...options(), transport: async () => { calls++; return Response.json(fixtures.chat); } }), /PROVIDER_RESPONSE_TOO_LARGE|PROVIDER_INPUT_TOO_LARGE/);
  assert.equal(calls, 0);
  await assert.rejects(generate(connection("chat"), question, { ...options(), transport: async () => Response.json({ ...fixtures.chat, excess: "x".repeat(1_048_576) }) }), /PROVIDER_RESPONSE_TOO_LARGE/);
  await assert.rejects(generate(connection("chat"), question, { ...options(), transport: async () => Response.json({ ...fixtures.chat, choices: [{ index: 0, finish_reason: "stop", message: { content: "x".repeat(131_073) } }] }) }), /INVALID_GENERATION_TEXT/);
});

for (const streaming of [false, true]) for (const status of [302, 401, 429, 500, 503]) test(`SDK ${streaming ? "stream" : "JSON"} HTTP ${status} is not retried and diagnostics are redacted`, async () => {
  let calls = 0;
  await assert.rejects(generate(connection("chat"), question, { ...options(), ...(streaming ? { onToken() {} } : {}), transport: async () => { calls++; return new Response("PRIVATE_PROVIDER_BODY synthetic-key-only", { status, headers: { location: "https://evil.invalid" } }); } }), error => {
    assert(error instanceof AIError);
    assert.equal(error.httpStatus, status);
    assert.doesNotMatch(String(error), /PRIVATE_PROVIDER_BODY|synthetic-key-only|evil/);
    return true;
  });
  assert.equal(calls, 1);
});

test("SDK cancellation interrupts unresponsive dispatch and body streams without a retry", async () => {
  for (const phase of ["dispatch", "body"] as const) {
    const abort = new AbortController(); let calls = 0;
    const operation = generate(connection("chat"), question, { ...options(), signal: abort.signal, transport: async () => {
      calls++; queueMicrotask(() => abort.abort());
      return phase === "body" ? new Response(new ReadableStream({ start() {} })) : new Promise<Response>(() => {});
    } });
    await assert.rejects(operation); assert.equal(calls, 1);
  }
});

test("SDK streams require terminal events, reject tool requests and never return partial text as success", async () => {
  for (const protocol of ["responses", "messages"] as const) {
    const incomplete = events[protocol].slice(0, -1);
    let calls = 0;
    await assert.rejects(generate(connection(protocol), question, { ...options(), onToken() {}, transport: async () => { calls++; return sse(incomplete); } }));
    assert.equal(calls, 1);
  }
  for (const value of [
    { choices: [{ index: 0, delta: { function_call: { name: "shell", arguments: "{}" } } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "forbidden", type: "function", function: { name: "shell", arguments: "{}" } }] } }] },
  ]) await assert.rejects(generate(connection("chat"), question, { ...options(), onToken() {}, transport: async () => sse([JSON.stringify(value), ...events.chat]) }), /UNSUPPORTED_GENERATION_OUTPUT/);
  const mismatched = [...events.responses.slice(0, -1), JSON.stringify({ type: "response.completed", response: { ...fixtures.responses, output: [{ ...fixtures.responses.output[0], content: [{ type: "output_text", text: "changed answer", annotations: [] }] }] } })];
  await assert.rejects(generate(connection("responses"), question, { ...options(), onToken() {}, transport: async () => sse(mismatched) }), /GENERATION_TEXT_MISMATCH/);
});

test("SDK failures retain dispatched quota and replay does not dispatch another request", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let reserved = false; let requests = 0;
  const db = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "reserve_ai_call") { const duplicate = reserved; reserved = true; return { data: duplicate ? "duplicate" : "reserved", error: null }; }
    return { data: true, error: null };
  } };
  const request = { id: "synthetic", task: "page" as const, connectionId: "synthetic", userId: "synthetic" };
  const run = () => withAICall(db as never, request, async () => {
    const result = await generate(connection("chat"), question, { ...options(), transport: async () => { requests++; return new Response("private diagnostic", { status: 500 }); } });
    return { value: result.content, usage: result.usage };
  });
  await assert.rejects(run(), /PROVIDER_HTTP_ERROR/);
  assert.equal(calls.find(v => v.name === "finish_ai_call")?.args.p_outcome, "unknown");
  await assert.rejects(run(), /AI_CALL_DUPLICATE/);
  assert.equal(requests, 1);
  assert.equal(calls.filter(v => v.name === "dispatch_ai_call").length, 1);
});

test("SDK malformed provider payloads cannot expose raw bodies through errors or warnings", async () => {
  let warnings = 0; const saved = console.warn;
  console.warn = () => { warnings++; };
  try {
    for (const protocol of ["chat", "responses", "messages"] as const) {
      await assert.rejects(generate(connection(protocol), question, { ...options(), transport: async () => Response.json({ private: "PRIVATE_BODY" }) }), error => {
        assert(error instanceof AIError); assert.doesNotMatch(String(error), /PRIVATE_BODY|synthetic-key-only/); return true;
      });
    }
    assert.equal(warnings, 0);
  } finally { console.warn = saved; }
});

test("SDK embedding preserves duplicate input, 16-item batch, original index order and one dispatch", async () => {
  let calls = 0;
  const texts = Array(16).fill("同一完整片段");
  const vectors = Array.from({ length: 16 }, (_, index) => ({ index, embedding: Array.from({ length: 1024 }, (_, n) => n === 0 ? index + 1 : 0) })).reverse();
  const result = await embed(connection("embeddings"), texts, signal(), async (_c, path, body) => {
    calls++; assert.equal(path, "/embeddings"); assert.deepEqual(body, { model: "BAAI/bge-m3", input: texts, encoding_format: "float" });
    return Response.json({ model: "BAAI/bge-m3", data: vectors });
  });
  assert.equal(calls, 1); assert.deepEqual(result.map(v => v[0]), Array.from({ length: 16 }, (_, i) => i + 1));
});

test("SDK embedding checks raw model/index, never retries and refuses unbounded input", async () => {
  const vector = Array(1024).fill(1);
  for (const value of [
    { model: "wrong", data: [{ index: 0, embedding: vector }] },
    { model: "BAAI/bge-m3", data: [{ index: 1, embedding: vector }] },
    { model: "BAAI/bge-m3", data: [{ index: 0, embedding: Array(1024).fill(0) }] },
    { model: "BAAI/bge-m3", data: [{ index: 0, embedding: vector.slice(1) }] },
  ]) await assert.rejects(embed(connection("embeddings"), ["test"], signal(), async () => Response.json(value)), /EMBEDDING_/);
  let calls = 0;
  const transport: AITransport = async () => { calls++; return new Response("PRIVATE_PROVIDER_BODY", { status: 429 }); };
  await assert.rejects(embed(connection("embeddings"), ["test"], signal(), transport), /PROVIDER_HTTP_ERROR/);
  assert.equal(calls, 1);
  await assert.rejects(embed(connection("embeddings"), Array(17).fill("test"), signal(), transport), /INVALID_EMBEDDING_INPUT/);
  assert.equal(calls, 1);
});
