import { sanitizeCustomHtml } from "@/lib/custom-pages/sanitize";
import { renderWidgetHtml } from "@/lib/custom-pages/widgets";
import { getSiteConfig } from "@/lib/get-site-config";
import { formatPrice } from "@/lib/format";
import { PurchaseButton } from "@/components/reading/purchase-button";
import { PricingPlans } from "./pricing-plans";

export async function CustomHtmlWithWidgets({ html }: { html: string }) {
  const clean = sanitizeCustomHtml(html);
  if (!/cp-(?:subscribe|pricing)/.test(clean))
    return <div className="custom-html-body">{renderWidgetHtml(clean)}</div>;
  const site = await getSiteConfig();
  const price = site.commerce.subscriptionPrice;
  return (
    <div className="custom-html-body">
      {renderWidgetHtml(clean, {
        pricing: <PricingPlans commerce={site.commerce} />,
        subscribe: (
          <div className="flex flex-wrap items-center gap-3 py-3">
            <PurchaseButton
              skuType="subscription"
              label={
                price
                  ? `订阅 ${formatPrice(price.amount, price.currency)} / 年`
                  : "订阅尚未配置"
              }
              enabled={site.commerce.paymentEnabled && !!price}
            />
            <span className="text-sm text-muted-foreground">
              购买前需登录；已有权益可在会员中心查看。
            </span>
          </div>
        ),
      })}
    </div>
  );
}
