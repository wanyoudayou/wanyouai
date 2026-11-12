import { getUserIdentity } from "@/lib/account/session";
import { sameSiteOrigin } from "@/lib/publishing/auth";
import { skillConversation, submitSkillTurn } from "@/lib/skills/conversations";
import { skillBody, skillReply, skillFailure } from "@/lib/skills/http";
import { SkillError, positiveId, uuid } from "@/lib/skills/types";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const { user } = await getUserIdentity(); if (!user) throw new SkillError("请先登录。", 401);
    const params = new URL(request.url).searchParams; const skill = Number(params.get("skill")); const session = params.get("session");
    if (!positiveId(skill) || !uuid(session)) throw new SkillError("对话标识无效。");
    return skillReply(await skillConversation(user.id, skill, session));
  } catch (error) { return skillFailure(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameSiteOrigin(request.headers.get("origin"), process.env.SITE_URL)) throw new SkillError("请求来源无效。", 403);
    const { user } = await getUserIdentity(); if (!user) throw new SkillError("请先登录。", 401);
    const data = await skillBody(request);
    if (!positiveId(data.skill) || !uuid(data.session) || !uuid(data.id) || typeof data.question !== "string" || !data.question.trim() || Buffer.byteLength(data.question) > 16384 || Object.keys(data).some(k => !["skill", "session", "id", "question"].includes(k))) throw new SkillError("请提交有效问题；历史消息由服务器读取。");
    return skillReply(await submitSkillTurn({ user: user.id, skill: data.skill, session: data.session, id: data.id, question: data.question, signal: request.signal }));
  } catch (error) { return skillFailure(error); }
}
