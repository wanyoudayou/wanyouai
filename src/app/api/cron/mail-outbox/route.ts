import { bearerMatches } from "@/lib/server-bearer";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { outboxConfig, runMailOutbox } from "@/lib/payments/mail-outbox";
import { mailOutboxGateway } from "@/lib/payments/mail-outbox-server";
import { sendMailSchedulerHeartbeat } from "@/lib/mail-scheduler-heartbeat";

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!bearerMatches(request, process.env.CRON_SECRET) && !bearerMatches(request, process.env.PUBLISH_TOKEN))
    return Response.json({ message: "未授权" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const signal = AbortSignal.timeout(45000);
  try {
    const config = outboxConfig(process.env);
    if (!config) return Response.json({ message: "事务邮件配置未就绪" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    const service = createSupabaseServiceClient({ timeoutMs: 8000, signal });
    const result = await runMailOutbox(mailOutboxGateway(service), config, { signal });
    const unhealthy = !!result.health && (result.health.dead > 0 || result.health.oldest_due_seconds > 600);
    if (!unhealthy) await sendMailSchedulerHeartbeat(process.env.MAIL_SCHEDULER_HEARTBEAT_URL);
    return Response.json(result, { status: unhealthy ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ message: "邮件队列暂不可用，请重试并检查部署诊断" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
export const GET = POST;

// Next otherwise implements HEAD by executing GET, which would send queued mail.
export function HEAD() {
  return new Response(null, { status: 405, headers: { Allow: "GET, POST", "Cache-Control": "no-store" } });
}
