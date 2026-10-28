import { getAdminIdentity } from "@/lib/admin/session";
import { sameSiteOrigin } from "@/lib/publishing/auth";
import { readBoundedBody } from "@/lib/publishing/request-body";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { newHandbookCredential, credentialHash } from "@/lib/handbooks/credentials";
import { uuid } from "@/lib/skills/types";
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET() {
  try {
    const identity = await getAdminIdentity(); if (!identity.owner || !identity.user) return reply({ message: "需要站主登录。" }, 401);
    const result = await createSupabaseServiceClient().from("handbook_credentials").select("id,name,created_at,last_used_at").eq("owner_id", identity.user.id).is("revoked_at", null).order("created_at", { ascending: false }).limit(10);
    if (result.error) throw new Error(); return reply({ items: result.data });
  } catch { return reply({ message: "连接列表暂时不可读。" }, 503); }
}
export async function POST(request: Request) {
  try {
    if (!sameSiteOrigin(request.headers.get("origin"), process.env.SITE_URL)) return reply({ message: "请求来源无效。" }, 403);
    const identity = await getAdminIdentity(); if (!identity.owner || !identity.user) return reply({ message: "需要站主登录。" }, 401);
    let data; try { data = JSON.parse((await readBoundedBody(request, 4096)).toString("utf8")); } catch { return reply({ message: "请求无效。" }, 422); }
    const db = createSupabaseServiceClient();
    if (data.op === "create" && typeof data.name === "string" && data.name.trim() && data.name.length <= 80) {
      const token = newHandbookCredential(); const result = await db.rpc("create_handbook_credential", { p_owner: identity.user.id, p_name: data.name.trim(), p_hash: credentialHash(token) });
      if (result.error) return reply({ message: "连接未创建；最多保留 10 个有效连接，请先撤销不使用的连接。" }, 409);
      return reply({ id: result.data, token });
    }
    if (data.op === "revoke" && uuid(data.id)) {
      const result = await db.from("handbook_credentials").update({ revoked_at: new Date().toISOString() }).eq("id", data.id).eq("owner_id", identity.user.id);
      if (result.error) throw new Error(); return reply({ ok: true });
    }
    return reply({ message: "请求参数无效。" }, 422);
  } catch { return reply({ message: "操作结果未知，请刷新连接列表。" }, 503); }
}
