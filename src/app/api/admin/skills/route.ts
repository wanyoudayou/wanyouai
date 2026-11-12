import { revalidatePath } from "next/cache";
import { getAdminIdentity } from "@/lib/admin/session";
import { sameSiteOrigin } from "@/lib/publishing/auth";
import { finishSkillUpload, prepareSkillUpload, skillReleases, cleanupSkillUploads } from "@/lib/skills/storage";
import { getAdminSkill, saveSkillSettings } from "@/lib/skills/repository";
import { skillBody, skillReply, skillFailure } from "@/lib/skills/http";
import { SkillError, positiveId, uuid } from "@/lib/skills/types";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    if (!(await getAdminIdentity()).owner) throw new SkillError("需要站主登录。", 401);
    const params = new URL(request.url).searchParams;
    const id = Number(params.get("id")); const page = Number(params.get("page") || 1);
    if (!positiveId(id) || !positiveId(page) || page > 100000) throw new SkillError("标识无效。");
    return skillReply({ ...(await getAdminSkill(id)), releases: await skillReleases(id, page) });
  } catch (error) { return skillFailure(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameSiteOrigin(request.headers.get("origin"), process.env.SITE_URL)) throw new SkillError("请求来源无效。", 403);
    const identity = await getAdminIdentity();
    if (!identity.owner || !identity.user) throw new SkillError("需要站主登录。", 401);
    const data = await skillBody(request);
    if (data.op === "cleanup" && positiveId(data.id)) return skillReply(await cleanupSkillUploads(data.id, identity.user.id));
    if (data.op === "prepare") return skillReply(await prepareSkillUpload(data, identity.user.id));
    if (data.op === "finish" && uuid(data.id)) return skillReply(await finishSkillUpload(data.id, identity.user.id));
    if (data.op === "save" && positiveId(data.id) && positiveId(data.revision) && typeof data.price === "number" && Number.isFinite(data.price) && data.price >= 0 && data.price <= 999999.99
      && (data.current_release === null || uuid(data.current_release)) && typeof data.online_enabled === "boolean" && typeof data.usage_guide === "string" && Buffer.byteLength(data.usage_guide) <= 16384) {
      const result = await saveSkillSettings(data, identity.user.id);
      revalidatePath("/skills", "layout"); revalidatePath("/card"); revalidatePath("/card.json");
      return skillReply(result);
    }
    throw new SkillError("请求参数无效。");
  } catch (error) { return skillFailure(error); }
}
