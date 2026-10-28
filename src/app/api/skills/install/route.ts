import { redeemSkillGrant } from "@/lib/skills/access";
import { skillReply, skillFailure } from "@/lib/skills/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try { return skillReply(await redeemSkillGrant(request.headers.get("authorization"))); }
  catch (error) { return skillFailure(error); }
}
