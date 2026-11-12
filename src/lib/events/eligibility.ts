/** 活动报名资格判定（纯函数，可测；PRD §4.5）。权威裁决在数据库 register_for_event，此处供页面展示。 */
import { hasEntitlement } from "@/lib/reading/access";
import type { Reader } from "@/types/reading";

export type EventLike = { id: number; status: string; kind: string; ticket_price: number | null; state: string };

export type Eligibility =
  | { action: "register"; reason: "subscriber" | "ticket" | "open" }
  | { action: "buy_ticket"; price: number }
  | { action: "subscription_required" }
  | { action: "closed"; reason: string };

export function checkEligibility(reader: Reader, event: EventLike, now = Date.now()): Eligibility {
  const hasTicket = hasEntitlement(reader, "event", event.id, now);
  // 暂停停售不停读：已购票者在暂停期仍可报名；归档或结束才关闭。
  if (event.status !== "published" && !(event.status === "paused" && hasTicket)) return { action: "closed", reason: "活动未上架" };
  if (event.state === "ended") return { action: "closed", reason: "活动已结束" };
  if (event.state !== "registering") return { action: "closed", reason: "报名未开始" };
  if (hasTicket) return { action: "register", reason: "ticket" };
  const subscribed = hasEntitlement(reader, "subscription", null, now);
  const priced = event.ticket_price !== null && event.ticket_price > 0;
  if (event.kind === "member") {
    if (subscribed) return { action: "register", reason: "subscriber" };
    if (priced) return { action: "buy_ticket", price: Number(event.ticket_price) };
    return { action: "subscription_required" };
  }
  // open：免费直接报名；收费先购票
  if (priced) return { action: "buy_ticket", price: Number(event.ticket_price) };
  return { action: "register", reason: "open" };
}
