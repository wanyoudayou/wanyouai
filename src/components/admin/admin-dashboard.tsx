import { Suspense } from "react";
import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSiteConfig } from "@/lib/get-site-config";
import { formatPrice } from "@/lib/format";
const cards = {
  revenue: "本月收入",
  subscriptions: "有效订阅用户",
  content: "已发布内容",
  avatar: "分身用量",
};
async function MetricCard({ section }: { section: keyof typeof cards }) {
  let value = "暂时不可用";
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("admin_dashboard_card", {
      p_section: section,
    });
    if (!error && data) {
      if (section === "revenue")
        value = formatPrice(
          Number(data.revenueThisMonth),
          (await getSiteConfig()).commerce.subscriptionPrice?.currency ?? "CNY",
        );
      if (section === "subscriptions") value = `${data.activeSubscriptions} 人`;
      if (section === "content")
        value = `${data.seriesPublished} 个手册与活动 · ${data.articlesPublished} 篇`;
      if (section === "avatar")
        value = `本月 ${data.avatarGenerationsThisMonth} 次生成`;
    }
  } catch {
    /* Unavailable is not zero; the other cards remain independently readable. */
  }
  return (
    <div className="space-y-2 rounded-xl border bg-card p-5">
      <h3 className="text-sm text-muted-foreground">{cards[section]}</h3>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}

const todos = [
  { key: "inbox", label: "待回复留言", href: "/admin/inbox?status=open" },
  { key: "inquiry", label: "待报价询价", href: "/admin/orders?status=inquiry" },
  { key: "accepted", label: "待结清服务", href: "/admin/orders?status=accepted" },
  { key: "revisions", label: "待发布修订", href: "/admin/articles?status=pending-review" },
] as const;

/** 待办计数只读计数（RLS 站主会话），读取失败显示不可用而非 0。 */
async function TodoList() {
  const client = await createSupabaseServerClient();
  const head = { count: "exact" as const, head: true };
  const results = await Promise.all([
    client.from("inbox_items").select("id", head).eq("status", "open"),
    client.from("bookings").select("id", head).eq("status", "inquiry"),
    client.from("bookings").select("id", head).eq("status", "accepted"),
    client.from("admin_documents").select("document_key", head).not("pending_revision_id", "is", null),
  ]).catch(() => null);
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {todos.map((todo, index) => {
        const result = results?.[index];
        const count = result && !result.error ? result.count : null;
        return (
          <li key={todo.key}>
            <Link
              href={todo.href}
              className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
            >
              <span className="flex-1">{todo.label}</span>
              <span
                className={cn(
                  "min-w-8 rounded-full px-2 py-0.5 text-center text-xs tabular-nums",
                  count ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
              >
                {count === null ? "不可用" : count || "无"}
              </span>
              <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

const creates = [
  { label: "新建文章", href: "/admin/content" },
  { label: "新建手册", href: "/admin/collections/new?type=handbook" },
  { label: "新建活动", href: "/admin/collections/new?type=event" },
  { label: "新建服务", href: "/admin/services/new" },
];

export function AdminTodo() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <section aria-labelledby="todo-heading" className="space-y-3">
        <h2 id="todo-heading" className="text-base font-medium">待处理</h2>
        <Suspense
          fallback={
            <p role="status" className="rounded-xl border bg-muted p-4 text-sm">
              正在读取待处理事项…
            </p>
          }
        >
          <TodoList />
        </Suspense>
      </section>
      <section aria-labelledby="create-heading" className="space-y-3">
        <h2 id="create-heading" className="text-base font-medium">快速新建</h2>
        <div className="grid grid-cols-2 gap-2">
          {creates.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg border bg-card px-3 py-2.5 text-center text-sm hover:border-primary/60 hover:bg-accent"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

export function AdminDashboard() {
  return (
    <section aria-label="本月数据" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {(Object.keys(cards) as (keyof typeof cards)[]).map((section) => (
        <Suspense
          key={section}
          fallback={
            <div role="status" className="rounded-xl border bg-muted p-5">
              正在读取{cards[section]}…
            </div>
          }
        >
          <MetricCard section={section} />
        </Suspense>
      ))}
    </section>
  );
}
