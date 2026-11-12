import { getAdminIdentity } from "@/lib/admin/session";
import { buildSubscriberCsv, listAdminUsers } from "@/lib/admin/users";

/** 运营邮件名单导出：有效订阅者邮箱 CSV，仅 owner 会话可下载。 */
export async function GET() {
  const identity = await getAdminIdentity();
  if (!identity.owner) return new Response("需要站主身份", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  const csv = buildSubscriberCsv(await listAdminUsers());
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="subscribers.csv"',
      "cache-control": "no-store",
    },
  });
}
