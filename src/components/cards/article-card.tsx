import { NewspaperIcon } from "lucide-react";

import {
  ContentCard,
  ContentCardAction,
  ContentCardChip,
} from "@/components/cards/content-card";
import { AccessBadge, StatusBadge } from "@/components/shared/status-badge";
import { formatDateTime } from "@/lib/format";
import type { ArticleCardData } from "@/types/content";

export function ArticleCard({
  data,
  timezone = "Asia/Shanghai",
}: {
  data: ArticleCardData;
  timezone?: string;
}) {
  return (
    <ContentCard href={data.href} kind="article">
      <div className="opc-content-card-cover">
        {data.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Cover is hosted or configured by the site owner.
          <img src={data.coverUrl} alt="" className="opc-content-card-image" />
        ) : (
          <div className="opc-content-card-placeholder" aria-hidden>
            <NewspaperIcon className="size-5" />
          </div>
        )}
        <ContentCardChip>{data.tags[0] ?? "文章"}</ContentCardChip>
      </div>
      <div className="opc-content-card-body">
        <div className="opc-content-card-heading">
          <h3 className="opc-content-card-title">{data.title}</h3>
          {data.owned ? (
            <StatusBadge tone="owned">已购</StatusBadge>
          ) : (
            <AccessBadge access={data.access} />
          )}
        </div>
        {data.summary ? (
          <p className="opc-content-card-summary">{data.summary}</p>
        ) : null}
        <div className="opc-content-card-footer">
          <span className="opc-content-card-meta">
            {data.publishedAt ? (
              <time dateTime={data.publishedAt}>
                {formatDateTime(data.publishedAt, timezone)}
              </time>
            ) : null}
            {data.tags.slice(1, 3).map((tag) => (
              <span key={tag}>#{tag}</span>
            ))}
          </span>
          <ContentCardAction>阅读</ContentCardAction>
        </div>
      </div>
    </ContentCard>
  );
}
