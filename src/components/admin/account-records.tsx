import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSiteConfig } from "@/lib/get-site-config";
import { formatDateTime, formatPrice } from "@/lib/format";
import { ADMIN_LABELS } from "@/lib/admin/list-labels";

const SKU_LABELS: Record<string, string> = { subscription: "订阅", series: "手册", single: "单篇", event: "活动票", skill: "技能" };
const SOURCE_LABELS: Record<string, string> = { order: "购买", admin: "站主开通", checkin: "到场核销" };
import { AdminDataTable } from "./admin-data-table";
import {
  parseListQuery,
  lastPage,
  type RawListQuery,
} from "@/lib/admin/list-query";

export async function AccountRecords({
  userId,
  kind,
  params,
}: {
  userId: string;
  kind: "orders" | "entitlements";
  params: RawListQuery;
}) {
  const query = parseListQuery(params);
  query.q = "";
  const [client, site] = await Promise.all([createSupabaseServerClient(), getSiteConfig()]);
  const tz = site.identity.timezone;
  const currency = site.commerce.subscriptionPrice?.currency ?? "CNY";
  const select =
    kind === "orders"
      ? "id,sku_type,amount,status,created_at"
      : "id,type,target_id,starts_at,ends_at,revoked_at,source,created_at";
  const read = (page: number) =>
    client
      .from(kind)
      .select(select, { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: query.sort === "oldest" })
      .order("id", { ascending: query.sort === "oldest" })
      .range((page - 1) * query.pageSize, page * query.pageSize - 1);
  let result = await read(query.page);
  if (result.error || result.count === null)
    throw new Error("账户记录暂时不可用");
  const page = Math.min(query.page, lastPage(result.count, query.pageSize));
  if (page !== query.page) {
    query.page = page;
    result = await read(page);
  }
  if (result.error || result.count === null)
    throw new Error("账户记录暂时不可用");
  const rows = (
    (result.data as unknown as Record<string, unknown>[]) ?? []
  ).map((row) => ({
    key: String(row.id),
    title:
      kind === "orders" ? `订单 #${row.id}` : `权益 #${row.id} · ${SKU_LABELS[String(row.type)] ?? row.type}`,
    href:
      kind === "orders"
        ? `/admin/payments/${row.id}`
        : `/admin/users/${userId}/entitlements`,
    cells: {
      details:
        kind === "orders"
          ? `${SKU_LABELS[String(row.sku_type)] ?? row.sku_type} · ${formatPrice(Number(row.amount), currency)} · ${ADMIN_LABELS[String(row.status)] ?? row.status}`
          : `${SOURCE_LABELS[String(row.source)] ?? row.source} · ${row.revoked_at ? "已撤销" : row.ends_at ? `至 ${formatDateTime(String(row.ends_at), tz)}` : "永久有效"}`,
      created: formatDateTime(String(row.created_at), tz),
    },
  }));
  return (
    <AdminDataTable
      rows={rows}
      columns={[
        {
          key: "details",
          label: kind === "orders" ? "商品／金额／状态" : "来源／有效期",
        },
        { key: "created", label: "创建时间" },
      ]}
      total={result.count}
      query={query}
      searchable={false}
      sorts={["newest", "oldest"]}
    />
  );
}
