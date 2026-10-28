import { Suspense } from "react";
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
        value = `${data.seriesPublished} 专辑 · ${data.articlesPublished} 篇`;
      if (section === "avatar")
        value = `本月 ${data.avatarGenerationsThisMonth} 次生成`;
    }
  } catch {
    /* Unavailable is not zero; the other cards remain independently readable. */
  }
  return (
    <div className="space-y-2 rounded-xl border bg-card p-5">
      <h2 className="text-sm text-muted-foreground">{cards[section]}</h2>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}
export function AdminDashboard() {
  return (
    <section aria-label="站点概览" className="grid gap-4 sm:grid-cols-2">
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
