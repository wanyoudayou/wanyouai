import assert from "node:assert/strict";
import test from "node:test";
import { generateSkillStep } from "../src/lib/ai/skill-step";
import { AIError, object, type AIConnection } from "../src/lib/ai/connections";
import { fixtures } from "./helpers/ai-protocol";

const targets = [
  ["chat", "https://api.deepseek.com"], ["responses", "https://api.deepseek.com"],
  ["chat", "https://api.siliconflow.cn/v1"], ["chat", "https://api.openai.com/v1"],
  ["responses", "https://api.openai.com/v1"], ["messages", "https://api.anthropic.com/v1"],
] as const;
const input = [{ role: "system" as const, content: "Read current package files with read_skill_files, then answer in Markdown." }, { role: "user" as const, content: "合成任务" }];
const paths = ["references/a.md"];
const answer = '# 阶段结论\n你说的“能力”需要具体证据。\n\n```md\n保持原始 Markdown\n```';
function response(protocol: "chat" | "responses" | "messages", read?: { name?: string; input?: unknown; count?: number }, text = answer) {
  const name = read?.name ?? "read_skill_files", value = read?.input ?? { paths };
  if (protocol === "chat") return { ...fixtures.chat, choices: [{ index: 0, finish_reason: read ? "tool_calls" : "stop", message: read ? { role: "assistant", content: "先核对资料。", tool_calls: Array.from({ length: read.count ?? 1 }, (_, i) => ({ id: `call-read-${i}`, type: "function", function: { name, arguments: JSON.stringify(value) } })) } : { role: "assistant", content: text } }] };
  if (protocol === "responses") return { ...fixtures.responses, output: read ? Array.from({ length: read.count ?? 1 }, (_, i) => ({ id: `fc-${i}`, type: "function_call", call_id: `call-read-${i}`, name, arguments: JSON.stringify(value), status: "completed" })) : [{ ...fixtures.responses.output[0], content: [{ type: "output_text", text, annotations: [] }] }] };
  return { ...fixtures.messages, stop_reason: read ? "tool_use" : "end_turn", content: read ? Array.from({ length: read.count ?? 1 }, (_, i) => ({ type: "tool_use", id: `call-read-${i}`, name, input: value })) : [{ type: "text", text }] };
}
for (const [protocol, baseUrl] of targets) {
  const connection: AIConnection = { id: "fixture", purpose: "generation", protocol, baseUrl, model: "synthetic-model", apiKey: "synthetic-key-only", verifiedAt: null };
  test(`Skill native tool ${baseUrl} ${protocol}: one fixed tool, paired results and plain Markdown`, async () => {
    let calls = 0;
    const first = await generateSkillStep(connection, input, { signal: AbortSignal.timeout(2000), maxTokens: 4096, exchanges: [], allowRead: true, transport: async (_c, _path, value) => {
      calls++; const body = object(value);
      const tools = body.tools as Record<string, unknown>[];
      assert.equal(tools.length, 1);
      assert.equal(protocol === "chat" ? object(tools[0].function).name : tools[0].name, "read_skill_files");
      assert.equal(body.response_format, undefined);
      assert.equal(object(body.text).format, undefined);
      assert.equal(body.output_config, undefined);
      return Response.json(response(protocol, {}));
    } });
    assert.deepEqual(first.read, { id: "call-read-0", paths }); assert.equal(first.content, "");
    assert.deepEqual(first.usage, { prompt_tokens: 7, completion_tokens: 2 });
    const second = await generateSkillStep(connection, input, { signal: AbortSignal.timeout(2000), maxTokens: 4096, exchanges: [{ ...first.read!, files: [{ path: paths[0], content: "PRIVATE_BOUND_REFERENCE" }] }], allowRead: false, transport: async (_c, _path, value) => {
      calls++; const body = object(value); const wire = JSON.stringify(body);
      assert(wire.includes("call-read-0")); assert(wire.includes("PRIVATE_BOUND_REFERENCE"));
      assert.equal(protocol === "messages" ? object(body.tool_choice).type : body.tool_choice, "none");
      if (protocol === "chat") assert.deepEqual((body.messages as Record<string, unknown>[]).slice(-2).map(m => m.role), ["assistant", "tool"]);
      return Response.json(response(protocol));
    } });
    assert.equal(second.content, answer); assert.equal(second.read, undefined); assert.equal(calls, 2);
  });
  test(`Skill native tool ${baseUrl} ${protocol}: invalid names, arguments, parallel and final-step calls stop once`, async () => {
    for (const [read, allowRead] of [[{ name: "shell" }, true], [{ input: { paths, command: "PRIVATE_BODY" } }, true], [{ input: { paths: [3] } }, true], [{ input: { paths: [] } }, true], [{ input: { paths: Array(7).fill("a.md") } }, true], [{ input: { paths: ["a".repeat(513)] } }, true], [{ count: 2 }, true], [{}, false]] as const) {
      let calls = 0;
      await assert.rejects(generateSkillStep(connection, input, { signal: AbortSignal.timeout(2000), maxTokens: 4096, exchanges: [], allowRead, transport: async () => { calls++; return Response.json(response(protocol, read)); } }), error => {
        assert(error instanceof AIError); assert.equal(error.code, "INVALID_SKILL_TOOL_CALL");
        assert.doesNotMatch(String(error), /PRIVATE_BODY|synthetic-key-only/); return true;
      });
      assert.equal(calls, 1);
    }
  });
  test(`Skill native tool ${baseUrl} ${protocol}: truncated answers are rejected without a second dispatch`, async () => {
    let calls = 0;
    const payload = response(protocol) as Record<string, unknown>;
    if (protocol === "chat") (payload.choices as Record<string, unknown>[])[0].finish_reason = "length";
    else if (protocol === "responses") { payload.status = "incomplete"; payload.incomplete_details = { reason: "max_output_tokens" }; }
    else payload.stop_reason = "max_tokens";
    await assert.rejects(generateSkillStep(connection, input, { signal: AbortSignal.timeout(2000), maxTokens: 4096, exchanges: [], allowRead: false, transport: async () => { calls++; return Response.json(payload); } }), /GENERATION_INCOMPLETE/);
    assert.equal(calls, 1);
  });
}
test("plain generation continues to reject native tools outside the Skill adapter", async () => {
  const { generate } = await import("../src/lib/ai/generation");
  let calls = 0;
  await assert.rejects(generate({ id: "test", purpose: "generation", protocol: "chat", baseUrl: "https://api.deepseek.com", model: "synthetic", apiKey: "synthetic-key-only", verifiedAt: null }, input, {
    signal: AbortSignal.timeout(2000), maxTokens: 4096, transport: async () => { calls++; return Response.json(response("chat", {})); },
  }), /UNSUPPORTED_GENERATION_OUTPUT/);
  assert.equal(calls, 1);
});
