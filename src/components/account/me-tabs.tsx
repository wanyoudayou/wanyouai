"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime, formatDateTimeFull, formatPrice } from "@/lib/format";
import { BOOKING_STATUS_LABEL } from "@/lib/services/tracking";
import { OrderContentLink } from "@/components/account/order-content-link";
import type { OrderContent } from "@/lib/orders/describe";
import { signOutUser } from "@/app/me/actions";

type Entitlement = { id: number; type: string; target_id: number | null; starts_at: string; ends_at: string | null; source: string };
type Order = { id: number; sku_type: string; amount: number; status: string; created_at: string; content: OrderContent };
const labels: Record<string, string> = { subscription: "订阅", series: "专辑", single: "单篇", event: "活动", skill: "Skill" };
const orderStatus: Record<string, string> = { pending: "待支付", paid: "已支付", fulfilled: "已交付", failed: "失败", refunded: "已退款" };
const regStatus: Record<string, string> = { registered: "已报名", attended: "已到场", cancelled: "已取消" };
const eventState: Record<string, string> = { upcoming: "即将开始", registering: "报名中", ended: "已结束" };

/** /me 页内 tabs（页面契约 3.8）：权益 / 订单 / 活动报名。日期按站点时区格式化，服务端与客户端一致。 */
export function MeTabs({ subscription, entitlements, orders, bookings, registrations, timezone, currency }: { timezone: string; currency: string; subscription: { endsAt: string | null } | null; entitlements: Entitlement[]; orders: Order[]; bookings: { id: number; service_id: number; status: string; created_at: string; serviceTitle: string }[]; registrations: { id: number; series_id: number; status: string; checkin_token: string; created_at: string; slug: string; title: string; state: string; startsAt: string | null }[] }) {
  const day = (iso: string) => formatDateTime(iso, timezone);
  const time = (iso: string) => formatDateTimeFull(iso, timezone);
  return <Tabs defaultValue="entitlements" className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <TabsList aria-label="我的账户">
        <TabsTrigger value="entitlements">权益</TabsTrigger>
        <TabsTrigger value="orders">订单</TabsTrigger>
        <TabsTrigger value="events">活动报名</TabsTrigger>
      </TabsList>
      <form action={signOutUser}><Button type="submit" variant="ghost" size="sm">退出登录</Button></form>
    </div>
    <TabsContent value="entitlements" className="space-y-4">
      <div className="rounded-lg border p-4">
        <p className="text-sm font-medium">订阅状态</p>
        <p className="mt-1 text-sm text-muted-foreground">{subscription ? (subscription.endsAt ? `有效期至 ${day(subscription.endsAt)}` : "长期有效") : "未订阅"}</p>
      </div>
      {entitlements.length ? <ul className="divide-y rounded-lg border">{entitlements.map((e) => <li key={e.id} className="p-4 text-sm">{labels[e.type] ?? e.type}{e.type !== "subscription" && e.target_id ? ` · #${e.target_id}` : ""}<span className="ml-2 text-xs text-muted-foreground">{e.ends_at ? `至 ${day(e.ends_at)}` : "永久"} · 来源 {e.source === "order" ? "购买" : "站主"}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">还没有权益。去逛专辑，遇到喜欢的内容就地解锁。</p>}
    </TabsContent>
    <TabsContent value="orders" className="space-y-3">
      {orders.length ? <ul className="divide-y rounded-lg border">{orders.map((o) => <li key={o.id}><Link href={`/me/orders/${o.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-muted/40"><div className="min-w-0"><p className="text-sm break-words">{o.content.name} · {formatPrice(Number(o.amount), currency)}</p><p className="text-xs text-muted-foreground">#{o.id} · {time(o.created_at)}</p></div><p className="shrink-0 text-xs text-muted-foreground">{orderStatus[o.status] ?? o.status} →</p></Link><div className="px-4 pb-3"><OrderContentLink content={o.content} /></div></li>)}</ul> : <p className="text-sm text-muted-foreground">还没有订单。</p>}
      <p className="text-xs text-muted-foreground">点击订单查看支付进度；待支付订单可在详情页继续支付。</p>
      <h3 className="pt-2 text-sm font-medium">服务订单</h3>
      {bookings.length ? <ul className="divide-y rounded-lg border">{bookings.map((b) => <li key={b.id}><Link href={`/me/services/${b.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-muted/40"><div className="min-w-0"><p className="text-sm">{b.serviceTitle}</p><p className="text-xs text-muted-foreground">#{b.id} · {time(b.created_at)}</p></div><p className="text-xs text-muted-foreground">{BOOKING_STATUS_LABEL[b.status] ?? b.status} →</p></Link></li>)}</ul> : <p className="text-sm text-muted-foreground">还没有服务订单。到服务页提交询价即可开始。</p>}
    </TabsContent>
    <TabsContent value="events" className="space-y-3">
      {registrations.length ? <ul className="divide-y rounded-lg border">{registrations.map((r) => <li key={r.id}><Link href={`/events/${r.slug}`} className="flex items-center justify-between gap-3 p-4 hover:bg-muted/40"><div className="min-w-0"><p className="text-sm">{r.title}</p><p className="text-xs text-muted-foreground">{r.startsAt ? time(r.startsAt) : ""} · {regStatus[r.status] ?? r.status}{r.status === "registered" && r.state !== "ended" ? " · 到场出示核销链接" : ""}</p></div><p className="text-xs text-muted-foreground">{eventState[r.state] ?? ""} →</p></Link></li>)}</ul> : <p className="text-sm text-muted-foreground">还没有报名活动。到活动页即可报名。</p>}
      <Button asChild variant="outline" size="sm"><Link href="/events">去看活动</Link></Button>
    </TabsContent>
  </Tabs>;
}
