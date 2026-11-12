/** 后台用户列表的纯推导层。无服务端依赖、不 import "server-only"，供 tsx 单测直接导入。 */

export type AdminUserRow = {
  id: string;
  email: string;
  registeredAt: string;
  /** 是否有有效订阅（含永久）。 */
  subscriptionActive: boolean;
  /** 有效订阅的最晚到期时间；null = 无有效订阅或永久有效。 */
  subscriptionEndsAt: string | null;
  lastActiveAt: string;
  orderCount: number;
};

export type AdminUserDetail = {
  user: AdminUserRow;
  orders: { id: number; sku_type: string; target_id: number | null; amount: number; status: string; created_at: string }[];
  entitlements: { id: number; type: string; target_id: number | null; starts_at: string; ends_at: string | null; revoked_at: string | null; source: string }[];
};

export type EntitlementLike = { user_id: string; type: string; ends_at: string | null; revoked_at: string | null; created_at: string };
export type OrderLike = { user_id: string; created_at: string };
export type UserLike = { id: string; email: string; created_at: string };

/** Group once, so the list does not rescan every order for every user. */
export function deriveUserRows(users: UserLike[], entitlements: EntitlementLike[], orders: OrderLike[], now: Date): AdminUserRow[] {
  function group<T extends { user_id: string }>(rows: T[]): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    for (const row of rows) {
      const existing = groups.get(row.user_id);
      if (existing) existing.push(row);
      else groups.set(row.user_id, [row]);
    }
    return groups;
  }
  const rightsByUser = group(entitlements);
  const ordersByUser = group(orders);
  return users.map((user) => deriveUserRow(user, rightsByUser.get(user.id) ?? [], ordersByUser.get(user.id) ?? [], now))
    .sort((a, b) => Date.parse(b.registeredAt) - Date.parse(a.registeredAt));
}

/** 纯函数：由 auth 用户 + 权益 + 订单推导列表行（订阅状态 / 最近活跃 / 订单数）。 */
export function deriveUserRow(
  user: { id: string; email: string; created_at: string },
  entitlements: EntitlementLike[],
  orders: OrderLike[],
  now: Date,
): AdminUserRow {
  const mine = entitlements.filter((e) => e.user_id === user.id);
  const myOrders = orders.filter((o) => o.user_id === user.id);
  const activeSubs = mine.filter((e) => e.type === "subscription" && !e.revoked_at && (!e.ends_at || Date.parse(e.ends_at) > now.getTime()));
  const subEnds = activeSubs.map((e) => e.ends_at).filter((v): v is string => v !== null).sort();
  const activity = [user.created_at, ...mine.map((e) => e.created_at), ...myOrders.map((o) => o.created_at)]
    .filter((v) => Number.isFinite(Date.parse(v)))
    .sort();
  return {
    id: user.id,
    email: user.email,
    registeredAt: user.created_at,
    subscriptionActive: activeSubs.length > 0,
    subscriptionEndsAt: subEnds[subEnds.length - 1] ?? null,
    lastActiveAt: activity[activity.length - 1] ?? user.created_at,
    orderCount: myOrders.length,
  };
}

/** 运营邮件名单 CSV：仅有效订阅者。 */
export function buildSubscriberCsv(rows: AdminUserRow[]): string {
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ["email,subscription_ends_at"];
  for (const row of rows) {
    if (!row.subscriptionActive) continue;
    lines.push(`${escape(row.email)},${row.subscriptionEndsAt ?? "永久"}`);
  }
  return lines.join("\n") + "\n";
}
