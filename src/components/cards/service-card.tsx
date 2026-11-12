import { BriefcaseBusinessIcon } from "lucide-react";

import {
  ContentCard,
  ContentCardAction,
  ContentCardChip,
} from "@/components/cards/content-card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatPrice } from "@/lib/format";
import type { ServiceCardData } from "@/types/content";

export function ServiceCard({
  data,
  currency,
}: {
  data: ServiceCardData;
  currency: string;
}) {
  return (
    <ContentCard href={`/services/${data.slug}`} kind="service">
      <div className="opc-content-card-cover">
        <div className="opc-content-card-placeholder" aria-hidden>
          <BriefcaseBusinessIcon className="size-5" />
        </div>
        <ContentCardChip>服务合作</ContentCardChip>
      </div>
      <div className="opc-content-card-body">
        <div className="opc-content-card-heading">
          <h3 className="opc-content-card-title">{data.title}</h3>
          {data.price !== null ? (
            <StatusBadge tone="paid">
              {formatPrice(data.price, currency)}
            </StatusBadge>
          ) : null}
        </div>
        {data.summary ? (
          <p className="opc-content-card-summary">{data.summary}</p>
        ) : null}
        {data.deliverables.length > 0 ? (
          <span className="opc-content-card-tags">
            {data.deliverables.map((item) => (
              <Badge key={item} variant="outline">
                {item}
              </Badge>
            ))}
          </span>
        ) : null}
        <div className="opc-content-card-footer">
          <span className="opc-content-card-meta">
            {data.duration ? <span>{data.duration}</span> : null}
            {data.capacityPerMonth !== null ? (
              <span>每月限 {data.capacityPerMonth} 单</span>
            ) : null}
          </span>
          <ContentCardAction>了解服务</ContentCardAction>
        </div>
      </div>
    </ContentCard>
  );
}
