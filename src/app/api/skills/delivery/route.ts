import { getUserIdentity } from "@/lib/account/session";
import { sameSiteOrigin } from "@/lib/publishing/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { issueSkillGrant, redeemSkillGrant } from "@/lib/skills/access";
import { skillBody, skillReply, skillFailure } from "@/lib/skills/http";
import { uuid, SkillError } from "@/lib/skills/types";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    if (!sameSiteOrigin(request.headers.get("origin"), process.env.SITE_URL)) throw new SkillError("请求来源无效。", 403);
    const { user } = await getUserIdentity();
    if (!user) throw new SkillError("请先登录。", 401);
    const data = await skillBody(request);
    if (data.op === "revoke" && uuid(data.id)) {
      const result = await createSupabaseServiceClient().from("skill_install_grants").update({ revoked_at: new Date().toISOString() }).eq("id", data.id).eq("user_id", user.id);
      if (result.error) throw new Error();
      return skillReply({ message: "安装授权已撤销；已签发的下载地址最多 60 秒后失效。" });
    }
    if (!uuid(data.release) || !["download", "install"].includes(String(data.op))) throw new SkillError("请选择有效版本。");
    const grant = await issueSkillGrant(user.id, data.release);
    if (data.op === "download") return skillReply(await redeemSkillGrant(`Bearer ${grant.token}`));
    return skillReply(grant);
  } catch (error) { return skillFailure(error); }
}
