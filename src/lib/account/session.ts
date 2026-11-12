import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** User-side identity (/login). Distinct from the admin owner identity. */
export const getUserIdentity = cache(async () => {
  const client = await createSupabaseServerClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error && error.name !== "AuthSessionMissingError" && error.status !== 401 && error.status !== 403) throw new Error("暂时无法验证登录状态");
  if (!user) return { user: null as null | { id: string; email: string } };
  return { user: { id: user.id, email: user.email ?? "" } };
});
