import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/server-bearer";
import { settleIfPaidRemotely } from "@/lib/payments/settle";
import { getUserIdentity } from "@/lib/account/session";
import { zpayProviderFromEnv } from "@/lib/payments/zpay";
import type { PaymentOrder } from "@/lib/payments/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { reconcileBatch, reconcileCursor } from "@/lib/payments/reconcile";

/** 回调丢失补漏：扫 pending 且超过 10 分钟的订单逐笔平台查单，走同一 settle 入箱。 */
const RECONCILE_AFTER_MINUTES = 10;
export const maxDuration = 60;

const tokenAllowed = (request: Request): boolean => bearerMatches(request, process.env.PUBLISH_TOKEN);

async function ownerAllowed(): Promise<boolean> {
  const { user } = await getUserIdentity();
  if (!user) return false;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("profiles").select("is_owner").eq("id", user.id).maybeSingle();
  if (error) throw new Error("Owner verification unavailable");
  return data?.is_owner === true;
}

export async function POST(request: Request) {
  const deadline = Date.now() + 45_000;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]);
  const headers = { "Cache-Control": "no-store" };
  try {
    if (!tokenAllowed(request) && !(await ownerAllowed())) {
      return NextResponse.json({ message: "未授权" }, { status: 401, headers });
    }
    const after = reconcileCursor(new URL(request.url).searchParams);
    if (after === null) return NextResponse.json({ message: "无效的补单游标" }, { status: 400, headers });
    const provider = zpayProviderFromEnv(process.env, (input, init) => fetch(input, {
      ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
    }));
    if (!provider) return NextResponse.json({ message: "暂未开通在线收款" }, { status: 404, headers });
    const service = createSupabaseServiceClient({ timeoutMs: 8_000, signal });
    const cutoff = new Date(Date.now() - RECONCILE_AFTER_MINUTES * 60_000).toISOString();
    const result = await reconcileBatch({
      after, deadline,
      readPage: async (cursor, limit) => {
        const { data, error } = await service.from("orders")
          .select("id,user_id,sku_type,target_id,amount,status,merchant_order_no")
          .eq("status", "pending").lte("created_at", cutoff).gt("id", cursor)
          .order("id", { ascending: true }).limit(limit);
        if (error || !data) throw new Error("Order scan unavailable");
        return data as PaymentOrder[];
      },
      settle: order => settleIfPaidRemotely(service, provider, order, "reconcile"),
    });
    const status = result.reason === "order_read_failed" || result.reason === "settlement_failed" ? 503 : 200;
    return NextResponse.json(result, { status, headers });
  } catch {
    return NextResponse.json({ message: "补单暂时不可用，请核对后重试", complete: false }, { status: 503, headers });
  }
}
