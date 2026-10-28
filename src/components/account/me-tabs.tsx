"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { OrderContentLink } from "@/components/account/order-content-link";
import type { OrderContent } from "@/lib/orders/describe";
import { signOutUser } from "@/app/me/actions";

type Entitlement = { id: number; type: string; target_id: number | null; starts_at: string; ends_at: string | null; source: string };
type Order = { id: number; sku_type: string; amount: number; status: string; created_at: string; content: OrderContent };
const labels: Record<string, string> = { subscription: "订阅", series: "专辑", single: "单篇", event: "活动", skill: "Skill" };
const orderStatus: Record<string, string> = { pending: "待支付", paid: "已支付", fulfilled: "已交付", failed: "失败", refunded: "已退款" };
const bookingStatus: Record<string, string> = { inquiry: "询价中", quoted: "报价中", booked: "已成交", in_progress: "交付中", delivered: "已交付", accepted: "已验收", settled: "已结案", declined: "已婉拒" };
const regStatus: Record<string, string> = { registered: "已报名", attended: "已到场", cancelled: "已取消" };
const eventState: Record<string, string> = { upcoming: "未开始", registering: "报名中", ended: "已结束" };

/** /me 页内 tabs（页面契约 3.8）：权益 / 订单 / 活动报名。 */
export function MeTabs({ subscription, entitlements, orders, bookings, registrations }: { subscription: { endsAt: string | null } | null; entitlements: Entitlement[]; orders: Order[]; bookings: { id: number; service_id: number; status: string; created_at: string; serviceTitle: string }[]; registrations: { id: number; series_id: number; status: string; checkin_token: string; created_at: string; slug: string; title: string; state: string; startsAt: string | null }[] }) {
  const [tab, setTab] = useState<"entitlements" | "orders" | "events">("entitlements");
  const tabs = [["entitlements", "权益"], ["orders", "订单"], ["events", "活动报名"]] as const;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex gap-2" role="tablist" aria-label="我的账户">
        {tabs.map(([key, label]) => <Button key={key} size="sm" variant={tab === key ? "default" : "outline"} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</Button>)}
      </div>
      <form action={signOutUser}><Button type="submit" variant="ghost" size="sm">退出登录</Button></form>
    </div>
    {tab === "entitlements" && <section aria-label="我的权益" className="space-y-4">
      <div className="rounded-lg border p-4">
        <p className="text-sm font-medium">订阅状态</p>
        <p className="mt-1 text-sm text-muted-foreground">{subscription ? (subscription.endsAt ? `有效期至 ${new Date(subscription.endsAt).toLocaleDateString("zh-CN")}` : "长期有效") : "未订阅"}</p>
      </div>
      {entitlements.length ? <ul className="divide-y rounded-lg border">{entitlements.map((e) => <li key={e.id} className="p-4 text-sm">{labels[e.type] ?? e.type}{e.type !== "subscription" && e.target_id ? ` · #${e.target_id}` : ""}<span className="ml-2 text-xs text-muted-foreground">{e.ends_at ? `至 ${new Date(e.ends_at).toLocaleDateString("zh-CN")}` : "永久"} · 来源 {e.source === "order" ? "购买" : "站主"}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">还没有权益。去逛专辑，遇到喜欢的内容就地解锁。</p>}
    </section>}
    {tab === "orders" && <section aria-label="我的订单" className="space-y-3">
      {orders.length ? <ul className="divide-y rounded-lg border">{orders.map((o) => <li key={o.id}><Link href={`/me/orders/${o.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-muted/40"><div className="min-w-0"><p className="text-sm break-words">{o.content.name} · ¥{o.amount}</p><p className="text-xs text-muted-foreground">#{o.id} · {new Date(o.created_at).toLocaleString("zh-CN")}</p></div><p className="shrink-0 text-xs text-muted-foreground">{orderStatus[o.status] ?? o.status} →</p></Link><div className="px-4 pb-3"><OrderContentLink content={o.content} /></div></li>)}</ul> : <p className="text-sm text-muted-foreground">还没有订单。</p>}
      <p className="text-xs text-muted-foreground">点击订单查看支付进度；待支付订单可在详情页继续支付。</p>
      <h3 className="pt-2 text-sm font-medium">服务订单</h3>
      {bookings.length ? <ul className="divide-y rounded-lg border">{bookings.map((b) => <li key={b.id}><Link href={`/me/services/${b.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-muted/40"><div className="min-w-0"><p className="text-sm">{b.serviceTitle}</p><p className="text-xs text-muted-foreground">#{b.id} · {new Date(b.created_at).toLocaleString("zh-CN")}</p></div><p className="text-xs text-muted-foreground">{bookingStatus[b.status] ?? b.status} →</p></Link></li>)}</ul> : <p className="text-sm text-muted-foreground">还没有服务订单。到服务页提交询价即可开始。</p>}
    </section>}
    {tab === "events" && <section aria-label="活动报名" className="space-y-3">
      {registrations.length ? <ul className="divide-y rounded-lg border">{registrations.map((r) => <li key={r.id}><Link href={`/events/${r.slug}`} className="flex items-center justify-between gap-3 p-4 hover:bg-muted/40"><div className="min-w-0"><p className="text-sm">{r.title}</p><p className="text-xs text-muted-foreground">{r.startsAt ? new Date(r.startsAt).toLocaleString("zh-CN") : ""} · {regStatus[r.status] ?? r.status}{r.status === "registered" && r.state !== "ended" ? " · 到场出示核销链接" : ""}</p></div><p className="text-xs text-muted-foreground">{eventState[r.state] ?? ""} →</p></Link></li>)}</ul> : <p className="text-sm text-muted-foreground">还没有报名活动。到活动页即可报名。</p>}
      <Button asChild variant="outline" size="sm"><Link href="/events">去看活动</Link></Button>
    </section>}

  </div>;
}
