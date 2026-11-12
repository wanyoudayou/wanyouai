import { CalendarDaysIcon, MapPinIcon } from "lucide-react";

import {
  ContentCard,
  ContentCardAction,
  ContentCardChip,
} from "@/components/cards/content-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDateTime, formatPrice } from "@/lib/format";
import type { EventCardData } from "@/types/content";

const STATE_META = {
  upcoming: { tone: "event-upcoming" as const, label: "即将开始" },
  registering: { tone: "event-registering" as const, label: "报名中" },
  ended: { tone: "event-ended" as const, label: "已结束" },
};

export function EventCard({
  data,
  timezone,
  currency,
}: {
  data: EventCardData;
  timezone: string;
  currency: string;
}) {
  const state = STATE_META[data.state];
  return (
    <ContentCard href={data.href} kind="event">
      <div className="opc-content-card-cover">
        {data.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Cover is hosted or configured by the site owner.
          <img src={data.coverUrl} alt="" className="opc-content-card-image" />
        ) : (
          <div className="opc-content-card-placeholder" aria-hidden>
            <CalendarDaysIcon className="size-5" />
          </div>
        )}
        <ContentCardChip>{data.tags[0] ?? "活动"}</ContentCardChip>
      </div>
      <div className="opc-content-card-body">
        <div className="opc-content-card-heading">
          <h3 className="opc-content-card-title">{data.title}</h3>
          <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
        </div>
        {data.summary ? (
          <p className="opc-content-card-summary">{data.summary}</p>
        ) : null}
        <p className="opc-content-card-meta">
          <span>
            <CalendarDaysIcon className="size-3" aria-hidden />
            <time dateTime={data.startsAt}>
              {formatDateTime(data.startsAt, timezone)}
            </time>
          </span>
          {data.locationText ? (
            <span>
              <MapPinIcon className="size-3" aria-hidden />
              {data.locationText}
            </span>
          ) : null}
        </p>
        <div className="opc-content-card-footer">
          <span className="opc-content-card-meta">
            {data.memberOnly
              ? "会员专享"
              : data.ticketPrice === null || data.ticketPrice === 0
                ? "免费参加"
                : formatPrice(data.ticketPrice, currency)}
          </span>
          <ContentCardAction>查看活动</ContentCardAction>
        </div>
      </div>
    </ContentCard>
  );
}
