import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Entitlement, Reader } from "@/types/reading";

export const getReader = cache(async (): Promise<Reader> => {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  // 过期或失效的登录凭据按匿名读者处理（与 account/session.ts 一致），只有服务故障才失败关闭。
  if (error && error.name !== "AuthSessionMissingError" && error.status !== 401 && error.status !== 403) throw new Error("会话验证暂时不可用");
  if (!user) return { userId: null, owner: false, entitlements: [] };
  const [profile, entitlements] = await Promise.all([
    supabase.from("profiles").select("is_owner").eq("id", user.id).maybeSingle(),
    supabase.from("entitlements").select("user_id, type, target_id, ends_at, revoked_at").eq("user_id", user.id).is("revoked_at", null).lte("starts_at", new Date().toISOString()),
  ]);
  if (profile.error || entitlements.error) throw new Error("阅读权限暂时不可用");
  return { userId: user.id, owner: profile.data?.is_owner === true, entitlements: (entitlements.data ?? []) as Entitlement[] };
});
