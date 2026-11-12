import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { zpayProviderFromEnv } from "@/lib/payments/zpay";
import { applyPaymentNotification } from "@/lib/payments/notification";

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/**
 * zpay 服务端回调（支付 API 契约 §4）：无会话依赖，只信签名 + 金额。
 * 结算与邮件任务同事务；不等待外部邮件服务。异常 500 让平台重试。
 */
export async function POST(request: Request) {
  let params: URLSearchParams;
  try { params = new URLSearchParams(await request.text()); } catch { return text("fail", 400); }
  return settleNotification(params);
}

/** The documented zpay callback uses GET; compatible providers may POST form data. */
export async function GET(request: Request) {
  return settleNotification(new URL(request.url).searchParams);
}

async function settleNotification(params: URLSearchParams) {
  const provider = zpayProviderFromEnv();
  if (!provider) return text("fail", 400);
  const verified = provider.verifyNotify(params);
  if (!verified) return text("fail", 400);
  const payload: Record<string, string> = {};
  params.forEach((value, key) => { payload[key] = value; });
  const result = await applyPaymentNotification(verified, payload, (args) => {
    const service = createSupabaseServiceClient({ timeoutMs: 3500 });
    return service.rpc("settle_payment_reference", args);
  });
  return text(result.body, result.status);
}
