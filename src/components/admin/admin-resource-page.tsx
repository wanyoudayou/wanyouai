import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminIdentity } from "@/lib/admin/session";
import {
  getAdminResourcePage,
  RESOURCES,
  type ResourceKind,
  type ListRecord,
} from "@/lib/admin/list-resources";
import {
  AdminDataTable,
  type AdminColumn,
  type AdminTableRow,
} from "./admin-data-table";
import { getSiteConfig } from "@/lib/get-site-config";
import { seriesPath } from "@/lib/content-kinds";
import { formatPrice } from "@/lib/format";
import { listQueryString, type RawListQuery } from "@/lib/admin/list-query";

import { ADMIN_LABELS } from "@/lib/admin/list-labels";

const text = (value: unknown) =>
  value === null || value === undefined ? "—" : String(value);
const label = (value: unknown) => ADMIN_LABELS[text(value)] ?? text(value);
const COLUMNS: Record<ResourceKind, AdminColumn[]> = {
  articles: [
    { key: "location", label: "所属位置" },
    { key: "status", label: "线上状态" },
    { key: "revision", label: "修订" },
    { key: "updated", label: "最近编辑" },
  ],
  collections: [
    { key: "kind", label: "类型" },
    { key: "status", label: "状态" },
    { key: "chapters", label: "章节（不含介绍）" },
    { key: "nav", label: "侧栏" },
    { key: "updated", label: "最近编辑" },
  ],
  pages: [
    { key: "address", label: "地址" },
    { key: "status", label: "状态" },
    { key: "placement", label: "位置" },
    { key: "updated", label: "最近编辑" },
  ],
  services: [
    { key: "status", label: "状态" },
    { key: "amount", label: "价格" },
    { key: "updated", label: "最近编辑" },
  ],
  payments: [
    { key: "buyer", label: "账户" },
    { key: "sku", label: "商品" },
    { key: "amount", label: "金额" },
    { key: "status", label: "状态" },
    { key: "created", label: "创建时间" },
  ],
  users: [
    { key: "subscription", label: "订阅" },
    { key: "count", label: "订单总数" },
    { key: "active", label: "最近业务活动" },
    { key: "created", label: "注册时间" },
  ],
  inbox: [
    { key: "status", label: "状态" },
    { key: "created", label: "收到时间" },
  ],
  conversations: [
    { key: "status", label: "状态" },
    { key: "created", label: "创建时间" },
  ],
  bookings: [
    { key: "buyer", label: "联系邮箱" },
    { key: "status", label: "状态" },
    { key: "created", label: "创建时间" },
  ],
  registrations: [
    { key: "status", label: "状态" },
    { key: "created", label: "报名时间" },
  ],
};

export async function AdminResourcePage({
  resource,
  params,
}: {
  resource: ResourceKind;
  params: RawListQuery;
}) {
  if (!(await getAdminIdentity()).owner) redirect("/admin");
  const [data, site] = await Promise.all([
    getAdminResourcePage(resource, params),
    getSiteConfig(),
  ]);
  const spec = RESOURCES[resource];
  const date = (value: unknown) =>
    typeof value === "string" && Number.isFinite(Date.parse(value))
      ? new Intl.DateTimeFormat("zh-CN", {
          timeZone: site.identity.timezone,
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(value))
      : "—";
  const money = (value: unknown) =>
    value === null
      ? "询价"
      : formatPrice(
          Number(value),
          site.commerce.subscriptionPrice?.currency ?? "CNY",
        );
  const returnTo = `${resource === "bookings" ? "/admin/orders" : `/admin/${resource}`}${listQueryString(data.query)}`;
  const rows = data.items.map((row: ListRecord): AdminTableRow => {
    const id = text(row.id);
    const base = {
      key: id,
      title: text(row.title),
      href: `/admin/${resource}/${id}?returnTo=${encodeURIComponent(returnTo)}`,
      cells: {
        status: label(row.status),
        updated: date(row.updated_at),
        created: date(row.created_at),
      },
      actions: [] as { label: string; href: string }[],
    };
    if (resource === "articles") {
      const href = row.article_id
        ? `/admin/articles/${row.article_id}?returnTo=${encodeURIComponent(returnTo)}`
        : `/admin/revisions/${row.pending_revision_id}?returnTo=${encodeURIComponent(returnTo)}`;
      const online =
        row.type === "skill" ? `/skills/${row.slug}` : row.type === "blog"
          ? `/blog/${row.slug}`
          : row.series_type && row.series_slug
            ? `${seriesPath({ type: text(row.series_type), slug: text(row.series_slug) })}${row.is_readme ? "" : `?article=${encodeURIComponent(text(row.slug))}`}`
            : null;
      return {
        ...base,
        key: text(row.document_key),
        title: text(row.title),
        href,
        description: `${row.is_readme ? "介绍页 · " : ""}${text(row.slug)}${row.pending_title && row.pending_title !== row.title ? ` · 待审标题：${row.pending_title}` : ""}`,
        cells: {
          ...base.cells,
          location: row.series_title ? text(row.series_title) : row.type === "skill" ? "Skill 介绍" : "独立博客",
          status: `${row.article_id ? label(row.status) : "未发布"}${Number(row.online_version) > 0 ? ` v${row.online_version}` : ""}`,
          revision: row.pending_revision_id
            ? `待审核 v${row.pending_version}`
            : "—",
        },
        actions: [
          ...(row.article_id && row.status !== "archived"
            ? [
                {
                  label: "编辑",
                  href: `/admin/content?article=${row.article_id}&returnTo=${encodeURIComponent(returnTo)}`,
                },
              ]
            : []),
          ...(row.pending_revision_id
            ? [
                {
                  label: "审核",
                  href: `/admin/revisions/${row.pending_revision_id}?returnTo=${encodeURIComponent(returnTo)}`,
                },
              ]
            : []),
          ...(online && ["published", "paused"].includes(text(row.status))
            ? [{ label: "查看线上", href: online }]
            : []),
        ],
      };
    }
    if (resource === "collections")
      return {
        ...base,
        description: text(row.slug),
        cells: {
          ...base.cells,
          kind: label(row.type),
          chapters: text(row.chapter_count),
          nav: row.nav_enabled ? text(row.nav_label || row.title) : "未显示",
        },
        actions: [
          { label: "管理专辑", href: base.href },
          ...(["published", "paused"].includes(text(row.status))
            ? [
                {
                  label: "查看线上",
                  href: seriesPath({
                    type: text(row.type),
                    slug: text(row.slug),
                  }),
                },
              ]
            : []),
        ],
      };
    if (resource === "pages")
      return {
        ...base,
        cells: {
          ...base.cells,
          address: `/p/${row.slug}`,
          placement:
            (
              { nav: "侧栏", footer: "页脚", none: "不固定" } as Record<
                string,
                string
              >
            )[text(row.placement)] ?? "—",
        },
        actions: [
          { label: "编辑", href: base.href },
          ...(row.status === "published"
            ? [{ label: "查看线上", href: `/p/${row.slug}` }]
            : []),
        ],
      };
    if (resource === "services")
      return {
        ...base,
        cells: { ...base.cells, amount: money(row.price) },
        actions: [
          { label: "编辑服务", href: base.href },
          { label: "服务履约", href: "/admin/orders" },
        ],
      };
    if (resource === "payments")
      return {
        ...base,
        title: `订单 #${id}`,
        description: text(row.merchant_order_no),
        cells: {
          ...base.cells,
          buyer: text(row.user_id),
          sku: text(row.sku_type),
          amount: money(row.amount),
        },
        actions: [
          { label: "查看订单", href: base.href },
          { label: "账户权益", href: `/admin/users/${row.user_id}` },
        ],
      };
    if (resource === "users")
      return {
        ...base,
        title: text(row.email),
        description: row.displayName ? text(row.displayName) : undefined,
        cells: {
          subscription: row.subscriptionActive
            ? `有效${row.subscriptionEndsAt ? `至 ${date(row.subscriptionEndsAt)}` : " · 永久"}`
            : "无有效订阅",
          count: text(row.orderCount),
          active: date(row.lastActiveAt),
          created: date(row.registeredAt),
        },
        actions: [{ label: "查看账户", href: base.href }],
      };
    if (resource === "bookings")
      return {
        ...base,
        title: `履约 #${id} · ${text(row.intent)}`,
        href: `/admin/orders/${id}?returnTo=${encodeURIComponent(returnTo)}`,
        cells: { ...base.cells, buyer: text(row.email) },
        actions: [
          {
            label: "查看履约",
            href: `/admin/orders/${id}?returnTo=${encodeURIComponent(returnTo)}`,
          },
        ],
      };
    if (resource === "registrations")
      return {
        ...base,
        title: text(row.email),
        href: `/checkin/${row.checkin_token}`,
        actions:
          row.status === "registered"
            ? [{ label: "到场核销", href: `/checkin/${row.checkin_token}` }]
            : [],
      };
    return {
      ...base,
      title:
        resource === "conversations"
          ? `对话 #${id}`
          : `留言 #${id} · ${text(row.kind)}`,
      href: `/admin/inbox/${resource === "conversations" ? "conversation" : "item"}/${id}?returnTo=${encodeURIComponent(returnTo)}`,
      actions: [
        {
          label: "查看详情",
          href: `/admin/inbox/${resource === "conversations" ? "conversation" : "item"}/${id}?returnTo=${encodeURIComponent(returnTo)}`,
        },
      ],
    };
  });
  const create =
    resource === "articles"
      ? {
          label: "新建文章",
          href: `/admin/content${data.query.series ? `?type=chapter&series=${encodeURIComponent(data.query.series)}&returnTo=${encodeURIComponent(returnTo)}` : `?returnTo=${encodeURIComponent(returnTo)}`}`,
        }
      : resource === "collections"
        ? { label: "新建专辑", href: "/admin/collections/new" }
        : resource === "pages"
          ? { label: "新建页面", href: "/admin/pages/new" }
          : resource === "services"
            ? { label: "新建服务", href: "/admin/services/new" }
            : undefined;
  return (
    <section className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{spec.title}</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          {spec.description}
        </p>
      </header>
      {["services", "bookings"].includes(resource) && (
        <nav aria-label="服务对象" className="flex gap-4 text-sm text-primary">
          <Link href="/admin/services">服务项目</Link>
          <Link href="/admin/orders">履约订单</Link>
        </nav>
      )}
      {["inbox", "conversations"].includes(resource) && (
        <nav aria-label="收件类型" className="flex gap-4 text-sm text-primary">
          <Link href="/admin/inbox">留言</Link>
          <Link href="/admin/conversations">对话与公开稿</Link>
        </nav>
      )}
      <AdminDataTable
        rows={rows}
        columns={COLUMNS[resource]}
        total={data.filteredTotal}
        query={data.query}
        statuses={spec.statuses}
        types={spec.types}
        create={create}
        sorts={
          resource === "articles" && data.query.series
            ? ["reading", "newest", "oldest", "title"]
            : resource === "users"
              ? ["newest", "oldest", "active"]
              : ["articles", "collections", "pages", "services"].includes(
                    resource,
                  )
                ? ["newest", "oldest", "title"]
                : ["newest", "oldest"]
        }
      />
    </section>
  );
}
