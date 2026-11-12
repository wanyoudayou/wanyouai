import "server-only";
import type { createSupabaseServiceClient } from "@/lib/supabase/service";

type Service = ReturnType<typeof createSupabaseServiceClient>;

/** Site-local calendar day (YYYY-MM-DD) so "每日" resets at local midnight, not UTC. */
export function siteDay(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Atomically consume one unit of a daily bucket. Returns false when the limit is
 * reached; throws when the limiter is unavailable so callers fail closed.
 */
export async function consumeDailyLimit(service: Service, bucket: string, limit: number, timeZone: string): Promise<boolean> {
  const { data, error } = await service.rpc("consume_request_limit", { p_bucket: bucket.slice(0, 200), p_day: siteDay(timeZone), p_limit: limit });
  if (error || typeof data !== "boolean") throw new Error("Request limiter unavailable");
  return data;
}

/** Client address for rate limiting; Vercel sets x-forwarded-for, self-hosts should set x-real-ip. */
export function clientAddress(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
}
