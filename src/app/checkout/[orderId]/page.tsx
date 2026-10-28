import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { InfoIcon, ReceiptIcon } from "lucide-react";
import { getUserIdentity } from "@/lib/account/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSiteConfig } from "@/lib/get-site-config";
import { formatPrice } from "@/lib/format";
import { getOrderContent } from "@/lib/orders/describe";
import { OrderContentLink } from "@/components/account/order-content-link";
import { zpayProviderFromEnv } from "@/lib/payments/zpay";
import { settleIfPaidRemotelyWithRetry } from "@/lib/payments/settle";
import { ReturnPoll } from "@/components/checkout/return-poll";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/shared/callout";
import { StatusBadge } from "@/components/shared/status-badge";

export const metadata: Metadata = { title: "订单核对", robots: { index: false, follow: false } };

const CHANNEL_LABEL: Record<"alipay" | "wxpay", string> = { alipay: "支付宝支付", wxpay: "微信支付" };

const STATUS_LABEL: Record<string, string> = {
  pending: "待支付",
  paid: "已支付",
  fulfilled: "已交付",
  failed: "已关闭",
  refunded: "已退款",
};

interface Props { params: Promise<{ orderId: string }>; searchParams: Promise<{ trade_status?: string }> }

/** 成交核对页（支付 API 契约 §2）：本人可见；非本人 404 不泄露存在性；未配置 zpay 如实呈现。 */
export default async function CheckoutPage({ params, searchParams }: Props) {
  const orderId = Number((await params).orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) notFound();
  const { user } = await getUserIdentity();
  if (!user) redirect("/login");
  const supabase = await createSupabaseServerClient();
  const [{ data: order }, site] = await Promise.all([
    supabase.from("orders").select("id,sku_type,target_id,amount,status,created_at,merchant_order_no").eq("id", orderId).maybeSingle(),
    getSiteConfig(),
  ]);
  if (!order || order.status === undefined) notFound();
  let current = order;
  // 买家从收银台跳回时携带 trade_status=TRADE_SUCCESS；若回调尚未到达，本页直接向平台查单落账（不信任 URL 参数，查单走签名 API）。
  const tradeStatus = (await searchParams).trade_status;
  if (current.status === "pending" && tradeStatus === "TRADE_SUCCESS") {
    const provider = zpayProviderFromEnv();
    if (provider) {
      const service = createSupabaseServiceClient();
      const outcome = await settleIfPaidRemotelyWithRetry(service, provider, { user_id: user.id, ...current }, "return");
      if (outcome === "settled" || outcome === "duplicate_or_already") {
        const { data: refreshed } = await supabase.from("orders").select("id,sku_type,target_id,amount,status,created_at,merchant_order_no").eq("id", orderId).maybeSingle();
        if (refreshed) current = refreshed;
      }
    }
  }
  const currency = site.commerce.subscriptionPrice?.currency ?? "CNY";
  const content = await getOrderContent(supabase, current);
  const pending = current.status === "pending";
  return <div className="mx-auto w-full max-w-xl space-y-6 px-6 py-12">
    <header className="space-y-2">
      <p className="text-sm text-muted-foreground">订单核对</p>
      <h1 className="text-2xl font-medium break-words">{content.name}</h1>
    </header>
    <OrderContentLink content={content} />
    <section className="rounded-xl border p-4 text-sm">
      <dl className="space-y-2">
        <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">金额</dt><dd className="font-medium">{formatPrice(Number(current.amount), currency)}</dd></div>
        <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">状态</dt><dd><StatusBadge tone={pending ? "free" : "owned"}>{STATUS_LABEL[current.status] ?? current.status}</StatusBadge></dd></div>
        <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">创建时间</dt><dd className="text-muted-foreground">{new Date(current.created_at).toLocaleString("zh-CN")}</dd></div>
      </dl>
    </section>
    {pending ? <>
      {site.commerce.paymentEnabled ? <>
        <div className="flex flex-wrap gap-2">
          {site.commerce.paymentChannels.map((channel) => <Button key={channel} asChild className="flex-1"><a href={`/api/payments/start?order=${current.id}&channel=${channel}`}>{CHANNEL_LABEL[channel]} {formatPrice(Number(current.amount), currency)}</a></Button>)}
        </div>
        <p className="text-xs text-muted-foreground">点击后跳转 {site.commerce.paymentChannels.map((c) => CHANNEL_LABEL[c]).join(" / ")} 收银台完成支付；支付完成后自动开通权益。</p>
        <p className="text-xs text-muted-foreground">本商品为知识性数字虚拟商品，一经售出概不退款（购买即视为已阅读）；详见{site.commerce.refundPolicyUrl ? <a href={site.commerce.refundPolicyUrl} target="_blank" rel="noreferrer" className="underline">退款政策</a> : "退款政策"}。</p>
      </> : <Callout Icon={InfoIcon} title="暂未开通在线收款"><p>站点尚未配置在线支付。可先收藏本页；收款开通后返回此订单继续支付。</p></Callout>}
      {tradeStatus === "TRADE_SUCCESS" ? <>
        <Callout Icon={InfoIcon} title="支付结果确认中"><p>平台已提示支付成功，正在与收银台核对到账，本页将在几秒内自动刷新；若长时间未更新请手动刷新。</p></Callout>
        <ReturnPoll />
      </> : null}
    </> : <Callout Icon={ReceiptIcon} title="订单已结束"><p>当前状态「{STATUS_LABEL[current.status] ?? current.status}」，无需继续支付。权益与订单明细见「我的」。</p></Callout>}
  </div>;
}
