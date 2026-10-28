import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { readSkillRelease, downloadSkillUrl } from "./storage";
import { SkillError } from "./types";
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export async function canUseSkill(skill: number, user: string | null) {
  if (!user) return false;
  const result = await createSupabaseServiceClient().rpc("can_use_skill", { p_skill: skill, p_user: user });
  if (result.error) throw new SkillError("暂时无法核对使用权限。", 503);
  return result.data === true;
}
export async function issueSkillGrant(user: string, releaseId: string) {
  const token = `wsi_${randomBytes(32).toString("hex")}`;
  const result = await createSupabaseServiceClient().rpc("issue_skill_install_grant", { p_user: user, p_release: releaseId, p_hash: tokenHash(token) });
  if (result.error || !result.data) throw new SkillError(result.error?.message.includes("RATE_LIMIT") ? "下载授权过于频繁，请稍后再试。" : "没有此版本的使用权限。", 403);
  const release = await readSkillRelease(releaseId);
  return { token, id: result.data.id as string, expiresAt: result.data.expires_at as string, release };
}
export async function redeemSkillGrant(authorization: string | null) {
  const token = /^Bearer (wsi_[a-f0-9]{64})$/.exec(authorization ?? "")?.[1];
  if (!token) throw new SkillError("需要有效的安装授权。", 401);
  const result = await createSupabaseServiceClient().rpc("redeem_skill_install_grant", { p_hash: tokenHash(token) });
  if (result.error || !result.data) throw new SkillError("安装授权已过期、被撤销或不再具备权限。", 403);
  const release = await readSkillRelease(result.data.release_id);
  const seconds = Math.min(60, Math.floor((Date.parse(result.data.expires_at) - Date.now()) / 1000));
  if (seconds < 1) throw new SkillError("安装授权已过期。", 403);
  const url = await downloadSkillUrl(release, seconds);
  if (Date.now() + seconds * 1000 > Date.parse(result.data.expires_at)) throw new SkillError("安装授权即将过期，请重新生成授权。", 403);
  return { url, expiresIn: seconds, version: release.version, sha256: release.package_sha256, name: release.skill_name, files: release.manifest };
}
