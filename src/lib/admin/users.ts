import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { deriveUserRows } from "@/lib/admin/users-derive";
import { readAllAdminRows, readAllAdminUsers } from "@/lib/admin/read-all";
import type {
  AdminUserRow,
  EntitlementLike,
  OrderLike,
} from "@/lib/admin/users-derive";

export type { AdminUserRow, AdminUserDetail } from "@/lib/admin/users-derive";
export { buildSubscriberCsv } from "@/lib/admin/users-derive";

/** 完整订阅者 CSV 导出专用；普通用户列表走分页聚合。调用方必须先验证站主。 */

async function fetchAll(
  service: ReturnType<typeof createSupabaseServiceClient>,
) {
  const [users, entitlements, orders] = await Promise.all([
    readAllAdminUsers(service),
    readAllAdminRows<EntitlementLike>(
      service,
      "entitlements",
      "id,user_id,type,ends_at,revoked_at,created_at",
    ),
    readAllAdminRows<OrderLike>(service, "orders", "id,user_id,created_at"),
  ]);
  return { users, entitlements, orders };
}

/** 用户列表（注册时间倒序），分页读取完整数据后按用户归组。 */
export async function listAdminUsers(): Promise<AdminUserRow[]> {
  const service = createSupabaseServiceClient();
  const { users, entitlements, orders } = await fetchAll(service);
  const now = new Date();
  return deriveUserRows(
    users.map((u) => ({
      id: u.id,
      email: u.email ?? "",
      created_at: u.created_at,
    })),
    entitlements,
    orders,
    now,
  );
}
