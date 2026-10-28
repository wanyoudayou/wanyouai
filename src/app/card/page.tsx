import { publicMetadata } from "@/lib/seo/server";

import { getCardData } from "@/lib/get-card";
import { getSiteConfig } from "@/lib/get-site-config";
import { getSiteUrl } from "@/lib/site-url";
import { CardPanel } from "@/components/card/card-panel";
import { SubscriptionCard } from "@/components/card/subscription-card";
import { CardIdentityAside } from "@/components/card/card-identity-aside";
import { CustomHtmlWithWidgets } from "@/components/custom/custom-html-widgets";
import { PanelPlaceholder } from "@/components/shell/panel-placeholder";

export async function generateMetadata() {
  return publicMetadata("名片", "/card");
}

/**
 * /card 名片页（页面契约 3.11）：人类可读视图，与 /card.json 同一数据函数。
 * 布局：浅灰铺满 main 区域 + 三栏——
 * 左身份栏（大头像/事实行/CTA/bio）· 中列内容卡片 · 右列自定义区。
 */
export default async function CardPage() {
  const [card, site] = await Promise.all([getCardData(), getSiteConfig()]);
  const currency = site.commerce.subscriptionPrice?.currency ?? "CNY";
  const cardJsonUrl = getSiteUrl() ? `${getSiteUrl()}/card.json` : "/card.json";

  return (
    <div className="min-h-full bg-muted/40 px-6 py-10 lg:px-8">
      <PanelPlaceholder value={{ kind: "card", card }} />
      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[15rem_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <CardIdentityAside card={card} cardJsonUrl={cardJsonUrl} />
          {site.commerce.subscriptionPrice &&
          site.identity.showSubscriptionCard ? (
            // 左栏订阅 pill 的落点（/card#pricing，身份区下方）
            <SubscriptionCard
              id="pricing"
              amount={site.commerce.subscriptionPrice.amount}
              currency={currency}
              paymentEnabled={site.commerce.paymentEnabled}
            />
          ) : null}
        </div>
        <div className="min-w-0">
          <CardPanel card={card} currency={currency} />
        </div>
        {site.identity.customZone.enabled && site.identity.customZone.html ? (
          // 容器无样式：内容由 cp-* 卡片各自独立平铺
          <aside
            className="min-w-0 lg:sticky lg:top-6 lg:self-start"
            aria-label="名片自定义区"
          >
            <CustomHtmlWithWidgets html={site.identity.customZone.html} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
