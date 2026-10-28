import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * 全站唯一常驻销售元素（页面契约 2.1/2.4）。
 * 支付未配置时：如实呈现未开通态，不伪造购买入口（环境变量契约）。
 */
export function SubscribePill({
  enabled,
  priceText,
  href,
  subscribedDays,
}: {
  /** commerce.payment_enabled —— zpay 配置完成前恒为 false */
  enabled: boolean;
  priceText: string | null;
  /** 落点：/card#pricing 或自定义页 /p/{slug}#pricing（站点配置可选） */
  href: string;
  /** 已订阅：剩余天数；非空时 pill 变为会员状态入口（→ /me） */
  subscribedDays?: number | null;
}) {
  if (subscribedDays != null) {
    return (
      <Button size="sm" variant="outline" className="rounded-full" asChild>
        <Link href="/me">订阅会员 · 剩余 {subscribedDays} 天</Link>
      </Button>
    );
  }
  if (!enabled) {
    return (
      <span
        className="inline-flex h-8 w-full cursor-not-allowed items-center justify-center gap-1 rounded-full border border-dashed px-2 text-sm whitespace-nowrap text-muted-foreground"
        role="note"
        title="在线订阅将在支付配置完成后开通"
      >
        订阅{priceText ? ` ${priceText}` : ""} · 暂未开通
      </span>
    );
  }
  return (
    <Button size="sm" className="rounded-full" asChild>
      <Link href={href}>订阅{priceText ? ` · ${priceText}` : ""}</Link>
    </Button>
  );
}
