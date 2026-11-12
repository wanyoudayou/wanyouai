import "server-only";

import type { createSupabaseServerClient } from "@/lib/supabase/server";

/** RLS 仅返回当前会话的权益；卡片只消费已购布尔值。 */
export async function getListOwnership(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data, error } = await supabase.from("entitlements")
    .select("type, target_id, ends_at")
    .is("revoked_at", null);
  if (error) throw new Error("无法加载内容权益");
  const now = Date.now();
  const active = (data ?? []).filter((row) => row.ends_at === null || Date.parse(row.ends_at) > now);
  return (type: "single" | "series" | "event", id: number) =>
    active.some((row) => row.type === type && row.target_id === id);
}
