import { getAdminIdentity } from "@/lib/admin/session";
import { buildRosterCsv, listEventRoster } from "@/lib/admin/roster";

/** 活动报名名单导出：邮箱/状态/报名时间 CSV，仅 owner 会话可下载。 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const identity = await getAdminIdentity();
  if (!identity.owner) return new Response("需要站主身份", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  const eventId = Number((await params).id);
  if (!Number.isInteger(eventId) || eventId <= 0) return new Response("无效活动", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const csv = buildRosterCsv(await listEventRoster(eventId));
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="event-${eventId}-roster.csv"`,
      "cache-control": "no-store",
    },
  });
}
