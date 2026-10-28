import { publicMetadata } from "@/lib/seo/server";
import { BriefcaseIcon } from "lucide-react";

import { getServices } from "@/lib/get-services";
import { getSiteConfig } from "@/lib/get-site-config";
import { CardGrid } from "@/components/cards/card-grid";
import { ServiceCard } from "@/components/cards/service-card";
import { EmptyState } from "@/components/shared/empty-state";

export async function generateMetadata() {
  return publicMetadata("服务", "/services");
}

/** /services 服务列表（页面契约 3.6）：仅 published 且价格完整。 */
export default async function ServicesPage() {
  const [services, site] = await Promise.all([getServices(), getSiteConfig()]);
  const currency = site.commerce.subscriptionPrice?.currency ?? "CNY";

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12 lg:px-8">
      <div className="flex flex-col gap-8">
        <header className="space-y-2">
          <h1 className="text-2xl leading-snug font-medium">服务</h1>
          {site.constraints.responseTime ? (
            <p className="text-sm text-muted-foreground">
              {site.constraints.responseTime}
            </p>
          ) : null}
        </header>
        {services.length === 0 ? (
          <EmptyState Icon={BriefcaseIcon} title="暂不接单" />
        ) : (
          <CardGrid>
            {services.map((service) => (
              <ServiceCard
                key={service.slug}
                data={service}
                currency={currency}
              />
            ))}
          </CardGrid>
        )}
      </div>
    </div>
  );
}
