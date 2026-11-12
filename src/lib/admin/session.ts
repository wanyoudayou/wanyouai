import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserIdentity } from "@/lib/account/session";

export const getAdminIdentity = cache(async () => {
  const { user } = await getUserIdentity();
  if (!user) return { user: null, owner: false };
  const client = await createSupabaseServerClient();
  const result = await client.rpc("is_owner");
  if (result.error) throw new Error("暂时无法验证站主身份");
  return { user, owner: result.data === true };
});
