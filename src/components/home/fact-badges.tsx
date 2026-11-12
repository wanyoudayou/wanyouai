import { BadgeCheckIcon, FilesIcon, LibraryIcon, TagIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { FactBadgeType } from "@/types/site";

/**
 * 事实徽章行（页面契约 3.1 纪律）：只放可验证事实——专辑数 / 文章数 /
 * 订阅价格 / 服务容量；不放自评分、不放自标签式信誉。
 */

const BADGE_ICONS: Record<FactBadgeType, typeof LibraryIcon> = {
  series_count: LibraryIcon,
  article_count: FilesIcon,
  subscription_price: TagIcon,
  service_capacity: BadgeCheckIcon,
};

export function FactBadges({
  facts,
}: {
  facts: { type: FactBadgeType; text: string }[];
}) {
  if (facts.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {facts.map((fact) => {
        const Icon = BADGE_ICONS[fact.type];
        return (
          <li key={fact.type}>
            <Badge
              variant="outline"
              className="gap-1 font-normal"
            >
              <Icon aria-hidden />
              {fact.text}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}
