import { AIError } from "../ai/connections";
import { SkillError, uuid } from "./types";

const CODES = new Set([
  "AI_CALL_RATE_LIMIT", "AI_CALL_DAILY_LIMIT", "AI_CALL_MONTHLY_LIMIT", "AI_CALL_DISABLED", "AI_CALL_UNVERIFIED", "AI_CALL_DUPLICATE",
  "AI_BUDGET_UNAVAILABLE", "AI_DISPATCH_UNAVAILABLE", "AI_CONNECTION_CHANGED", "INVALID_CREDENTIAL",
  "DNS_UNAVAILABLE", "UNSAFE_PROVIDER_ADDRESS", "PROVIDER_HTTP_ERROR", "PROVIDER_REDIRECT_DENIED", "PROVIDER_UNAVAILABLE",
  "PROVIDER_CANCELLED", "PROVIDER_INTERRUPTED", "PROVIDER_INPUT_TOO_LARGE", "PROVIDER_RESPONSE_TOO_LARGE",
  "INVALID_PROVIDER_RESPONSE", "INVALID_PROVIDER_JSON", "INVALID_STRUCTURED_OUTPUT", "INVALID_GENERATION_TEXT", "GENERATION_INCOMPLETE",
]);

/** IDs and fixed codes only: provider errors may contain prompts, bodies or keys. */
export function skillTurnFailure(error: unknown, context: {
  turnId: string; callIds: string[]; dispatched: boolean; signal: AbortSignal;
}, log: (label: string, event: Record<string, unknown>) => void = console.error): SkillError {
  const turnId = uuid(context.turnId) ? context.turnId : "invalid";
  const code = error instanceof AIError && CODES.has(error.code) ? error.code
    : context.signal.aborted ? context.signal.reason?.name === "TimeoutError" ? "TURN_TIMEOUT" : "TURN_CANCELLED"
    : error instanceof SkillError ? "SKILL_REJECTED" : "UNEXPECTED_FAILURE";
  const status = error instanceof AIError && Number.isInteger(error.httpStatus) && error.httpStatus! >= 300 && error.httpStatus! <= 599 ? error.httpStatus : undefined;
  try {
    log("[skill] turn_failed", {
      turnId, callIds: context.callIds.filter(uuid).slice(0, 3), code,
      ...(status === undefined ? {} : { providerStatus: status }), dispatched: context.dispatched,
    });
  } catch { /* Logging must not prevent the existing turn failure path. */ }
  const reference = `（参考编号：${turnId}）`;
  if (error instanceof SkillError) return new SkillError(error.message + reference, error.status);
  const reason = code === "AI_CALL_RATE_LIMIT" ? "调用过于频繁，本轮已停止。"
    : code === "AI_CALL_DAILY_LIMIT" || code === "AI_CALL_MONTHLY_LIMIT" ? "调用额度已达上限，本轮已停止。"
    : code === "TURN_TIMEOUT" || code === "PROVIDER_CANCELLED" || code === "TURN_CANCELLED" ? "本轮处理已超时或中断。"
    : code === "INVALID_STRUCTURED_OUTPUT" || code === "INVALID_GENERATION_TEXT" || code === "GENERATION_INCOMPLETE" ? "模型未返回完整、有效的结果。"
    : "本轮未完成。";
  return new SkillError(reason + (context.dispatched
    ? "已派发调用可能计费；不会自动重试，请先查询本轮状态。"
    : "本轮未派发模型调用，请站主按参考编号核对状态。") + reference, 503);
}
