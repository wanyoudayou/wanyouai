import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createPublisherStore } from "@/lib/publishing/server";
import { ASSET_COLUMNS, registerMedia, withAssetUrl } from "./repository";
import { uploadDescriptor, validateStagedImage } from "./validation";
import { prepareUploadProtocol } from "./upload-protocol";
import {
  MAX_IMAGE_BYTES,
  MEDIA_UPLOAD_BUCKET,
  MediaLibraryError,
} from "./types";

export async function prepareMediaUpload(value: unknown, owner: string) {
  const item = uploadDescriptor(value);
  const db = createSupabaseServiceClient({ timeoutMs: 15000 });
  const reserved = await db.rpc("reserve_media_upload", {
    p_id: item.id,
    p_owner: owner,
    p_name: item.name,
    p_hash: item.sha256,
    p_mime: item.mime,
    p_size: item.size,
  });
  if (reserved.error || !reserved.data)
    throw new MediaLibraryError(
      reserved.error?.message.includes("UPLOAD_RATE_LIMIT")
        ? "上传过于频繁，请稍后再试。"
        : "上传记录冲突或暂时不可用，请保留文件后重试。",
    );
  return prepareUploadProtocol(reserved.data, {
    readAsset: finalizedAsset,
    finish: () => finishMediaUpload(item.id, owner),
    sign: async () => {
      const bucket = await db.storage.getBucket(MEDIA_UPLOAD_BUCKET);
      if (
        bucket.error ||
        !bucket.data ||
        bucket.data.public ||
        Number(bucket.data.file_size_limit) !== MAX_IMAGE_BYTES
      )
        throw new MediaLibraryError(
          "私有暂存桶配置不完整，请按素材库部署说明运行 Storage 配置。",
        );
      const signed = await db.storage
        .from(MEDIA_UPLOAD_BUCKET)
        .createSignedUploadUrl(`${owner}/${item.id}`, { upsert: false });
      if (signed.error || !signed.data)
        throw new MediaLibraryError("无法准备上传，请确认私有暂存桶已配置。");
      return { signedUrl: signed.data.signedUrl, id: item.id };
    },
  });
}
async function finalizedAsset(id: string) {
  const result = await createSupabaseServiceClient({ timeoutMs: 15000 })
    .from("media_assets")
    .select(ASSET_COLUMNS)
    .eq("id", id)
    .single();
  if (result.error || !result.data)
    throw new Error("Finalized asset unavailable");
  return withAssetUrl(result.data);
}
export async function finishMediaUpload(id: string, owner: string) {
  const db = createSupabaseServiceClient({ timeoutMs: 25000 });
  const ticket = await db
    .from("media_uploads")
    .select(
      "id,owner_id,name,source_hash,mime_type,byte_size,asset_id,expires_at",
    )
    .eq("id", id)
    .eq("owner_id", owner)
    .maybeSingle();
  if (ticket.error) throw new Error("Upload record unavailable");
  const item = ticket.data;
  if (!item) throw new MediaLibraryError("上传记录不存在。");
  if (item.asset_id)
    return {
      asset: await finalizedAsset(item.asset_id),
      sourceHash: item.source_hash,
    };
  if (Date.parse(item.expires_at) <= Date.now())
    throw new MediaLibraryError(
      "上传凭据已过期，请重新选择文件。",
      "UPLOAD_EXPIRED",
    );
  const path = `${owner}/${id}`;
  const staged = db.storage.from(MEDIA_UPLOAD_BUCKET);
  const downloaded = await staged.download(
    path,
    {},
    { signal: AbortSignal.timeout(25000) },
  );
  if (downloaded.error || !downloaded.data) {
    if (
      downloaded.error &&
      "statusCode" in downloaded.error &&
      String(downloaded.error.statusCode) === "404"
    )
      throw new MediaLibraryError(
        "文件尚未完整到达，请点击重试；不会重复发布图片。",
        "UPLOAD_MISSING",
      );
    throw new Error("Staging storage unavailable");
  }
  if (
    downloaded.data.size !== item.byte_size ||
    downloaded.data.size > MAX_IMAGE_BYTES
  )
    throw new MediaLibraryError("文件大小与上传记录不一致。");
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const prepared = await validateStagedImage(bytes, item);
  const store = createPublisherStore().media;
  await store.upload(
    prepared.media.storage_path,
    prepared.bytes,
    prepared.media.mime_type,
  );
  const asset = await registerMedia(
    prepared.media,
    prepared.bytes.byteLength,
    item.name,
  );
  const finished = await db
    .from("media_uploads")
    .update({ asset_id: asset.id })
    .eq("id", id)
    .eq("owner_id", owner)
    .select("id");
  if (finished.error || !finished.data?.length)
    throw new Error("Upload confirmation unavailable");
  // Cleanup only the private, completed staging object. Public objects are never deleted here.
  await staged.remove([path]).catch(() => undefined);
  return { asset, sourceHash: item.source_hash };
}
