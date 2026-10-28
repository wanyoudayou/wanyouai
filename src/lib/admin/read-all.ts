import type { SupabaseClient, User } from "@supabase/supabase-js";
import { collectExportRows, collectExportUsers } from "./export-pagination";

type Query = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

/** Owner data paths only. Reuse the export's checked keyset reader; never trust the API row cap. */
export async function readAllAdminRows<T extends Record<string, unknown>>(
  client: SupabaseClient,
  table: string,
  columns: string,
  filter: (query: Query) => Query = (query) => query,
  key = "id",
): Promise<T[]> {
  try {
    return await collectExportRows<T>(table, [key], async (after, includeCount, size) => {
      let query = filter(client.from(table).select(columns, includeCount ? { count: "exact" } : {}))
        .order(key).limit(size);
      if (after !== null) query = query.gt(key, after);
      const result = await query;
      return { data: result.data as T[] | null, count: result.count, error: result.error };
    }, async () => {
      const result = await filter(client.from(table).select(columns, { count: "exact", head: true }));
      return { count: result.count, error: result.error };
    });
  } catch {
    throw new Error("后台数据读取不完整，请稍后重试");
  }
}

export async function readAllAdminUsers(client: SupabaseClient): Promise<User[]> {
  try {
    return await collectExportUsers<User>(async (page, perPage) => {
      const result = await client.auth.admin.listUsers({ page, perPage });
      return { users: result.data.users, total: "total" in result.data ? result.data.total : undefined, error: result.error };
    });
  } catch {
    throw new Error("用户数据读取不完整，请稍后重试");
  }
}
