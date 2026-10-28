import { PurchaseButton } from "@/components/reading/purchase-button";
import { formatPrice } from "@/lib/format";

/**
 * 订阅方案卡片：/card 左列（pill 落点 #pricing）与自定义页 cp-subscribe 占位符共用。
 * 价格与开关全部来自 site_config.commerce，无硬编码。
 */
export function SubscriptionCard({
  id,
  amount,
  currency,
  paymentEnabled,
}: {
  id?: string;
  amount: number;
  currency: string;
  paymentEnabled: boolean;
}) {
  return (
    <section id={id} aria-label="订阅方案" className="scroll-mt-6 rounded-2xl border bg-card p-5 shadow-xs">
      <h2 className="text-base font-medium">订阅方案</h2>
      <p className="mt-2 text-2xl font-semibold">
        {formatPrice(amount, currency)}
        <span className="ml-1 text-sm font-normal text-muted-foreground">/ 年</span>
      </p>
      <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-muted-foreground">
        <li>全站付费内容（专辑与单篇）无限阅读</li>
        <li>订阅专享内容与活动沉淀阅读资格</li>
        <li>有效期内新发布内容同步解锁</li>
      </ul>
      <div className="mt-4">
        <PurchaseButton skuType="subscription" label={`订阅 ${formatPrice(amount, currency)} / 年`} enabled={paymentEnabled} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">需登录后购买；已订阅请前往会员中心查看权益。</p>
    </section>
  );
}
