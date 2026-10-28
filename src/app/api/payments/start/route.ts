import { NextResponse } from "next/server";
import { getUserIdentity } from "@/lib/account/session";
import { describeOrder } from "@/lib/orders/describe";
import { zpayProviderFromEnv } from "@/lib/payments/zpay";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSiteConfig } from "@/lib/get-site-config";
import { getSiteUrl } from "@/lib/site-url";

/** GET /api/payments/start?order=<id> → 302 平台收银台（仅订单本人且 status='pending'）。 */
export async function GET(request: Request) {
  const provider = zpayProviderFromEnv();
  if (!provider) return NextResponse.json({ message: "暂未开通在线收款" }, { status: 404 });
  const url = new URL(request.url);
  const orderId = Number(url.searchParams.get("order"));
  if (!Number.isInteger(orderId) || orderId <= 0) return NextResponse.json({ message: "订单不存在" }, { status: 404 });
  const { user } = await getUserIdentity();
  if (!user) return NextResponse.redirect(new URL("/login", request.url), 302);
  const supabase = await createSupabaseServerClient();
  const { data: order, error } = await supabase.from("orders").select("id,user_id,sku_type,target_id,amount,status,merchant_order_no").eq("id", orderId).maybeSingle();
  if (error) return NextResponse.json({ message: "订单暂时不可用" }, { status: 503 });
  if (!order || order.user_id !== user.id) return NextResponse.json({ message: "订单不存在" }, { status: 404 });
  if (order.status !== "pending") return NextResponse.json({ message: "订单当前状态不可支付" }, { status: 409 });
  if (!/^9[0-9]{31}$/.test(order.merchant_order_no ?? "")) return NextResponse.json({ message: "订单支付编号暂时不可用" }, { status: 409 });
  const [site, name] = await Promise.all([getSiteConfig(), describeOrder(supabase, order)]);
  if (!site.commerce.paymentEnabled) return NextResponse.json({ message: "在线收款已暂停" }, { status: 503 });
  const channel = url.searchParams.get("channel");
  if (channel !== "alipay" && channel !== "wxpay") return NextResponse.json({ message: "支付渠道无效" }, { status: 400 });
  if (!site.commerce.paymentChannels.includes(channel)) return NextResponse.json({ message: "该支付渠道未开通" }, { status: 403 });
  const { redirectUrl } = provider.createPayment({
    order,
    productName: `${site.siteName} · ${name}`,
    notifyUrl: `${getSiteUrl()}/api/payments/notify`,
    returnUrl: `${getSiteUrl()}/checkout/${order.id}`,
    channel,
  });
  return NextResponse.redirect(redirectUrl, 302);
}
