import { SkillError } from "./types";
import { SkillPackageError } from "./package-policy";
import { readBoundedBody } from "@/lib/publishing/request-body";
export const skillReply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
export function skillFailure(error: unknown) {
  return skillReply({ message: error instanceof SkillError || error instanceof SkillPackageError ? error.message : "操作暂时无法完成，请刷新状态后再试。" }, error instanceof SkillError ? error.status : error instanceof SkillPackageError ? 422 : 503);
}
export async function skillBody(request: Request) {
  try {
    const value = JSON.parse((await readBoundedBody(request, 32768)).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new SkillError("请求格式无效或过大。"); }
}
