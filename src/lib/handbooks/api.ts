import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { canonicalJson } from "@/lib/publishing/validate";
import { inspectCandidate, stageCandidate, inventory, importScope, type ImportContext, type Candidate, ImportError } from "@/lib/importing/server";
import { projectPath } from "@/lib/importing/paths";
import { prepareMediaUpload, finishMediaUpload } from "@/lib/media/uploads";
import { uploadDescriptor } from "@/lib/media/validation";
import type { PublisherIdentity } from "@/lib/publishing/identity";
import { positiveId, uuid } from "@/lib/skills/types";
import { isHandbookDraftWrite } from "../../../packages/handbook-protocol/src";

export type HandbookIdentity = Extract<PublisherIdentity, { kind: "handbook" }>;
export async function handbookRead(action: string, query: URLSearchParams, identity: HandbookIdentity) {
  const db = createSupabaseServiceClient({ timeoutMs: 15000 });
  const context: ImportContext = { identity, client: db };
  if (action === "connect") return { protocol: 1, scope: "handbooks", uploadOrigin: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin, publicKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, imagesPublic: true, capabilities: ["draft-upload-v2"] };
  const page = Number(query.get("page") || 1);
  if (!positiveId(page) || page > 10000) throw new ImportError("页码无效。");
  if (action === "list") {
    const result = await db.from("series").select("id,slug,title,status,updated_at,readme_article_id", { count: "exact" }).eq("type", "handbook").neq("status", "archived").order("updated_at", { ascending: false }).order("id").range((page - 1) * 100, page * 100 - 1);
    if (result.error || result.count === null) throw new Error();
    return { items: result.data, total: result.count, page };
  }
  if (action === "inventory") return inventory(query.get("scope") || "", context, page);
  if (action === "status" && uuid(query.get("id"))) {
    const result = await db.from("handbook_sync_operations").select("id,operation,response").eq("id", query.get("id")!).eq("credential_id", identity.credentialId).maybeSingle();
    if (result.error) throw new Error();
    return { operation: result.data };
  }
  throw new ImportError("未知手册操作。");
}
export async function handbookWrite(action: string, data: Record<string, unknown>, identity: HandbookIdentity) {
  const db = createSupabaseServiceClient({ timeoutMs: 25000 });
  const context: ImportContext = { identity, client: db, draftUpload: true };
  if (!isHandbookDraftWrite(action)) throw new ImportError("请到网页后台设置与发布手册；同步接口仅保存草稿。", "WEB_MANAGEMENT_REQUIRED");
  if (action === "compare") return inspectCandidate(data.candidate as Candidate, context);
  if (action === "media-prepare" || action === "media-finish") {
    const parent = await importScope(String(data.scope), false, context);
    if (!parent) throw new ImportError("请选择手册。");
    if (action === "media-prepare") {
      const item = uploadDescriptor(data);
      const result = await db.rpc("prepare_handbook_image", { p_credential: identity.credentialId, p_series: parent.id, p_id: item.id, p_name: item.name, p_hash: item.sha256, p_mime: item.mime, p_size: item.size });
      if (result.error) throw new ImportError("图片上传超限或与现有记录冲突。");
      return prepareMediaUpload(data, identity.ownerId);
    }
    if (!uuid(data.id) || typeof data.path !== "string" || (data.expected !== null && typeof data.expected !== "string")) throw new ImportError("图片参数无效。");
    const path = projectPath(data.path);
    const bound = await db.from("handbook_media_uploads").select("id").eq("id", data.id).eq("credential_id", identity.credentialId).eq("series_id", parent.id).maybeSingle();
    if (bound.error || !bound.data) throw new ImportError("此图片上传不属于当前手册连接。");
    await finishMediaUpload(data.id, identity.ownerId);
    const result = await db.rpc("link_handbook_image", { p_credential: identity.credentialId, p_series: parent.id, p_upload: data.id, p_path: path, p_expected: data.expected });
    if (result.error) throw new ImportError("图片引用冲突或凭据已撤销，请重新比对。");
    return result.data;
  }
  if (!uuid(data.operationId)) throw new ImportError("缺少同步操作标识。");
  const hash = createHash("sha256").update(canonicalJson(data)).digest("hex");
  context.operation = { id: data.operationId, hash, updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null, checkedHash: typeof data.checkedHash === "string" ? data.checkedHash : undefined, accessChange: false, overwriteOnline: data.overwriteOnline === true };
  // Query before expensive work; transactional RPCs repeat this check at commit.
  const prior = await db.from("handbook_sync_operations").select("credential_id,request_hash,operation,response").eq("id", data.operationId).maybeSingle();
  if (prior.error) throw new Error();
  if (prior.data) {
    if (prior.data.credential_id !== identity.credentialId || prior.data.request_hash !== hash || prior.data.operation !== action) throw new ImportError("同一操作标识不能用于不同内容。");
    if (prior.data.response) return prior.data.response;
  }
  if (action === "stage" && Number.isSafeInteger(data.expected) && Number(data.expected) >= 0) return stageCandidate(data.candidate as Candidate, Number(data.expected), context);
  let result;
  const operation = { p_credential: identity.credentialId, p_operation: data.operationId, p_hash: hash };
  if (action === "create" && typeof data.slug === "string" && typeof data.title === "string") result = await db.rpc("create_synced_handbook", { ...operation, p_slug: data.slug, p_title: data.title });
  else if (action === "rename" && positiveId(data.fileId) && positiveId(data.expected) && typeof data.path === "string") result = await db.rpc("rename_handbook_file", { ...operation, p_file: data.fileId, p_path: projectPath(data.path), p_expected: data.expected });
  else throw new ImportError("未知手册操作或参数无效。");
  if (result.error) throw new ImportError("操作未提交：存在名称冲突、线上修改、未发布修订或凭据已撤销。请重新比对。");
  return result.data;
}
