import { PricingPlans } from "@/components/custom/pricing-plans";
import { SubscriptionCard } from "@/components/card/subscription-card";
import { PaywallBlock } from "@/components/reading/paywall-block";
import type { ReadingArticle } from "@/types/reading";
import type { CommerceConfig } from "@/types/site";

/** 订阅提示：?hint=no 为未配置，默认展示「咖啡 + 约每月一杯美式」。 */
export default async function Page({ searchParams }: { searchParams: Promise<{ hint?: string }> }) {
  const configured = (await searchParams).hint !== "no";
  const commerce: CommerceConfig = {
    paymentEnabled: true,
    paymentChannels: ["alipay"],
    subscriptionPrice: { amount: 99, currency: "CNY" },
    subscriptionHint: configured ? { icon: "coffee", text: "约每月一杯美式" } : null,
    refundPolicyUrl: null,
    subscribePage: null,
  };
  const article = { id: 1, status: "published", access: "paid", price: 9.9 } as unknown as ReadingArticle;
  return (
    <section className="mx-auto max-w-5xl space-y-8 p-6">
      <h1 className="text-3xl font-semibold">订阅提示</h1>
      <PaywallBlock article={article} commerce={commerce} viewer={{ loggedIn: true, subscribed: false }} />
      <div className="max-w-sm">
        <SubscriptionCard amount={99} currency="CNY" paymentEnabled hint={commerce} />
      </div>
      <PricingPlans commerce={commerce} />
    </section>
  );
}
