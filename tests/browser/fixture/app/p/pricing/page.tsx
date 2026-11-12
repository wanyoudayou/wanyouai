import { PricingPlans } from "@/components/custom/pricing-plans";
import { renderWidgetHtml } from "@/lib/custom-pages/widgets";
import template from "@/generated/starter-content.json";
export default function Page() {
  return (
    <div className="custom-html-body mx-auto max-w-6xl px-6 py-8">
      {renderWidgetHtml(template.pricing, {
        pricing: (
          <PricingPlans
            commerce={{
              paymentEnabled: false,
              subscriptionPrice: { amount: 99, currency: "CNY" },
            }}
          />
        ),
        subscribe: null,
      })}
    </div>
  );
}
