import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { SKILL_LIMITS } from "./package-policy";
import { inspectSkillPackage } from "./package";
import { SKILL_BUCKET, SkillError, uuid, positiveId, type SkillRelease } from "./types";

const releaseColumns = "id,skill_id,version,notes,package_sha256,byte_size,manifest,skill_name,description,online_eligible,created_at";
export const releasePath = (item: Pick<SkillRelease, "skill_id" | "id">) => `releases/${item.skill_id}/${item.id}.zip`;
async function privateStorage() {
  const db = createSupabaseServiceClient({ timeoutMs: 25000 });
  const result = await db.storage.getBucket(SKILL_BUCKET);
  if (result.error || !result.data || result.data.public || Number(result.data.file_size_limit) !== SKILL_LIMITS.archiveBytes)
    throw new SkillError("请先按 Skill 部署说明配置私有 skill-packages 桶。", 503);
  return { db, bucket: db.storage.from(SKILL_BUCKET) };
}
export async function readSkillRelease(id: string) {
  const result = await createSupabaseServiceClient().from("skill_releases").select(releaseColumns).eq("id", id).maybeSingle();
  if (result.error) throw new SkillError("版本暂时无法读取。", 503);
  if (!result.data) throw new SkillError("版本不存在。", 404);
  return result.data as SkillRelease;
}
export async function skillReleases(skill: number, page = 1) {
  const result = await createSupabaseServiceClient().from("skill_releases").select(releaseColumns, { count: "exact" }).eq("skill_id", skill)
    .order("created_at", { ascending: false }).order("id").range((page - 1) * 20, page * 20 - 1);
  if (result.error || result.count === null) throw new SkillError("版本列表暂时无法读取。", 503);
  return { items: result.data as SkillRelease[], total: result.count, page };
}
export async function prepareSkillUpload(value: Record<string, unknown>, owner: string) {
  if (!uuid(value.id) || !positiveId(value.skillId) || typeof value.version !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value.version)
    || typeof value.notes !== "string" || Buffer.byteLength(value.notes) > 16384 || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)
    || !positiveId(value.size) || value.size > SKILL_LIMITS.archiveBytes) throw new SkillError("请填写版本号并选择 20 MiB 以内的 ZIP。");
  const { db, bucket } = await privateStorage();
  const ticket = await db.rpc("reserve_skill_upload", { p_id: value.id, p_skill: value.skillId, p_owner: owner, p_version: value.version, p_notes: value.notes, p_hash: value.sha256, p_size: value.size });
  if (ticket.error || !ticket.data) throw new SkillError(ticket.error?.message.includes("RATE_LIMIT") ? "上传过于频繁，请稍后再试。" : "版本号已存在、上传记录冲突或暂时不可用。");
  if (ticket.data.release_id) return { release: await readSkillRelease(ticket.data.release_id) };
  if (Date.parse(ticket.data.expires_at) <= Date.now()) throw new SkillError("上传已过期，请重新开始。");
  const signed = await bucket.createSignedUploadUrl(`staging/${owner}/${value.id}.zip`, { upsert: false });
  if (signed.error || !signed.data) throw new SkillError("无法生成上传凭据。", 503);
  return { id: value.id, signedUrl: signed.data.signedUrl };
}
export async function finishSkillUpload(id: string, owner: string) {
  const { db, bucket } = await privateStorage();
  const ticket = await db.from("skill_uploads").select("*").eq("id", id).eq("owner_id", owner).maybeSingle();
  if (ticket.error || !ticket.data) throw new SkillError("上传记录不存在或暂时不可用。", 404);
  const item = ticket.data;
  if (item.release_id) return { release: await readSkillRelease(item.release_id) };
  if (Date.parse(item.expires_at) <= Date.now()) throw new SkillError("上传已过期，请重新开始。");
  const claimed = await db.rpc("claim_skill_confirmation", { p_upload: id, p_owner: owner });
  if (claimed.error || claimed.data !== true) throw new SkillError("文件正在校验或校验过于频繁，请稍后刷新版本列表。", 409);
  try {
    const staged = await bucket.download(`staging/${owner}/${id}.zip`, {}, { signal: AbortSignal.timeout(25000) });
    if (staged.error || !staged.data) throw new SkillError("文件尚未完整到达，请保留文件并重试确认。", 409);
    if (staged.data.size !== item.byte_size || staged.data.size > SKILL_LIMITS.archiveBytes) throw new SkillError("文件大小与上传记录不符。");
    const bytes = new Uint8Array(await staged.data.arrayBuffer());
    const inspected = await inspectSkillPackage(bytes);
    if (inspected.sha256 !== item.source_hash) throw new SkillError("文件摘要不符，请重新上传。");
    const path = releasePath({ skill_id: item.skill_id, id });
    const uploaded = await bucket.upload(path, bytes, { contentType: "application/zip", upsert: false });
    if (uploaded.error) {
      // A previous confirmation may have stored the immutable object before losing its response.
      const existing = await bucket.download(path, {}, { signal: AbortSignal.timeout(25000) });
      if (existing.error || !existing.data || existing.data.size !== bytes.length || createHash("sha256").update(new Uint8Array(await existing.data.arrayBuffer())).digest("hex") !== inspected.sha256)
        throw new SkillError("版本文件未确认，请稍后查询状态。", 503);
    }
    const confirmed = await db.rpc("confirm_skill_release", { p_upload: id, p_owner: owner, p_manifest: inspected.manifest, p_name: inspected.name, p_description: inspected.description, p_online: inspected.onlineEligible });
    if (confirmed.error || !confirmed.data) throw new SkillError("版本确认结果未知，请刷新版本列表后再试。", 503);
    return { release: await readSkillRelease(confirmed.data) };
  } finally {
    await db.from("skill_uploads").update({ confirming_until: null }).eq("id", id).eq("owner_id", owner);
  }
}
export async function downloadSkillUrl(release: SkillRelease, seconds: number) {
  const { bucket } = await privateStorage();
  const result = await bucket.createSignedUrl(releasePath(release), Math.min(60, seconds), { download: `${release.skill_name}-${release.version}.zip` });
  if (result.error || !result.data) throw new SkillError("下载暂时不可用。", 503);
  return result.data.signedUrl;
}
/** Caller must authorize the bound user/release immediately before reading. */
export async function readSkillPackage(release: SkillRelease) {
  const { bucket } = await privateStorage();
  const result = await bucket.download(releasePath(release), {}, { signal: AbortSignal.timeout(15000) });
  if (result.error || !result.data || result.data.size !== release.byte_size) throw new SkillError("版本文件不可用。", 503);
  const inspected = await inspectSkillPackage(new Uint8Array(await result.data.arrayBuffer()));
  if (inspected.sha256 !== release.package_sha256) throw new SkillError("版本文件校验失败。", 503);
  return inspected;
}

/** Removes only expired, uncommitted uploads. Immutable releases and their history are excluded by SQL. */
export async function cleanupSkillUploads(skill: number, owner: string) {
  const { db, bucket } = await privateStorage();
  const candidates = await db.rpc("expired_skill_uploads", { p_owner: owner, p_skill: skill });
  if (candidates.error) throw new SkillError("暂存记录暂时不可用。", 503);
  let removed = 0;
  for (const item of candidates.data ?? []) {
    const result = await bucket.remove([`staging/${owner}/${item.id}.zip`, releasePath({ skill_id: skill, id: item.id })]);
    if (result.error) throw new SkillError("部分暂存文件未清理，可稍后重试。", 503);
    const saved = await db.from("skill_uploads").update({ cleaned_at: new Date().toISOString() }).eq("id", item.id).is("release_id", null);
    if (saved.error) throw new SkillError("清理结果未确认，可稍后重试。", 503);
    removed++;
  }
  return { removed };
}
