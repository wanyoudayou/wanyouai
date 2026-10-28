import type { createSupabaseServiceClient } from "../supabase/service";

type Service = ReturnType<typeof createSupabaseServiceClient>;
export const DAILY_LIMIT = { subscriber: 100, registered: 20, anonymous: 5 } as const;

export async function reserveGeneration(service: Service, requestId: string, userId: string | null, ip: string | null, model: string) {
  const { data, error } = await service.rpc("reserve_avatar_generation", {
    p_request_id: requestId, p_user_id: userId, p_ip: ip, p_model: model,
  });
  if (error || !["reserved", "duplicate", "daily_limit", "monthly_limit", "disabled"].includes(data)) throw new Error("Generation quota unavailable");
  return data as "reserved" | "duplicate" | "daily_limit" | "monthly_limit" | "disabled";
}

export async function dispatchGeneration(service: Service, requestId: string): Promise<boolean> {
  const { data, error } = await service.rpc("dispatch_avatar_generation", { p_request_id: requestId });
  if (error || typeof data !== "boolean") throw new Error("Generation dispatch unavailable");
  return data;
}

const tokens = (value?: number) => Number.isSafeInteger(value) && value! >= 0 && value! <= 2_147_483_647 ? value! : 0;

/** Never throws after provider I/O. A failed write leaves dispatched usage charged. */
export async function finishGeneration(service: Service, requestId: string, outcome: "succeeded" | "unknown" | "released", usage?: { prompt_tokens?: number; completion_tokens?: number } | null) {
  try {
    const { data, error } = await service.rpc("finish_avatar_generation", {
      p_request_id: requestId, p_outcome: outcome,
      p_tokens_in: tokens(usage?.prompt_tokens), p_tokens_out: tokens(usage?.completion_tokens),
    });
    if (error || data !== true) throw new Error("Generation accounting unavailable");
  } catch {
    console.error("[avatar] 生成状态写回失败，请核对供应商用量；已派发额度保留");
  }
}
