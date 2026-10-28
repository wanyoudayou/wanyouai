/** 站主看板指标的纯汇总层。无服务端依赖、不 import "server-only"，供 tsx 单测直接导入。 */

export type DashboardMetrics = {
  /** 本月已支付订单总额（按支付完成时间计） */
  revenueThisMonth: number;
  /** 有效订阅数 */
  activeSubscriptions: number;
  seriesPublished: number;
  articlesPublished: number;
  avatarGenerationsThisMonth: number;
  avatarCacheHitsTotal: number;
  avatarGenerationsTotal: number;
};

export function monthStartIso(now: Date): string {
  // 统一按 UTC 月初计，避免服务器本地时区造成口径漂移。
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** 纯函数：由查询行集汇总看板指标（可测）。 */
export function summarizeDashboard(input: {
  paidOrders: { amount: number; updated_at: string }[];
  subscriptions: { ends_at: string | null; revoked_at: string | null }[];
  series: { status: string }[];
  articles: { status: string }[];
  avatarUsageThisMonth: { id: number }[];
  avatarUsageTotal: { id: number }[];
  avatarCache: { hit_count: number }[];
  now: Date;
}): DashboardMetrics {
  const monthStart = monthStartIso(input.now);
  const revenueThisMonth = input.paidOrders
    .filter((order) => order.updated_at >= monthStart)
    .reduce((sum, order) => sum + Number(order.amount), 0);
  const nowMs = input.now.getTime();
  return {
    revenueThisMonth: Math.round(revenueThisMonth * 100) / 100,
    activeSubscriptions: input.subscriptions.filter(
      (e) => !e.revoked_at && (!e.ends_at || Date.parse(e.ends_at) > nowMs),
    ).length,
    seriesPublished: input.series.filter((s) => s.status === "published").length,
    articlesPublished: input.articles.filter((a) => a.status === "published").length,
    avatarGenerationsThisMonth: input.avatarUsageThisMonth.length,
    avatarCacheHitsTotal: input.avatarCache.reduce((sum, c) => sum + c.hit_count, 0),
    avatarGenerationsTotal: input.avatarUsageTotal.length,
  };
}

/** 缓存命中率 = 命中 / (命中 + 生成)；无生成时为 null。 */
export function hitRate(metrics: Pick<DashboardMetrics, "avatarCacheHitsTotal" | "avatarGenerationsTotal">): number | null {
  const total = metrics.avatarCacheHitsTotal + metrics.avatarGenerationsTotal;
  return total === 0 ? null : metrics.avatarCacheHitsTotal / total;
}

