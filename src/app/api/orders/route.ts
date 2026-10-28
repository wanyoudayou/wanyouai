import { NextResponse } from "next/server";
import { getUserIdentity } from "@/lib/account/session";
import { createOrder, OrderError } from "@/lib/orders/service";
import { supabaseOrderGateway } from "@/lib/orders/supabase";
import { sameSiteOrigin } from "@/lib/publishing/auth";

export async function POST(request: Request) {
  if (!sameSiteOrigin(request.headers.get("origin"), process.env.SITE_URL)) return NextResponse.json({ message: "请求来源无效" }, { status: 403 });
  const { user } = await getUserIdentity();
  if (!user) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ message: "请求体无效" }, { status: 400 }); }
  try {
    const order = await createOrder(supabaseOrderGateway(), user.id, body);
    return NextResponse.json({ order: { id: order.id, sku_type: order.sku_type, target_id: order.target_id, amount: order.amount, status: order.status, created_at: order.created_at } }, { status: 201 });
  } catch (error) {
    if (error instanceof OrderError) {
      const status = error.code === "INVALID_SKU" ? 400 : error.code === "NOT_SELLABLE" ? 403 : 409;
      return NextResponse.json({ message: error.message, code: error.code }, { status });
    }
    return NextResponse.json({ message: "下单暂时不可用，请稍后重试" }, { status: 500 });
  }
}
