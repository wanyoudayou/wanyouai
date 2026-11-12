import "server-only";

import type { createSupabaseServerClient } from "@/lib/supabase/server";

/** 只取当前账户已生效的权益（站主的 RLS 可读全部行，必须显式按本人过滤）；卡片只消费已购布尔值。 */
export async function getListOwnership(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return () => false;
  const { data, error } = await supabase.from("entitlements")
    .select("type, target_id, ends_at")
    .eq("user_id", user.id)
    .lte("starts_at", new Date().toISOString())
    .is("revoked_at", null);
  if (error) throw new Error("无法加载内容权益");
  const now = Date.now();
  const active = (data ?? []).filter((row) => row.ends_at === null || Date.parse(row.ends_at) > now);
  return (type: "single" | "series" | "event", id: number) =>
    active.some((row) => row.type === type && row.target_id === id);
}
