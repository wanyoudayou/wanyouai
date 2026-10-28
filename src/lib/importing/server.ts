import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createPublisherStore } from "@/lib/publishing/server";
import { canonicalJson, validEnvelope } from "@/lib/publishing/validate";
import { validateFrontmatter } from "@/lib/publishing/frontmatter";
import { inspectMarkdown } from "@/lib/publishing/markdown";
import { resolveMedia } from "@/lib/publishing/media";
import { prepareImageUpload } from "@/lib/publishing/upload";
import { publish } from "@/lib/publishing/pipeline";
import { registerMedia, getMediaAsset } from "@/lib/media/repository";
import { assetMedia } from "@/lib/media/types";
import {
  relativeAsset,
  projectPath,
  normalizeEmbeds,
  localReferences,
  imageMime,
} from "./paths";
import type {
  Media,
  PublishInput,
  PublishResponse,
} from "@/lib/publishing/types";
import { publisherCanEdit, type PublisherIdentity } from "@/lib/publishing/identity";
import { preservedHandbookAccess } from "./access";
import { handbookStageProblem } from "./stage-guard";
import { chapterSlug } from "./selection";
export class ImportError extends Error { constructor(message: string, readonly code?: string) { super(message); } }
export type ImportContext = { identity: PublisherIdentity; client: Awaited<ReturnType<typeof createSupabaseServerClient>>; draftUpload?: boolean; operation?: { id: string; hash: string; updatedAt: string | null; checkedHash?: string; accessChange?: boolean; overwriteOnline?: boolean } };
const importClient = (context?: ImportContext) => context ? Promise.resolve(context.client) : createSupabaseServerClient();
export async function importScope(scope: string, folder = false, context?: ImportContext) {
  if (["blog", "skill"].includes(scope) && !folder && context?.identity.kind !== "handbook") return null;
  if (!/^series:[a-z0-9-]{2,120}$/.test(scope))
    throw new ImportError("请选择有效的专辑。");
  const db = await importClient(context);
  const { data, error } = await db
    .from("series")
    .select("id,slug,type,status")
    .eq("slug", scope.slice(7))
    .single();
  if (
    error ||
    !data ||
    data.status === "archived" ||
    (folder &&
      !["collection", "handbook", "skill", "event"].includes(data.type))
  )
    throw new ImportError(
      "文件夹导入仅支持未归档的普通专辑、手册、技能或活动。",
    );
  if (context && !publisherCanEdit(context.identity, { type: data.type, scope })) throw new ImportError("该凭据只能管理手册。");
  return data;
}
export async function inventory(scope: string, context?: ImportContext, page?: number) {
  const parent = await importScope(scope, false, context);
  const db = await importClient(context);
  const files = await db
    .from("content_files")
    .select("id,path,article_slug,sort", { count: "exact" })
    .eq("scope", scope)
    .order("sort")
    .order("path")
    .range(page ? (page - 1) * 100 : 0, page ? page * 100 - 1 : 999);
  const assets = await db
    .from("content_assets")
    .select("path,source_hash,media", { count: "exact" })
    .eq("scope", scope)
    .order("path")
    .range(page ? (page - 1) * 100 : 0, page ? page * 100 - 1 : 999);
  if (files.error || assets.error || files.count === null || assets.count === null) throw new Error("Inventory unavailable");
  const ids = files.data.map((f) => f.id);
  const revisions = ids.length
    ? await db
        .from("content_file_heads")
        .select("id,file_id,version,input_hash,publication,created_at")
        .in("file_id", ids)
        .order("version", { ascending: false })
        .limit(1000)
    : { data: [], error: null };
  if (revisions.error) throw new Error("Revisions unavailable");
  const online = context?.identity.kind === "handbook" && parent ? await db.from("articles").select("id,slug,title,status,updated_at,article_versions(version)", { count: "exact" }).eq("series_id", parent.id).order("id").range(page ? (page - 1) * 100 : 0, page ? page * 100 - 1 : 999).order("version", { referencedTable: "article_versions", ascending: false }).limit(1, { referencedTable: "article_versions" }) : { data: [], error: null, count: 0 };
  if (online.error || online.count === null) throw new Error("Online status unavailable");
  return {
    total: Math.max(files.count ?? 0, assets.count ?? 0, online.count),
    page: page ?? 1,
    files: files.data.map((f) => ({
      ...f,
      latest: revisions.data?.find((r) => r.file_id === f.id) ?? null,
    })),
    assets: assets.data,
    ...(context?.identity.kind === "handbook" ? { onlineArticles: online.data?.map(a => ({ id: a.id, slug: a.slug, title: a.title, status: a.status, updated_at: a.updated_at, version: a.article_versions[0]?.version ?? 0 })) ?? [] } : {}),
  };
}
export type Candidate = {
  scope: string;
  path: string;
  input: PublishInput;
  hashes: Record<string, string>;
  folder?: boolean;
  textOnly?: boolean;
};
export async function inspectCandidate(value: Candidate, context?: ImportContext) {
  if (
    !value ||
    typeof value.scope !== "string" ||
    typeof value.path !== "string" ||
    !validEnvelope(value.input)
  )
    throw new ImportError("导入请求无效。");
  const parent = await importScope(value.scope, value.folder, context);
  let path: string;
  try {
    path = projectPath(value.path);
  } catch {
    throw new ImportError("文件路径无效。");
  }
  const db = await importClient(context);
  const file = await db
    .from("content_files")
    .select("id,article_slug")
    .eq("scope", value.scope)
    .eq("path", path)
    .maybeSingle();
  if (file.error) throw new Error("File unavailable");
  const latest = file.data
    ? await db
        .from("content_file_revisions")
        .select(
          "id,input_hash,version,base_updated_at,published_updated_at,snapshot",
        )
        .eq("file_id", file.data.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null, error: null };
  if (latest.error) throw new Error("Revision unavailable");
  const fm = { ...value.input.frontmatter };
  if (!fm.slug)
    fm.slug =
      file.data?.article_slug ??
      (parent ? chapterSlug(parent.slug, path, createHash("sha256").update(value.scope + "/" + path).digest("hex")) :
        "doc-" + createHash("sha256").update(value.scope + "/" + path).digest("hex").slice(0, 24));
  if (file.data && file.data.article_slug !== fm.slug)
    throw new ImportError("同一路径不能更换文章地址标识。");
  let previousAccess: string | null = null;
  if (context?.identity.kind === "handbook") {
    const existing = await db.from("articles").select("access,series_id").eq("slug", fm.slug).maybeSingle();
    if (existing.error) throw new ImportError("当前权限暂时无法读取。");
    if (existing.data && existing.data.series_id !== parent?.id) throw new ImportError("文章不属于此手册。");
    previousAccess = existing.data?.access ?? null;
    const access = preservedHandbookAccess(fm.access, previousAccess, latest.data?.snapshot, { draftUpload: context.draftUpload, readme: path.toLowerCase() === "readme.md" });
    if (!access) throw new ImportError("首次发布必须选择阅读权限。", "INITIAL_ACCESS_REQUIRED");
    fm.access = access;
    if (path.toLowerCase() === "readme.md" && fm.access !== "public") throw new ImportError("README 是全文公开介绍，请明确选择公开权限。");
  }
  fm.type = parent ? "chapter" : value.scope === "skill" ? "skill" : "blog";
  if (parent) {
    fm.series_slug = parent.slug;
    delete fm.price;
  } else delete fm.series_slug;
  let markdown: string;
  try {
    markdown = normalizeEmbeds(value.input.markdown);
  } catch (e) {
    throw new ImportError((e as Error).message);
  }
  const errors = [
    ...validateFrontmatter(fm),
    ...inspectMarkdown(markdown, fm.access).diagnostics,
  ].filter((d) => d.severity === "error");
  if (errors.length)
    throw new ImportError(errors.map((d) => d.message).join(" "));
  const article = await db
    .from("articles")
    .select("id,series_id,type,status,updated_at")
    .eq("slug", fm.slug)
    .maybeSingle();
  if (article.error) throw new Error("Article unavailable");
  if (
    article.data &&
    (article.data.status === "archived" ||
      article.data.series_id !== (parent?.id ?? null) ||
      article.data.type !== fm.type)
  )
    throw new ImportError("文章地址与其他内容冲突，或文章已归档。");
  const binding = await db
    .from("content_files")
    .select("scope,path")
    .eq("article_slug", fm.slug)
    .maybeSingle();
  if (binding.error) throw new Error("Binding unavailable");
  if (
    binding.data &&
    (binding.data.scope !== value.scope || binding.data.path !== path)
  )
    throw new ImportError("文章地址已属于另一文件路径。");
  const refs = localReferences(markdown, fm.cover);
  // Only the owner web import may stage unresolved attachments. Publication still validates every reference.
  const textOnly = value.textOnly === true && value.folder === true && !context;
  const missingMedia: string[] = [];
  const hashes: Record<string, string> = {};
  for (const ref of refs) {
    let assetPath: string;
    try {
      assetPath = relativeAsset(path, ref);
    } catch (e) {
      // Text-only drafts retain the reference for repair; no path is read or uploaded.
      if (textOnly) { missingMedia.push(ref); continue; }
      throw new ImportError((e as Error).message);
    }
    const hash =
      value.hashes?.[assetPath] ??
      value.input.media.find((m) => m.source_path === ref)?.sha256;
    if (!/^[a-f0-9]{64}$/.test(hash ?? "")) {
      if (textOnly) { missingMedia.push(ref); continue; }
      throw new ImportError(`缺少附件：${assetPath}`);
    }
    hashes[assetPath] = hash;
  }
  const snapshot: PublishInput = {
    ...value.input,
    frontmatter: fm,
    markdown,
    media: value.input.media,
  };
  // Imported source plus referenced asset bytes define the revision, not request IDs.
  const hash = createHash("sha256")
    .update(
      canonicalJson({
        frontmatter: fm,
        markdown,
        hashes,
        media: value.input.media,
      }),
    )
    .digest("hex");
  const onlineChanged =
    !!latest.data &&
    (latest.data.published_updated_at ?? latest.data.base_updated_at) !==
      (article.data?.updated_at ?? null);
  // A published revision naturally has a newer online timestamp; compare its content when staging.
  let previousMarkdown =
    (latest.data?.snapshot as { markdown?: string } | undefined)?.markdown ??
    "";
  if ((!latest.data || onlineChanged) && article.data) {
    const body = await db
      .from("article_bodies")
      .select("content")
      .eq("article_id", article.data.id)
      .maybeSingle();
    if (body.error) throw new Error("Previous content unavailable");
    previousMarkdown = body.data?.content ?? "";
  }
  return {
    updatedAt: article.data?.updated_at ?? null,
    previousAccess,
    accessChanged: previousAccess !== null && previousAccess !== fm.access,
    previousMarkdown,
    previousMarkdownSource: (!latest.data || onlineChanged) && article.data ? "published" : "draft",
    scope: value.scope,
    path,
    input: snapshot,
    refs,
    missingMedia,
    hashes,
    hash,
    expected: latest.data?.id ?? 0,
    version: latest.data?.version ?? 0,
    change:
      latest.data?.input_hash === hash && !onlineChanged
        ? "unchanged"
        : latest.data
          ? "changed"
          : article.data
            ? "existing"
            : "new",
    onlineChanged,
  };
}
export async function stageCandidate(candidate: Candidate, expected: number, context?: ImportContext) {
  const checked = await inspectCandidate(candidate, context);
  if (context?.identity.kind === "handbook") {
    const problem = handbookStageProblem(checked, context.operation, !!context.draftUpload);
    if (problem) throw new ImportError(({ PREVIEW_CHANGED: "预览内容已变化，请重新比对。", ONLINE_CHANGED: "比对后线上内容又有更新，请重新比对。", OVERWRITE_CONFIRMATION_REQUIRED: "线上文章已有修改。请比对后明确确认用本地文稿覆盖线上草稿。" })[problem], problem);
  }
  const store = createPublisherStore();
  const client = await importClient(context);
  const service = createSupabaseServiceClient();
  const media: Media[] = [...checked.input.media];
  for (const ref of checked.refs) {
    if (checked.missingMedia.includes(ref)) continue;
    if (media.some((m) => m.source_path === ref)) continue;
    const path = relativeAsset(checked.path, ref);
    const asset = await client
      .from("content_assets")
      .select("source_hash,media")
      .eq("scope", checked.scope)
      .eq("path", path)
      .single();
    if (asset.error || asset.data.source_hash !== checked.hashes[path])
      throw new ImportError(`附件已变化或尚未上传：${path}`);
    const saved = asset.data.media as Media;
    if (saved.storage_path.startsWith("media/library/")) {
      media.push({ ...saved, source_path: ref });
      continue;
    }
    const bytes = await store.media.download(saved.storage_path);
    if (!bytes) throw new ImportError(`附件不可用：${path}`);
    const prepared = await prepareImageUpload(
      bytes,
      saved.mime_type,
      checked.input.frontmatter.slug,
      ref,
    );
    await store.media.upload(
      prepared.media.storage_path,
      prepared.bytes,
      prepared.media.mime_type,
    );
    media.push(prepared.media);
  }
  checked.input.media = media;
  const validation = await resolveMedia(checked.input, store.media);
  if (validation.diagnostics.some((d) => d.severity === "error" && !(checked.missingMedia.length && d.code === "MEDIA_MISSING")))
    throw new ImportError(
      validation.diagnostics.map((d) => d.message).join(" "),
    );
  const args = {
    p_scope: checked.scope,
    p_path: checked.path,
    p_slug: checked.input.frontmatter.slug,
    p_hash: checked.hash,
    p_snapshot: {
      frontmatter: checked.input.frontmatter,
      markdown: checked.input.markdown,
      media,
    },
    p_expected: expected,
    p_request: randomUUID(),
  };
  const scoped = context?.identity.kind === "handbook";
  const { data, error } = context?.identity.kind === "handbook" ? await service.rpc("stage_handbook_file", {
    p_credential: context.identity.credentialId, p_operation: context.operation!.id, p_hash: context.operation!.hash,
    p_scope: args.p_scope, p_path: args.p_path, p_slug: args.p_slug, p_input_hash: args.p_hash, p_snapshot: args.p_snapshot, p_expected: expected,
    p_updated: context.operation!.updatedAt, p_access_change: context.operation!.accessChange === true,
  }) : await service.rpc("stage_content_file", args);
  if (error)
    throw new ImportError(
      error.message.includes("IMPORT_STALE")
        ? "云端文件已变化，请重新比对。"
        : "保存修订失败，请重新比对后重试。",
    );
  return { id: scoped ? data.id : data };
}
export async function reviewRevision(id: number, context?: ImportContext) {
  const db = await importClient(context);
  const { data, error } = await db
    .from("content_file_revisions")
    .select(
      "id,file_id,version,snapshot,publication,request_id,base_updated_at",
    )
    .eq("id", id)
    .single();
  if (error || !data) throw new ImportError("修订不存在或无权访问。");
  const file = await db
    .from("content_files")
    .select("scope,path,article_slug")
    .eq("id", data.file_id)
    .single();
  if (file.error || !file.data) throw new Error("File unavailable");
  await importScope(file.data.scope, false, context);
  const snapshot = data.snapshot as Omit<PublishInput, "client_request_id">;
  const store = createPublisherStore();
  let preview = snapshot.markdown;
  for (const image of inspectMarkdown(
    preview,
    snapshot.frontmatter.access,
  ).images.reverse()) {
    const media = snapshot.media.find((m) => m.source_path === image.url);
    if (media)
      preview =
        preview.slice(0, image.start) +
        `![${image.alt.replace(/[\\\[\]\r\n]/g, " ")}](<${store.media.publicUrl(media.storage_path)}>)` +
        preview.slice(image.end);
  }
  return { ...data, ...file.data, snapshot, preview };
}
export async function publishRevision(id: number, context?: ImportContext) {
  if (context?.identity.kind === "handbook" && !context.operation) throw new ImportError("缺少同步操作标识。");
  const revision = await reviewRevision(id, context);
  await importScope(revision.scope, false, context);
  const store = createPublisherStore();
  const client = createSupabaseServiceClient();
  return publish(
    { client_request_id: revision.request_id, ...revision.snapshot },
    {
      ...store,
      replay: async () => context?.identity.kind === "handbook" ? null : revision.publication as PublishResponse | null,
      commit: async (_request, payload) => {
        const { data, error } = context?.identity.kind === "handbook" && context.operation ? await client.rpc("publish_handbook_revision", {
          p_credential: context.identity.credentialId, p_operation: context.operation.id, p_hash: context.operation.hash, p_revision: id, p_payload: payload,
        }) : await client.rpc("commit_file_publication", {
          p_revision: id,
          p_payload: payload,
        });
        if (error || !data) throw new Error("Publication unavailable");
        return data as PublishResponse;
      },
    },
  );
}
export async function uploadAsset(
  scope: string,
  path: string,
  file: File,
  expected: string | null,
  context?: ImportContext,
) {
  await importScope(scope, false, context);
  try {
    path = projectPath(path);
  } catch {
    throw new ImportError("附件路径无效。");
  }
  const slug = scope === "blog" ? "blog-assets" : scope.slice(7);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  let prepared: Awaited<ReturnType<typeof prepareImageUpload>>;
  try {
    prepared = await prepareImageUpload(bytes, imageMime(path), slug, path);
  } catch (e) {
    throw new ImportError((e as Error).message);
  }
  const store = createPublisherStore();
  await store.media.upload(
    prepared.media.storage_path,
    prepared.bytes,
    prepared.media.mime_type,
  );
  await registerMedia(prepared.media, prepared.bytes.byteLength, file.name);
  return saveAssetBinding(scope, path, hash, prepared.media, expected);
}

export async function linkLibraryAsset(
  scope: string,
  path: string,
  uploadId: string,
  expected: string | null,
  context?: ImportContext,
) {
  await importScope(scope, false, context);
  try {
    path = projectPath(path);
  } catch {
    throw new ImportError("附件路径无效。");
  }
  const db = createSupabaseServiceClient();
  const ticket = await db
    .from("media_uploads")
    .select("asset_id,source_hash")
    .eq("id", uploadId)
    .maybeSingle();
  if (ticket.error || !ticket.data?.asset_id)
    throw new ImportError("图片尚未完成校验，请重新上传。");
  const asset = await getMediaAsset(ticket.data.asset_id);
  if (asset.archived)
    throw new ImportError("素材已归档，请先在素材库恢复选用。");
  return saveAssetBinding(
    scope,
    path,
    ticket.data.source_hash,
    assetMedia(asset, path),
    expected,
  );
}

async function saveAssetBinding(
  scope: string,
  path: string,
  hash: string,
  media: Media,
  expected: string | null,
) {
  const db = createSupabaseServiceClient();
  const existing = await db
    .from("content_assets")
    .select("source_hash")
    .eq("scope", scope)
    .eq("path", path)
    .maybeSingle();
  if (existing.error) throw new Error("Asset unavailable");
  if (existing.data?.source_hash === hash) return { hash };
  if ((existing.data?.source_hash ?? null) !== expected)
    throw new ImportError("附件已变化，请重新比对。");
  const row = {
    scope,
    path,
    source_hash: hash,
    media,
    updated_at: new Date().toISOString(),
  };
  const result = existing.data
    ? await db
        .from("content_assets")
        .update(row)
        .eq("scope", scope)
        .eq("path", path)
        .eq("source_hash", expected!)
        .select("path")
    : await db.from("content_assets").insert(row).select("path");
  if (result.error || !result.data?.length)
    throw new ImportError("附件保存冲突，请重新比对。");
  return { hash };
}

export async function orderFiles(scope: string, ids: number[], context?: ImportContext) {
  await importScope(scope, false, context);
  if (
    !Array.isArray(ids) ||
    ids.length > 1000 ||
    !ids.every((id) => Number.isSafeInteger(id) && id > 0)
  )
    throw new ImportError("文件顺序无效。");
  const { error } = await createSupabaseServiceClient().rpc(
    "order_content_files",
    { p_scope: scope, p_ids: ids },
  );
  if (error) throw new ImportError("目录已变化，请刷新后重新排序。");
  const store = createPublisherStore();
  store.revalidate("/admin");
  if (scope.startsWith("series:"))
    for (const type of ["collections", "handbooks", "skills", "events"])
      store.revalidate("/" + type + "/" + scope.slice(7));
  return { ok: true };
}
