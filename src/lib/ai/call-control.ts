import type { createSupabaseServiceClient } from "../supabase/service";
import { AIError, tokenCount } from "./connections";

type Service = ReturnType<typeof createSupabaseServiceClient>;
export type AITask = "avatar" | "page" | "generation_probe" | "embedding_probe" | "retrieval" | "knowledge_questions" | "knowledge_preview" | "knowledge_preview_retrieval" | "skill";
export type AICallRequest = { id: string; task: AITask; connectionId: string; userId: string | null; ip?: string | null };
export async function finishAICall(service: Service, id: string, outcome: "released" | "unknown" | "succeeded", usage?: { prompt_tokens: number; completion_tokens: number }) {
  try {
    const { data, error } = await service.rpc("finish_ai_call", { p_request: id, p_outcome: outcome, p_tokens_in: tokenCount(usage?.prompt_tokens), p_tokens_out: tokenCount(usage?.completion_tokens) });
    if (error || data !== true) throw new AIError("AI_ACCOUNTING_UNAVAILABLE");
  } catch { console.error("[ai] 调用状态未确认，已派发额度保留"); }
}

/** Dispatch is the authority boundary. Unknown network outcomes are never retried here. */
export async function withAICall<T>(service: Service, request: {
  id: string; task: AITask; connectionId: string; userId: string | null; ip?: string | null;
}, operation: () => Promise<{ value: T; usage?: { prompt_tokens: number; completion_tokens: number } }>): Promise<T> {
  await reserveAICall(service, request);
  await dispatchAICall(service, request.id);
  try {
    const result = await operation();
    await finishAICall(service, request.id, "succeeded", result.usage);
    return result.value;
  } catch (error) {
    await finishAICall(service, request.id, "unknown");
    throw error;
  }
}

export async function reserveAICall(service: Service, request: AICallRequest) {
  const { data: reserved, error } = await service.rpc("reserve_ai_call", {
    p_request: request.id, p_task: request.task, p_connection: request.connectionId, p_user: request.userId, p_ip: request.ip ?? null,
  });
  if (error) throw new AIError("AI_BUDGET_UNAVAILABLE");
  if (reserved !== "reserved") throw new AIError(["duplicate", "daily_limit", "monthly_limit", "rate_limit", "disabled", "unverified"].includes(reserved) ? `AI_CALL_${String(reserved).toUpperCase()}` : "AI_BUDGET_UNAVAILABLE");
}

export async function dispatchAICall(service: Service, id: string) {
  try {
    const dispatched = await service.rpc("dispatch_ai_call", { p_request: id });
    if (dispatched.error || dispatched.data !== true) throw new AIError("AI_DISPATCH_UNAVAILABLE");
  } catch {
    await finishAICall(service, id, "released");
    throw new AIError("AI_DISPATCH_UNAVAILABLE");
  }
}
