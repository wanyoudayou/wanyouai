"use client";
import { zip } from "fflate";
import { credentialFile, excludedPackagePath, packagePath, SKILL_LIMITS } from "./package-policy";
import { SKILL_BUCKET } from "./types";
export async function skillRequest(body: object) {
  const response = await fetch("/api/admin/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(65000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "操作未完成，请刷新状态。");
  return result;
}
export function skillFolderFiles(files: File[]) {
  const included: { file: File; path: string }[] = []; const excluded: string[] = []; const paths = new Set<string>(); let total = 0;
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    if (excludedPackagePath(path)) { excluded.push(path); continue; }
    packagePath(path);
    if (credentialFile(path)) throw new Error(`请移除凭据文件：${path}`);
    if (paths.has(path.toLowerCase())) throw new Error(`路径重名：${path}`);
    paths.add(path.toLowerCase()); total += file.size;
    if (file.size > SKILL_LIMITS.fileBytes || total > SKILL_LIMITS.expandedBytes || included.length >= SKILL_LIMITS.files) throw new Error("文件夹超过数量或大小限制。");
    included.push({ file, path });
  }
  if (!included.length) throw new Error("文件夹没有可上传文件。");
  return { included, excluded };
}
export async function packageFolder(items: { file: File; path: string }[]) {
  const source: Record<string, Uint8Array> = Object.create(null);
  for (const { file, path } of items) source[path] = new Uint8Array(await file.arrayBuffer());
  const bytes = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => zip(source, { level: 6 }, (error, data) => error ? reject(error) : resolve(data as Uint8Array<ArrayBuffer>)));
  if (bytes.byteLength > SKILL_LIMITS.archiveBytes) throw new Error("压缩包超过 20 MiB，请减少附件。");
  return new File([bytes], "skill.zip", { type: "application/zip" });
}
export async function uploadSkill(file: File, descriptor: { id: string; skillId: number; version: string; notes: string }, progress: (text: string) => void) {
  if (!file.size || file.size > SKILL_LIMITS.archiveBytes) throw new Error("请选择 20 MiB 以内的 ZIP。");
  progress("正在计算摘要…");
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), b => b.toString(16).padStart(2, "0")).join("");
  const result = await skillRequest({ op: "prepare", ...descriptor, sha256, size: file.size });
  if (result.release) return result.release;
  const url = new URL(result.signedUrl); const base = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (url.origin !== base.origin || !url.pathname.startsWith(`/storage/v1/object/upload/sign/${SKILL_BUCKET}/staging/`)) throw new Error("上传地址无效。");
  progress("正在上传私有包…");
  const response = await fetch(url, { method: "PUT", redirect: "error", headers: { "Content-Type": "application/zip", apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, body: file, signal: AbortSignal.timeout(120000) });
  if (!response.ok && response.status !== 409) throw new Error("上传结果未知，请点击“查询并确认本次上传”。");
  progress("正在校验包格式与文件清单…");
  return (await skillRequest({ op: "finish", id: descriptor.id })).release;
}
