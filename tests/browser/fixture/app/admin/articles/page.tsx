import { AdminDataTable } from "@/components/admin/admin-data-table";
import { parseListQuery, type RawListQuery } from "@/lib/admin/list-query";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawListQuery>;
}) {
  const q = parseListQuery(await searchParams);
  let all = Array.from({ length: 21 }, (_, i) => ({
    key: String(i + 1),
    title: `文章 ${i + 1}`,
    href: "/admin/content",
    cells: { status: i % 2 ? "已发布" : "待审核", version: `v${i + 1}` },
  }));
  if (q.q) all = all.filter((r) => r.title.includes(q.q));
  const total = all.length;
  const rows = all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
  return (
    <section className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">文章管理</h1>
      <AdminDataTable
        rows={rows}
        columns={[
          { key: "status", label: "状态" },
          { key: "version", label: "版本" },
        ]}
        total={total}
        query={q}
        create={{ label: "新建文章", href: "/admin/content" }}
      />
    </section>
  );
}
