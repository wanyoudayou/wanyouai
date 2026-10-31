import assert from "node:assert/strict";
import test from "node:test";
import type { JSONSchema7 } from "ai";
import { generate } from "../src/lib/ai/generation";
import { AIError, object, type AIConnection } from "../src/lib/ai/connections";
import { fixtures } from "./helpers/ai-protocol";

const schema: JSONSchema7 = {
  type: "object", additionalProperties: false,
  properties: { answer: { type: "string" }, read: { type: "array", items: { type: "string" } } },
};
const targets = [
  ["chat", "https://api.deepseek.com"], ["responses", "https://api.deepseek.com"],
  ["chat", "https://api.siliconflow.cn/v1"], ["chat", "https://api.openai.com/v1"],
  ["responses", "https://api.openai.com/v1"], ["messages", "https://api.anthropic.com/v1"],
] as const;
function response(protocol: "chat" | "responses" | "messages", text: string) {
  if (protocol === "chat") return { ...fixtures.chat, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: text } }] };
  if (protocol === "responses") return { ...fixtures.responses, output: [{ ...fixtures.responses.output[0], content: [{ type: "output_text", text, annotations: [] }] }] };
  return { ...fixtures.messages, content: [{ type: "text", text }] };
}
const input = [{ role: "system" as const, content: 'Return JSON only: {"answer":"text"} or {"read":["references/a.md"]}.' }, { role: "user" as const, content: "合成任务" }];
for (const [protocol, baseUrl] of targets) {
  const connection: AIConnection = { id: "fixture", purpose: "generation", protocol, baseUrl, model: "synthetic-model", apiKey: "synthetic-key-only", verifiedAt: null };
  test(`Skill JSON ${baseUrl} ${protocol}: native format, one dispatch, no implicit tool`, async () => {
    let calls = 0;
    for (const reply of [{ read: ["references/a.md"] }, { answer: "第一步\n请补充一个具体案例。" }]) {
      const result = await generate(connection, input, { signal: AbortSignal.timeout(2000), maxTokens: 4096, jsonSchema: schema, transport: async (_c, _path, value) => {
        calls++;
        const body = object(value);
        if (protocol === "chat") assert.deepEqual(body.response_format, { type: "json_object" });
        else if (protocol === "responses") {
          assert.deepEqual(object(body.text).format, { type: "json_object" });
          assert.equal(body.store, false);
        } else {
          const format = object(object(body.output_config).format);
          assert.equal(format.type, "json_schema");
          assert.deepEqual(object(format.schema).properties, schema.properties);
        }
        assert.equal(body.tools, undefined);
        assert.equal(body.tool_choice, undefined);
        assert.equal(body.model, connection.model);
        return Response.json(response(protocol, JSON.stringify(reply)));
      } });
      assert.deepEqual(JSON.parse(result.content), reply);
      assert.deepEqual(result.usage, { prompt_tokens: 7, completion_tokens: 2 });
    }
    assert.equal(calls, 2);
  });
  test(`Skill JSON ${baseUrl} ${protocol}: invalid output stops once and hides provider text`, async () => {
    let calls = 0;
    await assert.rejects(generate(connection, input, { signal: AbortSignal.timeout(2000), maxTokens: 4096, jsonSchema: schema, transport: async () => {
      calls++;
      return Response.json(response(protocol, "PRIVATE_PROVIDER_TEXT not json synthetic-key-only"));
    } }), error => {
      assert(error instanceof AIError);
      assert.equal(error.code, "INVALID_STRUCTURED_OUTPUT");
      assert.doesNotMatch(String(error), /PRIVATE_PROVIDER_TEXT|synthetic-key-only/);
      return true;
    });
    assert.equal(calls, 1);
  });
}
test("structured output never streams unvalidated JSON or starts a paid request", async () => {
  let calls = 0;
  const [protocol, baseUrl] = targets[0];
  await assert.rejects(generate({ id: "fixture", purpose: "generation", protocol, baseUrl, model: "synthetic-model", apiKey: "synthetic-key-only", verifiedAt: null }, input, {
    signal: AbortSignal.timeout(2000), maxTokens: 4096, jsonSchema: schema, onToken() {},
    transport: async () => { calls++; return Response.json(response(protocol, '{"answer":"partial"}')); },
  }), /INVALID_GENERATION_INPUT/);
  assert.equal(calls, 0);
});
