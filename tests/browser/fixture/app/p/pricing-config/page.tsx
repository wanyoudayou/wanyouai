import { PricingPlans } from "@/components/custom/pricing-plans";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ configured?: string }>;
}) {
  const configured = (await searchParams).configured === "yes";
  return (
    <section className="mx-auto max-w-5xl p-6">
      <h1 className="text-3xl font-semibold">收费方案配置边界</h1>
      <PricingPlans
        commerce={{
          paymentEnabled: true,
          subscriptionPrice: configured
            ? { amount: 299.5, currency: "CNY" }
            : null,
        }}
      />
    </section>
  );
}
