import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { InfoIcon, ReceiptIcon } from "lucide-react";
import { getUserIdentity } from "@/lib/account/session";
import { getOrderContent } from "@/lib/orders/describe";
import { OrderContentLink } from "@/components/account/order-content-link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSiteConfig } from "@/lib/get-site-config";
import { formatPrice } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/shared/callout";
import { StatusBadge } from "@/components/shared/status-badge";

export const metadata: Metadata = { title: "订单详情", robots: { index: false, follow: false } };

const STATUS_LABEL: Record<string, string> = { pending: "待支付", paid: "已支付", fulfilled: "已交付", failed: "已关闭", refunded: "已退款" };
const CHANNEL_LABEL: Record<string, string> = { alipay: "支付宝", wxpay: "微信支付" };

interface Props { params: Promise<{ id: string }> }

/** 订单追踪（页面契约 §3.9）：本人可见；时间线 = 创建 → 本站确认收款 → 权益开通。 */
export default async function OrderDetailPage({ params }: Props) {
  const orderId = Number((await params).id);
  if (!Number.isInteger(orderId) || orderId <= 0) notFound();
  const { user } = await getUserIdentity();
  if (!user) redirect("/login");
  const supabase = await createSupabaseServerClient();
  const { data: order } = await supabase.from("orders").select("id,user_id,sku_type,target_id,amount,status,created_at").eq("id", orderId).maybeSingle();
  if (!order || order.user_id !== user.id) notFound();
  const [site, content, grant] = await Promise.all([
    getSiteConfig(),
    getOrderContent(supabase, order),
    supabase.from("entitlements").select("id,type,starts_at,created_at").eq("user_id", user.id).eq("source", "order").eq("source_ref", `order:${order.id}`).maybeSingle(),
  ]);
  const currency = site.commerce.subscriptionPrice?.currency ?? "CNY";
  const pending = order.status === "pending";
  const paid = ["paid", "fulfilled"].includes(order.status);
  const steps = [
    { title: "创建订单", time: order.created_at, done: true },
    { title: "本站确认收款", time: paid ? grant.data?.created_at ?? null : null, done: paid },
    { title: "权益开通", time: grant.data?.starts_at ?? null, done: !!grant.data },
  ];
  return <div className="mx-auto w-full max-w-xl space-y-6 px-6 py-10">
    <Link href="/me" className="text-sm text-muted-foreground hover:text-foreground">← 返回我的权益</Link>
    <header className="space-y-2">
      <p className="text-sm text-muted-foreground">订单 #{order.id}</p>
      <h1 className="text-2xl font-medium break-words">{content.name}</h1>
      <div className="flex items-center gap-2 text-sm"><StatusBadge tone={paid ? "owned" : pending ? "free" : "paused"}>{STATUS_LABEL[order.status] ?? order.status}</StatusBadge><span className="font-medium">{formatPrice(Number(order.amount), currency)}</span></div>
    </header>
    <OrderContentLink content={content} />
    <p className="text-xs text-muted-foreground">时间按站点时区 {site.identity.timezone} 显示。本站确认收款时间可能晚于支付平台的付款时间。</p>
    <ol className="space-y-0 rounded-xl border p-4">
      {steps.map((step, i) => <li key={step.title} className="flex gap-3">
        <div className="flex flex-col items-center"><span className={`flex size-5 items-center justify-center rounded-full border text-xs ${step.done ? "border-primary text-primary" : "border-muted-foreground/40 text-muted-foreground"}`}>{i + 1}</span>{i < steps.length - 1 ? <span className="my-1 h-8 w-px bg-border" /> : null}</div>
        <div className="pb-4"><p className="text-sm font-medium">{step.title}</p><p className="text-xs text-muted-foreground">{step.time ? <time dateTime={step.time}>{new Date(step.time).toLocaleString("zh-CN", { timeZone: site.identity.timezone, hour12: false })}</time> : step.done ? "—" : "待完成"}</p></div>
      </li>)}
    </ol>
    {pending ? <>
      {site.commerce.paymentEnabled ? <>
        <div className="flex flex-wrap gap-2">
          {site.commerce.paymentChannels.map((channel) => <Button key={channel} asChild className="flex-1"><a href={`/api/payments/start?order=${order.id}&channel=${channel}`}>{CHANNEL_LABEL[channel]}支付 {formatPrice(Number(order.amount), currency)}</a></Button>)}
        </div>
        <p className="text-xs text-muted-foreground">支付完成后自动开通权益；若跳转后未完成，可返回本页继续支付。</p>
        <p className="text-xs text-muted-foreground">本商品为知识性数字虚拟商品，一经售出概不退款（购买即视为已阅读）。</p>
      </> : <Callout Icon={InfoIcon} title="暂未开通在线收款"><p>站点尚未配置在线支付。可先收藏本页；收款开通后返回此订单继续支付。</p></Callout>}
    </> : null}
    {order.status === "failed" ? <Callout Icon={ReceiptIcon} title="订单已关闭"><p>本订单未在支付有效期内完成。如已扣款请联系站主核对。</p></Callout> : null}
    {order.status === "refunded" ? <Callout Icon={ReceiptIcon} title="订单已退款"><p>退款完成后对应权益已回收；如有疑问请联系站主。</p></Callout> : null}
  </div>;
}
