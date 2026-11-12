import Link from "next/link";
import { LockIcon } from "lucide-react";
import { Callout } from "@/components/shared/callout";
import { Button } from "@/components/ui/button";
import { PurchaseButton } from "@/components/reading/purchase-button";
import { formatPrice } from "@/lib/format";
import type { ReadingArticle, ReadingSeries } from "@/types/reading";
import type { EventDetailsRow } from "@/types/database";
import type { CommerceConfig } from "@/types/site";

/** 已购判别由 lib/reading/viewer.ts 汇总后传入，页面不各自实现。 */
export interface PaywallViewer { loggedIn: boolean; subscribed: boolean; }

/**
 * Paywall 引导 = 上下文函数（页面契约 §2.5）：
 * 匿名 → 登录引导 + 价格；登录未购 → 主 CTA；单买旁固定订阅交叉卡（已订阅者不显示）。
 * paymentEnabled=false 时按钮如实禁用并提示「暂未开通在线收款」。
 */
export function PaywallBlock({ article, series = null, event = null, commerce, viewer }: { article: ReadingArticle; series?: ReadingSeries | null; event?: EventDetailsRow | null; commerce: CommerceConfig; viewer: PaywallViewer }) {
  const currency = commerce.subscriptionPrice?.currency ?? "CNY";
  const paused = article.status === "paused" || series?.status === "paused";
  const registered = article.access === "registered";
  const subscriber = article.access === "subscriber";
  const eventReading = series?.type === "event" && subscriber;
  const price = subscriber || registered ? null : series && series.type !== "event" ? Number(series.price) : article.price;
  const subscriptionPrice = commerce.subscriptionPrice;

  // 已购 / 已登录满足注册级时 visible() 已放行全文，这里只做防御性收敛。
  if (registered && viewer.loggedIn) return null;
  if (subscriber && !eventReading && viewer.subscribed) return null;

  const loginCta = <Button asChild size="sm"><Link href="/login">登录后阅读</Link></Button>;
  const crossCard = !viewer.subscribed && subscriptionPrice ? (
    <div className="rounded-md border bg-muted/40 p-3 text-sm">
      <p className="font-medium text-foreground">订阅解锁全站付费内容</p>
      <p className="mt-1 text-muted-foreground">{series ? "本专辑" : "本篇"}也包含在订阅内；订阅另含订阅专享内容。</p>
      <div className="mt-2"><PurchaseButton skuType="subscription" label={`订阅 ${formatPrice(subscriptionPrice.amount, subscriptionPrice.currency)} / 年`} enabled={commerce.paymentEnabled} /></div>
    </div>
  ) : null;

  return <section data-paywall className="mt-8">
    <Callout Icon={LockIcon} title={paused ? "内容已停售" : "继续阅读完整内容"}>
      {paused ? <p>已有的有效权益仍可阅读，当前不再新售。</p> : <>
        {!viewer.loggedIn ? <>
          <p>{registered ? "此内容需登录后阅读。" : eventReading ? "有效订阅或本活动的有效票可解锁活动沉淀。" : subscriber ? "此内容为订阅专享，普通专辑购买不包含此访问级别。" : series ? "有效订阅或购买本专辑后，可阅读其中的付费章节。" : "有效订阅或购买本篇后可阅读全文。"}</p>
          {price !== null && Number(price) > 0 ? <p className="mt-2 font-medium text-foreground">{series ? "专辑价格" : "单篇价格"} {formatPrice(Number(price), currency)}</p> : null}
          {subscriber && subscriptionPrice ? <p className="mt-2">订阅 {formatPrice(subscriptionPrice.amount, subscriptionPrice.currency)} / 年</p> : null}
          <div className="my-3 flex flex-wrap gap-2">{loginCta}</div>
        </> : <>
          {registered ? null : <>
            <p>{eventReading ? "有效订阅或本活动的有效票可解锁活动沉淀。" : subscriber ? "此内容为订阅专享，普通专辑购买不包含此访问级别。" : series ? "购买本专辑后可阅读其中的付费章节；有效订阅亦可。" : "购买本篇后可阅读全文；有效订阅亦可。"}</p>
            {price !== null && Number(price) > 0 ? <p className="mt-2 font-medium text-foreground">{series ? "专辑价格" : "单篇价格"} {formatPrice(Number(price), currency)}</p> : null}
            <div className="my-3 flex flex-wrap items-start gap-2">
              {eventReading ? <PurchaseButton skuType="subscription" label={subscriptionPrice ? `订阅 ${formatPrice(subscriptionPrice.amount, subscriptionPrice.currency)} / 年` : "订阅全站"} enabled={commerce.paymentEnabled} />
                : subscriber ? <PurchaseButton skuType="subscription" label={subscriptionPrice ? `订阅 ${formatPrice(subscriptionPrice.amount, subscriptionPrice.currency)} / 年` : "订阅全站"} enabled={commerce.paymentEnabled} />
                : series && series.type !== "event" ? <PurchaseButton skuType="series" targetId={series.id} label="购买整本内容" enabled={commerce.paymentEnabled} />
                : <PurchaseButton skuType="single" targetId={article.id} label="购买本篇" enabled={commerce.paymentEnabled} />}
              {eventReading && event?.state === "registering" && event.ticket_price !== null && Number(event.ticket_price) > 0 ? <Button disabled size="sm" variant="outline" title="活动线上售票随报名闭环开放">活动票 {formatPrice(Number(event.ticket_price), currency)}</Button> : null}
            </div>
            {article.access === "paid" ? <div className="mt-3">{crossCard}</div> : null}
          </>}
        </>}
        {!commerce.paymentEnabled ? <p>暂未开通在线收款。</p> : null}
      </>}
    </Callout>
  </section>;
}
