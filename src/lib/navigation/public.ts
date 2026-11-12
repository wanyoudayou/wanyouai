import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildNavigation, type PublicNavRow } from "./links";
import type { NavEntry } from "./types";

export type { PublicNavRow } from "./links";

/** 已启用且目标公开可读的导航行（RPC 只返回公开字段）。 */
export const getPublicNavRows = cache(async (): Promise<PublicNavRow[]> => {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("public_navigation");
  if (error || !Array.isArray(data)) throw new Error("导航暂时不可用");
  return data as PublicNavRow[];
});

/** 左栏自定义导航（两级：链接与可折叠的父级目录）。 */
export async function getNavigation(): Promise<NavEntry[]> {
  return buildNavigation(await getPublicNavRows());
}
