import { CalendarDaysIcon } from "lucide-react";
import { Callout } from "@/components/shared/callout";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatPrice } from "@/lib/format";
import type { EventDetailsRow } from "@/types/database";

const STATES = { upcoming: "即将开始", registering: "报名中", ended: "已结束" };
export function RegistrationCallout({ event, timezone, currency, paused }: { event: EventDetailsRow | null; timezone: string; currency: string; paused: boolean }) {
  if (!event) return <Callout title="活动信息整理中"><p>时间与报名说明将随后公布。</p></Callout>;
  const price = event.ticket_price === null ? "票价待定" : Number(event.ticket_price) === 0 ? "免费参加" : `票价 ${formatPrice(Number(event.ticket_price), currency)}`;
  return <Callout Icon={CalendarDaysIcon} title="活动安排">
    <div className="mb-3 flex flex-wrap gap-2"><StatusBadge tone={`event-${event.state}`}>{STATES[event.state]}</StatusBadge>{paused ? <StatusBadge tone="paused">已停售</StatusBadge> : null}</div>
    <p><time dateTime={event.starts_at}>{new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(event.starts_at))}</time> · {timezone}</p>
    {event.location_text ? <p>{event.location_text}</p> : null}
    <p>{price}{event.kind === "member" ? " · 订阅会员免费参加" : " · 开放活动"}</p>
    {event.capacity ? <p>名额：{event.capacity}</p> : null}
    {event.registration ? <p className="whitespace-pre-wrap">{event.registration}</p> : null}
  </Callout>;
}
