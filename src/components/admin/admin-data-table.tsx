"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import {
  safeAdminReturn,
  lastPage,
  listQueryString,
  type ListQuery,
} from "@/lib/admin/list-query";

export type AdminTableRow = {
  key: string;
  title: string;
  href: string;
  description?: string;
  cells: Record<string, string>;
  actions?: { label: string; href: string }[];
};
export type AdminColumn = { key: string; label: string };
import { ADMIN_LABELS } from "@/lib/admin/list-labels";

export function AdminDataTable({
  rows,
  columns,
  total,
  query,
  statuses = [],
  types = [],
  create,
  sorts = ["newest", "oldest", "title"],
  searchable = true,
}: {
  rows: AdminTableRow[];
  columns: AdminColumn[];
  total: number;
  query: ListQuery;
  statuses?: readonly string[];
  types?: readonly string[];
  create?: { label: string; href: string };
  sorts?: string[];
  searchable?: boolean;
}) {
  const pathname = usePathname();
  const returnTo = safeAdminReturn(useSearchParams().get("returnTo"), "");
  const definitions = useMemo<ColumnDef<AdminTableRow>[]>(
    () => [
      {
        id: "title",
        header: "名称",
        cell: ({ row }) => (
          <div className="min-w-40 max-w-md">
            <Link
              href={row.original.href}
              className="break-words font-medium text-primary hover:underline"
            >
              {row.original.title}
            </Link>
            {row.original.description && (
              <p className="mt-1 break-words text-xs text-muted-foreground">
                {row.original.description}
              </p>
            )}
          </div>
        ),
      },
      ...columns.map(
        (column): ColumnDef<AdminTableRow> => ({
          id: column.key,
          header: column.label,
          cell: ({ row }) => (
            <span className="break-words">
              {row.original.cells[column.key] ?? "—"}
            </span>
          ),
        }),
      ),
      {
        id: "actions",
        header: "操作",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-3">
            {(row.original.actions ?? []).map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="whitespace-nowrap text-primary underline-offset-4 hover:underline"
              >
                {action.label}
              </Link>
            ))}
          </div>
        ),
      },
    ],
    [columns],
  );
  // The URL owns pagination/filtering; only the current authorized page reaches the table.
  // React Compiler must not memoize TanStack's mutable instance.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns: definitions,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.key,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    rowCount: total,
    state: {
      pagination: { pageIndex: query.page - 1, pageSize: query.pageSize },
    },
  });
  const pages = lastPage(total, query.pageSize);
  const go = (page: number) => {
    const params = new URLSearchParams(listQueryString(query, { page }));
    if (returnTo) params.set("returnTo", returnTo);
    return `${pathname}?${params}`;
  };
  const filtered = !!(query.q || query.status || query.type);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <form
          method="get"
          action={pathname}
          className="flex min-w-0 flex-wrap items-center gap-2"
          aria-label="列表筛选"
        >
          {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
          {query.series && (
            <input type="hidden" name="series" value={query.series} />
          )}
          {searchable && (
            <input
              name="q"
              type="search"
              aria-label="搜索"
              placeholder="搜索…"
              maxLength={120}
              defaultValue={query.q}
              className="h-10 w-44 rounded-lg border bg-background px-3 text-sm"
            />
          )}
          {statuses.length > 0 && (
            <select
              name="status"
              aria-label="状态"
              defaultValue={query.status}
              className="h-10 rounded-lg border bg-background px-2 text-sm"
            >
              <option value="">全部状态</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {ADMIN_LABELS[status] ?? status}
                </option>
              ))}
            </select>
          )}
          {types.length > 0 && (
            <select
              name="type"
              aria-label="类型"
              defaultValue={query.type}
              className="h-10 rounded-lg border bg-background px-2 text-sm"
            >
              <option value="">全部类型</option>
              {types.map((type) => (
                <option key={type} value={type}>
                  {ADMIN_LABELS[type] ?? type}
                </option>
              ))}
            </select>
          )}
          <select
            name="sort"
            aria-label="排序"
            defaultValue={query.sort}
            className="h-10 rounded-lg border bg-background px-2 text-sm"
          >
            {sorts.map((sort) => (
              <option key={sort} value={sort}>
                {
                  {
                    newest: "最近优先",
                    oldest: "最早优先",
                    title: "标题排序",
                    reading: "阅读顺序",
                    active: "最近业务活动",
                  }[sort]
                }
              </option>
            ))}
          </select>
          <select
            name="pageSize"
            aria-label="每页数量"
            defaultValue={query.pageSize}
            className="h-10 rounded-lg border bg-background px-2 text-sm"
          >
            {[20, 50, 100].map((size) => (
              <option key={size} value={size}>
                每页 {size} 条
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline">
            查询
          </Button>
          {filtered && (
            <Link
              href={
                pathname +
                (query.series
                  ? `?series=${encodeURIComponent(query.series)}`
                  : "")
              }
              className="px-2 text-sm text-primary"
            >
              清除筛选
            </Link>
          )}
        </form>
        {create && (
          <Button asChild>
            <Link href={create.href}>{create.label}</Link>
          </Button>
        )}
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {total === 0
          ? "0 条记录"
          : `显示第 ${(query.page - 1) * query.pageSize + 1}–${Math.min(query.page * query.pageSize, total)} 条，${filtered ? "当前筛选" : "共"} ${total} 条`}
      </p>
      {rows.length ? (
        <>
          <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/70">
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    {group.headers.map((header) => (
                      <th
                        key={header.id}
                        scope="col"
                        className="px-4 py-3 font-medium"
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y">
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="align-top hover:bg-muted/40">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-4">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-3 md:hidden">
            {rows.map((row) => (
              <li
                key={row.key}
                className="space-y-3 rounded-xl border bg-card p-4"
              >
                <Link
                  href={row.href}
                  className="break-words font-medium text-primary"
                >
                  {row.title}
                </Link>
                {row.description && (
                  <p className="break-words text-xs text-muted-foreground">
                    {row.description}
                  </p>
                )}
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                  {columns.map((column) => (
                    <div key={column.key} className="contents">
                      <dt className="text-muted-foreground">{column.label}</dt>
                      <dd className="break-words">
                        {row.cells[column.key] ?? "—"}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="flex flex-wrap gap-4 text-sm">
                  {row.actions?.map((action) => (
                    <Link
                      key={action.href}
                      href={action.href}
                      className="text-primary underline"
                    >
                      {action.label}
                    </Link>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="rounded-xl border border-dashed bg-card p-8 text-center text-muted-foreground">
          {filtered
            ? "没有符合筛选条件的记录。请修改或清除条件。"
            : "还没有记录。"}
        </div>
      )}
      {total > 0 && (
        <nav
          aria-label="列表分页"
          className="flex flex-wrap items-center justify-between gap-3 text-sm"
        >
          <span>
            第 {query.page} / {pages} 页
          </span>
          <div className="flex gap-2">
            {[
              [1, "首页"],
              [query.page - 1, "上一页"],
              [query.page + 1, "下一页"],
              [pages, "末页"],
            ].map(([page, label], index) => (
              <Button
                key={index}
                asChild
                size="sm"
                variant="outline"
                disabled={index < 2 ? query.page === 1 : query.page === pages}
              >
                <Link
                  href={go(Math.max(1, Math.min(pages, Number(page))))}
                  aria-disabled={
                    index < 2 ? query.page === 1 : query.page === pages
                  }
                  className={
                    (index < 2 ? query.page === 1 : query.page === pages)
                      ? "pointer-events-none opacity-40"
                      : undefined
                  }
                  tabIndex={
                    (index < 2 ? query.page === 1 : query.page === pages)
                      ? -1
                      : undefined
                  }
                >
                  {label}
                </Link>
              </Button>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
