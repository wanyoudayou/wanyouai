import { bearerMatches } from "@/lib/server-bearer";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { reconcileAutomatic } from "@/lib/payments/reconcile";
import { settleIfPaidRemotely } from "@/lib/payments/settle";
import { zpayProviderFromEnv } from "@/lib/payments/zpay";
import type { PaymentOrder } from "@/lib/payments/types";

export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (!bearerMatches(request, process.env.CRON_SECRET) && !bearerMatches(request, process.env.PUBLISH_TOKEN))
    return Response.json({ message: "未授权" }, { status: 401, headers });
  const deadline = Date.now() + 45_000;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]);
  try {
    const provider = zpayProviderFromEnv(process.env, (input, init) => fetch(input, {
      ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
    }));
    if (!provider) return Response.json({ message: "暂未开通在线收款" }, { status: 503, headers });
    const service = createSupabaseServiceClient({ timeoutMs: 8_000, signal });
    const result = await reconcileAutomatic({
      deadline,
      claim: async () => {
        const { data, error } = await service.rpc("claim_pending_payment_reconciliation");
        if (error || !data || !Array.isArray(data)) throw new Error("Payment claim unavailable");
        return (data[0] as PaymentOrder | undefined) ?? null;
      },
      settle: order => settleIfPaidRemotely(service, provider, order, "reconcile"),
    });
    return Response.json(result, { status: result.reason ? 503 : 200, headers });
  } catch {
    return Response.json({ message: "自动查单暂时不可用" }, { status: 503, headers });
  }
}

export function HEAD() {
  return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });
}
