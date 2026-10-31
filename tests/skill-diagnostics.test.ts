import test from "node:test";
import assert from "node:assert/strict";
import { AIError } from "../src/lib/ai/connections";
import { SkillError } from "../src/lib/skills/types";
import { skillTurnFailure } from "../src/lib/skills/diagnostics";

const turnId = "11111111-1111-4111-8111-111111111111";
const callId = "22222222-2222-4222-8222-222222222222";
function inspect(error: unknown, dispatched = true, signal = new AbortController().signal) {
  const events: { label: string; event: Record<string, unknown> }[] = [];
  const failure = skillTurnFailure(error, { turnId, callIds: [callId], dispatched, signal }, (label, event) => events.push({ label, event }));
  return { failure, events };
}
test("rate, provider and timeout failures have precise codes and the same public operation reference", () => {
  for (const [error, code] of [[new AIError("AI_CALL_RATE_LIMIT"), "AI_CALL_RATE_LIMIT"], [new AIError("PROVIDER_HTTP_ERROR", 429), "PROVIDER_HTTP_ERROR"], [new AIError("INVALID_STRUCTURED_OUTPUT"), "INVALID_STRUCTURED_OUTPUT"]] as const) {
    const result = inspect(error);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].event.code, code);
    assert.equal(result.events[0].event.turnId, turnId);
    assert.deepEqual(result.events[0].event.callIds, [callId]);
    assert(result.failure.message.includes(turnId));
    assert(result.failure.message.includes("不会自动重试"));
    assert.equal(result.failure.status, 503);
  }
  const deadline = new AbortController(); deadline.abort(new DOMException("PRIVATE_REASON", "TimeoutError"));
  assert.equal(inspect(new Error("PRIVATE_BODY"), true, deadline.signal).events[0].event.code, "TURN_TIMEOUT");
});
test("raw errors, unknown codes, keys, invalid IDs and non-HTTP statuses never enter logs or public messages", () => {
  for (const error of [new Error("PRIVATE_BODY synthetic-key-only"), new AIError("PRIVATE_BODY", 123456)]) {
    const result = inspect(error);
    assert.equal(result.events[0].event.code, "UNEXPECTED_FAILURE");
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_BODY|synthetic-key-only|123456/);
  }
  const events: unknown[] = [];
  skillTurnFailure(new Error("PRIVATE_BODY"), { turnId: "synthetic-key-only", callIds: ["private@mail.invalid", callId, callId, callId, callId], dispatched: false, signal: new AbortController().signal }, (_label, event) => events.push(event));
  assert.doesNotMatch(JSON.stringify(events), /synthetic-key-only|private@mail.invalid/);
  assert.equal((events[0] as { callIds: unknown[] }).callIds.length, 3);
});
test("validation status survives diagnostics and undispatched failures do not claim model charges", () => {
  const validation = inspect(new SkillError("权限已失效。", 403), false);
  assert.equal(validation.failure.status, 403); assert(validation.failure.message.includes("权限已失效"));
  const result = inspect(new AIError("AI_BUDGET_UNAVAILABLE"), false);
  assert(result.failure.message.includes("未派发模型调用"));
  assert.doesNotMatch(result.failure.message, /可能计费/);
  assert(inspect(new AIError("AI_CALL_RATE_LIMIT"), false).failure.message.includes("调用过于频繁"));
});
test("a failed log sink does not replace the controlled error with a new exception", () => {
  const failure = skillTurnFailure(new AIError("PROVIDER_HTTP_ERROR", 503), { turnId, callIds: [callId], dispatched: true, signal: new AbortController().signal }, () => { throw new Error("PRIVATE_LOG_SINK"); });
  assert(failure instanceof SkillError); assert.equal(failure.status, 503);
  assert.doesNotMatch(failure.message, /PRIVATE_LOG_SINK/);
});
