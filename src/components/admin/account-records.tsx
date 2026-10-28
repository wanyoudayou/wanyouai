import { createSupabaseServerClient } from "@/lib/supabase/server";
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
  const client = await createSupabaseServerClient();
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
      .order("id", { ascending: false })
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
      kind === "orders" ? `订单 #${row.id}` : `权益 #${row.id} · ${row.type}`,
    href:
      kind === "orders"
        ? `/admin/payments/${row.id}`
        : `/admin/users/${userId}/entitlements`,
    cells: {
      details:
        kind === "orders"
          ? `${row.sku_type} · ${row.amount} · ${row.status}`
          : `${row.source} · ${row.revoked_at ? "已撤销" : row.ends_at ? `至 ${row.ends_at}` : "永久有效"}`,
      created: String(row.created_at),
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
